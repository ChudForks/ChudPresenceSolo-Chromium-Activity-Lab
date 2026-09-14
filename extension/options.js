import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings.js';

const form = document.getElementById('settings-form');
const status = document.getElementById('save-status');
let saveTimer = 0;
const discordStatus = document.getElementById('discord-status');
const connectButton = document.getElementById('connect-discord');
const discordState = document.getElementById('discord-state');
const activeServices = document.getElementById('active-services');

function render(settings) {
  for (const [key, value] of Object.entries(normalizeSettings(settings))) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  updateServiceCards();
}

function updateServiceCards() {
  let enabledCount = 0;
  for (const card of document.querySelectorAll('.service-card')) {
    const sourceToggle = card.querySelector('.section-heading .switch input');
    card.classList.toggle('is-disabled', sourceToggle?.checked === false);
    if (sourceToggle?.checked) enabledCount += 1;
  }
  activeServices.textContent = `${enabledCount} service${enabledCount === 1 ? '' : 's'} active`;
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

function renderDiscord(result) {
  if (!result?.ok) throw new Error(result?.error || 'Could not load Discord setup.');
  const setup = result.setup || {};
  connectButton.textContent = setup.authenticated ? 'Disconnect Discord' : 'Connect Discord';
  connectButton.dataset.action = setup.authenticated ? 'disconnect' : 'connect';
  discordStatus.textContent = result.delivery?.message || '';
  discordState.classList.toggle('connected', setup.authenticated === true);
  discordState.querySelector('span').textContent = setup.authenticated ? 'Connected' : 'Not connected';
}

async function loadDiscordSetup() {
  renderDiscord(await chrome.runtime.sendMessage({ type: 'GET_DISCORD_SETUP' }));
}

async function save() {
  clearTimeout(saveTimer);
  await chrome.storage.local.set(readForm());
  status.textContent = 'Saved.';
  status.classList.add('saved');
  saveTimer = setTimeout(() => {
    status.textContent = 'Changes save automatically.';
    status.classList.remove('saved');
  }, 1800);
}

form.addEventListener('change', (event) => {
  if (!event.target.name) return;
  updateServiceCards();
  save().catch(() => {
    status.classList.remove('saved');
    status.textContent = 'Could not save settings. Try again.';
  });
});

document.getElementById('reset').addEventListener('click', () => {
  render(DEFAULT_SETTINGS);
  save().catch(() => {
    status.textContent = 'Could not restore defaults. Try again.';
  });
});

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  discordStatus.textContent = connectButton.dataset.action === 'disconnect'
    ? 'Disconnecting…'
    : 'Waiting for Discord…';
  try {
    const type = connectButton.dataset.action === 'disconnect' ? 'DISCONNECT_DISCORD' : 'CONNECT_DISCORD';
    renderDiscord(await chrome.runtime.sendMessage({ type }));
  } catch (error) {
    discordStatus.textContent = error.message || 'Could not update the Discord connection.';
  } finally {
    connectButton.disabled = false;
  }
});

load().catch(() => {
  status.textContent = 'Could not load settings. Reload this page.';
});

const navLinks = [...document.querySelectorAll('.settings-nav a')];
const sections = navLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);

if ('IntersectionObserver' in window) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    for (const link of navLinks) {
      link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`);
    }
  }, { rootMargin: '-18% 0px -62% 0px', threshold: [0, .2, .5] });
  sections.forEach((section) => sectionObserver.observe(section));
}
