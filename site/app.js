(() => {
  const WORKER = (window.GIMMAKER_WORKER_URL || location.origin).replace(/\/$/, "");

  const X_HOSTS = /(^|\.)(x\.com|twitter\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com|fixvx\.com)$/i;
  const IG_HOSTS = /(^|\.)(instagram\.com|ddinstagram\.com|kkinstagram\.com|instagramez\.com)$/i;

  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const input = $("link");
  const error = $("error");
  const result = $("result");
  const fixedUrl = $("fixed-url");
  const fixedText = $("fixed-url-text");
  const downloads = $("downloads");
  const loading = $("loading");
  const mediaBox = $("media");

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

  function el(tag, attrs = {}) {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    return node;
  }

  function clearMedia() {
    mediaBox.replaceChildren();
    downloads.replaceChildren();
  }

  function renderMedia(post, original) {
    const many = post.shown.length > 1;
    mediaBox.classList.toggle("multi", many);
    post.shown.forEach((m, n) => {
      // index.html sets referrer to no-referrer; X and Instagram's CDNs refuse ours.
      mediaBox.append(
        m.kind === "video"
          ? el("video", { src: m.url, poster: m.thumbnail || "", controls: true, muted: true, playsInline: true })
          : el("img", { src: m.url, alt: "", loading: "lazy" }),
      );
      const link = el("a", {
        className: "option",
        href: `${WORKER}/api/download?url=${encodeURIComponent(original)}&i=${m.index}`,
      });
      link.append(
        el("span", { className: "option-title", textContent: m.kind === "video" ? "Download video" : "Download photo" }),
        el("span", { className: "option-sub", textContent: (m.kind === "video" ? "MP4" : "JPG") + (many ? ` · ${n + 1}` : "") }),
      );
      downloads.append(link);
    });
  }

  async function loadMedia(original) {
    loading.hidden = true;
    clearMedia();
    try {
      const res = await fetch(`${WORKER}/api/post?url=${encodeURIComponent(original)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load that post.");
      renderMedia(data, original);
    } catch (e) {
      loading.textContent = e.message.startsWith("Failed to fetch") ? "Couldn't reach the link fixer." : e.message;
      loading.hidden = false;
    }
  }

  let lastLink = "";
  function update() {
    const raw = input.value.trim();
    if (raw === lastLink) return;
    lastLink = raw;
    if (!raw) {
      showError("");
      result.hidden = true;
      clearMedia();
      return;
    }
    const { fixed, error: message } = fixLink(raw);
    showError(message || "");
    result.hidden = !fixed;
    if (!fixed) return clearMedia();
    fixedText.textContent = fixed;
    loadMedia(raw);
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

  // The box shows the link; clicking it copies and briefly says so in place.
  fixedUrl.addEventListener("click", async () => {
    const link = fixedText.textContent;
    if (link === "Copied!" || link === "Couldn't copy") return;
    try {
      await navigator.clipboard.writeText(link);
      fixedText.textContent = "Copied!";
    } catch {
      fixedText.textContent = "Couldn't copy";
    }
    setTimeout(() => (fixedText.textContent = link), 1200);
  });

  // Supports sharing a prefilled tool link: ?url=<post link>
  const preset = new URLSearchParams(location.search).get("url");
  if (preset) {
    input.value = preset;
    update();
  }
})();
