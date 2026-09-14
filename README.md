# ChudPresence Solo

ChudPresence Solo is an extension-only foundation for detecting playback on YouTube,
YouTube Music, Crunchyroll, and 67Movies.

The old Node.js companion, localhost bridge, system tray app, Windows installer,
and bundled runtime have been removed. The extension detects activity, displays
it in its popup, and can experimentally publish it directly to Discord.

> Discord does not document Headless Sessions as a supported public API. This
> extension-only transport may change or stop working without notice. It uses
> Discord OAuth with PKCE and never asks for a Discord account token. Discord's
> required `sdk.social_layer_presence` scope authorizes more Social SDK features
> than this extension uses; ChudPresence Solo only calls user info and presence routes.

## Load the extension

1. Open `chrome://extensions` (or the equivalent page in Edge or Brave).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension` directory.
5. In the Discord Developer Portal, ensure the built-in OAuth application's
   OAuth2 redirect list contains
   `https://lgnhpmldmgjclkkjajcaehlcggbconka.chromiumapp.org/discord` and that
   **Public Client** is enabled.
6. Open the extension's **Settings** page and choose **Connect Discord**.
7. Open a supported site and play something, then open the extension popup.

Use **Settings** in the popup, or **Details → Extension options** on the browser's
extensions page, to configure a separate profile for each supported service.
Service profiles contain sharing, paused-media, member-list status text, artwork,
timer, and Discord profile-button preferences. The OAuth application ID, service
application IDs, and OAuth redirect URI are fixed in
`extension/config.js`; users cannot override them from Settings. Other settings
are stored locally by the extension.

The fixed redirect URI requires the extension to run with the ID
`lgnhpmldmgjclkkjajcaehlcggbconka`; verify that ID in the browser's extension
page before connecting Discord.

## Discord layouts

- **YouTube Music:** song title, artist, album artwork tooltip, playback progress,
  **Play on YouTube Music**, and **Search artist**.
- **YouTube:** video title, channel, thumbnail, playback progress, **Watch on
  YouTube**, and **View channel**. Live streams use an elapsed timer and Live
  marker; Shorts use **Watch Short**.
- **Crunchyroll:** series plus season/episode information, with the episode title
  on the artwork tooltip. Movies use their own title and **Watch movie** layout.
- **67Movies:** TMDB series/movie artwork and metadata. Episodes show series plus
  episode title; movies use their own title and **Watch movie** layout.

Paused activities remain visible and receive a Paused marker by default. Every
service can independently disable that behavior and choose whether Discord's
member list shows the application name, primary title, or secondary status.

No companion process, localhost port, installer, or Discord desktop client is
required. Detection and preview continue to work without connecting Discord.

## Development

Requirements: Node.js 18 or newer for checks, tests, and packaging. The unpacked
extension itself has no Node.js runtime dependency and no third-party packages.

```bash
npm run check
npm test
npm run build
```

`npm run build` replaces `dist/` with an extension directory and installable zip.
Day-to-day development has no compilation step: edit `extension/` and reload it
from the browser's extensions page.

See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries and the recommended
rewrite sequence.

## Supported sites and privacy

- YouTube and YouTube Music
- Crunchyroll
- 67Movies

The manifest only requests `storage` permission. Content scripts run only on the
documented supported domains. There are no localhost host permissions and no
companion process. Some site adapters may use public page metadata and artwork
URLs exposed by the site they run on.
