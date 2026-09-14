// Transport boundary for a supported Discord connector. This build deliberately
// reports the missing transport instead of treating OAuth as presence delivery:
// Discord OAuth has no REST endpoint that sets a user's Rich Presence, and the
// Social SDK cannot run in a Chromium extension.
const PREVIEW_STATUS = Object.freeze({
  id: 'preview',
  available: false,
  state: 'transport-unavailable',
  message: 'Activity is ready, but Discord has no supported extension-only Rich Presence transport.',
});

export const presencePublisher = Object.freeze({
  status() {
    return PREVIEW_STATUS;
  },

  async publish(intent) {
    // Keep the contract exercised even in preview mode so a future connector can
    // replace only this module. `intent` is null when presence should be cleared.
    void intent;
    return PREVIEW_STATUS;
  },
});
