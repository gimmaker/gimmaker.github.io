// The bot's commands, registered with Discord by scripts/register-discord.js.
// integration_types 0/1: installable on a server or on someone's own account.
// contexts 0/1/2: usable in servers, in the bot's DMs and in other DMs/groups.

const everywhere = { integration_types: [0, 1], contexts: [0, 1, 2] };

const STRING = 3;
const ATTACHMENT = 11;

const file = { type: ATTACHMENT, name: "file", description: "Video, GIF or image to use" };
const link = { type: STRING, name: "link", description: "…or a reel or xeet link instead of a file" };

export const COMMANDS = [
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
        description: "What to do with the audio",
        required: true,
        choices: [
          { name: "Replace", value: "replace" },
          { name: "Remove", value: "remove" },
          { name: "Extract as MP3", value: "extract" },
        ],
      },
      file,
      link,
      { type: ATTACHMENT, name: "audio", description: "The new sound, for Replace (audio file or a video)" },
    ],
  },
  {
    name: "deepfry",
    description: "Deepfry a video, image or GIF",
    ...everywhere,
    options: [
      file,
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
      { type: STRING, name: "text", description: "The caption", required: true, max_length: 100 },
      file,
      link,
    ],
  },
  {
    name: "gif",
    description: "Convert to a GIF, or convert a GIF to a video",
    ...everywhere,
    options: [
      file,
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
