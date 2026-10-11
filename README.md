# gimmaker

Fixes X/Twitter and Instagram link previews in Discord (and Telegram, Slack, etc.), the way
[fixupx / FxTwitter](https://github.com/FxEmbed/FxEmbed) and kkinstagram / ddinstagram do.

It has two parts:

- **Website** (`site/`): paste a post link, get the fixed link and a Discord-style preview.
  Hosted on GitHub Pages.
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
