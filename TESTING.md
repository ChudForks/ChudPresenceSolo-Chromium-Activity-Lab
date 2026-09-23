# Chromium Activity Lab verification

## Automated gates

On September 23, 2026, the lab passed `npm run check`, `npm test` (67 tests), and `npm run build`. The separate local `ChudPresence-Activities` copy passed `npm run check:contract`, `npm run check:catalog`, `npm run typecheck`, and `npm test` (4 tests). The original checkout remained at `3e3ff9acda7b0377e9e2bbea85c33a30c3be849c` with a clean working tree.

## Chromium browser check

Microsoft Edge 153 loaded the unpacked lab extension and its MV3 service worker. A clean profile showed the Library's **Allow User Scripts** guidance until the extension details toggle was enabled. With the toggle enabled, the Library reported an available user-script runtime.

In an isolated integration profile, the local Crunchyroll and YouTube Music packages installed as separate `USER_SCRIPT` registrations. Synthetic pages served at their real HTTPS origins through Chrome DevTools Protocol exercised the actual injected Activity code and service worker. The browser accepted a playing episode, a paused episode, and an ad report. The ad produced no final presence intent. Closing and reopening a tab, navigating to another episode in the same tab, switching to YouTube Music and back, and stopping the MV3 worker all produced the expected current Activity and intent. The same document reconnected and restored its report after the worker stopped. Activity reload reinjected the current document; removal unregistered its script and cleared its intent. An extension reload restored both installed registrations.

The integration profile pregranted the two Activity origins in a temporary copy of the manifest so headless Chromium would not stall on a permission prompt. The shipping lab manifest keeps those origins optional and requests them during installation. The clean profile confirmed the permission guidance, but interactive approval of each origin still needs a headed browser check.

Synthetic playback validates the Chromium port and message flow, not the current live Crunchyroll or YouTube Music player DOM. Before publishing, load `extension/` in a normal Chrome profile, grant each requested origin, and repeat the playing, paused, ad, navigation, and worker restart checks while signed in to the services. Discord publishing was outside this playback gate.
