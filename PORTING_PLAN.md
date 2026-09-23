# Chromium Activity Lab porting plan

## Goal and boundaries

Build a separate Chromium MV3 development extension in this repository. Keep the original ChudPresence Solo Chrome release unchanged. The `ChudPresence-Activities/` package checkout is kept separately and ignored here; Activity Library packages are maintained in their own repository.

The target is the Activity Library, its diagnostics, and the V1 Crunchyroll and YouTube Music packages running in Chromium. Preserve the original Chromium build as a baseline. Keep Discord publishing out of the first playback-detection gate; the popup's local presence intent is sufficient to validate the port.

## Platform decisions

- Target Chrome 135 or newer. The current Activity Manager needs `userScripts.execute()` and document-targeted injection, available from Chrome 135. Per-Activity `worldId` requires Chrome 133 or newer.
- Declare `userScripts` as an install-time permission in the Chromium manifest. Keep website origins optional and request them when an Activity is installed. On Chrome 138 or newer, instruct the tester to enable **Allow User Scripts** on the extension details page; detect when the API is unavailable and show this state in the Library.
- Use a Manifest V3 background service worker. Keep Activity installation in storage, restore registered scripts on install/update and worker startup, and recheck behavior after worker suspension. Preserve tab, frame, and document ownership checks.
- Give this lab its own extension identity. Validate local preview before OAuth. If Discord testing is later needed, derive the lab's Chromium callback from its actual extension ID and register that callback; do not assume the original extension's fixed callback applies.
- The original Chromium build already has packaged Crunchyroll scripts, including an iframe player probe. Use them as a comparison baseline. During Activity testing, disable the packaged Crunchyroll provider in the lab build so two reporters do not compete for one tab.

## Implementation sequence

1. **Baseline.** Record this clone's starting commit and verify `npm run check`, `npm test`, and `npm run build`. Load its `extension/` directory unpacked in a clean Chromium profile and record the existing Crunchyroll behavior. Keep build output inside this repo.
2. **Bring over the V1 contract.** Copy the canonical schemas, generated contract, validator, repository client, Activity settings, and their tests from the Firefox fork. Make a separate local copy of `ChudPresence-Activities` for this lab before editing packages. Check the two contract copies and catalog hashes against each other.
3. **Port the runtime.** Adapt Activity Manager registration, `USER_SCRIPT` world configuration, message ownership, document-targeted reload, `MAIN` page execution, and restore logic to Chrome. Keep the existing report validator and network restrictions. Add tests for Chrome-specific API failures and worker cold starts.
4. **Wire the service worker.** Integrate Activity reports with the registry, selection, local presence intent, and tab lifecycle in `extension/background.js`. Restore installed Activities on install/update and after a worker restart. Ensure old-document clears cannot erase a newer report.
5. **Port the Library UI.** Bring over Discover, Installed, Updates, Developer diagnostics, and local file loading. Replace Firefox permission prompts and wording with Chromium API availability and site-permission states. Make `visibility`, playback state, last accepted report, last clear, and final presence intent easy to inspect.
6. **Package and document.** Update the manifest, check/build scripts, README, and privacy text for this lab. Keep `dist/` local. Do not reuse Firefox XPI packaging or claim the lab is the original Chrome release.

## Luna subagent work during implementation

Summon up to three `gpt-6-luna` subagents at a time with concrete, bounded assignments and separate file ownership:

- **Luna A — Chromium platform:** manifest, permissions helper, identity/callback, and shutdown strategy. Do not edit `background.js`.
- **Luna B — Activity runtime:** V1 contract, validator, repository client, Activity Manager, and focused runtime tests. Do not edit UI or `background.js`.
- **Luna C — Library and diagnostics:** `activities.*`, popup diagnostics, Chromium wording, and focused UI checks. Do not edit runtime or `background.js`.

The primary agent owns `background.js`, integrates the three streams, resolves API assumptions in a real Chromium build, and runs the end-to-end gates. Start each Luna task only after the lab copy has been prepared, and ask each agent to report changed files, tests, and unresolved risks. Keep shared manifest/background changes sequential.

## Acceptance gates

- `npm run check`, `npm test`, and `npm run build` pass in this new folder. The Activity package copy passes its tests, typecheck, and catalog hash check.
- Chrome loads `extension/` unpacked with no manifest or service-worker errors; Activity Library clearly reports whether user scripts and host access are available.
- A local Crunchyroll Activity reports a normal playing episode, a paused episode, and an ad without mixing them. Close and reopen its tab, open another episode, switch to YouTube Music and back, and repeat after service-worker suspension. The final presence intent must follow the newest accepted report without a stale-document error blocking playback.
- Local Activity reload and removal cleanly update registered scripts and reports. An extension reload/update restores installed Activities.
- The original Chromium checkout remains clean and at its original commit. No GitHub repo, PR, or release is created until local behavior is reviewed.
