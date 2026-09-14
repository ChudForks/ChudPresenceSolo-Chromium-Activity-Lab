# Architecture

ChudPresenceSolo is one Manifest V3 Chromium extension. It has no localhost
server, native process, installer, autostart entry, or bundled runtime.

## Layered flow

The project follows the shape of the proposed PreMiD-style pipeline while
keeping detection separate from Discord delivery:

```text
YouTube / YouTube Music / Crunchyroll / 67Movies
                         |
                         v
              provider content scripts
                         |
                  TRACK_UPDATE message
                         |
                         v
           activity broker (select one tab)
                    /             \
                   v               v
             popup preview   presence intent mapper
                                      |
                                      v
                              publisher transport port
                                      |
                         +------------+------------+
                         |                         |
                         v                         v
                  preview publisher       supported Discord
                    (current)             connector (future)
```

This gives the extension a stable internal contract that resembles:

```text
site -> extension activity -> Discord-ready activity -> connection -> Rich Presence
```

It does **not** model OAuth tokens as a presence transport. Authentication and
delivery are separate concerns.

## Why the pictured Discord path cannot run inside this extension

Discord OAuth can identify and authorize a user, but Discord does not expose a
REST endpoint that lets a browser extension set that user's Rich Presence.
Access and refresh tokens therefore do not complete the last hop.

Discord currently supports off-platform Rich Presence through its native Social
SDK. Its direct RPC mode requires a running Discord client and explicitly does
not support web clients. A Manifest V3 extension cannot load the native Social
SDK or open Discord's desktop IPC socket. The Embedded App SDK is for an Activity
running inside Discord, not an arbitrary extension page.

Consequently, a real publisher requires one of these product decisions:

1. Allow a small native host using Discord's Social SDK. This is the direct and
   supported Rich Presence route, but it is a companion component.
2. Turn ChudPresence into a Discord Activity using the Embedded App SDK. This is
   browser technology, but users must run the Activity inside Discord and a
   secure relay would be needed to receive browser-extension events.
3. Keep ChudPresenceSolo extension-only and provide local preview only. This is
   the current, honest behavior.

A bot or ordinary OAuth-backed web service is not a fourth option: it can update
the bot's presence, not the authenticated user's presence.

## Module ownership

- `extension/content.js`, `youtube.js`, `crunchyroll.js`, and `movies67.js` are
  provider adapters. They observe a page and emit normalized tracks.
- `extension/core/activity.js` selects one reportable track across browser tabs.
- `extension/core/presence.js` converts that track to a transport-neutral,
  Discord-shaped presence intent. It owns text limits, safe external URLs,
  timers, artwork, and buttons.
- `extension/background.js` owns browser lifecycle, settings, and orchestration.
- `extension/platform/presence-publisher.js` is the only delivery boundary. A
  supported connector replaces this module without changing provider adapters.
- `extension/popup.*` renders detected activity and the real publisher status.
- `extension/options.*` owns the settings UI, while `core/settings.js` owns
  defaults, normalization, and provider filtering.

Provider tracks may contain `source`, `kind`, `title`, `artist`, `album`,
`artwork`, `url`, `channelUrl`, `playing`, `idle`, `ad`, `live`, `position`, and
`duration`. Consumers tolerate missing optional fields.

The publisher accepts either a presence intent or `null`; `null` means clear the
presence. It returns a delivery status with `id`, `available`, `state`, and
`message` so UI code never has to know which transport is installed.

## Next decision gate

Do not add `identity`, broad host permissions, OAuth token storage, or a Discord
login UI until a supported publisher has been selected. OAuth should then live
beside that publisher rather than inside site adapters or the popup.
