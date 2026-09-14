# ChudPresenceSolo

ChudPresenceSolo is an extension-only foundation for detecting playback on YouTube,
YouTube Music, Crunchyroll, and 67Movies.

The old Node.js companion, localhost bridge, system tray app, Windows installer,
and bundled runtime have been removed. The extension currently detects activity
and displays it in its popup.

> Discord Rich Presence publishing is not available in this baseline. Discord's
> supported off-platform path uses its native Social SDK, which cannot run in a
> Chromium extension. OAuth access alone does not provide a user-presence API.
> The extension prepares a Discord-shaped activity behind the publisher boundary
> described in [ARCHITECTURE.md](ARCHITECTURE.md), but reports the missing
> transport honestly.

## Load the extension

1. Open `chrome://extensions` (or the equivalent page in Edge or Brave).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension` directory.
5. Open a supported site and play something, then open the extension popup.

Use **Settings** in the popup, or **Details → Extension options** on the browser's
extensions page, to configure supported sources, paused-media handling, artwork,
timers, and activity links. Settings are stored locally by the extension.

No companion process, application ID, localhost port, installer, or Discord login
is required for detection and preview behavior.

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
