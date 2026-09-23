import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../extension/', import.meta.url);
const readExtensionFile = (name) => readFile(new URL(name, root), 'utf8');

test('Activity Library exposes the four library views and local package loading', async () => {
  const html = await readExtensionFile('activities.html');
  for (const id of ['discover-view', 'installed-view', 'updates-view', 'developer-view', 'local-files', 'load-local']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('Activity Library explains Chromium user script availability and requests only declared origins', async () => {
  const [html, script] = await Promise.all([readExtensionFile('activities.html'), readExtensionFile('activities.js')]);
  assert.match(html, /Chrome 138[\s\S]*Allow User Scripts/);
  assert.match(script, /chrome\.permissions\.request\(\{ origins \}\)/);
  assert.match(script, /api\.userScripts\?\.execute/);
  assert.doesNotMatch(script, /requestUserScriptsPermission|Firefox requires|Firefox permission/);
});

test('popup exposes visibility, playback, report, clear, and local intent diagnostics', async () => {
  const [html, script] = await Promise.all([readExtensionFile('popup.html'), readExtensionFile('popup.js')]);
  for (const id of ['local-visibility', 'local-playback', 'local-last-report', 'local-last-clear', 'local-presence-intent']) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(script, new RegExp(`getElementById\\('${id}'\\)`));
  }
  assert.match(html, /href="activities\.html"/);
  assert.match(script, /state\.finalPresenceIntent/);
  assert.match(script, /state\.activityDiagnostics/);
});
