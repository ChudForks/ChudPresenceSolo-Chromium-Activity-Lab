import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings.js';

const form = document.getElementById('settings-form');
const status = document.getElementById('save-status');
let saveTimer = 0;
const clientIdInput = document.getElementById('discord-client-id');
const redirectInput = document.getElementById('discord-redirect');
const discordStatus = document.getElementById('discord-status');
const connectButton = document.getElementById('connect-discord');

function render(settings) {
  for (const [key, value] of Object.entries(normalizeSettings(settings))) {
    const input = form.elements.namedItem(key);
    if (input) input.checked = value;
  }
}

function readForm() {
  const settings = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    settings[key] = Boolean(form.elements.namedItem(key)?.checked);
  }
  return settings;
}

async function load() {
  render(await chrome.storage.local.get(DEFAULT_SETTINGS));
  await loadDiscordSetup();
}

function renderDiscord(result) {
  if (!result?.ok) throw new Error(result?.error || 'Could not load Discord setup.');
  const setup = result.setup || {};
  clientIdInput.value = setup.clientId || '';
  redirectInput.value = setup.redirectUrl || '';
  connectButton.textContent = setup.authenticated ? 'Disconnect Discord' : 'Connect Discord';
  connectButton.dataset.action = setup.authenticated ? 'disconnect' : 'connect';
  discordStatus.textContent = result.delivery?.message || '';
}

async function loadDiscordSetup() {
  renderDiscord(await chrome.runtime.sendMessage({ type: 'GET_DISCORD_SETUP' }));
}

async function save() {
  clearTimeout(saveTimer);
  await chrome.storage.local.set(readForm());
  status.textContent = 'Saved.';
  saveTimer = setTimeout(() => {
    status.textContent = 'Changes save automatically.';
  }, 1800);
}

form.addEventListener('change', () => {
  save().catch(() => {
    status.textContent = 'Could not save settings. Try again.';
  });
});

document.getElementById('reset').addEventListener('click', () => {
  render(DEFAULT_SETTINGS);
  save().catch(() => {
    status.textContent = 'Could not restore defaults. Try again.';
  });
});

document.getElementById('save-discord').addEventListener('click', async () => {
  discordStatus.textContent = 'Saving…';
  try {
    renderDiscord(await chrome.runtime.sendMessage({
      type: 'CONFIGURE_DISCORD',
      clientId: clientIdInput.value,
    }));
  } catch (error) {
    discordStatus.textContent = error.message || 'Could not save Discord setup.';
  }
});

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  discordStatus.textContent = connectButton.dataset.action === 'disconnect'
    ? 'Disconnecting…'
    : 'Waiting for Discord…';
  try {
    if (connectButton.dataset.action === 'connect' && clientIdInput.value.trim()) {
      const configured = await chrome.runtime.sendMessage({
        type: 'CONFIGURE_DISCORD',
        clientId: clientIdInput.value,
      });
      if (!configured?.ok) throw new Error(configured?.error);
    }
    const type = connectButton.dataset.action === 'disconnect' ? 'DISCONNECT_DISCORD' : 'CONNECT_DISCORD';
    renderDiscord(await chrome.runtime.sendMessage({ type }));
  } catch (error) {
    discordStatus.textContent = error.message || 'Could not update the Discord connection.';
  } finally {
    connectButton.disabled = false;
  }
});

document.getElementById('copy-redirect').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(redirectInput.value);
    discordStatus.textContent = 'Redirect URL copied.';
  } catch {
    redirectInput.select();
    discordStatus.textContent = 'Press Ctrl+C to copy the selected redirect URL.';
  }
});

load().catch(() => {
  status.textContent = 'Could not load settings. Reload this page.';
});
