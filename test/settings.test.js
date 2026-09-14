import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applicationIdForSource,
  DEFAULT_SETTINGS,
  isTrackAllowed,
  normalizeSettings,
  presenceDetailsForSource,
} from '../extension/core/settings.js';

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

test('migrates legacy global presence details to every service', () => {
  const normalized = normalizeSettings({
    showArtwork: false,
    showTimestamps: true,
    showButtons: false,
  });

  for (const prefix of ['youtube', 'youtubeMusic', 'crunchyroll', 'movies67']) {
    assert.equal(normalized[`${prefix}ShowArtwork`], false);
    assert.equal(normalized[`${prefix}ShowTimestamps`], true);
    assert.equal(normalized[`${prefix}ShowButtons`], false);
  }
});

test('uses presence details and application IDs from the active service only', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    youtubeApplicationId: '111111111111111111',
    youtubeShowArtwork: false,
    crunchyrollApplicationId: '222222222222222222',
    crunchyrollShowButtons: false,
  };

  assert.equal(applicationIdForSource('youtube', settings), '111111111111111111');
  assert.equal(applicationIdForSource('crunchyroll', settings), '222222222222222222');
  assert.deepEqual(presenceDetailsForSource('youtube', settings), {
    showArtwork: false,
    showTimestamps: true,
    showButtons: true,
  });
  assert.deepEqual(presenceDetailsForSource('crunchyroll', settings), {
    showArtwork: true,
    showTimestamps: true,
    showButtons: false,
  });
});
