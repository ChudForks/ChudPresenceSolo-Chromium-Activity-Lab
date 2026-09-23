import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasHostPermissions,
  hasUserScriptsPermission,
  requestHostPermissions,
} from '../extension/core/activity-permissions.js';

test('host permissions check only the declared Activity origins', async () => {
  const expected = ['https://www.crunchyroll.com/*'];
  let query;
  const api = { permissions: { contains: async (value) => { query = value; return true; } } };

  assert.equal(await hasHostPermissions(expected, api), true);
  assert.deepEqual(query, { origins: expected });
  assert.equal(await hasHostPermissions([], api), true);
});

test('missing or failing host permission APIs report unavailable', async () => {
  assert.equal(await hasHostPermissions(['https://example.com/*'], {}), false);
  assert.equal(await hasHostPermissions(['https://example.com/*'], {
    permissions: { contains: async () => { throw new Error('blocked'); } },
  }), false);
});

test('userScripts availability requires a working API and the declared permission', async () => {
  const api = {
    userScripts: { execute() {}, async getScripts() { return []; } },
    permissions: { contains: async (value) => value.permissions.includes('userScripts') },
  };
  assert.equal(await hasUserScriptsPermission(api), true);
  assert.equal(await hasUserScriptsPermission({ ...api, userScripts: undefined }), false);
  assert.equal(await hasUserScriptsPermission({
    ...api,
    permissions: { contains: async () => false },
  }), false);
  assert.equal(await hasUserScriptsPermission({
    ...api,
    userScripts: { ...api.userScripts, async getScripts() { throw new Error('Allow User Scripts disabled'); } },
  }), false);
});

test('origin requests use the package-declared patterns and fail closed', async () => {
  const origins = ['https://music.youtube.com/*'];
  let query;
  const api = { permissions: { request: async (value) => { query = value; return true; } } };

  assert.equal(await requestHostPermissions(origins, api), true);
  assert.deepEqual(query, { origins });
  assert.equal(await requestHostPermissions(origins, {}), false);
});
