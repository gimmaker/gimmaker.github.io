// Registers the bot's slash commands with Discord. Run it once, and again after
// changing worker/discord-commands.js:
//
//   DISCORD_APPLICATION_ID=... DISCORD_TOKEN=... npm run discord:register
//
// The token is only read from the environment and never stored in the repo.

import { COMMANDS } from "../worker/discord-commands.js";

const { DISCORD_APPLICATION_ID: appId, DISCORD_TOKEN: token } = process.env;
if (!appId || !token) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_TOKEN first.");
  process.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
  console.error(`Discord said ${res.status}:`, await res.text());
  process.exit(1);
}
const saved = await res.json();
console.log(`Registered ${saved.length} commands: ${saved.map((c) => c.name).join(", ")}`);
