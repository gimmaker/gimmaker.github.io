// X / Twitter post fetching (the fixupx / fxtwitter side).
//
// Uses X's public syndication endpoint, the same one that powers embedded
// tweets on websites. It needs no login or API key.

import { FetchError, TTLCache, compact, getJson, joinStats } from "./util.js";

const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result?token=a&lang=en&id=";
// Discord's media proxy struggles with very large files, so cap the bitrate
// we pick and fall back to the smallest variant if nothing fits.
const MAX_BITRATE = 2_500_000;

const cache = new TTLCache();

function bestMp4(variants = []) {
  const mp4s = variants
    .filter((v) => v.content_type === "video/mp4")
    .sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
  if (!mp4s.length) return null;
  const fitting = mp4s.filter((v) => (v.bitrate || 0) <= MAX_BITRATE);
  return (fitting.length ? fitting[fitting.length - 1] : mp4s[0]).url;
}

function expandText(tweet) {
  let text = tweet.text || "";
  const entities = tweet.entities || {};
  for (const u of entities.urls || []) text = text.replace(u.url, u.expanded_url || u.url);
  // Media links are shown as the embed itself, so drop the t.co stub.
  for (const m of entities.media || []) text = text.replace(m.url, "");
  return text.trim();
}

export async function fetchTweet(id) {
  const cached = cache.get(id);
  if (cached) return cached;

  const data = await getJson(SYNDICATION_URL + id);
  if (data.__typename !== "Tweet") throw new FetchError(`tweet ${id} not found or unavailable`);

  const user = data.user || {};
  const handle = user.screen_name || "i";
  let text = expandText(data);
  if (data.quoted_tweet) {
    const q = data.quoted_tweet;
    text += `\n\n↘️ Quoting @${q.user?.screen_name || ""}:\n${expandText(q)}`;
  }

  const media = [];
  for (const m of data.mediaDetails || []) {
    const { width = 0, height = 0 } = m.original_info || {};
    if (m.type === "photo") {
      media.push({ kind: "photo", url: `${m.media_url_https}?name=orig`, width, height });
    } else {
      // "video" or "animated_gif"
      const url = bestMp4(m.video_info?.variants);
      if (url) media.push({ kind: "video", url, width, height, thumbnail: m.media_url_https });
    }
  }

  const post = {
    site: "X",
    url: `https://x.com/${handle}/status/${id}`,
    authorName: user.name || handle,
    authorHandle: handle,
    text,
    avatar: user.profile_image_url_https?.replace("_normal.", "_400x400.") || null,
    media,
    stats: joinStats([
      data.conversation_count ? `💬 ${compact(data.conversation_count)}` : "",
      data.favorite_count ? `❤️ ${compact(data.favorite_count)}` : "",
    ]),
    color: "#1d9bf0",
  };
  cache.set(id, post);
  return post;
}
