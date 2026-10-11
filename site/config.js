// Address of the gimmaker Cloudflare Worker (the link fixer), without a trailing slash.
// Leave empty when the site is served by the worker itself (local dev, workers.dev).
// The GitHub Pages copy needs it set, e.g. "https://gimmaker.<your-subdomain>.workers.dev".
window.GIMMAKER_WORKER_URL = location.hostname.endsWith("github.io") ? "https://gimmaker.gimmaker.workers.dev" : "";
