// Pinned media (link or upload), Gimmideo FC, and the preview column.
// Exposes window.gimmaker so tools.js can read the media and show results.
(() => {
  const WORKER = (window.GIMMAKER_WORKER_URL || location.origin).replace(/\/$/, "");
  const STORAGE_KEY = "gimmaker.link";

  const X_HOSTS = /(^|\.)(x\.com|twitter\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com|fixvx\.com)$/i;
  const IG_HOSTS = /(^|\.)(instagram\.com|ddinstagram\.com|kkinstagram\.com|instagramez\.com)$/i;

  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const input = $("link");
  const error = $("error");
  const uploadRow = $("upload-row");
  const upload = $("upload");
  const sourceStatus = $("source-status");
  const sourceName = $("source-name");
  const result = $("result");
  const fixedUrl = $("fixed-url");
  const copied = $("copied");
  const loading = $("loading");
  const downloads = $("downloads");
  const previewTabs = $("preview-tabs");
  const mediaBox = $("media");
  const outputBox = $("output");

  let tool = "embed";
  let source = null; // { type: "link", original, site, item } or { type: "file", file, kind, url }
  const results = {}; // tool -> { url, kind, name, size }
  let view = "original";

  const store = {
    get() {
      try { return localStorage.getItem(STORAGE_KEY) || ""; } catch { return ""; }
    },
    set(value) {
      try { value ? localStorage.setItem(STORAGE_KEY, value) : localStorage.removeItem(STORAGE_KEY); } catch {}
    },
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    node.append(...children);
    return node;
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  // Same rewrite the worker expects: keep the path, swap the domain.
  function fixLink(raw) {
    let url;
    try {
      url = new URL(raw.trim());
    } catch {
      return { error: "That doesn't look like a link." };
    }
    if (!X_HOSTS.test(url.hostname) && !IG_HOSTS.test(url.hostname)) {
      return { error: "Only X/Twitter and Instagram post links are supported." };
    }
    const index = url.searchParams.get("img_index");
    return { fixed: WORKER + url.pathname + (index ? `?img_index=${encodeURIComponent(index)}` : "") };
  }

  const formatSize = (bytes) =>
    bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;

  function mediaElement(kind, url, poster) {
    // index.html sets referrer to no-referrer; X and Instagram's CDNs refuse ours.
    return kind === "video"
      ? el("video", { src: url, poster: poster || "", controls: true, muted: true, playsInline: true, loop: true })
      : el("img", { src: url, alt: "" });
  }

  // ---------- Preview column ----------

  function renderPreview() {
    const res = results[tool];
    previewTabs.hidden = !res;
    if (!res) view = "original";
    for (const b of previewTabs.querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b.dataset.view === view));
    }
    mediaBox.hidden = view !== "original";
    outputBox.hidden = view !== "result";
    outputBox.replaceChildren(...(res ? [mediaElement(res.kind, res.url)] : []));
  }

  previewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    view = button.dataset.view;
    renderPreview();
  });

  // ---------- Pinned source ----------

  function setSource(next) {
    if (source?.type === "file") URL.revokeObjectURL(source.url);
    source = next;
    for (const key of Object.keys(results)) {
      URL.revokeObjectURL(results[key].url);
      delete results[key];
    }
    document.dispatchEvent(new CustomEvent("sourcechange"));
    sourceStatus.hidden = !source;
    if (source?.type === "file") {
      sourceName.textContent = `Using upload: ${source.file.name}`;
      mediaBox.classList.remove("multi");
      mediaBox.replaceChildren(mediaElement(source.kind === "video" ? "video" : "image", source.url));
    } else if (source?.type === "link") {
      sourceName.textContent = `Using ${source.site} post`;
    } else {
      mediaBox.replaceChildren();
    }
    view = "original";
    renderPreview();
  }

  upload.addEventListener("change", () => {
    const file = upload.files[0];
    upload.value = "";
    if (!file) return;
    const kind = file.type === "image/gif" ? "gif" : file.type.startsWith("image/") ? "image" : "video";
    showError("");
    setSource({ type: "file", file, kind, url: URL.createObjectURL(file) });
  });

  $("clear-source").addEventListener("click", () => {
    input.value = "";
    lastLink = "";
    store.set("");
    resetExtractor();
    setSource(null);
  });

  // ---------- Gimmideo FC ----------

  function resetExtractor() {
    result.hidden = true;
    downloads.replaceChildren();
    downloads.hidden = true;
  }

  function renderDownloads(post, original) {
    downloads.replaceChildren(
      ...post.shown.map((m, n) =>
        el("a", { className: "option", href: `${WORKER}/api/download?url=${encodeURIComponent(original)}&i=${m.index}` }, [
          el("span", { className: "option-title", textContent: m.kind === "video" ? "Download video" : "Download photo" }),
          el("span", {
            className: "option-sub",
            textContent: (m.kind === "video" ? "MP4" : "JPG") + (post.shown.length > 1 ? ` · ${n + 1}` : ""),
          }),
        ]),
      ),
    );
    downloads.hidden = false;
  }

  async function loadPost(original) {
    loading.hidden = false;
    loading.textContent = "Loading post…";
    downloads.hidden = true;
    try {
      const res = await fetch(`${WORKER}/api/post?url=${encodeURIComponent(original)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load that post.");
      if (input.value.trim() !== original) return; // a newer link was pasted meanwhile
      loading.hidden = true;
      renderDownloads(data, original);
      // The first item becomes the pinned media for every other tool.
      const item = data.shown[0];
      setSource(item ? { type: "link", original, site: data.site, item } : null);
      mediaBox.classList.toggle("multi", data.shown.length > 1);
      mediaBox.replaceChildren(...data.shown.map((m) => mediaElement(m.kind, m.url, m.thumbnail)));
    } catch (e) {
      loading.textContent = e.message.startsWith("Failed to fetch") ? "Couldn't reach the link fixer." : e.message;
    }
  }

  let lastLink = "";
  function update() {
    const raw = input.value.trim();
    if (raw === lastLink) return;
    lastLink = raw;
    if (!raw) {
      showError("");
      resetExtractor();
      return;
    }
    const { fixed, error: message } = fixLink(raw);
    showError(message || "");
    if (!fixed) return resetExtractor();
    store.set(raw);
    result.hidden = false;
    fixedUrl.textContent = fixed;
    copied.textContent = "";
    loadPost(raw);
  }

  // No button: fix the link as soon as it's pasted or typed (Enter also works).
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(update, 300);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    update();
  });

  fixedUrl.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(fixedUrl.textContent);
      copied.textContent = "Copied!";
    } catch {
      copied.textContent = "Couldn't copy";
    }
    setTimeout(() => (copied.textContent = ""), 1500);
  });

  // ---------- Tool switching ----------

  document.addEventListener("toolchange", (event) => {
    tool = event.detail;
    uploadRow.hidden = tool === "embed";
    view = results[tool] ? "result" : "original";
    renderPreview();
  });

  // ---------- Shared with tools.js ----------

  window.gimmaker = {
    source: () => source,
    // Size of the media as shown in the preview, for tools that need it.
    sourceSize() {
      const node = mediaBox.querySelector("video, img");
      if (!node) return null;
      const width = node.videoWidth || node.naturalWidth;
      const height = node.videoHeight || node.naturalHeight;
      return width && height ? { width, height } : null;
    },
    async sourceBlob() {
      if (!source) throw new Error("Paste a link or upload a file first.");
      if (source.type === "file") return source.file;
      // Fetched through our worker, which allows cross-site reads.
      const res = await fetch(
        `${WORKER}/api/download?url=${encodeURIComponent(source.original)}&i=${source.item.index}`,
      );
      if (!res.ok) throw new Error("Couldn't download the media from that post.");
      return res.blob();
    },
    // Kind of the pinned media: "video", "gif" or "image".
    sourceKind() {
      if (!source) return null;
      return source.type === "file" ? source.kind : source.item.kind === "video" ? "video" : "image";
    },
    showResult(forTool, blob, name) {
      if (results[forTool]) URL.revokeObjectURL(results[forTool].url);
      const kind = blob.type.startsWith("video/") ? "video" : "image";
      results[forTool] = { url: URL.createObjectURL(blob), kind, name, size: blob.size };
      if (forTool === tool) view = "result";
      renderPreview();
      return results[forTool];
    },
    formatSize,
  };

  // Restore a link from ?url=, or the last one used, so it stays pinned.
  const preset = new URLSearchParams(location.search).get("url") || store.get();
  if (preset) {
    input.value = preset;
    update();
  }
})();
