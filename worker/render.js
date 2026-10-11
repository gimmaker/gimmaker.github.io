// Runs the editing tools for the Discord bot without anyone opening the site:
// a Cloudflare-hosted browser (Browser Run) opens gimmaker with the job's
// settings, the site does the edit with ffmpeg.wasm as usual, then uploads the
// result to /api/deliver, which posts it into Discord.
//
// Free plan: about 10 minutes of browser time a day, 3 browsers at once, one
// new browser every 20 seconds. Anything that can't finish falls back to the
// usual "Open in gimmaker" button.

import puppeteer from "@cloudflare/puppeteer";
import { discordApi, handoffMessage, TOOL_NAMES } from "./discord.js";

export { workingText } from "./discord.js";

// Discord's upload limit for bots in most servers and DMs.
export const MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_BROWSERS = 2;
const LAUNCH_GAP_MS = 21_000;
const JOB_TIMEOUT_MS = 150_000;
const API = "https://discord.com/api/v10";

// Where a job's message lives: an interaction reply, or a bot message.
function messagePath(env, target) {
  return target.kind === "interaction"
    ? `/webhooks/${env.DISCORD_APPLICATION_ID}/${target.token}/messages/@original`
    : `/channels/${target.channelId}/messages/${target.messageId}`;
}

function edit(env, target, message) {
  return discordApi(env, "PATCH", messagePath(env, target), message, { asBot: target.kind !== "interaction" });
}

// Replaces the job's message with the finished file.
async function uploadResult(env, target, { content, filename, type, bytes }) {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content, components: [], attachments: [{ id: 0, filename }] }));
  form.append("files[0]", new Blob([bytes], { type }), filename);
  const headers = { "User-Agent": "DiscordBot (https://github.com/gimmaker/gimmaker.github.io, 1.0)" };
  if (target.kind !== "interaction") headers.Authorization = `Bot ${env.DISCORD_TOKEN}`;
  return fetch(`${API}${messagePath(env, target)}`, { method: "PATCH", headers, body: form });
}

export class Renderer {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.jobs = new Map();
    this.queue = [];
    this.running = 0;
    this.lastLaunch = 0;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/render") {
      // { options: handoffMessage options, target: { kind, token | channelId+messageId } }
      const job = { ...(await request.json()), id: crypto.randomUUID() };
      this.jobs.set(job.id, job);
      this.queue.push(job);
      this.pump();
      return Response.json({ id: job.id });
    }
    if (pathname === "/test-result") return Response.json(this.lastTest || null);
    const deliver = pathname.match(/^\/deliver\/([\w-]+)$/);
    if (deliver) return this.deliver(deliver[1], request);
    return new Response("Not found", { status: 404 });
  }

  // Starts queued jobs while respecting the browser limits.
  pump() {
    if (!this.queue.length || this.running >= MAX_BROWSERS || this.waiting) return;
    const wait = Math.max(0, this.lastLaunch + LAUNCH_GAP_MS - Date.now());
    this.waiting = true;
    setTimeout(() => {
      this.waiting = false;
      const job = this.queue.shift();
      if (!job) return;
      this.running++;
      this.lastLaunch = Date.now();
      this.run(job).finally(() => {
        this.running--;
        this.pump();
      });
      this.pump();
    }, wait);
  }

  async run(job) {
    job.started = Date.now();
    let browser;
    try {
      browser = await puppeteer.launch(this.env.BROWSER);
      const page = await browser.newPage();
      const params = new URLSearchParams(job.params);
      params.set("run", "1");
      params.set("deliver", job.id);
      await page.goto(`${this.env.PUBLIC_URL}/?${params}`, { waitUntil: "domcontentloaded" });
      // The site sets window.__gimmakerDone once it has delivered the file or failed.
      const handle = await page.waitForFunction(() => window.__gimmakerDone, {
        timeout: JOB_TIMEOUT_MS,
        polling: 1000,
      });
      const outcome = await handle.jsonValue();
      if (!outcome.ok) throw new Error(outcome.error || "The edit didn't finish.");
    } catch (e) {
      await this.fallback(job, e);
    } finally {
      this.jobs.delete(job.id);
      await browser?.close().catch(() => {});
    }
  }

  // Couldn't do it automatically: offer the usual Open button instead.
  async fallback(job, error) {
    const raw = String(error?.message || error);
    // Test jobs (see /discord/render-test) just record what happened.
    if (job.target.kind === "test") {
      this.lastTest = { ok: false, error: raw, at: new Date().toISOString() };
      return;
    }
    const reason = /429|limit|quota|rate/i.test(raw)
      ? "the bot's free editing time for today is used up"
      : /timeout|timed out/i.test(raw)
        ? "it took too long"
        : raw.replace(/^Error:\s*/, "");
    const message = handoffMessage(job.options);
    await edit(this.env, job.target, {
      content: `⚠️ Couldn't finish this automatically (${reason}).\n${message.content}`,
      components: message.components,
    });
  }

  // The site uploads the finished file here; it goes straight into Discord.
  async deliver(id, request) {
    const job = this.jobs.get(id);
    if (!job || job.delivered) return new Response("Unknown or finished job.", { status: 404 });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD) return new Response("Too big for Discord.", { status: 413 });
    job.delivered = true;
    const filename = (request.headers.get("X-Filename") || "gimmaker-result").replace(/[^\w.-]/g, "_");
    if (job.target.kind === "test") {
      this.lastTest = { ok: true, filename, bytes: bytes.byteLength, seconds: Math.round((Date.now() - job.started) / 1000) };
      return new Response("Delivered (test).");
    }
    const res = await uploadResult(this.env, job.target, {
      content: `**${TOOL_NAMES[job.options.tool]}** ✅`,
      filename,
      type: request.headers.get("Content-Type") || "application/octet-stream",
      bytes,
    });
    if (!res.ok) {
      job.delivered = false;
      return new Response(`Discord refused the upload (${res.status}).`, { status: 502 });
    }
    return new Response("Delivered.");
  }
}
