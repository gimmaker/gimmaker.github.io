# gimmaker

Fixes X/Twitter and Instagram link previews in Discord (and Telegram, Slack, etc.), the way
[fixupx / FxTwitter](https://github.com/FxEmbed/FxEmbed) and kkinstagram / ddinstagram do.

## How it works

When you paste a link, Discord's crawler (`Discordbot`) fetches it and reads OpenGraph
`<meta>` tags to build the preview. X and Instagram give crawlers a poor preview with no
playable video. gimmaker sits in between:

1. You replace the domain of a post link with gimmaker's domain:
   - `https://x.com/user/status/123` → `https://<gimmaker>/user/status/123`
   - `https://www.instagram.com/reel/ABC/` → `https://<gimmaker>/reel/ABC/`
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

## Run it

Requires Python 3.9+. It uses only the standard library, so there is nothing to install.

```bash
python3 -m gimmaker
```

Environment variables:

| Variable     | Default     | Meaning                                                  |
|--------------|-------------|----------------------------------------------------------|
| `HOST`       | `127.0.0.1` | Interface to bind (`0.0.0.0` when deployed)              |
| `PORT`       | `8080`      | Port to listen on                                        |
| `PUBLIC_URL` | from `Host` | Public base URL used in generated links (`https://...`)  |

To see what a crawler gets, add `?embed=1` in a browser, or:

```bash
curl -A Discordbot http://127.0.0.1:8080/jack/status/20
```

Discord can only reach gimmaker at a public HTTPS address, so it has to be deployed or
tunnelled before links work in a real chat.
