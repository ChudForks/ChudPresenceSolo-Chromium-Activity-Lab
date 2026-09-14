export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  sourceYouTube: true,
  sourceYouTubeMusic: true,
  sourceCrunchyroll: true,
  sourceMovies67: true,
  showPaused: true,
  showArtwork: true,
  showTimestamps: true,
  showButtons: true,
});

const SOURCE_SETTING = Object.freeze({
  crunchyroll: 'sourceCrunchyroll',
  movies67: 'sourceMovies67',
  youtube: 'sourceYouTube',
  youtubeMusic: 'sourceYouTubeMusic',
});

export function normalizeSettings(value = {}) {
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    normalized[key] = typeof value[key] === 'boolean' ? value[key] : fallback;
  }
  return normalized;
}

export function isTrackAllowed(track, settings = DEFAULT_SETTINGS) {
  if (!track) return false;
  const current = normalizeSettings(settings);
  if (!current.enabled) return false;
  if (!current.showPaused && !track.playing) return false;
  const sourceSetting = SOURCE_SETTING[track.source];
  return !sourceSetting || current[sourceSetting];
}
