// Discord bot, served over Discord's HTTP interactions (no gateway connection),
// so it runs on this same free worker. Setup steps are in README.md.
//
// /gimmideo and the "Gimmideo FC" message command answer in Discord with the
// fixed link. The editing commands hand off to the website, which opens with
// the media, tool and options filled in and runs the edit in the browser.

import { findPostLink, parsePostLink, POST_UNAVAILABLE } from "./links.js";
import { pickMedia } from "./embed.js";
import { FetchError } from "./util.js";

const SITE = "https://gimmaker.github.io/";
const API = "https://discord.com/api/v10";

// Interaction and response types from the Discord API.
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const EPHEMERAL = 64;

const TOOL_NAMES = { gimmaudio: "Gimmaudio FC", deepfry: "Deepfry FC", caption: "Caption FC", gif: "GIF FC" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const linkButton = (label, url) => ({ type: 2, style: 5, label, url });
const row = (...buttons) => ({ type: 1, components: buttons });

// A private reply only the person who ran the command sees.
const privateReply = (content, components = []) =>
  json({ type: MESSAGE, data: { content, components, flags: EPHEMERAL } });

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g) || [], (b) => parseInt(b, 16));
}

// Discord signs every request; anything that fails verification is rejected.
async function verify(request, body, publicKey) {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
  } catch {
    return false;
  }
}

function options(interaction) {
  const out = {};
  for (const o of interaction.data.options || []) out[o.name] = o.value;
  return out;
}

function attachment(interaction, id) {
  return id ? interaction.data.resolved?.attachments?.[id] : null;
}

// ---------- Gimmideo FC ----------

// Builds the reply for a post link: the fixed link (which Discord turns into a
// playable embed) plus Download and Open buttons.
async function gimmideoMessage(link, base) {
  const { url, target, error } = parsePostLink(link);
  if (error) return { content: `⚠️ ${error}` };
  let post;
  try {
    post = await target.fetch();
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
    return { content: `⚠️ ${POST_UNAVAILABLE}` };
  }
  const query = url.searchParams.get("img_index") ? `?img_index=${url.searchParams.get("img_index")}` : "";
  const shown = pickMedia(post, target.index);
  const buttons = [];
  if (shown[0]) {
    const i = post.media.indexOf(shown[0]);
    buttons.push(linkButton("Download result", `${base}/api/download?url=${encodeURIComponent(link)}&i=${i}`));
  }
  buttons.push(linkButton("Open in gimmaker", `${SITE}?url=${encodeURIComponent(link)}`));
  return { content: `${base}${url.pathname}${query}`, components: [row(...buttons)] };
}

function editOriginal(interaction, env, message) {
  return fetch(`${API}/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
}

// Fetching the post can take a moment, so acknowledge first and fill in after.
function deferGimmideo(interaction, env, ctx, link, base) {
  ctx.waitUntil(
    gimmideoMessage(link, base)
      .catch(() => ({ content: "⚠️ Something went wrong. Try again in a moment." }))
      .then((message) => editOriginal(interaction, env, message)),
  );
  return json({ type: DEFERRED_MESSAGE });
}

// ---------- Editing tools: hand off to the website ----------

function handoff(interaction) {
  const name = interaction.data.name;
  const opts = options(interaction);
  const media = attachment(interaction, opts.file);
  const audio = attachment(interaction, opts.audio);

  if (!media && !opts.link) {
    return privateReply("⚠️ Attach a file or add a reel or xeet `link` to use this command.");
  }
  if (opts.link && parsePostLink(opts.link).error) {
    return privateReply(`⚠️ ${parsePostLink(opts.link).error}`);
  }
  if (name === "gimmaudio" && opts.mode === "replace" && !audio) {
    return privateReply("⚠️ Attach the new sound as `audio` to replace the audio.");
  }

  const params = new URLSearchParams({ tool: name });
  if (media) params.set("media", media.url);
  else params.set("url", opts.link);
  if (name === "gimmaudio") {
    params.set("mode", opts.mode);
    if (opts.mode === "replace") params.set("audio", audio.url);
  }
  if (opts.level) params.set("level", opts.level);
  if (opts.text) params.set("text", opts.text);
  if (opts.size) params.set("size", opts.size);
  params.set("run", "1");

  const url = `${SITE}?${params}`;
  const label = `Open ${TOOL_NAMES[name]}`;
  const content =
    `**${TOOL_NAMES[name]}** is ready. It opens with your media loaded and starts by itself.\n` +
    `-# Editing happens in your browser; Discord files expire after about a day.`;
  // Link buttons are capped at 512 characters; fall back to a text link.
  return url.length <= 512
    ? privateReply(content, [row({ type: 2, style: 5, label, url })])
    : privateReply(`${content}\n[${label}](${url})`);
}

// ---------- Entry point ----------

export async function handleDiscord(request, env, ctx, base) {
  if (request.method !== "POST") return new Response("Discord interactions endpoint.", { status: 405 });
  if (!env.DISCORD_PUBLIC_KEY || !env.DISCORD_APPLICATION_ID) {
    return new Response("Discord bot isn't configured yet.", { status: 503 });
  }

  const body = await request.text();
  if (!(await verify(request, body, env.DISCORD_PUBLIC_KEY))) {
    return new Response("Bad request signature.", { status: 401 });
  }

  const interaction = JSON.parse(body);
  if (interaction.type === PING) return json({ type: PONG });
  if (interaction.type !== APPLICATION_COMMAND) return json({ error: "Unsupported interaction" }, 400);

  const { name } = interaction.data;
  if (name === "gimmideo") return deferGimmideo(interaction, env, ctx, options(interaction).link, base);
  if (name === "Gimmideo FC") {
    const message = interaction.data.resolved?.messages?.[interaction.data.target_id];
    const link = findPostLink(message?.content || "");
    if (!link) return privateReply("⚠️ That message doesn't have a reel or xeet link in it.");
    return deferGimmideo(interaction, env, ctx, link, base);
  }
  if (TOOL_NAMES[name]) return handoff(interaction);
  return privateReply("⚠️ Unknown command.");
}
