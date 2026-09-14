const enabledEl = document.getElementById('enabled');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const kickerEl = document.getElementById('kicker');
const artEl = document.getElementById('art');
const artFallback = document.getElementById('art-fallback');
const hintEl = document.getElementById('hint');
const modeEl = document.getElementById('mode');
const discordActionEl = document.getElementById('discord-action');
const sourceStatusIconEl = document.getElementById('source-status-icon');
const activeServiceIconEl = document.getElementById('active-service-icon');
const brandStatusEl = document.getElementById('brand-status');
let lastState = null;

function sourceIcon(track) {
  if (track?.source === 'youtubeMusic') return 'assets/services/youtube-music.svg';
  if (track?.source === 'youtube') return 'assets/services/youtube.svg';
  if (track?.source === 'crunchyroll') return 'assets/services/crunchyroll.svg';
  if (track?.source === 'movies67') return 'assets/services/movies67.svg';
  return 'icons/icon32.png';
}

function sourceName(track) {
  if (track?.source === 'movies67') return '67Movies';
  if (track?.source === 'crunchyroll') return 'Crunchyroll';
  if (track?.source === 'youtube') {
    if (track.kind === 'short') return 'YouTube Shorts';
    if (track.live || track.kind === 'live') return 'YouTube Live';
    return 'YouTube';
  }
  if (track?.source === 'youtubeMusic' || track?.title) return 'YouTube Music';
  return 'Playback';
}

function setPill(id, state) {
  const el = document.getElementById(id);
  el.classList.remove('on', 'off', 'warn');
  el.classList.add(state);
  const label = el.querySelector('.pill-name')?.textContent.trim() || el.textContent.trim();
  const status = state === 'on' ? 'Active' : state === 'warn' ? 'Waiting' : 'Inactive';
  el.setAttribute('aria-label', `${label}: ${status}`);
  el.title = `${label}: ${status}`;
  el.dataset.status = status;
}

function render(state) {
  lastState = state;
  const settings = state.settings || { enabled: true };
  const track = state.track;
  const source = sourceName(track);
  const icon = sourceIcon(track);

  enabledEl.checked = settings.enabled !== false;
  document.body.dataset.enabled = settings.enabled !== false ? 'true' : 'false';
  sourceStatusIconEl.src = icon;
  activeServiceIconEl.src = icon;
  brandStatusEl.textContent = settings.enabled === false
    ? 'Activity sharing paused'
    : track?.title ? `${source} is active` : 'Ready to share activity';
  document.getElementById('pill-source-label').textContent = source;
  setPill('pill-source', track?.title ? 'on' : 'warn');
  setPill('pill-extension', settings.enabled !== false ? 'on' : 'off');
  setPill('pill-discord', state.delivery?.available ? 'on' : 'off');

  if (track?.title) {
    kickerEl.textContent = track.playing ? 'Now playing' : 'Paused';
    titleEl.textContent = track.title;
    artistEl.textContent = [track.artist, track.album].filter(Boolean).join(' • ') || source;
    if (track.artwork) {
      artEl.src = track.artwork;
      artEl.hidden = false;
      artFallback.style.display = 'none';
    } else {
      artEl.hidden = true;
      artFallback.style.display = 'grid';
    }
  } else {
    kickerEl.textContent = 'Nothing playing';
    titleEl.textContent = 'Open a supported streaming site';
    artistEl.textContent = 'Play something on YouTube, YouTube Music, Crunchyroll, or 67Movies.';
    artEl.removeAttribute('src');
    artEl.hidden = true;
    artFallback.style.display = 'grid';
  }

  titleEl.title = titleEl.textContent;
  artistEl.title = artistEl.textContent;
  hintEl.textContent = settings.enabled === false
    ? 'Activity sharing is paused. Turn it on to resume.'
    : state.delivery?.message || 'Ready to detect activity from a supported site.';
  const authenticated = state.delivery?.authenticated === true;
  discordActionEl.textContent = authenticated ? 'Disconnect Discord' : 'Connect Discord';
  discordActionEl.dataset.action = authenticated ? 'disconnect' : 'connect';
  modeEl.textContent = '4 services • Local first';
}

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (state) render(state);
  } catch {
    hintEl.textContent = 'Reload the extension if this popup stays empty.';
  }
}

artEl.addEventListener('error', () => {
  artEl.hidden = true;
  artFallback.style.display = 'grid';
});

enabledEl.addEventListener('change', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'SET_ENABLED', enabled: enabledEl.checked });
    await refresh();
  } catch {
    enabledEl.checked = lastState?.settings?.enabled !== false;
    hintEl.textContent = 'Could not update activity detection. Please try again.';
  }
});

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

discordActionEl.addEventListener('click', async () => {
  discordActionEl.disabled = true;
  try {
    if (discordActionEl.dataset.action === 'disconnect') {
      await chrome.runtime.sendMessage({ type: 'DISCONNECT_DISCORD' });
    } else if (lastState?.delivery?.configured) {
      const result = await chrome.runtime.sendMessage({ type: 'CONNECT_DISCORD' });
      if (!result?.ok) throw new Error(result?.error || 'Discord connection failed.');
    } else {
      chrome.runtime.openOptionsPage();
    }
    await refresh();
  } catch (error) {
    hintEl.textContent = error.message || 'Could not update the Discord connection.';
  } finally {
    discordActionEl.disabled = false;
  }
});

refresh();
setInterval(refresh, 1000);
