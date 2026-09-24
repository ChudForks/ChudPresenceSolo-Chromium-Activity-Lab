import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationIdForPresence,
  DEFAULT_SETTINGS,
  isTrackAllowed,
  normalizeSettings,
  presenceDetailsForTrack,
} from '../extension/core/settings.js';
import { DISCORD_CLIENT_ID } from '../extension/config.js';

test('normalizes missing and invalid settings to defaults', () => {
  assert.deepEqual(normalizeSettings({ enabled: false, showArtwork: 'no' }), {
    ...DEFAULT_SETTINGS,
    enabled: false,
  });
});

test('global sharing switch controls installed Activities', () => {
  assert.equal(isTrackAllowed({ activityId: 'youtube', playback: { state: 'playing' }, media: { title: 'Video' } }, {
    enabled: false,
  }), false);
  assert.equal(isTrackAllowed({ source: 'crunchyroll', activityId: 'crunchyroll', playing: true }, DEFAULT_SETTINGS), true);
});

test('filters paused tracks only when configured', () => {
  const paused = { source: 'crunchyroll', activityId: 'crunchyroll', playing: false };
  assert.equal(isTrackAllowed(paused, DEFAULT_SETTINGS, { showPaused: true }), true);
  assert.equal(isTrackAllowed(paused, DEFAULT_SETTINGS, { showPaused: false }), false);
});

test('YouTube, Kick, and Twitch use installed Activity preferences instead of packaged settings', () => {
  for (const id of ['youtube', 'kick', 'twitch']) {
    const sourceKey = `source${id[0].toUpperCase()}${id.slice(1)}`;
    assert.equal(Object.hasOwn(normalizeSettings({ [sourceKey]: false }), sourceKey), false);
    const track = { activityId: id, source: 'activity', playing: false };
    assert.equal(isTrackAllowed(track, DEFAULT_SETTINGS, { showPaused: false }), false);
    assert.equal(isTrackAllowed(track, DEFAULT_SETTINGS, { showPaused: true }), true);
  }
});

test('ignores retired provider settings', () => {
  const normalized = normalizeSettings({
    showPaused: false,
    sourceYouTube: false,
    youtubeStatusDisplay: 'video',
  });
  assert.deepEqual(normalized, DEFAULT_SETTINGS);
});

test('uses one fixed Discord application identity', () => {
  assert.equal(applicationIdForPresence(), DISCORD_CLIENT_ID);
});

test('applies installed Activity preferences to paused filtering and presence details', () => {
  const track = { activityId: 'sample-activity', source: 'sample-activity', playing: false };
  assert.equal(isTrackAllowed(track, DEFAULT_SETTINGS, { showPaused: false }), false);
  assert.equal(isTrackAllowed(track, DEFAULT_SETTINGS, { showPaused: true }), true);
  assert.deepEqual(presenceDetailsForTrack(track, DEFAULT_SETTINGS, {
    statusDisplay: 'track',
    showArtwork: false,
    showTimestamps: false,
    showButtons: false,
  }), {
    statusDisplay: 'track',
    showArtwork: false,
    showTimestamps: false,
    showButtons: false,
  });
});
