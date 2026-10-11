// Gimmaudio FC, Deepfry FC, Caption FC and GIF FC. Everything runs in the
// browser with ffmpeg.wasm (FFmpeg compiled to WebAssembly), so files never
// leave the visitor's computer. The ~30 MB engine loads on first use.

import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { fetchFile, toBlobURL } from "./vendor/util/index.js";

const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
const g = window.gimmaker;

// ---------- Engine ----------

// The CDN compresses the engine, so Content-Length is the compressed size and
// only an estimate of the bytes we read; ffmpeg's own toBlobURL progress mode
// treats that mismatch as an error, hence this small replacement.
async function blobURLWithProgress(url, type, onProgress) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("Couldn't download the video engine.");
  const total = Number(res.headers.get("Content-Length")) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress(Math.min(99, Math.round((received / total) * 100)));
  }
  return URL.createObjectURL(new Blob(chunks, { type }));
}

let enginePromise = null;
function engine(setStatus) {
  if (!enginePromise) {
    setStatus("Loading the video engine (about 30 MB, first time only)…");
    enginePromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await blobURLWithProgress(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm", (pct) =>
          setStatus(`Loading the video engine (first time only)… ${pct}%`),
        ),
      });
      return ffmpeg;
    })();
    enginePromise.catch(() => (enginePromise = null));
  }
  return enginePromise;
}

// ---------- Helpers ----------

const even = "scale=trunc(iw/2)*2:trunc(ih/2)*2";
const x264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
// Palette tuned for small files: only changed areas are redrawn each frame.
const gifPalette =
  "split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle";
const MIME = { mp4: "video/mp4", gif: "image/gif", jpg: "image/jpeg", png: "image/png" };

function inputName(blob, kind) {
  const fromName = /\.(\w+)$/.exec(blob.name || "")?.[1]?.toLowerCase();
  if (fromName) return `input.${fromName}`;
  return `input.${kind === "video" ? "mp4" : kind === "gif" ? "gif" : "jpg"}`;
}

function choice(name) {
  return document.querySelector(`[data-choice="${name}"] [aria-pressed="true"]`)?.dataset.value;
}

// Renders the caption bar with the browser's own text engine, so ffmpeg only
// has to stack it on top of the media.
async function captionImage(text, width) {
  await document.fonts.load('800 40px "Montserrat"');
  const size = Math.max(18, Math.round(width / 11));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `800 ${size}px "Montserrat", "Helvetica Neue", Arial, sans-serif`;
  ctx.font = font;

  const maxWidth = width * 0.9;
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  const lineHeight = Math.round(size * 1.15);
  const pad = Math.round(size * 0.55);
  const height = Math.ceil((lines.length * lineHeight + pad * 2) / 2) * 2;
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, width / 2, pad + lineHeight * i + lineHeight / 2));

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return { blob, height };
}

// ---------- Tools ----------
// Each returns { output, attempts }: one or more argument lists to try in order.
// Files a tool writes go in `written` so they are cleaned up afterwards.

const FRY = {
  mild: { down: 2, sat: 2, con: 1.35, sharp: 1.5, noise: 10, crf: 38, q: 18, bits: 10, bass: 6 },
  crispy: { down: 3, sat: 3, con: 1.7, sharp: 2.5, noise: 22, crf: 46, q: 28, bits: 6, bass: 12 },
  nuclear: { down: 4, sat: 4.5, con: 2.2, sharp: 4, noise: 38, crf: 51, q: 31, bits: 4, bass: 20 },
};

const TOOLS = {
  async audio({ ffmpeg, kind, input, written }) {
    if (choice("audio-mode") === "remove") {
      if (kind !== "video") throw new Error("Images and GIFs have no audio to remove.");
      return { output: "out.mp4", attempts: [["-i", input, "-map", "0:v:0", "-c:v", "copy", "-an", "out.mp4"], ["-i", input, "-vf", even, ...x264, "-an", "out.mp4"]] };
    }
    const file = document.getElementById("audio-file").files[0];
    if (!file) throw new Error("Choose the new audio first.");
    const audio = `audio.${/\.(\w+)$/.exec(file.name)?.[1] || "mp3"}`;
    await ffmpeg.writeFile(audio, await fetchFile(file));
    written.push(audio);
    const tail = ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-shortest", "out.mp4"];
    if (kind === "video") {
      return {
        output: "out.mp4",
        attempts: [
          ["-i", input, "-i", audio, "-c:v", "copy", ...tail],
          ["-i", input, "-i", audio, "-vf", even, ...x264, ...tail],
        ],
      };
    }
    // A GIF loops and a photo is held for as long as the new audio plays.
    const loop = kind === "gif" ? ["-stream_loop", "-1"] : ["-loop", "1"];
    return { output: "out.mp4", attempts: [[...loop, "-i", input, "-i", audio, "-vf", even, ...x264, ...tail]] };
  },

  async fry({ kind, input }) {
    const p = FRY[choice("fry") || "crispy"];
    const vf =
      `scale=trunc(iw/${p.down}/2)*2:trunc(ih/${p.down}/2)*2,` +
      `eq=saturation=${p.sat}:contrast=${p.con}:brightness=0.06,` +
      `unsharp=7:7:${p.sharp}:7:7:0,noise=alls=${p.noise}:allf=t+u,` +
      `scale=trunc(iw*${p.down}/2)*2:trunc(ih*${p.down}/2)*2:flags=neighbor`;
    if (kind === "image") {
      return { output: "out.jpg", attempts: [["-i", input, "-vf", vf, "-q:v", String(p.q), "out.jpg"]] };
    }
    if (kind === "gif") {
      return { output: "out.gif", attempts: [["-i", input, "-filter_complex", `[0:v]${vf},${gifPalette}`, "-loop", "0", "out.gif"]] };
    }
    const video = ["-i", input, "-vf", vf, ...x264, "-crf", String(p.crf)];
    const earrape = `bass=g=${p.bass},acrusher=bits=${p.bits}:mode=log:aa=1,volume=2`;
    return {
      output: "out.mp4",
      attempts: [
        [...video, "-af", earrape, "-c:a", "aac", "-b:a", "32k", "out.mp4"],
        [...video, "-an", "out.mp4"], // no audio track
      ],
    };
  },

  async caption({ ffmpeg, kind, input, written }) {
    const text = document.getElementById("caption-text").value.trim();
    if (!text) throw new Error("Type a caption first.");
    const size = g.sourceSize();
    if (!size) throw new Error("The preview hasn't loaded yet. Try again in a second.");
    const width = Math.floor(size.width / 2) * 2;
    const { blob, height } = await captionImage(text, width);
    await ffmpeg.writeFile("caption.png", await fetchFile(blob));
    written.push("caption.png");
    const stack =
      `[0:v]scale=${width}:-2,pad=iw:ih+${height}:0:${height}:white[v];` + `[v][1:v]overlay=0:0`;
    if (kind === "image") {
      return { output: "out.png", attempts: [["-i", input, "-i", "caption.png", "-filter_complex", stack, "out.png"]] };
    }
    if (kind === "gif") {
      return {
        output: "out.gif",
        attempts: [["-i", input, "-i", "caption.png", "-filter_complex", `${stack},${gifPalette}`, "-loop", "0", "out.gif"]],
      };
    }
    const base = ["-i", input, "-i", "caption.png", "-filter_complex", `${stack}[out]`, "-map", "[out]", "-map", "0:a?", ...x264, "-crf", "28"];
    return { output: "out.mp4", attempts: [[...base, "-c:a", "copy", "out.mp4"], [...base, "-c:a", "aac", "out.mp4"]] };
  },

  async gif({ kind, input }) {
    // A GIF goes the other way: it becomes an MP4.
    if (kind === "gif") {
      return { output: "out.mp4", attempts: [["-i", input, "-movflags", "+faststart", "-vf", even, ...x264, "-crf", "23", "-an", "out.mp4"]] };
    }
    // Size is the longest side, so tall videos don't balloon.
    const side = Number(choice("gif") || 480);
    const fit = `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
    const vf = `fps=10,${fit},${gifPalette}`;
    const limit = kind === "image" ? [] : ["-t", "15"];
    return { output: "out.gif", attempts: [["-i", input, ...limit, "-filter_complex", `[0:v]${vf}`, "-loop", "0", "out.gif"]] };
  },
};

const OUTPUT_LABEL = { audio: "gimmaudio-fc", fry: "deepfry-fc", caption: "caption-fc", gif: "gif-fc" };

// ---------- Wiring ----------

for (const group of document.querySelectorAll("[data-choice]")) {
  group.addEventListener("click", (event) => {
    const option = event.target.closest(".option");
    if (!option) return;
    for (const o of group.querySelectorAll(".option")) o.setAttribute("aria-pressed", String(o === option));
  });
}

// Gimmaudio FC: the audio picker only matters when replacing.
document.querySelector('[data-choice="audio-mode"]').addEventListener("click", () => {
  const remove = choice("audio-mode") === "remove";
  document.getElementById("audio-pick").hidden = remove;
  document.getElementById("audio-run-label").textContent = remove ? "Remove audio" : "Replace audio";
});

const audioFile = document.getElementById("audio-file");
audioFile.addEventListener("change", () => {
  document.getElementById("audio-name").textContent = audioFile.files[0]?.name || "MP3, M4A, WAV or a video";
});

// GIF FC flips direction depending on the pinned media.
function updateGifPanel() {
  const fromGif = g.sourceKind() === "gif";
  document.getElementById("gif-sizes").hidden = fromGif;
  document.getElementById("gif-run-label").textContent = fromGif ? "Convert to video" : "Convert to GIF";
  document.getElementById("gif-sub").textContent = fromGif
    ? "Your GIF becomes an MP4 video"
    : "Convert to a GIF (first 15 seconds, size is the longest side), or upload a GIF to make it a video";
}
updateGifPanel();

// A new source makes old results stale.
document.addEventListener("sourcechange", () => {
  updateGifPanel();
  for (const panel of document.querySelectorAll(".tool-body")) {
    panel.querySelector(".tool-status").textContent = "";
    const result = panel.querySelector(".tool-result");
    result.replaceChildren();
    result.hidden = true;
  }
});

let busy = false;

for (const button of document.querySelectorAll(".run")) {
  const panel = button.closest(".tool-body");
  const status = panel.querySelector(".tool-status");
  const resultBox = panel.querySelector(".tool-result");
  const name = button.dataset.tool;
  const setStatus = (text) => (status.textContent = text);

  button.addEventListener("click", async () => {
    if (busy) return setStatus("Another tool is still working. Hang on…");
    const kind = g.sourceKind();
    if (!kind) return setStatus("Paste a link or upload a file in Your Media first.");

    busy = true;
    button.disabled = true;
    resultBox.hidden = true;
    const onProgress = ({ progress }) => {
      if (progress > 0 && progress <= 1) setStatus(`Working… ${Math.round(progress * 100)}%`);
    };
    let ffmpeg;
    const written = [];
    try {
      ffmpeg = await engine(setStatus);
      setStatus("Getting your media…");
      const blob = await g.sourceBlob();
      const input = inputName(blob, kind);
      await ffmpeg.writeFile(input, await fetchFile(blob));
      written.push(input);

      setStatus("Working…");
      ffmpeg.on("progress", onProgress);
      const job = await TOOLS[name]({ ffmpeg, kind, input, written });
      written.push(job.output);
      let ok = false;
      for (const args of job.attempts) {
        if ((await ffmpeg.exec(args)) === 0) {
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error("That file couldn't be processed. Try a different one.");

      const data = await ffmpeg.readFile(job.output);
      const ext = job.output.split(".").pop();
      const out = new Blob([data.buffer], { type: MIME[ext] });
      const fileName = `gimmaker-${OUTPUT_LABEL[name]}.${ext}`;
      const res = g.showResult(name, out, fileName);

      const link = document.createElement("a");
      link.className = "option";
      link.href = res.url;
      link.download = fileName;
      link.innerHTML = `<span class="option-title">Download result</span><span class="option-sub"></span>`;
      link.querySelector(".option-sub").textContent = `${ext.toUpperCase()} · ${g.formatSize(out.size)}`;
      resultBox.replaceChildren(link);
      resultBox.hidden = false;
      setStatus("Done.");
    } catch (e) {
      setStatus(e.message || "Something went wrong.");
    } finally {
      if (ffmpeg) {
        ffmpeg.off("progress", onProgress);
        for (const file of written) {
          try { await ffmpeg.deleteFile(file); } catch {}
        }
      }
      busy = false;
      button.disabled = false;
    }
  });
}
