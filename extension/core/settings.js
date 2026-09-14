export const SERVICE_SETTINGS = Object.freeze({
  youtube: Object.freeze({
    label: 'YouTube',
    enabled: 'sourceYouTube',
    applicationId: 'youtubeApplicationId',
    artwork: 'youtubeShowArtwork',
    timestamps: 'youtubeShowTimestamps',
    buttons: 'youtubeShowButtons',
  }),
  youtubeMusic: Object.freeze({
    label: 'YouTube Music',
    enabled: 'sourceYouTubeMusic',
    applicationId: 'youtubeMusicApplicationId',
    artwork: 'youtubeMusicShowArtwork',
    timestamps: 'youtubeMusicShowTimestamps',
    buttons: 'youtubeMusicShowButtons',
  }),
  crunchyroll: Object.freeze({
    label: 'Crunchyroll',
    enabled: 'sourceCrunchyroll',
    applicationId: 'crunchyrollApplicationId',
    artwork: 'crunchyrollShowArtwork',
    timestamps: 'crunchyrollShowTimestamps',
    buttons: 'crunchyrollShowButtons',
  }),
  movies67: Object.freeze({
    label: '67Movies',
    enabled: 'sourceMovies67',
    applicationId: 'movies67ApplicationId',
    artwork: 'movies67ShowArtwork',
    timestamps: 'movies67ShowTimestamps',
    buttons: 'movies67ShowButtons',
  }),
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  showPaused: true,
  sourceYouTube: true,
  youtubeApplicationId: '',
  youtubeShowArtwork: true,
  youtubeShowTimestamps: true,
  youtubeShowButtons: true,
  sourceYouTubeMusic: true,
  youtubeMusicApplicationId: '',
  youtubeMusicShowArtwork: true,
  youtubeMusicShowTimestamps: true,
  youtubeMusicShowButtons: true,
  sourceCrunchyroll: true,
  crunchyrollApplicationId: '',
  crunchyrollShowArtwork: true,
  crunchyrollShowTimestamps: true,
  crunchyrollShowButtons: true,
  sourceMovies67: true,
  movies67ApplicationId: '',
  movies67ShowArtwork: true,
  movies67ShowTimestamps: true,
  movies67ShowButtons: true,
});

export const LEGACY_DETAIL_SETTINGS = Object.freeze([
  'showArtwork',
  'showTimestamps',
  'showButtons',
]);

export function normalizeSettings(value = {}) {
  const normalized = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof fallback === 'boolean') {
      normalized[key] = typeof value[key] === 'boolean' ? value[key] : fallback;
    } else {
      normalized[key] = typeof value[key] === 'string' ? value[key].trim() : fallback;
    }
  }

  for (const service of Object.values(SERVICE_SETTINGS)) {
    if (typeof value[service.artwork] !== 'boolean' && typeof value.showArtwork === 'boolean') {
      normalized[service.artwork] = value.showArtwork;
    }
    if (typeof value[service.timestamps] !== 'boolean' && typeof value.showTimestamps === 'boolean') {
      normalized[service.timestamps] = value.showTimestamps;
    }
    if (typeof value[service.buttons] !== 'boolean' && typeof value.showButtons === 'boolean') {
      normalized[service.buttons] = value.showButtons;
    }
  }
  return normalized;
}

export function presenceDetailsForSource(source, settings = DEFAULT_SETTINGS) {
  const service = SERVICE_SETTINGS[source];
  if (!service) return {};
  const current = normalizeSettings(settings);
  return {
    showArtwork: current[service.artwork],
    showTimestamps: current[service.timestamps],
    showButtons: current[service.buttons],
  };
}

export function applicationIdForSource(source, settings = DEFAULT_SETTINGS) {
  const service = SERVICE_SETTINGS[source];
  if (!service) return '';
  return normalizeSettings(settings)[service.applicationId];
}

export function isTrackAllowed(track, settings = DEFAULT_SETTINGS) {
  if (!track) return false;
  const current = normalizeSettings(settings);
  if (!current.enabled) return false;
  if (!current.showPaused && !track.playing) return false;
  const service = SERVICE_SETTINGS[track.source];
  return !service || current[service.enabled];
}
