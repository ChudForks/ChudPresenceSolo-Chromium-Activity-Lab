import { normalizeActivityPreferences } from './activity-settings.js';
import { DISCORD_CLIENT_ID } from '../config.js';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
});

export const LEGACY_DETAIL_SETTINGS = Object.freeze([
  'showPaused',
  'showArtwork',
  'showTimestamps',
  'showButtons',
]);

export const LEGACY_APPLICATION_ID_SETTINGS = Object.freeze([
  'youtubeApplicationId',
  'movies67ApplicationId',
  'twitchApplicationId',
  'kickApplicationId',
]);

/** Packaged-provider keys retired as providers became Activities. */
export const RETIRED_PROVIDER_SETTINGS = Object.freeze([
  'sourceMovies67',
  'movies67ShowPaused',
  'movies67StatusDisplay',
  'movies67ShowArtwork',
  'movies67ShowTimestamps',
  'movies67ShowButtons',
  'sourceKick',
  'kickShowPaused',
  'kickStatusDisplay',
  'kickShowArtwork',
  'kickShowTimestamps',
  'kickShowButtons',
  'sourceTwitch',
  'twitchShowPaused',
  'twitchStatusDisplay',
  'twitchShowArtwork',
  'twitchShowTimestamps',
  'twitchShowButtons',
  'sourceYouTube',
  'youtubeShowPaused',
  'youtubeStatusDisplay',
  'youtubeShowArtwork',
  'youtubeShowTimestamps',
  'youtubeShowButtons',
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

  return normalized;
}

export function presenceDetailsForTrack(track, settings = DEFAULT_SETTINGS, activityPreferences = null) {
  if (activityPreferences) {
    const preferences = normalizeActivityPreferences(activityPreferences);
    return {
      statusDisplay: preferences.statusDisplay,
      showArtwork: preferences.showArtwork,
      showTimestamps: preferences.showTimestamps,
      showButtons: preferences.showButtons,
    };
  }
  const keys = track?.settingKeys;
  if (!keys) return {};
  const current = normalizeSettings(settings);
  return {
    ...(keys.statusDisplay ? { statusDisplay: current[keys.statusDisplay] } : {}),
    ...(keys.showArtwork ? { showArtwork: current[keys.showArtwork] } : {}),
    ...(keys.showTimestamps ? { showTimestamps: current[keys.showTimestamps] } : {}),
    ...(keys.showButtons ? { showButtons: current[keys.showButtons] } : {}),
  };
}

export function applicationIdForPresence() {
  return DISCORD_CLIENT_ID;
}

export function isTrackAllowed(track, settings = DEFAULT_SETTINGS, activityPreferences = null) {
  if (!track) return false;
  const current = normalizeSettings(settings);
  if (!current.enabled) return false;
  if (track.media && track.playback) {
    return track.playback.state === 'playing' || normalizeActivityPreferences(activityPreferences).showPaused;
  }
  if (track.activityId) {
    return track.playing || normalizeActivityPreferences(activityPreferences).showPaused;
  }
  const keys = track.settingKeys;
  if (!keys) return true;
  if (keys.enabled && !current[keys.enabled]) return false;
  return track.playing || !keys.showPaused || current[keys.showPaused];
}
