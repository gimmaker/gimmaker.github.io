// Instagram post fetching (the kkinstagram / ddinstagram side).
//
// Instagram's own link previews only carry a thumbnail. To get playable video
// we read the public embed page (/p/<code>/embed/captioned/), which ships the
// full post JSON, including direct video URLs. If that JSON is missing we fall
// back to scraping the embed HTML, then to Instagram's own crawler meta tags.

import { FetchError, TTLCache, compact, getText, joinStats, unescapeHtml } from "./util.js";

const embedUrl = (code) => `https://www.instagram.com/p/${code}/embed/captioned/`;
const postUrl = (code) => `https://www.instagram.com/p/${code}/`;

// Without these Instagram serves an error page instead of the embed.
const EMBED_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "iframe",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "cross-site",
};
const COLOR = "#e1306c";

const cache = new TTLCache();

function fromContextJson(code, page) {
  const m = page.match(/"contextJSON":("(?:[^"\\]|\\.)*")/);
  if (!m) return null;
  let ctx;
  try {
    ctx = JSON.parse(JSON.parse(m[1]));
  } catch {
    return null;
  }
  const sm = ctx.gql_data?.shortcode_media;
  if (!sm) return null;

  const children = (sm.edge_sidecar_to_children?.edges || []).map((e) => e.node);
  const media = [];
  for (const n of children.length ? children : [sm]) {
    const { width = 0, height = 0 } = n.dimensions || {};
    if (n.is_video && n.video_url) {
      media.push({ kind: "video", url: n.video_url, width, height, thumbnail: n.display_url });
    } else if (n.display_url) {
      media.push({ kind: "photo", url: n.display_url, width, height });
    }
  }

  const owner = sm.owner || {};
  const likes = (sm.edge_liked_by || sm.edge_media_preview_like)?.count;
  const comments = sm.edge_media_to_comment?.count;
  return {
    site: "Instagram",
    url: postUrl(code),
    authorName: owner.full_name || owner.username || "",
    authorHandle: owner.username || "",
    text: sm.edge_media_to_caption?.edges?.[0]?.node?.text || "",
    avatar: owner.profile_pic_url || null,
    media,
    stats: joinStats([
      comments ? `💬 ${compact(comments)}` : "",
      likes ? `❤️ ${compact(likes)}` : "",
      sm.video_view_count ? `▶️ ${compact(sm.video_view_count)}` : "",
    ]),
    color: COLOR,
  };
}

function fromEmbedHtml(code, page) {
  const img = page.match(/class="EmbeddedMediaImage"[^>]*?src="([^"]+)"/);
  if (!img) return null;
  const user = page.match(/class="CaptionUsername"[^>]*>([^<]+)<\/a>/);
  const caption = page.match(/<div class="Caption">[\s\S]*?<\/a>([\s\S]*?)<div class="CaptionComments">/);
  const text = caption
    ? unescapeHtml(caption[1].replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "")).trim()
    : "";
  const username = user ? unescapeHtml(user[1]) : "";
  return {
    site: "Instagram",
    url: postUrl(code),
    authorName: username,
    authorHandle: username,
    text,
    avatar: null,
    media: [{ kind: "photo", url: unescapeHtml(img[1]), width: 0, height: 0 }],
    stats: "",
    color: COLOR,
  };
}

async function fromCrawlerTags(code) {
  // Instagram serves OpenGraph tags (thumbnail + caption only) to crawlers.
  const page = await getText(postUrl(code), { "User-Agent": "facebookexternalhit/1.1" });
  const meta = (prop) => {
    const m = page.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`));
    return m ? unescapeHtml(m[1]) : "";
  };
  const image = meta("og:image");
  if (!image) return null;
  const title = meta("og:title");
  const handle = meta("twitter:title").match(/\(@([\w.]+)\)/);
  return {
    site: "Instagram",
    url: postUrl(code),
    authorName: title ? title.split(" on Instagram")[0] : "",
    authorHandle: handle ? handle[1] : "",
    text: meta("og:description"),
    avatar: null,
    media: [{ kind: "photo", url: image, width: 0, height: 0 }],
    stats: "",
    color: COLOR,
  };
}

export async function fetchInstagram(code) {
  const cached = cache.get(code);
  if (cached) return cached;

  let post = null;
  try {
    const page = await getText(embedUrl(code), EMBED_HEADERS);
    post = fromContextJson(code, page) || fromEmbedHtml(code, page);
  } catch (e) {
    if (!(e instanceof FetchError)) throw e;
  }
  if (!post) post = await fromCrawlerTags(code);
  if (!post) throw new FetchError(`instagram post ${code} not found or unavailable`);

  cache.set(code, post);
  return post;
}
