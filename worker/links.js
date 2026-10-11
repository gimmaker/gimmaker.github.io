// Recognising X/Instagram post links. Shared by the embed fixer, the website's
// API and the Discord bot.

import { fetchInstagram } from "./instagram.js";
import { fetchTweet } from "./twitter.js";

export const TWEET_PATH = /^\/(?:(?<user>\w+)\/|i\/(?:web\/)?)?status(?:es)?\/(?<id>\d+)(?:\/(?:photo|video)\/(?<n>\d))?\/?$/;
export const IG_PATH = /^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/(?<code>[\w-]+)(?:\/(?<n>\d+))?\/?$/;

const X_HOSTS = /(^|\.)(x\.com|twitter\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com|fixvx\.com)$/i;
const IG_HOSTS = /(^|\.)(instagram\.com|ddinstagram\.com|kkinstagram\.com|instagramez\.com)$/i;

export const POST_UNAVAILABLE = "Couldn't load that post. It may be private, deleted or age-restricted.";

function parseIndex(raw) {
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

// Works out which post a path refers to; null if it isn't a post link.
export function matchPost(pathname, searchParams) {
  let m = pathname.match(TWEET_PATH);
  if (m) {
    return {
      original: `https://x.com${pathname}`,
      index: parseIndex(m.groups.n),
      fetch: () => fetchTweet(m.groups.id),
      mediaUrl: null,
    };
  }
  m = pathname.match(IG_PATH);
  if (m) {
    const { code } = m.groups;
    return {
      original: `https://www.instagram.com${pathname}`,
      // Instagram carousels use ?img_index=N; also accept /p/CODE/N.
      index: parseIndex(m.groups.n || searchParams.get("img_index")),
      fetch: () => fetchInstagram(code),
      // Instagram video URLs are signed and expire, so point Discord at our
      // redirect endpoint, which always resolves to a fresh URL.
      mediaUrl: (base) => (media, i) => (media.kind === "video" ? `${base}/ig/media/${code}/${i}` : media.url),
    };
  }
  return null;
}

// Parses a pasted X/Instagram link; returns { url, target } or { error }.
export function parsePostLink(link) {
  let url;
  try {
    url = new URL(link.trim());
  } catch {
    return { error: "That doesn't look like a link." };
  }
  if (!X_HOSTS.test(url.hostname) && !IG_HOSTS.test(url.hostname)) {
    return { error: "Only X/Twitter and Instagram post links are supported." };
  }
  const target = matchPost(url.pathname, url.searchParams);
  if (!target) return { error: "That isn't a link to a single post." };
  return { url, target };
}

// First X/Instagram post link in a block of text (e.g. a Discord message).
export function findPostLink(text) {
  for (const candidate of text.match(/https?:\/\/[^\s<>|)]+/g) || []) {
    if (!parsePostLink(candidate).error) return candidate;
  }
  return null;
}
