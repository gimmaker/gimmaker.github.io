"""Instagram post fetching (the kkinstagram / ddinstagram side).

Instagram's own link previews only carry a thumbnail. To get playable video we
read the public embed page (/p/<code>/embed/captioned/), which ships the full
post JSON, including direct video URLs. If that JSON is missing we fall back
to scraping the embed HTML, then to Instagram's own crawler meta tags.
"""

import html
import json
import re

from .common import FetchError, Media, Post, TTLCache, compact_number, http_get

EMBED_URL = "https://www.instagram.com/p/{code}/embed/captioned/"
POST_URL = "https://www.instagram.com/p/{code}/"

# Without these Instagram serves an error page instead of the embed.
EMBED_HEADERS = {
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-Fetch-Dest": "iframe",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "cross-site",
}

_cache = TTLCache()


def _from_context_json(code, page):
    m = re.search(r'"contextJSON":("(?:[^"\\]|\\.)*")', page)
    if not m:
        return None
    try:
        ctx = json.loads(json.loads(m.group(1)))
    except ValueError:
        return None
    sm = (ctx.get("gql_data") or {}).get("shortcode_media")
    if not sm:
        return None

    nodes = [e["node"] for e in sm.get("edge_sidecar_to_children", {}).get("edges", [])] or [sm]
    media = []
    for n in nodes:
        dims = n.get("dimensions", {})
        w, h = dims.get("width", 0), dims.get("height", 0)
        if n.get("is_video") and n.get("video_url"):
            media.append(Media("video", n["video_url"], w, h, thumbnail=n.get("display_url")))
        elif n.get("display_url"):
            media.append(Media("photo", n["display_url"], w, h))

    captions = sm.get("edge_media_to_caption", {}).get("edges", [])
    owner = sm.get("owner", {})
    username = owner.get("username", "")
    likes = (sm.get("edge_liked_by") or sm.get("edge_media_preview_like") or {}).get("count")
    comments = (sm.get("edge_media_to_comment") or {}).get("count")
    stats = "   ".join(
        s
        for s in (
            f"💬 {compact_number(comments)}" if comments else "",
            f"❤️ {compact_number(likes)}" if likes else "",
            f"▶️ {compact_number(sm['video_view_count'])}" if sm.get("video_view_count") else "",
        )
        if s
    )
    return Post(
        site="Instagram",
        url=POST_URL.format(code=code),
        author_name=owner.get("full_name") or username,
        author_handle=username,
        text=captions[0]["node"]["text"] if captions else "",
        avatar=owner.get("profile_pic_url"),
        media=media,
        stats=stats,
        color="#e1306c",
    )


def _from_embed_html(code, page):
    img = re.search(r'class="EmbeddedMediaImage"[^>]*?src="([^"]+)"', page)
    if not img:
        return None
    user = re.search(r'class="CaptionUsername"[^>]*>([^<]+)</a>', page)
    caption = re.search(r'<div class="Caption">.*?</a>(.*?)<div class="CaptionComments">', page, re.S)
    text = ""
    if caption:
        text = re.sub(r"<br\s*/?>", "\n", caption.group(1))
        text = html.unescape(re.sub(r"<[^>]+>", "", text)).strip()
    username = html.unescape(user.group(1)) if user else ""
    return Post(
        site="Instagram",
        url=POST_URL.format(code=code),
        author_name=username,
        author_handle=username,
        text=text,
        media=[Media("photo", html.unescape(img.group(1)))],
        color="#e1306c",
    )


def _from_crawler_tags(code):
    # Instagram serves OpenGraph tags (thumbnail + caption only) to crawlers.
    page = http_get(POST_URL.format(code=code), headers={"User-Agent": "facebookexternalhit/1.1"})

    def meta(prop):
        m = re.search(rf'<meta (?:property|name)="{prop}" content="([^"]*)"', page)
        return html.unescape(m.group(1)) if m else ""

    image = meta("og:image")
    if not image:
        return None
    title = meta("og:title")
    handle = re.search(r"\(@([\w.]+)\)", meta("twitter:title"))
    return Post(
        site="Instagram",
        url=POST_URL.format(code=code),
        author_name=title.split(" on Instagram")[0] if title else "",
        author_handle=handle.group(1) if handle else "",
        text=meta("og:description"),
        media=[Media("photo", image)],
        color="#e1306c",
    )


def fetch_post(code):
    cached = _cache.get(code)
    if cached:
        return cached

    post = None
    try:
        page = http_get(EMBED_URL.format(code=code), headers=EMBED_HEADERS)
        post = _from_context_json(code, page) or _from_embed_html(code, page)
    except FetchError:
        pass
    if post is None:
        post = _from_crawler_tags(code)
    if post is None:
        raise FetchError(f"instagram post {code} not found or unavailable")

    _cache.set(code, post)
    return post
