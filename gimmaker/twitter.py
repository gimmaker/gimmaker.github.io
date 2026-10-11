"""X / Twitter post fetching (the fixupx / fxtwitter side).

Uses X's public syndication endpoint, the same one that powers embedded
tweets on websites. It needs no login or API key.
"""

from .common import FetchError, Media, Post, TTLCache, compact_number, http_get_json

SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result?id={id}&token=a&lang=en"
# Discord's media proxy struggles with very large files, so cap the bitrate
# we pick and fall back to the smallest variant if nothing fits.
MAX_BITRATE = 2_500_000

_cache = TTLCache()


def _best_mp4(variants):
    mp4s = [v for v in variants if v.get("content_type") == "video/mp4"]
    if not mp4s:
        return None
    mp4s.sort(key=lambda v: v.get("bitrate", 0))
    fitting = [v for v in mp4s if v.get("bitrate", 0) <= MAX_BITRATE]
    return (fitting[-1] if fitting else mp4s[0])["url"]


def _expand_text(tweet):
    text = tweet.get("text", "")
    entities = tweet.get("entities", {})
    for u in entities.get("urls", []):
        text = text.replace(u["url"], u.get("expanded_url", u["url"]))
    # Media links are shown as the embed itself, so drop the t.co stub.
    for m in entities.get("media", []):
        text = text.replace(m["url"], "")
    return text.strip()


def fetch_tweet(tweet_id):
    cached = _cache.get(tweet_id)
    if cached:
        return cached

    data = http_get_json(SYNDICATION_URL.format(id=tweet_id))
    if data.get("__typename") != "Tweet":
        raise FetchError(f"tweet {tweet_id} not found or unavailable")

    user = data.get("user", {})
    handle = user.get("screen_name", "i")
    text = _expand_text(data)

    quoted = data.get("quoted_tweet")
    if quoted:
        qhandle = quoted.get("user", {}).get("screen_name", "")
        text += f"\n\n↘️ Quoting @{qhandle}:\n{_expand_text(quoted)}"

    media = []
    for m in data.get("mediaDetails", []):
        info = m.get("original_info", {})
        w, h = info.get("width", 0), info.get("height", 0)
        if m.get("type") == "photo":
            media.append(Media("photo", m["media_url_https"] + "?name=orig", w, h))
        else:  # "video" or "animated_gif"
            url = _best_mp4(m.get("video_info", {}).get("variants", []))
            if url:
                media.append(Media("video", url, w, h, thumbnail=m.get("media_url_https")))

    stats = "   ".join(
        s
        for s in (
            f"💬 {compact_number(data.get('conversation_count'))}" if data.get("conversation_count") else "",
            f"❤️ {compact_number(data.get('favorite_count'))}" if data.get("favorite_count") else "",
        )
        if s
    )

    post = Post(
        site="X",
        url=f"https://x.com/{handle}/status/{tweet_id}",
        author_name=user.get("name", handle),
        author_handle=handle,
        text=text,
        avatar=(user.get("profile_image_url_https") or "").replace("_normal.", "_400x400.") or None,
        media=media,
        stats=stats,
        color="#1d9bf0",
    )
    _cache.set(tweet_id, post)
    return post
