import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, isTrackAllowed, normalizeSettings } from '../extension/core/settings.js';

test('normalizes missing and invalid settings to defaults', () => {
  assert.deepEqual(normalizeSettings({ enabled: false, showArtwork: 'no' }), {
    ...DEFAULT_SETTINGS,
    enabled: false,
  });
});

test('filters disabled sources', () => {
  assert.equal(isTrackAllowed({ source: 'youtube', playing: true }, {
    ...DEFAULT_SETTINGS,
    sourceYouTube: false,
  }), false);
  assert.equal(isTrackAllowed({ source: 'crunchyroll', playing: true }, DEFAULT_SETTINGS), true);
});

test('filters paused tracks only when configured', () => {
  const paused = { source: 'youtubeMusic', playing: false };
  assert.equal(isTrackAllowed(paused, DEFAULT_SETTINGS), true);
  assert.equal(isTrackAllowed(paused, { ...DEFAULT_SETTINGS, showPaused: false }), false);
});
