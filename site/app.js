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
  const copy = $("copy");
  const loading = $("loading");
  const card = $("card");

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

  function renderCard(post) {
    card.style.setProperty("--card-color", post.color);
    $("card-provider").textContent = `gimmaker · ${post.site}`;
    $("card-stats").textContent = post.stats;
    $("card-title").textContent = post.title;
    // Match the worker's embed, which trims descriptions the way Discord shows them.
    $("card-text").textContent = post.text.length > 340 ? post.text.slice(0, 339).trimEnd() + "…" : post.text;

    const media = $("card-media");
    media.replaceChildren();
    media.classList.toggle("multi", post.shown.length > 1);
    for (const m of post.shown) {
      // index.html sets referrer to no-referrer; X and Instagram's CDNs refuse ours.
      media.append(
        m.kind === "video"
          ? el("video", { src: m.url, poster: m.thumbnail || "", controls: true, muted: true, playsInline: true })
          : el("img", { src: m.url, alt: "", loading: "lazy" }),
      );
    }
    card.hidden = false;
  }

  async function loadPreview(original) {
    loading.hidden = false;
    loading.textContent = "Loading post…";
    card.hidden = true;
    try {
      const res = await fetch(`${WORKER}/api/post?url=${encodeURIComponent(original)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't load that post.");
      loading.hidden = true;
      renderCard(data);
    } catch (e) {
      loading.textContent = e.message.startsWith("Failed to fetch")
        ? "Couldn't reach the link fixer, so no preview. The fixed link above still works once it's online."
        : e.message;
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const { fixed, error: message } = fixLink(input.value);
    showError(message || "");
    result.hidden = !fixed;
    if (!fixed) return;
    fixedUrl.textContent = fixed;
    copy.textContent = "Copy";
    loadPreview(input.value.trim());
  });

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(fixedUrl.textContent);
      copy.textContent = "Copied!";
    } catch {
      copy.textContent = "Copy failed";
    }
  });

  // Supports sharing a prefilled tool link: ?url=<post link>
  const preset = new URLSearchParams(location.search).get("url");
  if (preset) {
    input.value = preset;
    form.requestSubmit();
  }
})();
