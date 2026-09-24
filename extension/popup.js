import { DEFAULT_SETTINGS, normalizeSettings, SERVICE_SETTINGS } from './core/settings.js';
import { DEFAULT_ACTIVITY_PREFERENCES } from './core/activity-settings.js';

const serviceUi = Object.freeze({
  youtube: {
    icon: 'assets/services/youtube.svg',
    description: 'Videos, Shorts, and live streams',
    statuses: [['app', 'YouTube'], ['creator', 'Creator / channel'], ['video', 'Video title']],
  },
  youtubeMusic: {
    icon: 'assets/services/youtube-music.svg',
    description: 'Songs, artists, and albums',
    statuses: [['app', 'YouTube Music'], ['artist', 'Artist'], ['track', 'Track title']],
  },
  crunchyroll: {
    icon: 'assets/services/crunchyroll.svg',
    description: 'Anime, series, and movies',
    statuses: [['app', 'Crunchyroll'], ['series', 'Series'], ['episode', 'Episode']],
  },
  movies67: {
    icon: 'assets/services/movies67.svg',
    description: 'Movies and television',
    statuses: [['app', '67Movies'], ['series', 'Series'], ['episode', 'Episode']],
  },
  twitch: {
    icon: 'assets/services/twitch.svg',
    description: 'Live streams and videos on demand',
    statuses: [['app', 'Twitch'], ['streamer', 'Streamer'], ['stream', 'Stream title']],
  },
  kick: {
    icon: 'assets/services/kick.svg',
    description: 'Live streams and videos on demand',
    statuses: [['app', 'Kick'], ['streamer', 'Streamer'], ['stream', 'Stream title']],
  },
});

const activityView = document.getElementById('activity-view');
const settingsView = document.getElementById('settings-view');
const activityTab = document.getElementById('activity-tab');
const settingsTab = document.getElementById('settings-tab');
const form = document.getElementById('settings-form');
const saveStatus = document.getElementById('save-status');
const artEl = document.getElementById('art');
const artFallback = document.getElementById('art-fallback');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const kickerEl = document.getElementById('kicker');
const hintEl = document.getElementById('hint');
const presenceState = document.getElementById('presence-state');
const discordAction = document.getElementById('discord-action');
const settingsDiscordAction = document.getElementById('settings-discord-action');
const discordStatus = document.getElementById('discord-status');
const activeServiceIcon = document.getElementById('active-service-icon');
let lastState = null;
let installedActivities = [];
let formHasLoaded = false;
let saveTimer = 0;

const activityStatusOptions = Object.freeze([
  ['app', 'Activity name'],
  ['artist', 'Artist / creator'],
  ['track', 'Media title'],
]);

function setSafeIcon(image, icon) {
  image.onerror = () => {
    image.onerror = null;
    if (image.getAttribute('src') !== 'icons/icon32.png') image.src = 'icons/icon32.png';
  };
  image.src = icon || 'icons/icon32.png';
}

function installedActivity(id) {
  return installedActivities.find((activity) => activity.id === id);
}

function sourceIcon(track) {
  const activity = installedActivity(track?.activityId);
  if (activity || track?.activityName) return activity?.icon || 'icons/icon32.png';
  const source = track?.activityId === 'youtube-music' ? 'youtubeMusic' : track?.activityId || track?.source;
  return serviceUi[source]?.icon || 'icons/icon32.png';
}

function sourceName(track) {
  if (track?.activityName) return track.activityName;
  if (track?.source === 'movies67') return '67Movies';
  if (track?.source === 'crunchyroll') return 'Crunchyroll';
  if (track?.source === 'youtube') {
    if (track.kind === 'short') return 'YouTube Shorts';
    if (track.live || track.kind === 'live') return 'YouTube Live';
    return 'YouTube';
  }
  if (track?.source === 'youtubeMusic') return 'YouTube Music';
  if (track?.source === 'twitch') return track.live || track.kind === 'live' ? 'Twitch Live' : 'Twitch';
  if (track?.source === 'kick') return track.live || track.kind === 'live' ? 'Kick Live' : 'Kick';
  return 'Playback';
}

function buildServiceSettings() {
  const container = document.getElementById('service-settings');
  const template = document.getElementById('service-settings-template');

  for (const [source, service] of Object.entries(SERVICE_SETTINGS)) {
    const ui = serviceUi[source];
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.service = source;
    card.querySelector('.service-summary-icon img').src = ui.icon;
    card.querySelector('.setting-copy strong').textContent = service.label;
    card.querySelector('.setting-copy small').textContent = ui.description;

    const master = card.querySelector('.service-master input');
    master.name = service.enabled;
    master.setAttribute('aria-label', `Share ${service.label} activity`);
    master.addEventListener('click', (event) => event.stopPropagation());

    for (const [settingType, settingName] of Object.entries({
      paused: service.paused,
      status: service.status,
      artwork: service.artwork,
      timestamps: service.timestamps,
      buttons: service.buttons,
    })) {
      const input = card.querySelector(`[data-setting="${settingType}"]`);
      input.name = settingName;
      if (input.tagName === 'SELECT') {
        for (const [value, label] of ui.statuses) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          input.append(option);
        }
      }
    }
    container.append(card);
  }
}

function renderInstalledActivityTiles() {
  const serviceGrid = document.querySelector('.service-grid');
  serviceGrid.querySelectorAll('[data-activity-id]').forEach((tile) => tile.remove());
  for (const activity of installedActivities) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `service-tile activity-service-tile ${activity.enabled ? 'enabled' : 'disabled'}`;
    tile.dataset.activityId = activity.id;
    tile.setAttribute('aria-label', `${activity.name}, ${activity.enabled ? 'enabled' : 'disabled'}. Open settings.`);
    const icon = document.createElement('img');
    icon.alt = '';
    setSafeIcon(icon, activity.icon);
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = activity.name;
    const status = document.createElement('small');
    status.textContent = activity.enabled ? 'Installed Activity · Enabled' : 'Installed Activity · Disabled';
    copy.append(name, status);
    const stateMark = document.createElement('i');
    stateMark.setAttribute('aria-hidden', 'true');
    tile.append(icon, copy, stateMark);
    tile.addEventListener('click', () => showActivitySettings(activity.id));
    serviceGrid.append(tile);
  }
}

function renderInstalledActivitySettings(openActivityId = '') {
  const container = document.getElementById('activity-settings');
  const section = document.getElementById('activity-settings-section');
  const openIds = new Set([...container.querySelectorAll('.service-settings-card[open]')]
    .map((card) => card.dataset.activityId));
  if (openActivityId) openIds.add(openActivityId);
  container.replaceChildren();
  section.hidden = installedActivities.length === 0;

  const template = document.getElementById('service-settings-template');
  for (const activity of installedActivities) {
    const preferences = { ...DEFAULT_ACTIVITY_PREFERENCES, ...activity.preferences };
    const card = template.content.firstElementChild.cloneNode(true);
    card.classList.add('activity-settings-card');
    card.dataset.activityId = activity.id;
    card.open = openIds.has(activity.id);
    setSafeIcon(card.querySelector('.service-summary-icon img'), activity.icon);
    card.querySelector('.setting-copy strong').textContent = activity.name;
    card.querySelector('.setting-copy small').textContent = activity.description ||
      (activity.matches?.length ? activity.matches.join(', ') : 'Installed Activity');
    card.classList.toggle('is-disabled', !activity.enabled);

    const master = card.querySelector('.service-master input');
    master.checked = activity.enabled === true;
    master.dataset.activityId = activity.id;
    master.dataset.activityEnabled = activity.id;
    master.setAttribute('aria-label', `Enable ${activity.name}`);
    master.addEventListener('click', (event) => event.stopPropagation());

    for (const [settingType, preferenceName] of Object.entries({
      paused: 'showPaused',
      artwork: 'showArtwork',
      timestamps: 'showTimestamps',
      buttons: 'showButtons',
    })) {
      const input = card.querySelector(`[data-setting="${settingType}"]`);
      input.checked = typeof preferences[preferenceName] === 'boolean'
        ? preferences[preferenceName]
        : DEFAULT_ACTIVITY_PREFERENCES[preferenceName];
      input.dataset.activityPreference = preferenceName;
      input.dataset.activityId = activity.id;
      input.disabled = activity.enabled !== true;
      const accessibleLabel = preferenceName === 'showArtwork' ? 'Show artwork' :
        preferenceName === 'showTimestamps' ? 'Show playback progress' :
          preferenceName === 'showButtons' ? 'Show action buttons' : 'Show while paused';
      input.setAttribute('aria-label', `${accessibleLabel} for ${activity.name}`);
    }

    const statusSelect = card.querySelector('[data-setting="status"]');
    statusSelect.closest('.compact-row')?.querySelector('strong')?.replaceChildren('Status display');
    statusSelect.replaceChildren();
    for (const [value, label] of activityStatusOptions) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      statusSelect.append(option);
    }
    statusSelect.value = activityStatusOptions.some(([value]) => value === preferences.statusDisplay)
      ? preferences.statusDisplay
      : DEFAULT_ACTIVITY_PREFERENCES.statusDisplay;
    statusSelect.dataset.activityPreference = 'statusDisplay';
    statusSelect.dataset.activityId = activity.id;
    statusSelect.disabled = activity.enabled !== true;
    statusSelect.setAttribute('aria-label', `Status display for ${activity.name}`);
    container.append(card);
  }
}

async function activityMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Could not update the Activity.');
  return response.result;
}

async function refreshInstalledActivities(openActivityId = '') {
  const state = await activityMessage({ type: 'ACTIVITY_LIBRARY_STATE' });
  installedActivities = Array.isArray(state?.installed) ? state.installed : [];
  renderInstalledActivityTiles();
  renderInstalledActivitySettings(openActivityId);
  if (lastState) renderDashboard(lastState);
  return installedActivities;
}

async function showActivitySettings(id) {
  showView('settings');
  try {
    await refreshInstalledActivities(id);
  } catch (error) {
    setSaveFeedback('error', error.message || 'Could not refresh installed Activities.');
  }
  const card = [...document.querySelectorAll('#activity-settings .service-settings-card')]
    .find((item) => item.dataset.activityId === id);
  if (card) {
    card.open = true;
    card.querySelector('summary')?.focus();
    card.scrollIntoView?.({ block: 'nearest' });
  }
}

function showView(view) {
  const showSettings = view === 'settings';
  activityView.hidden = showSettings;
  settingsView.hidden = !showSettings;
  activityTab.classList.toggle('is-active', !showSettings);
  settingsTab.classList.toggle('is-active', showSettings);
  activityTab.setAttribute('aria-pressed', String(!showSettings));
  settingsTab.setAttribute('aria-pressed', String(showSettings));
  document.body.dataset.view = view;
  (showSettings ? settingsView : activityView).scrollTop = 0;
}

function updateServiceStates(settings) {
  for (const [source, service] of Object.entries(SERVICE_SETTINGS)) {
    const enabled = settings[service.enabled] !== false;
    document.querySelector(`.service-tile[data-service="${source}"]`)?.classList.toggle('enabled', enabled);
    document.querySelector(`.service-tile[data-service="${source}"]`)?.classList.toggle('disabled', !enabled);
    document.querySelector(`.service-settings-card[data-service="${source}"]`)?.classList.toggle('is-disabled', !enabled);
  }
}

function renderForm(settings) {
  const normalized = normalizeSettings(settings);
  for (const [key, value] of Object.entries(normalized)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  updateServiceStates(normalized);
  formHasLoaded = true;
}

function readForm() {
  const settings = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const input = form.elements.namedItem(key);
    settings[key] = typeof fallback === 'boolean' ? Boolean(input?.checked) : String(input?.value || '').trim();
  }
  return settings;
}

function renderDiscord(delivery = {}) {
  const authenticated = delivery.authenticated === true;
  const buttonText = authenticated ? 'Disconnect' : 'Connect';
  for (const button of [discordAction, settingsDiscordAction]) {
    button.dataset.action = authenticated ? 'disconnect' : 'connect';
    const textNode = button.querySelector('span');
    if (textNode) textNode.textContent = buttonText;
    else button.textContent = buttonText;
  }
  document.getElementById('discord-title').textContent = authenticated ? 'Discord connected' : 'Connect Discord';
  discordStatus.textContent = authenticated ? 'Connected and ready to publish' : 'Not connected';
  document.getElementById('discord-dot').classList.toggle('on', delivery.available === true);
}

function renderDashboard(state) {
  lastState = state;
  const settings = normalizeSettings(state.settings);
  const track = state.track;
  const source = sourceName(track);
  const enabled = settings.enabled !== false;
  const title = track?.media?.title || track?.title || '';
  const playing = track?.playback ? track.playback.state === 'playing' : Boolean(track?.playing);
  const artist = track?.media?.artist || track?.media?.creator || track?.media?.series ||
    track?.artist || track?.album || '';
  const artwork = typeof track?.artwork === 'string' ? track.artwork : track?.artwork?.large || '';
  const active = enabled && Boolean(title);

  document.body.dataset.enabled = String(enabled);
  document.getElementById('brand-status').textContent = !enabled ? 'Activity paused' : active ? `${source} active` : 'Ready to share';
  document.getElementById('extension-dot').classList.toggle('on', enabled);
  setSafeIcon(activeServiceIcon, sourceIcon(track));
  presenceState.classList.toggle('active', active);
  presenceState.innerHTML = `<i></i>${active ? 'Active' : enabled ? 'Waiting' : 'Paused'}`;

  if (title) {
    kickerEl.textContent = playing ? `Now playing · ${source}` : `Paused · ${source}`;
    titleEl.textContent = title;
    artistEl.textContent = artist || source;
    if (artwork) {
      artEl.src = artwork;
      artEl.hidden = false;
      artFallback.hidden = true;
    } else {
      artEl.hidden = true;
      artFallback.hidden = false;
    }
  } else {
    kickerEl.textContent = enabled ? 'Nothing playing' : 'Activity sharing paused';
    titleEl.textContent = enabled ? 'Open a supported streaming site' : 'Activity Lab is turned off';
    artistEl.textContent = enabled ? 'Your activity preview will appear here.' : 'Enable it in Settings when you are ready.';
    artEl.removeAttribute('src');
    artEl.hidden = true;
    artFallback.hidden = false;
  }

  titleEl.title = titleEl.textContent;
  artistEl.title = artistEl.textContent;
  hintEl.textContent = state.delivery?.message || (state.delivery?.authenticated ? 'Ready to share activity.' : 'Share what you are watching or listening to.');
  renderDiscord(state.delivery);
  renderLocalDiagnostics(state);
  updateServiceStates(settings);
  if (!formHasLoaded) renderForm(settings);
}

function diagnosticSummary(value) {
  if (!value) return 'None';
  if (typeof value === 'string') return value;
  const time = value.timestamp ? new Date(value.timestamp).toLocaleTimeString() : '';
  const label = value.title || value.reason || value.state || value.source || value.kind || 'Recorded';
  return time ? `${label} · ${time}` : label;
}

function renderLocalDiagnostics(state) {
  const diagnostics = state.activityDiagnostics || {};
  const intent = state.finalPresenceIntent;
  document.getElementById('local-visibility').textContent = diagnostics.visibility || 'Unknown';
  document.getElementById('local-playback').textContent = diagnostics.playbackState ||
    state.track?.playback?.state || (state.track?.playing ? 'playing' : state.track?.title ? 'paused' : 'No report');
  document.getElementById('local-last-report').textContent = diagnosticSummary(diagnostics.lastReport);
  document.getElementById('local-last-clear').textContent = diagnosticSummary(diagnostics.lastClear);
  document.getElementById('local-presence-intent').textContent = intent
    ? `${intent.details || intent.name || 'Activity'}${intent.state ? ` · ${intent.state}` : ''}`
    : 'Nothing selected';
}

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (state?.ok === false) throw new Error(state.error || 'Could not load current presence state.');
    if (state) renderDashboard(state.result || state);
  } catch {
    hintEl.textContent = 'Reload the extension if this panel stays empty.';
  }
}

function setSaveFeedback(kind, message) {
  clearTimeout(saveTimer);
  saveStatus.textContent = message;
  saveStatus.classList.toggle('saved', kind === 'saved');
  saveStatus.classList.toggle('error', kind === 'error');
  if (kind === 'saved') {
    saveTimer = setTimeout(() => {
      saveStatus.textContent = 'Saved locally';
      saveStatus.classList.remove('saved');
    }, 1400);
  }
}

function restoreActivityControl(id, preferenceName, fallbackValue) {
  const input = [...document.querySelectorAll('#activity-settings input, #activity-settings select')]
    .find((control) => control.dataset.activityId === id &&
      (preferenceName === 'enabled'
        ? control.dataset.activityEnabled === id
        : control.dataset.activityPreference === preferenceName));
  if (!input) return;
  if (input.type === 'checkbox') input.checked = Boolean(fallbackValue);
  else input.value = String(fallbackValue);
  input.disabled = false;
}

async function updateActivityPreference(input) {
  const { activityId, activityPreference } = input.dataset;
  const value = input.type === 'checkbox' ? input.checked : input.value;
  const previous = installedActivity(activityId)?.preferences?.[activityPreference] ??
    DEFAULT_ACTIVITY_PREFERENCES[activityPreference];
  input.disabled = true;
  try {
    await activityMessage({
      type: 'ACTIVITY_SET_PREFERENCES',
      id: activityId,
      preferences: { [activityPreference]: value },
    });
  } catch (error) {
    const refreshed = await refreshInstalledActivities(activityId).then(() => true, () => false);
    const current = refreshed ? installedActivity(activityId) : null;
    const authoritative = current
      ? current.preferences?.[activityPreference] ?? DEFAULT_ACTIVITY_PREFERENCES[activityPreference]
      : previous;
    restoreActivityControl(activityId, activityPreference, authoritative);
    await refresh();
    setSaveFeedback('error', error.message || 'Could not save Activity preferences.');
    return;
  }

  let refreshError = null;
  try {
    await refreshInstalledActivities(activityId);
  } catch (error) {
    refreshError = error;
    restoreActivityControl(activityId, activityPreference, value);
  }
  await refresh();
  if (refreshError) setSaveFeedback('error', `Saved, but Activity state could not refresh: ${refreshError.message}`);
  else setSaveFeedback('saved', 'Saved');
}

async function updateActivityEnabled(input) {
  const id = input.dataset.activityEnabled;
  const enabled = input.checked;
  const previous = installedActivity(id)?.enabled === true;
  input.disabled = true;
  try {
    await activityMessage({ type: 'ACTIVITY_SET_ENABLED', id, enabled });
  } catch (error) {
    const refreshed = await refreshInstalledActivities(id).then(() => true, () => false);
    const current = refreshed ? installedActivity(id) : null;
    restoreActivityControl(id, 'enabled', current ? current.enabled === true : previous);
    await refresh();
    setSaveFeedback('error', error.message || 'Could not update Activity.');
    return;
  }

  let refreshError = null;
  try {
    await refreshInstalledActivities(id);
  } catch (error) {
    refreshError = error;
    restoreActivityControl(id, 'enabled', enabled);
  }
  await refresh();
  if (refreshError) setSaveFeedback('error', `Saved, but Activity state could not refresh: ${refreshError.message}`);
  else setSaveFeedback('saved', 'Saved');
}

async function saveSettings() {
  clearTimeout(saveTimer);
  const settings = readForm();
  await chrome.storage.local.set(settings);
  updateServiceStates(settings);
  document.body.dataset.enabled = String(settings.enabled);
  setSaveFeedback('saved', 'Saved');
}

async function updateDiscord(event) {
  const button = event.currentTarget;
  const otherButton = button === discordAction ? settingsDiscordAction : discordAction;
  button.disabled = true;
  otherButton.disabled = true;
  discordStatus.textContent = button.dataset.action === 'disconnect' ? 'Disconnecting…' : 'Waiting for Discord…';
  try {
    const type = button.dataset.action === 'disconnect' ? 'DISCONNECT_DISCORD' : 'CONNECT_DISCORD';
    const result = await chrome.runtime.sendMessage({ type });
    if (!result?.ok) throw new Error(result?.error || 'Could not update the Discord connection.');
    renderDiscord({ ...(result.delivery || {}), authenticated: result.setup?.authenticated });
    await refresh();
  } catch (error) {
    discordStatus.textContent = error.message || 'Could not update the Discord connection.';
    hintEl.textContent = discordStatus.textContent;
  } finally {
    button.disabled = false;
    otherButton.disabled = false;
  }
}

buildServiceSettings();

activityTab.addEventListener('click', () => showView('activity'));
document.getElementById('show-activity').addEventListener('click', () => showView('activity'));
settingsTab.addEventListener('click', () => {
  showView('settings');
  refreshInstalledActivities().catch((error) => {
    setSaveFeedback('error', error.message || 'Could not refresh installed Activities.');
  });
});
document.getElementById('open-settings').addEventListener('click', () => {
  showView('settings');
  refreshInstalledActivities().catch((error) => {
    setSaveFeedback('error', error.message || 'Could not refresh installed Activities.');
  });
});
document.getElementById('manage-services').addEventListener('click', () => {
  showView('settings');
  const firstService = document.querySelector('.service-settings-card');
  if (firstService) firstService.open = true;
  refreshInstalledActivities().catch((error) => {
    setSaveFeedback('error', error.message || 'Could not refresh installed Activities.');
  });
});

form.addEventListener('change', (event) => {
  if (event.target.dataset.activityEnabled) {
    return updateActivityEnabled(event.target);
  }
  if (event.target.dataset.activityPreference) {
    return updateActivityPreference(event.target);
  }
  if (!event.target.name) return;
  return saveSettings().catch(() => {
    saveStatus.classList.remove('saved');
    saveStatus.textContent = 'Could not save';
  });
});

document.getElementById('reset').addEventListener('click', () => {
  renderForm(DEFAULT_SETTINGS);
  saveSettings().catch(() => { saveStatus.textContent = 'Could not restore defaults'; });
});

discordAction.addEventListener('click', updateDiscord);
settingsDiscordAction.addEventListener('click', updateDiscord);
artEl.addEventListener('error', () => {
  artEl.hidden = true;
  artFallback.hidden = false;
});
activeServiceIcon.addEventListener('error', () => {
  if (activeServiceIcon.getAttribute('src') !== 'icons/icon32.png') activeServiceIcon.src = 'icons/icon32.png';
});

if (location.hash === '#settings') showView('settings');
refresh();
refreshInstalledActivities().catch(() => {});
setInterval(() => {
  if (document.body.dataset.view === 'activity') refresh();
}, 1000);
