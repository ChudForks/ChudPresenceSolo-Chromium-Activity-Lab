# Chromium Activity API V1 conformance coverage

`activity-conformance.test.js` is the integration-level Activity runtime suite. It runs the registered Chromium `USER_SCRIPT` wrapper in a synthetic page VM and drives its `chrome.runtime` requests against an `ActivityManager` backed by a deterministic fake extension API.

| Contract area | Coverage |
| --- | --- |
| Install and registration | Isolated `USER_SCRIPT` world and Activity `worldId`; registration match and `excludeMatches` patterns; `runAt` and frame configuration; restore after script registration state is lost. |
| Chromium ownership | Accepts matching world, message Activity ID, Activity version, installed record, capability and sender URL; rejects mismatches, malformed or stale capabilities, excluded/out-of-match URLs, disabled/uninstalled records and wrong connection versions. |
| Missing `userScriptWorldId` | Authenticates with the persisted Activity ID and capability; rejects another Activity's capability, malformed IDs, missing capabilities and page/content-script forgeries. |
| Capability rotation and secrecy | Reinstall rotates per-install ownership; old messages stop working; the capability is absent from public state, diagnostics, errors, logs, normalized reports, network diagnostics and presence tracks. |
| Public runtime API | Frozen `ChudPresence` surface and coverage for report/clear, `page.execute`, `net.fetch`, storage, settings, navigation, media, DOM, logs and lifecycle. The Activity receives no direct `chrome` or `browser` extension API. |
| Page execution | Uses `chrome.userScripts.execute` in `MAIN`, bound to the sender's `documentId`; covers stale documents, protected pages, code/argument limits, malformed JSON/results, and structured page exceptions. |
| Navigation and documents | Coalesced rapid History API transitions, same-document queue URL changes, and true document replacement/invalidation. Delayed reports and clears from retired documents are rejected. |
| Frames | Top and embedded reports, frame and parent-frame identity, per-frame document ownership, child/top replacement, stale child reports, and frame-specific clears. |
| External network broker | Declared origin plus host permission, HTTPS, omitted credentials, rejected redirects and Discord endpoints, method/header restrictions, body/response/time limits, JSON errors, structured diagnostics, and global/per-Activity concurrency. |
| Activity storage | Namespacing and isolation, get/set/remove/clear, JSON and key validation, quota/errors, update persistence, and uninstall cleanup. |
| Settings | Boolean, select, string, range and number defaults; persistence; validation; change notifications to running instances; compatible updates and new-schema fallback. |
| Lifecycle and upgrades | Disable/enable, update, reload, uninstall and permission loss; abort signals, timers, intervals and cleanup; persisted one-time upgrade notifications, migration failure/success and restart behavior. |
| Reports, logs and diagnostics | All supported report kinds, report size and field validation, playback/display/artwork/buttons/media/visibility normalization, structured errors, rate limits, bounded logs, last report/clear/error/upgrade and network diagnostics. |
| MV3 recovery and rollback | Cold `ActivityManager` restoration, persisted capabilities and pending upgrades, disabled and permission-missing records, synthetic `runtime.onInstalled`/`onStartup` restoration after Chrome clears registrations, plus install/disable/update rollback failures. |

Chromium-specific conformance points are capability-based ownership when `sender.userScriptWorldId` is absent, per-install capability rotation and redaction, `chrome.userScripts.execute`, document-bound `MAIN`-world page execution, and Manifest V3 service-worker and extension-update restoration.

The suite is synthetic: its fake `chrome.storage.local`, `chrome.permissions`, `chrome.userScripts`, `chrome.tabs` and `chrome.runtime` APIs make behavior deterministic without starting Chrome. The extension update test dispatches the same runtime lifecycle handler registered by the background worker; it does not simulate Chrome internals. These tests do not replace real-browser checks for user-script permission prompts, actual frame injection, service-worker suspension, or end-to-end Activity installation and reporting.

Run with `npm test`.
