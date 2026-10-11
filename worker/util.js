// Shared helpers for the gimmaker worker.

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/129.0 Safari/537.36";

export class FetchError extends Error {}

export async function getText(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, ...headers } });
  } catch (e) {
    throw new FetchError(`GET ${url} failed: ${e.message}`);
  }
  if (!res.ok) throw new FetchError(`GET ${url} failed: ${res.status}`);
  return res.text();
}

export async function getJson(url, headers) {
  const body = await getText(url, headers);
  try {
    return JSON.parse(body);
  } catch {
    throw new FetchError(`GET ${url} returned non-JSON`);
  }
}

export function compact(n) {
  if (n == null) return null;
  n = Number(n);
  for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (n >= div) return (n / div).toFixed(1).replace(/\.0$/, "") + suffix;
  }
  return String(n);
}

// Joins non-empty stat fragments, e.g. ["💬 12", "", "❤️ 3K"] -> "💬 12   ❤️ 3K".
export function joinStats(parts) {
  return parts.filter(Boolean).join("   ");
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function unescapeHtml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Small per-isolate cache so repeat crawls of the same post don't refetch.
export class TTLCache {
  constructor(ttlMs = 10 * 60 * 1000, maxItems = 1000) {
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    this.map.delete(key);
    return null;
  }
  set(key, value) {
    if (this.map.size >= this.maxItems) this.map.clear();
    this.map.set(key, { expires: Date.now() + this.ttlMs, value });
  }
}
