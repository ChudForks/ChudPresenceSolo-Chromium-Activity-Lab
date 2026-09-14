import { DEFAULT_SETTINGS, normalizeSettings, SERVICE_SETTINGS } from './core/settings.js';

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
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
}

function readForm() {
  const settings = {};
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const input = form.elements.namedItem(key);
    settings[key] = typeof fallback === 'boolean' ? Boolean(input?.checked) : String(input?.value || '').trim();
  }
  return settings;
}

async function load() {
  render(await chrome.storage.local.get(null));
  await loadDiscordSetup();
}

function invalidServiceApplicationId() {
  for (const service of Object.values(SERVICE_SETTINGS)) {
    const input = form.elements.namedItem(service.applicationId);
    const value = input.value.trim();
    const invalid = Boolean(value) && !/^\d{17,20}$/.test(value);
    input.setAttribute('aria-invalid', String(invalid));
    if (invalid) return { input, label: service.label };
  }
  return null;
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
  const invalid = invalidServiceApplicationId();
  if (invalid) {
    status.textContent = `${invalid.label} needs a valid 17–20 digit Discord application ID.`;
    return;
  }
  await chrome.storage.local.set(readForm());
  status.textContent = 'Saved.';
  saveTimer = setTimeout(() => {
    status.textContent = 'Changes save automatically.';
  }, 1800);
}

form.addEventListener('change', (event) => {
  if (!event.target.name) return;
  save().catch(() => {
    status.textContent = 'Could not save settings. Try again.';
  });
});

for (const input of document.querySelectorAll('.service-application-id')) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 20);
    input.setAttribute('aria-invalid', 'false');
  });
}

clientIdInput.addEventListener('input', () => {
  clientIdInput.value = clientIdInput.value.replace(/\D/g, '').slice(0, 20);
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
