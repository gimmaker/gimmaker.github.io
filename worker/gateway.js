// Discord bot, message side: auto-embeds X/Instagram links and answers prefix
// commands (gm6 deepfry, ?g caption hi, ...). Reading messages needs a live
// Gateway connection, which this Durable Object holds open. An alarm every 30s
// and a once-a-minute cron (see index.js) reconnect it if it ever drops.

import { discordApi, gimmideoMessage, handoffMessage, TOOL_NAMES } from "./discord.js";
import { findPostLink, findPostLinks, fixedLink, isOriginalLink } from "./links.js";

const GATEWAY = "https://gateway.discord.gg/?v=10&encoding=json";
// GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const SUPPRESS_EMBEDS = 1 << 2;
const WATCHDOG_MS = 30_000;
// Close codes that won't fix themselves (bad token, intent not enabled, ...).
const FATAL_CLOSES = { 4004: "The bot token is wrong.", 4013: "Invalid intents.", 4014: "Turn on Message Content Intent in the Developer Portal." };
const FATAL_RETRY_MS = 10 * 60_000;

// Shown under the bot's name: "Watching reels & xeets · ?help".
const PRESENCE = {
  since: null,
  activities: [{ name: "reels & xeets · ?help", type: 3 }], // 3 = Watching
  status: "online",
  afk: false,
};

const MAX_AUTO_LINKS = 4;
const FRY_LEVELS = ["mild", "crispy", "nuclear"];
const GIF_SIZES = { small: "320", medium: "480", large: "640", 320: "320", 480: "480", 640: "640" };
const AUDIO_MODES = ["replace", "remove", "extract"];

// Command names people are likely to type, mapped to the real ones.
const ALIASES = {
  help: "help", h: "help", commands: "help", cmds: "help",
  gimmideo: "gimmideo", gimmick: "gimmideo", embed: "gimmideo", fix: "gimmideo", dl: "gimmideo", download: "gimmideo",
  gimmaudio: "gimmaudio", audio: "gimmaudio", sound: "gimmaudio",
  deepfry: "deepfry", fry: "deepfry", df: "deepfry",
  caption: "caption", cap: "caption",
  gif: "gif",
};

// Commands that also work straight after "?", like ?deepfry or ?cap. Words
// that are common in chat (?fix, ?audio...) are left out on purpose.
const DIRECT = ["help", "gimmideo", "gimmaudio", "deepfry", "fry", "caption", "cap", "gif"];

// "deepfry", "deepfryfc", "Deepfry FC" (the "fc" is dropped later) all match.
function resolveCommand(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "").replace(/fc$/, "");
  return ALIASES[w] || null;
}

export function prefixes(env) {
  // Longest first, so "?gmq" isn't mistaken for "?g" + "mq".
  return (env.BOT_PREFIXES || "gm6")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function helpText(prefixList) {
  return [
    "**gimmaker** — paste a reel or xeet link and I'll fix the embed automatically. Commands:",
    "`?gimmideo <link>` — fixed link + download",
    "`?gimmaudio replace|remove|extract` — attach a video (and the new sound for replace)",
    "`?deepfry [mild|crispy|nuclear]` (or `?fry`)",
    "`?caption <text>` (or `?cap`)",
    "`?gif [small|medium|large]` — or a GIF to turn it into a video",
    `-# Also works as ${prefixList.map((p) => `\`${p} deepfry\``).join(", ")}. ` +
      "Each takes an attached file, a link, or a reply to a message that has one. Slash commands work too.",
  ].join("\n");
}

// ---------- Deciding what to do with a message ----------

// Returns { kind: "command", prefix, command, rest }, { kind: "embed", links }
// or null. Pure, so it's easy to test.
export function planMessage(msg, { base, prefixList }) {
  if (msg.author?.bot || msg.webhook_id) return null;
  const content = msg.content || "";
  const lower = content.toLowerCase();
  // ?deepfry, ?cap ... straight after a question mark.
  const direct = lower.match(/^\?([a-z]+)(?=\s|$)/);
  if (direct && DIRECT.includes(direct[1])) {
    const words = content.slice(direct[0].length).trim().split(/\s+/).filter(Boolean);
    if (words[0]?.toLowerCase() === "fc") words.shift();
    return { kind: "command", prefixList, command: resolveCommand(direct[1]), rest: words.join(" "), spaced: true };
  }
  const prefix = prefixList.find((p) => lower.startsWith(p));
  if (prefix) {
    const after = content.slice(prefix.length);
    let [command = "", ...words] = after.trim().split(/\s+/).filter(Boolean);
    // "?g <link>" on its own means gimmideo.
    if (/^<?https?:\/\//i.test(command)) {
      words.unshift(command);
      command = "gimmideo";
    }
    if (words[0]?.toLowerCase() === "fc") words.shift();
    return {
      kind: "command",
      prefixList,
      command: command ? resolveCommand(command) || command.toLowerCase() : "help",
      rest: words.join(" "),
      // "?g dance" was meant for the bot; "?good" probably wasn't.
      spaced: !after || /^\s/.test(after),
    };
  }
  const links = findPostLinks(content)
    .filter(isOriginalLink)
    .slice(0, MAX_AUTO_LINKS)
    .map((l) => fixedLink(l, base))
    .filter(Boolean);
  return links.length ? { kind: "embed", links } : null;
}

const isAudio = (a) => a.content_type?.startsWith("audio/");

// Works out the media for a prefix command: this message's attachments or
// link first, then the message it replies to.
function mediaFor(msg, rest) {
  const own = msg.attachments || [];
  const replied = msg.referenced_message;
  const visual = own.filter((a) => !isAudio(a));
  return {
    media: visual[0]?.url || (!findPostLink(rest) && replied?.attachments?.find((a) => !isAudio(a))?.url) || null,
    link: findPostLink(rest) || (!visual.length && replied ? findPostLink(replied.content || "") : null),
    // The new sound: an audio attachment, or a second video to take it from.
    audio: own.find(isAudio)?.url || visual[1]?.url || null,
  };
}

// Builds the reply for a prefix command, or null to stay quiet.
export async function commandReply(plan, msg, base) {
  const { prefixList, command, rest } = plan;
  const words = rest.toLowerCase().split(/\s+/);
  const { media, link, audio } = mediaFor(msg, rest);

  if (command === "help") return { content: helpText(prefixList) };
  if (command === "gimmideo") {
    if (!link) return { content: `⚠️ Add a reel or xeet link, or reply to a message that has one.` };
    return gimmideoMessage(link, base);
  }
  if (!TOOL_NAMES[command]) {
    return plan.spaced ? { content: `⚠️ I don't know \`${command}\`. Here's what I can do:\n\n${helpText(prefixList)}` } : null;
  }

  const options = { tool: command, media, link, audio };
  if (command === "gimmaudio") options.mode = words.find((w) => AUDIO_MODES.includes(w));
  if (command === "deepfry") options.level = words.find((w) => FRY_LEVELS.includes(w));
  if (command === "gif") options.size = GIF_SIZES[words.find((w) => GIF_SIZES[w])];
  if (command === "caption") options.text = rest.replace(link || "", "").trim();

  const result = handoffMessage(options);
  return result.error ? { content: `⚠️ ${result.error}` } : result;
}

// ---------- The Gateway connection ----------

export class Gateway {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.ws = null;
    this.seq = null;
    this.heartbeat = null;
    this.acked = true;
    this.lastError = null;
    this.fatalUntil = 0;
    this.connectedAt = null;
  }

  status() {
    return {
      connected: Boolean(this.ws),
      since: this.connectedAt,
      lastError: this.lastError,
      tokenSet: Boolean(this.env.DISCORD_TOKEN),
    };
  }

  async fetch(request) {
    // A request from a newer deployment means this copy is running old code:
    // drop the connection and reset, so the next request starts the new code.
    const caller = request.headers.get("X-Worker-Version");
    const mine = this.env.CF_VERSION_METADATA?.id;
    if (caller && mine && caller !== mine) {
      this.ws?.close(1000, "new version");
      this.state.abort("A new version was deployed.");
    }
    if (new URL(request.url).pathname !== "/status") await this.ensure();
    return Response.json({ ...this.status(), version: mine });
  }

  async alarm() {
    await this.ensure();
  }

  async ensure() {
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + WATCHDOG_MS);
    if (this.seq !== null) await this.state.storage.put("seq", this.seq);
    if (!this.env.DISCORD_TOKEN || this.ws || this.connecting || Date.now() < this.fatalUntil) return;
    await this.connect();
  }

  async connect() {
    this.connecting = true;
    try {
      const resumeUrl = await this.state.storage.get("resumeUrl");
      const url = resumeUrl ? `${resumeUrl.replace(/^wss:/, "https:")}/?v=10&encoding=json` : GATEWAY;
      const res = await fetch(url, { headers: { Upgrade: "websocket" } });
      const ws = res.webSocket;
      if (!ws) throw new Error(`Gateway refused the connection (${res.status}).`);
      ws.accept();
      this.ws = ws;
      this.connectedAt = new Date().toISOString();
      ws.addEventListener("message", (event) => this.onPayload(JSON.parse(event.data)).catch((e) => console.error(e)));
      ws.addEventListener("close", (event) => this.onClose(event.code));
      ws.addEventListener("error", () => this.onClose(1006));
    } catch (e) {
      this.lastError = e.message;
    } finally {
      this.connecting = false;
    }
  }

  send(payload) {
    try {
      this.ws?.send(JSON.stringify(payload));
    } catch {
      this.onClose(1006);
    }
  }

  async onPayload(p) {
    if (p.s !== null && p.s !== undefined) this.seq = p.s;
    switch (p.op) {
      case 10: {
        // Hello: start heartbeating, then resume the old session or log in.
        clearInterval(this.heartbeat);
        this.acked = true;
        this.heartbeat = setInterval(() => this.beat(), p.d.heartbeat_interval);
        const session = await this.state.storage.get("session");
        const seq = this.seq ?? (await this.state.storage.get("seq"));
        if (session && seq !== undefined && seq !== null) {
          this.send({ op: 6, d: { token: this.env.DISCORD_TOKEN, session_id: session, seq } });
        } else {
          this.send({
            op: 2,
            d: {
              token: this.env.DISCORD_TOKEN,
              intents: INTENTS,
              properties: { os: "cloudflare", browser: "gimmaker", device: "gimmaker" },
              presence: PRESENCE,
            },
          });
        }
        break;
      }
      case 11:
        this.acked = true;
        break;
      case 1:
        this.send({ op: 1, d: this.seq });
        break;
      case 7: // Discord asks us to reconnect.
        this.ws?.close(4000, "reconnect");
        break;
      case 9: // Invalid session: start a fresh one unless it's resumable.
        if (!p.d) await this.state.storage.delete(["session", "resumeUrl", "seq"]);
        this.seq = null;
        this.ws?.close(4000, "invalid session");
        break;
      case 0:
        await this.onDispatch(p.t, p.d);
        break;
    }
  }

  beat() {
    if (!this.acked) {
      // No reply to the last heartbeat: the connection is dead.
      this.ws?.close(4000, "zombie");
      return;
    }
    this.acked = false;
    this.send({ op: 1, d: this.seq });
  }

  onClose(code) {
    if (!this.ws) return;
    clearInterval(this.heartbeat);
    this.ws = null;
    if (FATAL_CLOSES[code]) {
      this.lastError = FATAL_CLOSES[code];
      this.fatalUntil = Date.now() + FATAL_RETRY_MS;
      return;
    }
    setTimeout(() => this.connect(), 1000 + Math.random() * 2000);
  }

  async onDispatch(type, data) {
    if (type === "READY" || type === "RESUMED") {
      this.lastError = null;
      if (type === "READY") await this.state.storage.put({ session: data.session_id, resumeUrl: data.resume_gateway_url });
      // Resumed sessions keep whatever status they had, so set it again.
      this.send({ op: 3, d: PRESENCE });
      return;
    }
    if (type !== "MESSAGE_CREATE") return;

    const base = this.env.PUBLIC_URL;
    const plan = planMessage(data, { base, prefixList: prefixes(this.env) });
    if (!plan) return;

    const reply =
      plan.kind === "embed" ? { content: plan.links.join("\n") } : await commandReply(plan, data, base);
    if (!reply) return;
    await discordApi(this.env, "POST", `/channels/${data.channel_id}/messages`, {
      ...reply,
      message_reference: { message_id: data.id, fail_if_not_exists: false },
      allowed_mentions: { replied_user: false },
    });

    // Hide the original's broken preview (needs Manage Messages; skipped in DMs).
    if (plan.kind === "embed" && data.guild_id) {
      await discordApi(this.env, "PATCH", `/channels/${data.channel_id}/messages/${data.id}`, {
        flags: (data.flags || 0) | SUPPRESS_EMBEDS,
      }, { quiet: true });
    }
  }
}
