# gimmaker

Fixes X/Twitter and Instagram link previews in Discord (and Telegram, Slack, etc.), the way
[fixupx / FxTwitter](https://github.com/FxEmbed/FxEmbed) and kkinstagram / ddinstagram do.

It has two parts:

- **Website** (`site/`): paste a post link (or upload a file) once and use it with every tool.
  Hosted on GitHub Pages.
  - **Gimmideo FC:** download reels and xeets, plus the fixed Discord link.
  - **Gimmaudio FC** (replace, remove or extract a video's audio, or add audio to an image), **Deepfry FC**,
    **Caption FC** and **GIF FC** (video to GIF, or GIF to video) run in the browser with
    [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), so files never leave the visitor's
    computer. The ~30 MB engine loads from jsDelivr on first use; the small wrapper files live in
    `site/vendor/` (refresh them with `npm run vendor`).
- **Link fixer** (`worker/`): a Cloudflare Worker that serves the previews Discord reads.
  It runs on Cloudflare's free plan, because GitHub Pages can only serve static files.

## How it works

When you paste a link, Discord's crawler (`Discordbot`) fetches it and reads OpenGraph
`<meta>` tags to build the preview. X and Instagram give crawlers a poor preview with no
playable video. gimmaker sits in between:

1. You replace the domain of a post link with the link fixer's domain:
   - `https://x.com/user/status/123` → `https://<worker>/user/status/123`
   - `https://www.instagram.com/reel/ABC/` → `https://<worker>/reel/ABC/`
2. **Crawlers** get an HTML page with `og:video` (a direct `.mp4`), `og:image` (one or more
   images for a gallery), the post text, the author, and an oEmbed link that shows like and
   comment counts.
3. **People** clicking the link get a `302` redirect to the original post.

Data sources (no login or API keys):

- **X:** the public syndication API that powers embedded tweets on websites.
- **Instagram:** the public `/embed/captioned/` page, which contains the post JSON with direct
  video URLs. If that fails, gimmaker scrapes the embed HTML, then falls back to Instagram's
  crawler meta tags. Video links go through `/ig/media/<code>/<n>`, which redirects to a fresh
  signed CDN URL.

Supported paths: `/<user>/status/<id>`, `/i/status/<id>`, `.../photo/<n>`, `.../video/<n>`,
`/p/<code>`, `/reel/<code>`, `/reels/<code>`, `/tv/<code>`, `/<user>/reel/<code>` and
`?img_index=<n>` for carousels.

Worker endpoints besides post paths: `/api/post?url=<link>` (JSON used by the website),
`/oembed`, and `/ig/media/<code>/<n>`. Add `?embed=1` to a post path to see the crawler view in
a browser.

## Run it locally

Requires Node.js 20+.

```bash
npm install
npm run dev
```

This serves the worker and the website together at http://localhost:8787.

## Deploy

**Link fixer (Cloudflare Workers, free):**

```bash
npx wrangler login
npm run deploy
```

It prints the worker's address, e.g. `https://gimmaker.<your-subdomain>.workers.dev`. The
worker serves the website at that address too.

To deploy automatically on every push, add the repo secrets `CLOUDFLARE_API_TOKEN` (a
Cloudflare API token from the "Edit Cloudflare Workers" template) and `CLOUDFLARE_ACCOUNT_ID`.

**Website (GitHub Pages):** `.github/workflows/pages.yml` publishes `site/` on every push to
`main`. Set the worker's address in `site/config.js` so the Pages copy knows where the link
fixer is.

## Discord bot

The worker also serves a Discord bot at `/discord` (HTTP interactions, so no always-on
process is needed). It can be installed on a server or on your own account, and works in
the bot's DMs, other DMs and group chats.

- `/gimmideo link:` and **Apps → Gimmideo FC** (right-click a message) reply with the fixed
  link, so the video plays, plus **Download result** and **Open in gimmaker** buttons.
- **Auto-embed:** any x.com, twitter.com or instagram.com post link posted where the bot can
  read messages gets a reply with the fixed link (and the original's broken preview is hidden
  when the bot has Manage Messages). Links wrapped in `<...>` are left alone.
- **Prefix commands** (`gm6`, `?gmq`, `?g` or `.gmq`, set by `BOT_PREFIXES` in
  `wrangler.toml`): `help`, `gimmideo <link>`, `gimmaudio replace|remove|extract`,
  `deepfry [mild|crispy|nuclear]`, `caption <text>`, `gif [small|medium|large]`. Each uses an
  attached file, a link, or the message it replies to.
- `/gimmaudio`, `/deepfry`, `/caption` and `/gif` (and their prefix versions) take a `file` or
  a `link` plus their options. The bot posts "working on it", then a Cloudflare-hosted browser
  ([Browser Run](https://developers.cloudflare.com/browser-run/), `worker/render.js`) opens the
  website with everything filled in, runs the edit, and uploads the result through
  `/api/deliver`, replacing that message with the file. The free plan allows about 10 minutes of
  browser time a day (roughly 15–30 edits); when it runs out, or a result is over Discord's
  10 MB upload limit, the message offers an **Open in gimmaker** button instead. Discord attachments reach the site through `/api/media`, which
  only relays files from Discord's own file hosts.

- **`/settings`** (server admins with Manage Server only) opens one private panel with a toggle
  button for each feature: auto-embed, hiding the original preview, prefix commands, and each
  tool. Settings are saved per server (in the Gateway Durable Object) and everything is on by
  default.

Setup:

1. Create an application at <https://discord.com/developers/applications>.
2. Put its **Application ID** and **Public Key** in `wrangler.toml` under `[vars]`
   (`DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`) and run `npm run deploy`.
3. In the application's **General Information**, set **Interactions Endpoint URL** to
   `https://<worker>/discord`.
4. Under **Installation**, enable **User Install** and **Guild Install** with the
   `applications.commands` scope.
5. For auto-embed and prefix commands, the bot keeps a live connection to Discord from a
   Durable Object (`worker/gateway.js`), checked every minute by a cron trigger. Turn on
   **Message Content Intent** on the **Bot** page, then give the worker the bot token:

   ```bash
   npx wrangler secret put DISCORD_TOKEN
   ```

   `https://<worker>/discord/status` shows whether it's connected. This only works in servers
   the bot itself has joined (Guild Install with the `bot` scope) and in DMs with the bot.
6. Register the commands with the bot token (from the **Bot** page; keep it secret):

   ```bash
   DISCORD_APPLICATION_ID=... DISCORD_TOKEN=... npm run discord:register
   ```
