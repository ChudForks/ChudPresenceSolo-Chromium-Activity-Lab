# Original Chromium baseline

- Starting lab and original checkout commit: `3e3ff9acda7b0377e9e2bbea85c33a30c3be849c`.
- Before porting, `npm run check`, `npm test` (26 tests), and `npm run build` passed in this lab clone.
- The original 1.8.0 build zip is retained locally at `baseline/ChudPresence-Solo-1.8.0-extension.zip`.
- Microsoft Edge 153 loaded the original extension unpacked in a separate clean profile. Its `background.js` service worker appeared in DevTools under the original extension ID `lgnhpmldmgjclkkjajcaehlcggbconka`.
- The original manifest packages both `crunchyroll.js` and the all-frame `crunchyroll-player.js` probe. Live Crunchyroll playback requires a signed-in session and was not observed in the clean profile.
- The original checkout had no working-tree changes at the baseline check.
