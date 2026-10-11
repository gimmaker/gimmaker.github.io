"""Turn a Post into the HTML + oEmbed JSON that Discord reads to build a preview."""

from html import escape
from urllib.parse import urlencode

# Discord cuts long descriptions anyway; trim ourselves so it ends cleanly.
MAX_DESCRIPTION = 340
MAX_GALLERY = 4


def pick_media(post, index=None):
    """index is 1-based (as in /photo/2 or ?img_index=2); None picks automatically."""
    if not post.media:
        return []
    if index is not None and 1 <= index <= len(post.media):
        return [post.media[index - 1]]
    if post.media[0].kind == "video":
        return [post.media[0]]
    return [m for m in post.media if m.kind == "photo"][:MAX_GALLERY]


def _truncate(text, limit):
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def render(post, base_url, media_url=None, index=None):
    """media_url(media, position) lets a site swap in a proxy URL for a media item."""
    chosen = pick_media(post, index)
    title = f"{post.author_name} (@{post.author_handle})" if post.author_handle else post.author_name
    description = _truncate(post.text, MAX_DESCRIPTION)
    oembed = f"{base_url}/oembed?" + urlencode(
        {"author": post.stats or post.site, "url": post.url, "site": post.site}
    )

    tags = [
        ("property", "og:site_name", f"gimmaker · {post.site}"),
        ("property", "og:url", post.url),
        ("property", "og:title", title),
        ("property", "og:description", description),
        ("name", "twitter:title", title),
        ("name", "twitter:description", description),
        ("name", "theme-color", post.color),
    ]

    if chosen and chosen[0].kind == "video":
        v = chosen[0]
        src = media_url(v, post.media.index(v)) if media_url else v.url
        tags += [
            ("property", "og:type", "video.other"),
            ("name", "twitter:card", "player"),
            ("property", "og:video", src),
            ("property", "og:video:secure_url", src),
            ("property", "og:video:type", "video/mp4"),
            ("property", "og:video:width", str(v.width)),
            ("property", "og:video:height", str(v.height)),
            ("name", "twitter:player:stream", src),
            ("name", "twitter:player:stream:content_type", "video/mp4"),
            ("name", "twitter:player:width", str(v.width)),
            ("name", "twitter:player:height", str(v.height)),
        ]
        if v.thumbnail:
            tags += [("property", "og:image", v.thumbnail), ("name", "twitter:image", v.thumbnail)]
    elif chosen:
        tags += [("property", "og:type", "article"), ("name", "twitter:card", "summary_large_image")]
        # Several og:image tags make Discord show a gallery.
        for m in chosen:
            tags += [
                ("property", "og:image", m.url),
                ("property", "og:image:width", str(m.width)),
                ("property", "og:image:height", str(m.height)),
                ("name", "twitter:image", m.url),
            ]
    else:
        tags += [("property", "og:type", "article"), ("name", "twitter:card", "summary")]
        if post.avatar:
            tags += [("property", "og:image", post.avatar), ("name", "twitter:image", post.avatar)]

    meta = "\n".join(
        f'  <meta {attr}="{escape(key)}" content="{escape(value)}">'
        for attr, key, value in tags
        if value and value != "0"
    )
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>{escape(title)}</title>
{meta}
  <link rel="alternate" type="application/json+oembed" href="{escape(oembed)}">
  <meta http-equiv="refresh" content="0; url={escape(post.url)}">
</head>
<body>Redirecting to <a href="{escape(post.url)}">{escape(post.url)}</a></body>
</html>
"""


def oembed_json(params):
    # Discord shows provider_name as the small top line and author_name below it,
    # which is where fixupx-style embeds put the likes/replies counts.
    url = params.get("url", "")
    return {
        "version": "1.0",
        "type": "link",
        "author_name": params.get("author", ""),
        "author_url": url,
        "provider_name": f"gimmaker · {params.get('site', '')}".rstrip(" ·"),
        "provider_url": url,
        "title": "Embed",
    }
