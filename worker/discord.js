// Discord bot, slash-command side, served over Discord's HTTP interactions.
// Prefix commands and auto-embedding live in gateway.js. Setup is in README.md.
//
// /gimmideo and the "Gimmideo FC" message command answer in Discord with the
// fixed link. The editing commands hand off to the website, which opens with
// the media, tool and options filled in and runs the edit in the browser.

import { pickMedia } from "./embed.js";
import { findPostLink, parsePostLink, POST_UNAVAILABLE } from "./links.js";
import { FetchError } from "./util.js";

const SITE = "https://gimmaker.github.io/";
const API = "https://discord.com/api/v10";
// Discord's API rejects requests without a bot-style User-Agent.
const USER_AGENT = "DiscordBot (https://github.com/gimmaker/gimmaker.github.io, 1.0)";

// Interaction and response types from the Discord API.
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const MESSAGE = 4;
const DEFERRED_MESSAGE = 5;
const EPHEMERAL = 64;

export const TOOL_NAMES = { gimmaudio: "Gimmaudio FC", deepfry: "Deepfry FC", caption: "Caption FC", gif: "GIF FC" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const linkButton = (label, url) => ({ type: 2, style: 5, label, url });
const row = (...buttons) => ({ type: 1, components: buttons });

// A private reply only the person who ran the command sees.
const privateReply = (content, components = []) =>
  json({ type: MESSAGE, data: { content, components, flags: EPHEMERAL } });

// Calls the Discord REST API. As the bot by default (needs the DISCORD_TOKEN
// secret); interaction follow-ups are authorised by their token instead.
export async function discordApi(env, method, path, body, { asBot = true, quiet = false } = {}) {
  const headers = { "Content-Type": "application/json", "User-Agent": USER_AGENT };
  if (asBot) headers.Authorization = `Bot ${env.DISCORD_TOKEN}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok && !quiet) console.error(`Discord ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res;
}

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

// ---------- Shared message builders ----------

// The reply for a post link: the fixed link (which Discord turns into a
// playable embed) plus Download and Open buttons.
export async function gimmideoMessage(link, base) {
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

// The hand-off reply for an editing tool: a button that opens the website with
// everything filled in. Returns { error } when something required is missing.
// tool: gimmaudio | deepfry | caption | gif; media/audio: Discord file URLs.
export function handoffMessage({ tool, media, link, audio, mode, level, text, size }) {
  if (!media && !link) return { error: "Attach a file or add a reel or xeet link." };
  if (!media && parsePostLink(link).error) return { error: parsePostLink(link).error };
  if (tool === "gimmaudio" && !["replace", "remove", "extract"].includes(mode)) {
    return { error: "Choose replace, remove or extract." };
  }
  if (tool === "gimmaudio" && mode === "replace" && !audio) return { error: "Attach the new sound to replace the audio." };
  if (tool === "caption" && !text) return { error: "Add the caption text." };

  const params = new URLSearchParams({ tool });
  if (media) params.set("media", media);
  else params.set("url", link);
  if (tool === "gimmaudio") {
    params.set("mode", mode);
    if (mode === "replace") params.set("audio", audio);
  }
  if (level) params.set("level", level);
  if (text) params.set("text", text);
  if (size) params.set("size", size);
  params.set("run", "1");

  const url = `${SITE}?${params}`;
  const label = `Open ${TOOL_NAMES[tool]}`;
  const content =
    `**${TOOL_NAMES[tool]}** is ready. It opens with your media loaded and starts by itself.\n` +
    `-# Editing happens in your browser; Discord files expire after about a day.`;
  // Link buttons are capped at 512 characters; fall back to a text link.
  return url.length <= 512
    ? { content, components: [row(linkButton(label, url))] }
    : { content: `${content}\n[${label}](${url})`, components: [] };
}

// ---------- Slash commands ----------

function editOriginal(interaction, env, message) {
  const path = `/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  return discordApi(env, "PATCH", path, message, { asBot: false });
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

function handoff(interaction) {
  const opts = options(interaction);
  const result = handoffMessage({
    tool: interaction.data.name,
    media: attachment(interaction, opts.file)?.url,
    link: opts.link,
    audio: attachment(interaction, opts.audio)?.url,
    mode: opts.mode,
    level: opts.level,
    text: opts.text,
    size: opts.size,
  });
  if (result.error) return privateReply(`⚠️ ${result.error}`);
  return privateReply(result.content, result.components);
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
