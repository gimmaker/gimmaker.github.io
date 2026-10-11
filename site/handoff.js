// Opens the site the way the Discord bot asked: picks the tool, loads the
// link or the attached file, fills in the options and starts the edit.
//
//   ?tool=deepfry&media=<Discord file URL>&level=nuclear&run=1
//   ?tool=caption&url=<reel or xeet link>&text=hello&run=1

const g = window.gimmaker;
const WORKER = (window.GIMMAKER_WORKER_URL || location.origin).replace(/\/$/, "");
const TABS = { gimmideo: "embed", gimmaudio: "audio", deepfry: "fry", caption: "caption", gif: "gif" };

const params = new URLSearchParams(location.search);
const tool = TABS[params.get("tool")];

// Discord's file host can't be read from the browser, so the worker relays it.
async function relay(src) {
  const res = await fetch(`${WORKER}/api/media?src=${encodeURIComponent(src)}`);
  if (!res.ok) throw new Error((await res.text()) || "Couldn't get the file from Discord.");
  const blob = await res.blob();
  const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "file");
  return new File([blob], name, { type: blob.type });
}

function waitFor(check, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("The media took too long to load. Try again."));
      setTimeout(tick, 200);
    };
    tick();
  });
}

function choose(group, value) {
  document.querySelector(`[data-choice="${group}"] [data-value="${CSS.escape(value)}"]`)?.click();
}

async function start() {
  // Clean the address so a refresh doesn't run the edit again.
  history.replaceState(null, "", location.pathname);

  const tab = document.getElementById(`tab-${tool}`);
  if (tab.getAttribute("aria-selected") !== "true") tab.click();
  const panel = document.getElementById(`panel-${tool}`);
  const status = panel.querySelector(".tool-status");
  const say = (text) => status && (status.textContent = text);

  try {
    if (params.get("mode")) choose("audio-mode", params.get("mode"));
    if (params.get("level")) choose("fry", params.get("level"));
    if (params.get("size")) choose("gif", params.get("size"));
    if (params.get("text")) document.getElementById("caption-text").value = params.get("text");

    if (params.get("media")) {
      say("Getting your file from Discord…");
      g.setFile(await relay(params.get("media")));
    }
    if (params.get("audio")) {
      const input = document.getElementById("audio-file");
      const files = new DataTransfer();
      files.items.add(await relay(params.get("audio")));
      input.files = files.files;
      input.dispatchEvent(new Event("change"));
    }

    if (params.get("run") === "1" && tool !== "embed") {
      say("Loading your media…");
      // Caption needs the media's size, which is known once the preview loads.
      await waitFor(() => g.sourceKind() && (tool !== "caption" || g.sourceSize()));
      say("");
      panel.querySelector(".run").click();
    }
  } catch (e) {
    say(e.message);
  }
}

if (tool) start();
