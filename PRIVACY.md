# gimmaker Privacy Policy

_Last updated: October 11, 2026_

This policy explains what information the gimmaker website (gimmaker.github.io), the link
fixer at gimmaker.gimmaker.workers.dev, and the gimmaker Discord bot handle. gimmaker is a
free hobby project made by qaysarstellar. The short version: gimmaker has no accounts, no
analytics, no ads and no database, and doesn't sell or share your information.

## The website

- **Files you upload** are edited inside your own browser. They are never sent to gimmaker.
- **Links you paste** are sent to the gimmaker link fixer so it can look up the post on
  X or Instagram (see below).
- **Your last pasted link** is saved in your browser's local storage so it's still there next
  time. It stays on your device; clear it with the **Clear** button or your browser settings.
- **No cookies, analytics or tracking** are used.

## The link fixer

When you paste a link, open a fixed link, or download media, the link fixer (a Cloudflare
Worker) fetches that post's public text and media from X or Instagram and passes it back.

- Post details are kept in memory for up to about 10 minutes so repeat requests are faster,
  then discarded. Nothing is written to a database or log by gimmaker.
- When people click a fixed link, they're simply redirected to the original post.

## The Discord bot

When you use a gimmaker command, Discord sends the bot the details needed to answer it:
your Discord user ID, where the command was used, the options you chose, the link or the
address of any file you attached, and, for **Apps → Gimmideo FC**, the text of the message
you picked.

- The bot uses this only to reply to that command, and doesn't store it.
- Files you attach are passed through to the website for editing in your browser, without
  being saved. Discord's own file links expire after about a day.
- The bot can't read your other messages.

Discord's handling of your data is covered by
[Discord's Privacy Policy](https://discord.com/privacy).

## Services gimmaker relies on

These services receive your IP address and standard request details when you use gimmaker,
and handle them under their own privacy policies:

- **GitHub Pages** hosts the website ([GitHub privacy](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)).
- **Cloudflare** runs the link fixer and bot ([Cloudflare privacy](https://www.cloudflare.com/privacypolicy/)).
- **Google Fonts** serves the site's fonts ([Google privacy](https://policies.google.com/privacy)).
- **jsDelivr** serves the video-editing engine the first time you use an editing tool
  ([jsDelivr privacy](https://www.jsdelivr.com/terms/privacy-policy-jsdelivr-net)).
- **X and Instagram** serve the posts and media you ask for.
- **Discord**, if you use the bot.

## Children

gimmaker isn't meant for children under 13, and doesn't knowingly collect information from
them. Discord requires users to be at least 13 (or older where local law requires).

## Changes

This policy may be updated. Changes take effect when they're posted here, and the date at
the top shows the latest version.

## Contact

Questions or requests: open an issue at
<https://github.com/gimmaker/gimmaker.github.io/issues>.
