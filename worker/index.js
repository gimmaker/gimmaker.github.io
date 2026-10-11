// gimmaker Cloudflare Worker: link-preview bots get an embed page, people get
// redirected to the original post.
//
//   https://x.com/user/status/123        -> https://<gimmaker>/user/status/123
//   https://www.instagram.com/reel/ABC/  -> https://<gimmaker>/reel/ABC/
//
// The website in /site is served for everything else (as static assets).

import { handleDiscord } from "./discord.js";
import { Gateway } from "./gateway.js";
import { MAX_UPLOAD, Renderer } from "./render.js";
import { oembedJson, pickMedia, renderEmbed, title } from "./embed.js";
import { fetchInstagram } from "./instagram.js";
import { matchPost, parsePostLink, POST_UNAVAILABLE } from "./links.js";
import { BROWSER_UA, FetchError } from "./util.js";

// User agents of link-preview crawlers (Discord, Telegram, Slack, ...).
const BOT_UA =
  /discordbot|twitterbot|telegrambot|slackbot|facebookexternalhit|whatsapp|mastodon|iframely|embedly|redditbot|skypeuripreview|linkedinbot|vkshare|bluesky|cardyb|matrix|synapse|element/i;

const IG_MEDIA_PATH = /^\/ig\/media\/(?<code>[\w-]+)\/(?<i>\d+)$/;

// Hosts /api/media will relay: files people attach to Discord bot commands.
const DISCORD_CDN = /^(cdn\.discordapp\.com|media\.discordapp\.net)$/;

const CORS = { "Access-Control-Allow-Origin": "*" };

const text = (status, body) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const html = (body) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });

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

// Relays a Discord attachment to the website, which can't read Discord's CDN
// directly. Only Discord's file hosts are allowed, so this isn't an open proxy.
async function apiMedia(src) {
  let url;
  try {
    url = new URL(src);
  } catch {
    return text(400, "Bad media link.");
  }
  if (url.protocol !== "https:" || !DISCORD_CDN.test(url.hostname)) return text(400, "Only Discord attachments are supported.");
  const upstream = await fetch(url, { headers: { "User-Agent": BROWSER_UA } });
  if (!upstream.ok) return text(502, "That Discord file has expired. Run the command again.");
  const headers = new Headers({ "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream", ...CORS });
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(upstream.body, { headers });
}

// The Durable Object that keeps the bot connected to Discord.
export { Gateway, Renderer };

function gateway(env) {
  return env.GATEWAY.get(env.GATEWAY.idFromName("main"));
}

// Tells the bot which deployment is calling, so an old copy can restart.
function gatewayRequest(env, path) {
  return gateway(env).fetch(`https://gateway${path}`, {
    headers: { "X-Worker-Version": env.CF_VERSION_METADATA?.id || "" },
  });
}

export default {
  // Once a minute, make sure the bot is still connected.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(gatewayRequest(env, "/ensure"));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const base = url.origin;
    const { pathname, searchParams } = url;

    if (pathname === "/discord/status") return gatewayRequest(env, "/status");
    // Private end-to-end check of the cloud browser, guarded by a secret key.
    if (pathname.startsWith("/discord/render-test")) {
      if (!env.RENDER_TEST_KEY || searchParams.get("key") !== env.RENDER_TEST_KEY) return text(404, "Not found.");
      const renderer = env.RENDERER.get(env.RENDERER.idFromName("main"));
      if (pathname.endsWith("/result")) return renderer.fetch("https://renderer/test-result");
      const options = { tool: searchParams.get("tool") || "deepfry", link: searchParams.get("link"), level: "nuclear", text: "test", size: "320", mode: "extract" };
      const params = Object.fromEntries(new URLSearchParams([...Object.entries({ tool: options.tool, url: options.link, level: options.level, text: options.text, size: options.size, mode: options.mode })]));
      return renderer.fetch("https://renderer/render", { method: "POST", body: JSON.stringify({ options, params, target: { kind: "test" } }) });
    }
    if (pathname === "/discord") return handleDiscord(request, env, ctx, base);
    if (pathname === "/api/media") return apiMedia(searchParams.get("src") || "");
    // The cloud browser hands finished bot edits back here (see render.js).
    if (pathname === "/api/deliver" && request.method === "POST") {
      const job = searchParams.get("job") || "";
      if (Number(request.headers.get("Content-Length")) > MAX_UPLOAD) return text(413, "Too big for Discord.");
      return env.RENDERER.get(env.RENDERER.idFromName("main")).fetch(`https://renderer/deliver/${encodeURIComponent(job)}`, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });
    }
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
