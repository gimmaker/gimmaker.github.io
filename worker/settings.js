// Per-server settings: admins turn features on or off from one /settings panel.
// They're stored by the Gateway Durable Object (see gateway.js), which also
// reads them when handling messages.

export const SETTINGS = [
  { key: "autoEmbed", label: "Auto-embed", about: "Reply to reel and xeet links with a working embed" },
  { key: "hideOriginal", label: "Hide original preview", about: "Hide the broken preview on links the bot fixes" },
  { key: "prefix", label: "Prefix commands", about: "?fry, ?cap, ?g, gm6 and the rest" },
  { key: "gimmideo", label: "Gimmideo FC", about: "Fixed links and downloads" },
  { key: "gimmaudio", label: "Gimmaudio FC", about: "Replace, remove or extract audio" },
  { key: "deepfry", label: "Deepfry FC", about: "Deepfried media" },
  { key: "caption", label: "Caption FC", about: "Captioned media" },
  { key: "gif", label: "GIF FC", about: "GIF conversion" },
];

export const DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, true]));
const KEYS = new Set(SETTINGS.map((s) => s.key));
export const isSettingKey = (key) => KEYS.has(key);

// Manage Server or Administrator.
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;
export function canManage(member) {
  const perms = BigInt(member?.permissions || 0);
  return (perms & MANAGE_GUILD) !== 0n || (perms & ADMINISTRATOR) !== 0n;
}

function settingsStub(env) {
  return env.GATEWAY.get(env.GATEWAY.idFromName("main"));
}

export async function getSettings(env, guildId) {
  if (!guildId) return DEFAULTS;
  const res = await settingsStub(env).fetch(`https://gateway/settings?guild=${guildId}`);
  return res.ok ? res.json() : DEFAULTS;
}

// change: { key, value } or { reset: true }. Returns the new settings.
export async function changeSettings(env, guildId, change) {
  const res = await settingsStub(env).fetch("https://gateway/settings", {
    method: "POST",
    body: JSON.stringify({ guild: guildId, ...change }),
  });
  return res.json();
}

// The single settings panel: an embed listing every feature, with a toggle
// button for each (green = on) and a reset button.
export function settingsPanel(settings) {
  const lines = SETTINGS.map((s) => `${settings[s.key] ? "🟢" : "⚫"} **${s.label}** — ${s.about}`);
  const button = (s) => ({
    type: 2,
    style: settings[s.key] ? 3 : 2, // 3 = green, 2 = grey
    label: s.label,
    custom_id: `settings:toggle:${s.key}`,
  });
  const row = (...components) => ({ type: 1, components });
  return {
    embeds: [
      {
        title: "gimmaker settings",
        description: `Tap a button to turn it on or off for this server.\n\n${lines.join("\n")}`,
        color: 0x0a0a0a,
        footer: { text: "Only people with Manage Server can change these." },
      },
    ],
    components: [
      row(...SETTINGS.slice(0, 3).map(button)),
      row(...SETTINGS.slice(3, 8).map(button)),
      row({ type: 2, style: 4, label: "Reset (turn everything on)", custom_id: "settings:reset" }),
    ],
  };
}
