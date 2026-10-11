// gimmaker Cloudflare Worker: link-preview bots get an embed page, people get
// redirected to the original post.
//
//   https://x.com/user/status/123        -> https://<gimmaker>/user/status/123
//   https://www.instagram.com/reel/ABC/  -> https://<gimmaker>/reel/ABC/
//
// The website in /site is served for everything else (as static assets).

import { oembedJson, pickMedia, renderEmbed, title } from "./embed.js";
import { fetchInstagram } from "./instagram.js";
import { fetchTweet } from "./twitter.js";
import { BROWSER_UA, FetchError } from "./util.js";

// User agents of link-preview crawlers (Discord, Telegram, Slack, ...).
const BOT_UA =
  /discordbot|twitterbot|telegrambot|slackbot|facebookexternalhit|whatsapp|mastodon|iframely|embedly|redditbot|skypeuripreview|linkedinbot|vkshare|bluesky|cardyb|matrix|synapse|element/i;

const TWEET_PATH = /^\/(?:(?<user>\w+)\/|i\/(?:web\/)?)?status(?:es)?\/(?<id>\d+)(?:\/(?:photo|video)\/(?<n>\d))?\/?$/;
const IG_PATH = /^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/(?<code>[\w-]+)(?:\/(?<n>\d+))?\/?$/;
const IG_MEDIA_PATH = /^\/ig\/media\/(?<code>[\w-]+)\/(?<i>\d+)$/;

const X_HOSTS = /(^|\.)(x\.com|twitter\.com|fixupx\.com|fxtwitter\.com|vxtwitter\.com|fixvx\.com)$/i;
const IG_HOSTS = /(^|\.)(instagram\.com|ddinstagram\.com|kkinstagram\.com|instagramez\.com)$/i;

const CORS = { "Access-Control-Allow-Origin": "*" };

const text = (status, body) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const html = (body) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });

function parseIndex(raw) {
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

// Works out which post a path refers to; null if it isn't a post link.
function matchPost(pathname, searchParams) {
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
function parsePostLink(link) {
  let url;
  try {
    url = new URL(link);
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

const POST_UNAVAILABLE = "Couldn't load that post. It may be private, deleted or age-restricted.";

// JSON summary of a post for the website's preview.
async function apiPost(link, base) {
  const { url, target, error } = parsePostLink(link);
  if (error) return json(400, { error });

  try {
    const post = await target.fetch();
    const query = url.searchParams.get("img_index") ? `?img_index=${url.searchParams.get("img_index")}` : "";
    return json(200, {
      ...post,
      title: title(post),
      // index lets the website ask /api/download for a specific item.
      shown: pickMedia(post, target.index).map((m) => ({ ...m, index: post.media.indexOf(m) })),
      fixedUrl: `${base}${url.pathname}${query}`,
    });
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
    return json(502, { error: POST_UNAVAILABLE });
  }
}

// Streams one media item of a post back as a file download. Browsers ignore the
// download attribute on cross-site links, so the file has to come from us. Only
// media belonging to the given post can be fetched, so this isn't an open proxy.
async function apiDownload(link, rawIndex) {
  const { target, error } = parsePostLink(link);
  if (error) return text(400, error);

  let post;
  try {
    post = await target.fetch();
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
    return text(502, POST_UNAVAILABLE);
  }
  const index = Number(rawIndex) || 0;
  const media = post.media[index];
  if (!media) return text(404, "Media not found.");

  const upstream = await fetch(media.url, { headers: { "User-Agent": BROWSER_UA } });
  if (!upstream.ok) return text(502, "Couldn't download that file.");

  const ext = media.kind === "video" ? "mp4" : "jpg";
  const id = post.url.split("/").filter(Boolean).pop();
  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") || (media.kind === "video" ? "video/mp4" : "image/jpeg"),
    "Content-Disposition": `attachment; filename="gimmaker-${post.site.toLowerCase()}-${id}-${index + 1}.${ext}"`,
    ...CORS,
  });
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const base = url.origin;
    const { pathname, searchParams } = url;

    if (pathname === "/oembed") return json(200, oembedJson(searchParams));
    if (pathname === "/api/post") return apiPost(searchParams.get("url") || "", base);
    if (pathname === "/api/download") return apiDownload(searchParams.get("url") || "", searchParams.get("i"));

    let m = pathname.match(IG_MEDIA_PATH);
    if (m) {
      try {
        const post = await fetchInstagram(m.groups.code);
        const media = post.media[Number(m.groups.i)];
        if (media) return Response.redirect(media.url, 302);
      } catch (e) {
        if (!(e instanceof FetchError)) throw e;
      }
      return text(404, "Media not found.");
    }

    const target = matchPost(pathname, searchParams);
    if (!target) return text(404, "Not a supported X or Instagram post link.");

    // ?embed=1 forces the bot view, handy for checking output in a browser.
    const isBot = BOT_UA.test(request.headers.get("User-Agent") || "") || searchParams.has("embed");
    if (!isBot) return Response.redirect(target.original, 302);

    try {
      const post = await target.fetch();
      return html(
        renderEmbed(post, base, { index: target.index, mediaUrl: target.mediaUrl && target.mediaUrl(base) }),
      );
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      console.error(e.message);
      return Response.redirect(target.original, 302);
    }
  },
};
