# ChudPresenceSolo

ChudPresenceSolo is an extension-only foundation for detecting playback on YouTube,
YouTube Music, Crunchyroll, and 67Movies.

The old Node.js companion, localhost bridge, system tray app, Windows installer,
and bundled runtime have been removed. The extension detects activity, displays
it in its popup, and can experimentally publish it directly to Discord.

> Discord does not document Headless Sessions as a supported public API. This
> extension-only transport may change or stop working without notice. It uses
> Discord OAuth with PKCE and never asks for a Discord account token. Discord's
> required `sdk.social_layer_presence` scope authorizes more Social SDK features
> than this extension uses; ChudPresence only calls user info and presence routes.

## Load the extension

1. Open `chrome://extensions` (or the equivalent page in Edge or Brave).
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension` directory.
5. Open the extension's **Settings** page and copy its OAuth redirect URL.
6. Create a Discord application, enable **Public Client**, and add that exact
   redirect URL in the application's OAuth2 settings.
7. Paste the ChudPresenceSolo OAuth application ID into its Discord connection
   settings, save it, and choose **Connect Discord**.
8. Optionally add a separate Discord application ID to each service profile.
   A blank service ID falls back to the ChudPresenceSolo OAuth application ID.
9. Open a supported site and play something, then open the extension popup.

Use **Settings** in the popup, or **Details → Extension options** on the browser's
extensions page, to configure paused-media handling and a separate profile for
each supported service. Service profiles contain the activity application ID,
artwork, timer, and activity-link preferences. The one ChudPresenceSolo OAuth
application remains responsible for the shared Discord login. Settings are
stored locally by the extension.

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
