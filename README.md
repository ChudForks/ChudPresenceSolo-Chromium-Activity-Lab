# ChudPresence Chromium Activity Lab

This is a separate Manifest V3 Chromium development extension for Activity API V1. It is not the original ChudPresence Solo Chrome release. The Activity Library catalog is maintained in a separate repository. A copy of its YouTube Activity is included for the first install.

The Activity Library installs the V1 Crunchyroll, YouTube Music, 67Movies, Kick, Twitch, and YouTube packages from the official catalog or local files. YouTube is installed as an Activity by default once Chromium allows user scripts. You can disable or remove it in the Library; removing it prevents automatic reinstallation on later starts or updates. Playback detection and the popup's local presence intent can be tested without connecting Discord.

## Run locally

1. Use Chrome or another Chromium browser version 135 or newer. In `chrome://extensions`, enable **Developer mode** and select **Load unpacked**.
2. Select this repository's `extension/` directory, then open its **Activity Library** from the popup.
3. On Chrome 138 or newer, open the lab extension's details page and enable **Allow User Scripts**. The Library reports when the API is unavailable.
4. YouTube appears in Installed once user scripts are available. Install Crunchyroll, YouTube Music, 67Movies, Kick, or Twitch from Discover, or enable Developer mode in the Library and load a local `metadata.json` and `activity.js` from `ChudPresence-Activities/activities/`. Chromium asks for those Activities' declared website origins when installed. 67Movies also asks for its declared The Movie Database API origin.
5. Play media and inspect the Library's report, clear, frame, permission, and local presence diagnostics. The popup also shows the selected local presence intent.

The lab's unpacked extension ID is determined by Chromium. If you later test Discord publishing, copy the callback shown in Settings and register that exact callback for client ID `1549066134706323548` in the Discord Developer Portal, with **Public Client** enabled. The original release's fixed callback does not apply to this lab. Discord's Headless Sessions transport is experimental and is outside the first playback detection gate.

## Development gates

Requirements: Node.js 20 or newer for the extension checks and the local Activity package copy.

```bash
npm run check
npm test
npm run build
cd ChudPresence-Activities
npm ci
npm test
npm run typecheck
npm run check:catalog
```

`npm run build` writes a local unpacked build and zip under `dist/`. Load `extension/` directly while debugging. The original 1.8.0 Chromium build is retained locally under `baseline/`; both directories are ignored by Git. The separate `ChudPresence-Activities/` checkout is also local and ignored by this repository. `npm run check` verifies the Activity contract copies and local catalog hashes when that checkout is present. It never publishes a package.

Activity API V1 is a trusted first-party API. See [the Activity API guide](extension/ACTIVITY_API.md), [the browser verification record](TESTING.md), [the porting plan](PORTING_PLAN.md), and [privacy details](PRIVACY.md).
