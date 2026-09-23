// Discord application identities are intentionally part of this extension build.
// Application IDs are public identifiers, not client secrets.
export const DISCORD_CLIENT_ID = '1549066134706323548';
// Derive the callback from this unpacked lab install's extension ID. OAuth
// must remain disabled until this callback is registered with the Discord app.
export function discordRedirectUrl(identity = globalThis.chrome?.identity) {
  if (typeof identity?.getRedirectURL !== 'function') {
    throw new Error('Chromium identity API is unavailable.');
  }
  return identity.getRedirectURL('discord');
}

export const SERVICE_APPLICATION_IDS = Object.freeze({
  youtube: DISCORD_CLIENT_ID,
  youtubeMusic: DISCORD_CLIENT_ID,
  crunchyroll: DISCORD_CLIENT_ID,
  movies67: DISCORD_CLIENT_ID,
  twitch: DISCORD_CLIENT_ID,
  kick: DISCORD_CLIENT_ID,
});
