// The bot's commands, registered with Discord by scripts/register-discord.js.
// integration_types 0/1: installable on a server or on someone's own account.
// contexts 0/1/2: usable in servers, in the bot's DMs and in other DMs/groups.

const everywhere = { integration_types: [0, 1], contexts: [0, 1, 2] };

const STRING = 3;
const ATTACHMENT = 11;

const media = { type: ATTACHMENT, name: "media", description: "The video, GIF or image to edit" };
const link = { type: STRING, name: "link", description: "…or a reel or xeet link to edit instead of uploading" };

export const COMMANDS = [
  {
    name: "settings",
    description: "Turn gimmaker features on or off for this server",
    // Servers only, and only people with Manage Server see it by default.
    integration_types: [0],
    contexts: [0],
    default_member_permissions: String(1 << 5),
  },
  {
    name: "gimmideo",
    description: "Fix a reel or xeet link so the video plays in Discord, and get a download",
    ...everywhere,
    options: [{ type: STRING, name: "link", description: "Instagram reel/post or X post link", required: true }],
  },
  {
    // Right-click a message → Apps → Gimmideo FC
    type: 3,
    name: "Gimmideo FC",
    ...everywhere,
  },
  {
    name: "gimmaudio",
    description: "Replace, remove or extract the audio of a video, or add audio to an image",
    ...everywhere,
    options: [
      {
        type: STRING,
        name: "mode",
        description: "What to do with the sound",
        required: true,
        choices: [
          { name: "Replace the sound", value: "replace" },
          { name: "Remove the sound", value: "remove" },
          { name: "Extract the sound as MP3", value: "extract" },
        ],
      },
      media,
      link,
      {
        type: ATTACHMENT,
        name: "replacement-audio",
        description: "The new sound, for Replace: an audio file, or a video to take it from",
      },
    ],
  },
  {
    name: "deepfry",
    description: "Deepfry a video, image or GIF",
    ...everywhere,
    options: [
      media,
      link,
      {
        type: STRING,
        name: "level",
        description: "How fried (default Crispy)",
        choices: [
          { name: "Mild", value: "mild" },
          { name: "Crispy", value: "crispy" },
          { name: "Nuclear", value: "nuclear" },
        ],
      },
    ],
  },
  {
    name: "caption",
    description: "Add a caption to a video, image or GIF",
    ...everywhere,
    options: [
      { type: STRING, name: "text", description: "The caption to put on top", required: true, max_length: 100 },
      media,
      link,
    ],
  },
  {
    name: "gif",
    description: "Convert to a GIF, or convert a GIF to a video",
    ...everywhere,
    options: [
      media,
      link,
      {
        type: STRING,
        name: "size",
        description: "GIF size, longest side (default Medium)",
        choices: [
          { name: "Small (320 px)", value: "320" },
          { name: "Medium (480 px)", value: "480" },
          { name: "Large (640 px)", value: "640" },
        ],
      },
    ],
  },
];
