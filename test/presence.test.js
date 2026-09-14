import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceIntent } from '../extension/core/presence.js';

test('maps a playing track to a Discord-ready presence intent', () => {
  const intent = createPresenceIntent({
    source: 'youtubeMusic',
    kind: 'song',
    title: 'A Song',
    artist: 'An Artist',
    album: 'An Album',
    artwork: 'https://example.com/art.jpg',
    url: 'https://music.youtube.com/watch?v=abcdefghijk',
    playing: true,
    position: 30,
    duration: 210,
  }, 1_000_000);

  assert.deepEqual(intent, {
    name: 'YouTube Music',
    type: 'listening',
    details: 'A Song',
    state: 'An Artist • An Album',
    timestamps: { start: 970, end: 1180 },
    assets: { largeImage: 'https://example.com/art.jpg', largeText: 'YouTube Music' },
    buttons: [{ label: 'Listen', url: 'https://music.youtube.com/watch?v=abcdefghijk' }],
    source: 'youtubeMusic',
  });
});

test('omits timers while paused and rejects unsafe URLs', () => {
  const intent = createPresenceIntent({
    source: 'crunchyroll',
    kind: 'episode',
    title: 'Episode title',
    artist: 'Series title',
    artwork: 'http://insecure.example/art.jpg',
    url: 'javascript:alert(1)',
    playing: false,
  });

  assert.equal(intent.timestamps, null);
  assert.equal(intent.assets, null);
  assert.deepEqual(intent.buttons, []);
});

test('does not create presence for idle, ad, or untitled tracks', () => {
  assert.equal(createPresenceIntent(null), null);
  assert.equal(createPresenceIntent({ idle: true, title: 'Idle' }), null);
  assert.equal(createPresenceIntent({ ad: true, title: 'Ad' }), null);
  assert.equal(createPresenceIntent({ playing: true }), null);
});

test('honors presence detail preferences', () => {
  const intent = createPresenceIntent({
    source: 'youtube',
    title: 'Video',
    artwork: 'https://example.com/art.jpg',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    playing: true,
    position: 5,
    duration: 60,
  }, 1_000_000, {
    showArtwork: false,
    showTimestamps: false,
    showButtons: false,
  });

  assert.equal(intent.assets, null);
  assert.equal(intent.timestamps, null);
  assert.deepEqual(intent.buttons, []);
});
