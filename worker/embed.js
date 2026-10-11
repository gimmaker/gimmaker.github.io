// Turn a post into the HTML + oEmbed JSON that Discord reads to build a preview.

import { escapeHtml } from "./util.js";

// Discord cuts long descriptions anyway; trim ourselves so it ends cleanly.
const MAX_DESCRIPTION = 340;
const MAX_GALLERY = 4;

// index is 1-based (as in /photo/2 or ?img_index=2); null picks automatically.
export function pickMedia(post, index = null) {
  if (!post.media.length) return [];
  if (index != null && index >= 1 && index <= post.media.length) return [post.media[index - 1]];
  if (post.media[0].kind === "video") return [post.media[0]];
  return post.media.filter((m) => m.kind === "photo").slice(0, MAX_GALLERY);
}

function truncate(text, limit) {
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + "…";
}

export function title(post) {
  return post.authorHandle ? `${post.authorName} (@${post.authorHandle})` : post.authorName;
}

// mediaUrl(media, position) lets a site swap in a proxy URL for a media item.
export function renderEmbed(post, baseUrl, { mediaUrl = null, index = null } = {}) {
  const chosen = pickMedia(post, index);
  const heading = title(post);
  const description = truncate(post.text, MAX_DESCRIPTION);
  const oembed =
    `${baseUrl}/oembed?` +
    new URLSearchParams({ author: post.stats || post.site, url: post.url, site: post.site });

  const tags = [
    ["property", "og:site_name", `gimmaker · ${post.site}`],
    ["property", "og:url", post.url],
    ["property", "og:title", heading],
    ["property", "og:description", description],
    ["name", "twitter:title", heading],
    ["name", "twitter:description", description],
    ["name", "theme-color", post.color],
  ];

  if (chosen[0]?.kind === "video") {
    const v = chosen[0];
    const src = mediaUrl ? mediaUrl(v, post.media.indexOf(v)) : v.url;
    tags.push(
      ["property", "og:type", "video.other"],
      ["name", "twitter:card", "player"],
      ["property", "og:video", src],
      ["property", "og:video:secure_url", src],
      ["property", "og:video:type", "video/mp4"],
      ["property", "og:video:width", v.width],
      ["property", "og:video:height", v.height],
      ["name", "twitter:player:stream", src],
      ["name", "twitter:player:stream:content_type", "video/mp4"],
      ["name", "twitter:player:width", v.width],
      ["name", "twitter:player:height", v.height],
    );
    if (v.thumbnail) tags.push(["property", "og:image", v.thumbnail], ["name", "twitter:image", v.thumbnail]);
  } else if (chosen.length) {
    tags.push(["property", "og:type", "article"], ["name", "twitter:card", "summary_large_image"]);
    // Several og:image tags make Discord show a gallery.
    for (const m of chosen) {
      tags.push(
        ["property", "og:image", m.url],
        ["property", "og:image:width", m.width],
        ["property", "og:image:height", m.height],
        ["name", "twitter:image", m.url],
      );
    }
  } else {
    tags.push(["property", "og:type", "article"], ["name", "twitter:card", "summary"]);
    if (post.avatar) tags.push(["property", "og:image", post.avatar], ["name", "twitter:image", post.avatar]);
  }

  const meta = tags
    .filter(([, , value]) => value && value !== 0 && value !== "0")
    .map(([attr, key, value]) => `  <meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(value)}">`)
    .join("\n");
  const url = escapeHtml(post.url);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(heading)}</title>
${meta}
  <link rel="alternate" type="application/json+oembed" href="${escapeHtml(oembed)}">
  <meta http-equiv="refresh" content="0; url=${url}">
</head>
<body>Redirecting to <a href="${url}">${url}</a></body>
</html>
`;
}

// Discord shows provider_name as the small top line and author_name below it,
// which is where fixupx-style embeds put the likes/replies counts.
export function oembedJson(params) {
  const url = params.get("url") || "";
  const site = params.get("site");
  return {
    version: "1.0",
    type: "link",
    author_name: params.get("author") || "",
    author_url: url,
    provider_name: site ? `gimmaker · ${site}` : "gimmaker",
    provider_url: url,
    title: "Embed",
  };
}
