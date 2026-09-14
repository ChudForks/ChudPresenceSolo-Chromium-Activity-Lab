const ACTIVITY_TYPES = Object.freeze({ playing: 0, listening: 2, watching: 3 });

function milliseconds(seconds) {
  return Math.round(Number(seconds) * 1000);
}

export function buildHeadlessActivity(intent, applicationId) {
  if (!intent?.details || !/^\d{17,20}$/.test(String(applicationId || ''))) return null;

  const buttons = (intent.buttons || []).slice(0, 2);
  const activity = {
    application_id: String(applicationId),
    platform: 'desktop',
    supported_platforms: ['desktop'],
    name: intent.name || 'ChudPresence',
    type: ACTIVITY_TYPES[intent.type] ?? ACTIVITY_TYPES.playing,
    details: intent.details,
    state: intent.state || intent.name || 'ChudPresence',
  };

  if (intent.timestamps?.start || intent.timestamps?.end) {
    activity.timestamps = {};
    if (intent.timestamps.start) activity.timestamps.start = milliseconds(intent.timestamps.start);
    if (intent.timestamps.end) activity.timestamps.end = milliseconds(intent.timestamps.end);
  }

  if (intent.assets?.largeImage) {
    activity.assets = {
      large_image: intent.assets.largeImage,
      large_text: intent.assets.largeText || intent.name || 'ChudPresence',
    };
  }

  if (buttons.length) {
    activity.buttons = buttons.map((button) => ({ label: button.label, url: button.url }));
    activity.metadata = { button_urls: buttons.map((button) => button.url) };
  }

  return activity;
}
