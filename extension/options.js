import { DEFAULT_SETTINGS, normalizeSettings } from './core/settings.js';

const form = document.getElementById('settings-form');
const status = document.getElementById('save-status');
let saveTimer = 0;

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

load().catch(() => {
  status.textContent = 'Could not load settings. Reload this page.';
});
