"""HTTP server: link-preview bots get an embed page, people get redirected.

Swap the domain of a post link for this server's domain, e.g.

    https://x.com/user/status/123        -> https://<gimmaker>/user/status/123
    https://www.instagram.com/reel/ABC/  -> https://<gimmaker>/reel/ABC/
"""

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from . import embed, instagram, twitter
from .common import FetchError

# User agents of link-preview crawlers (Discord, Telegram, Slack, ...).
BOT_UA = re.compile(
    r"discordbot|twitterbot|telegrambot|slackbot|facebookexternalhit|whatsapp|"
    r"mastodon|iframely|embedly|redditbot|skypeuripreview|linkedinbot|vkshare|"
    r"bluesky|cardyb|matrix|synapse|element",
    re.I,
)

TWEET_PATH = re.compile(r"^/(?:(?P<user>\w+)/|i/(?:web/)?)?status(?:es)?/(?P<id>\d+)(?:/(?:photo|video)/(?P<n>\d))?/?$")
IG_PATH = re.compile(r"^/(?:[\w.]+/)?(?:p|reel|reels|tv)/(?P<code>[\w-]+)(?:/(?P<n>\d+))?/?$")
IG_MEDIA_PATH = re.compile(r"^/ig/media/(?P<code>[\w-]+)/(?P<i>\d+)$")

HOME = """<!doctype html><html><head><meta charset="utf-8"><title>gimmaker</title></head>
<body style="font-family:system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1>gimmaker</h1>
<p>Fixes X/Twitter and Instagram previews in Discord. Replace the domain of a post link with this one:</p>
<ul>
<li><code>x.com/user/status/123</code> &rarr; <code>{host}/user/status/123</code></li>
<li><code>instagram.com/reel/ABC</code> &rarr; <code>{host}/reel/ABC</code></li>
</ul></body></html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "gimmaker"

    # -- helpers ---------------------------------------------------------
    def _send(self, status, body, content_type="text/html; charset=utf-8", cache=300):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", f"public, max-age={cache}")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _base_url(self):
        if os.environ.get("PUBLIC_URL"):
            return os.environ["PUBLIC_URL"].rstrip("/")
        proto = self.headers.get("X-Forwarded-Proto", "http")
        return f"{proto}://{self.headers.get('Host', 'localhost')}"

    def _wants_embed(self, query):
        # ?embed=1 forces the bot view, handy for checking output in a browser.
        return bool(BOT_UA.search(self.headers.get("User-Agent", ""))) or "embed" in query

    # -- routing ---------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        parts = urlsplit(self.path)
        path, query = parts.path, parse_qs(parts.query)

        if path == "/":
            return self._send(200, HOME.format(host=self.headers.get("Host", "gimmaker")))
        if path == "/oembed":
            params = {k: v[0] for k, v in query.items()}
            return self._send(200, json.dumps(embed.oembed_json(params)), "application/json")

        m = IG_MEDIA_PATH.match(path)
        if m:
            return self._instagram_media(m["code"], int(m["i"]))

        m = TWEET_PATH.match(path)
        if m:
            original = f"https://x.com{path}"
            if not self._wants_embed(query):
                return self._redirect(original)
            index = int(m["n"]) if m["n"] else None
            return self._embed(lambda: twitter.fetch_tweet(m["id"]), original, index)

        m = IG_PATH.match(path)
        if m:
            original = f"https://www.instagram.com{path}"
            if not self._wants_embed(query):
                return self._redirect(original)
            # Instagram carousels use ?img_index=N; also accept /p/CODE/N.
            raw = m["n"] or (query.get("img_index") or [None])[0]
            index = int(raw) if raw and raw.isdigit() else None
            code = m["code"]
            base = self._base_url()
            # Instagram video URLs are signed and expire, so point Discord at our
            # redirect endpoint, which always resolves to a fresh URL.
            media_url = lambda media, i: f"{base}/ig/media/{code}/{i}" if media.kind == "video" else media.url
            return self._embed(lambda: instagram.fetch_post(code), original, index, media_url)

        self._send(404, "Not a supported X or Instagram post link.", "text/plain; charset=utf-8")

    def _embed(self, fetch, original, index, media_url=None):
        try:
            post = fetch()
        except FetchError as e:
            self.log_error("%s", e)
            return self._redirect(original)
        self._send(200, embed.render(post, self._base_url(), media_url, index))

    def _instagram_media(self, code, i):
        try:
            post = instagram.fetch_post(code)
            return self._redirect(post.media[i].url)
        except (FetchError, IndexError):
            self._send(404, "Media not found.", "text/plain; charset=utf-8")


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8080"))
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"gimmaker listening on http://{host}:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
