const MAX_TEXT_LENGTH = 128;

const SOURCE_LABELS = Object.freeze({
  crunchyroll: 'Crunchyroll',
  movies67: '67Movies',
  youtube: 'YouTube',
  youtubeMusic: 'YouTube Music',
});

function cleanText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function sourceLabel(track) {
  if (track?.source === 'youtube' && track.kind === 'short') return 'YouTube Shorts';
  if (track?.source === 'youtube' && (track.live || track.kind === 'live')) return 'YouTube Live';
  return SOURCE_LABELS[track?.source] || 'ChudPresence';
}

function activityType(track) {
  return track?.kind === 'song' || track?.source === 'youtubeMusic' ? 'listening' : 'watching';
}

function timestamps(track, nowMs) {
  if (!track?.playing || track.live) return null;

  const position = Math.max(0, Number(track.position) || 0);
  const duration = Math.max(0, Number(track.duration) || 0);
  if (!duration || position >= duration) return null;

  const now = Math.floor(nowMs / 1000);
  return {
    start: now - Math.floor(position),
    end: now + Math.ceil(duration - position),
  };
}

/**
 * Converts a provider-neutral track into a transport-neutral Discord presence
 * intent. A native Social SDK, Embedded App, or another supported connector can
 * translate this object without coupling itself to page scraping code.
 */
export function createPresenceIntent(track, nowMs = Date.now(), settings = {}) {
  if (!track?.title || track.idle || track.ad) return null;

  const provider = sourceLabel(track);
  const state = cleanText([track.artist, track.album].filter(Boolean).join(' • ') || provider);
  const artwork = settings.showArtwork === false ? '' : safeUrl(track.artwork);
  const activityUrl = safeUrl(track.url);
  const channelUrl = safeUrl(track.channelUrl);
  const buttons = [];

  if (activityUrl) buttons.push({ label: track.kind === 'song' ? 'Listen' : 'Watch', url: activityUrl });
  if (channelUrl && channelUrl !== activityUrl) {
    buttons.push({ label: track.kind === 'episode' ? 'View series' : 'View channel', url: channelUrl });
  }

  return {
    name: provider,
    type: activityType(track),
    details: cleanText(track.title),
    state,
    timestamps: settings.showTimestamps === false ? null : timestamps(track, nowMs),
    assets: artwork ? { largeImage: artwork, largeText: provider } : null,
    buttons: settings.showButtons === false ? [] : buttons.slice(0, 2),
    source: track.source || 'unknown',
  };
}
