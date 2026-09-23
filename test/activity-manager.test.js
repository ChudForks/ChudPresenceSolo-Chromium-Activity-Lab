import assert from 'node:assert/strict';
import test from 'node:test';
import { ActivityManager } from '../extension/core/activity-manager.js';

function createApi({ stored = {}, userScripts, origins = true } = {}) {
  const data = { installedActivities: stored };
  return {
    __storageData: data,
    storage: {
      local: {
        async get(key) { return { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
        async remove(keys) { for (const key of keys) delete data[key]; },
      },
    },
    permissions: {
      async contains(query) { return query.permissions?.includes('userScripts') || origins; },
      async getAll() { return { origins: [] }; },
    },
    runtime: { getManifest() { return { version: '1.8.0' }; } },
    ...(userScripts ? { userScripts } : {}),
  };
}

const metadata = {
  id: 'sample-activity',
  name: 'Sample Activity',
  description: 'A sample website observer.',
  version: '1.0.0',
  apiVersion: 1,
  matches: ['https://example.com/*'],
  entry: 'activity.js',
};
const capability = 'a'.repeat(64);

test('reports unavailable Chrome userScripts.execute as a settings issue during install', async () => {
  const manager = new ActivityManager({ api: createApi() });
  await assert.rejects(manager.install({ metadata, source: 'ChudPresence.report({ kind: "video", media: { title: "x" } });' }),
    /Chrome does not expose the required userScripts.execute API.*Allow User Scripts/);
});

test('reports missing Chrome userScripts.execute even when registration methods exist', async () => {
  const api = createApi({ userScripts: { async getScripts() { return []; }, async register() {} } });
  const manager = new ActivityManager({ api });
  await assert.rejects(manager.install({ metadata, source: 'ChudPresence.report({ kind: "video", media: { title: "x" } });' }),
    /Chrome does not expose the required userScripts.execute API.*Chrome 135/);
});

test('restores stored Activities after a service worker cold start', async () => {
  const activity = {
    metadata,
    code: 'ChudPresence.report({ kind: "video", media: { title: "x" } });',
    enabled: true,
  };
  const calls = [];
  const userScripts = {
    async execute() { return []; },
    async getScripts() { calls.push('getScripts'); return []; },
    async configureWorld(options) { calls.push(['configureWorld', options]); },
    async register(scripts) { calls.push(['register', scripts]); },
  };
  const api = createApi({ stored: { 'sample-activity': activity }, userScripts });
  const result = await new ActivityManager({ api }).restoreAll();

  assert.deepEqual(result, { restored: 1, permissionMissing: false });
  assert.equal(calls.filter((call) => call === 'getScripts').length, 2);
  assert.deepEqual(calls.find((call) => Array.isArray(call) && call[0] === 'configureWorld'),
    ['configureWorld', { worldId: 'chudpresence.activity.sample-activity', messaging: true }]);
  const registration = calls.find((call) => Array.isArray(call) && call[0] === 'register');
  assert.equal(registration[1][0].world, 'USER_SCRIPT');
  assert.equal(registration[1][0].worldId, 'chudpresence.activity.sample-activity');
  const migrated = api.__storageData.installedActivities['sample-activity'];
  assert.match(migrated.capability, /^[a-f0-9]{64}$/);
  assert.match(registration[1][0].js[0].code, new RegExp(migrated.capability));
});

test('rejects page execution cleanly when Chrome does not expose userScripts.execute', async () => {
  const api = createApi({ stored: {
    'sample-activity': { metadata, code: 'void 0;', enabled: true, capability },
  }, userScripts: { async execute() { throw new Error('should not run'); } } });
  delete api.userScripts.execute;
  const manager = new ActivityManager({ api });
  const result = await manager.handleUserScriptMessage({
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'sample-activity', capability, apiVersion: 1, requestId: 'request-1',
    operation: 'page.execute', payload: { source: '() => document.title', argsJson: '[]' },
  }, {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 7 }, frameId: 0, documentId: 'document-7', url: 'https://example.com/watch',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'unsupported_operation');
  assert.match(result.error.message, /does not support page-context execution/);
});

test('accepts Chrome user-script messages without worldId only with the installed capability', async () => {
  const otherMetadata = { ...metadata, id: 'other-activity', name: 'Other Activity' };
  const api = createApi({ stored: {
    'sample-activity': { metadata, code: 'void 0;', enabled: true, capability },
    'other-activity': { metadata: otherMetadata, code: 'void 0;', enabled: true, capability: 'b'.repeat(64) },
  } });
  const manager = new ActivityManager({ api });
  const sender = {
    id: 'extension-id', url: 'https://example.com/watch', origin: 'https://example.com',
    frameId: 0, documentId: 'document-7', documentLifecycle: 'active', tab: { id: 7 },
  };
  const message = {
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'sample-activity', capability,
    apiVersion: 1, requestId: 'request-1', operation: 'settings.getAll', payload: {},
  };

  assert.equal(Object.hasOwn(sender, 'userScriptWorldId'), false);
  const accepted = await manager.handleUserScriptMessage(message, sender);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.data, { value: {} });
  assert.equal(await manager.handleUserScriptMessage({ ...message, capability: 'b'.repeat(64) }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, activityId: 'other-activity' }, sender), false);
  assert.equal(await manager.handleUserScriptMessage(message, { ...sender, url: 'https://attacker.example/watch' }), false);
});

test('continues to enforce sender world identity when Chromium provides it', async () => {
  const manager = new ActivityManager({ api: createApi({ stored: {
    'sample-activity': { metadata, code: 'void 0;', enabled: true, capability },
  } }) });
  const message = {
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'sample-activity', capability,
    apiVersion: 1, requestId: 'request-1', operation: 'settings.getAll', payload: {},
  };
  const sender = {
    userScriptWorldId: 'chudpresence.activity.other',
    url: 'https://example.com/watch', frameId: 0, documentId: 'document-7', tab: { id: 7 },
  };

  assert.equal(await manager.handleUserScriptMessage(message, sender), false);
});

test('keeps persisted capabilities out of Activity status and error text', async () => {
  const manager = new ActivityManager({ api: createApi({ stored: {
    'sample-activity': { metadata, code: 'void 0;', enabled: true, capability, error: `failure ${capability}` },
  } }) });
  const status = await manager.status();

  assert.equal(status.installed[0].error, 'failure [redacted capability]');
  assert.equal(JSON.stringify(status).includes(capability), false);
});

test('reload injects into the same Chrome document and Activity world', async () => {
  const injected = [];
  const userScripts = {
    async execute(options) {
      injected.push(options);
      return [{ documentId: 'document-7' }];
    },
    async getScripts() { return []; },
    async configureWorld() {},
    async register() {},
  };
  const api = createApi({ stored: {
    'sample-activity': { metadata, code: 'void 0;', enabled: true, capability },
  }, userScripts });
  const manager = new ActivityManager({ api });
  manager.lastSeen.set('sample-activity', new Map([[7, new Map([[0, {
    documentId: 'document-7', lastSeen: Date.now(), active: true, senderUrl: 'https://example.com/watch',
  }]])]]));

  assert.deepEqual(await manager.reload('sample-activity'), { id: 'sample-activity', reloadedFrames: 1 });
  assert.deepEqual(injected[0].target, { tabId: 7, documentIds: ['document-7'] });
  assert.equal(injected[0].world, 'USER_SCRIPT');
  assert.equal(injected[0].worldId, 'chudpresence.activity.sample-activity');
});

test('accepts a connection only from the matching Activity world and sender URL', async () => {
  const manager = new ActivityManager({ api: createApi({ stored: {
    'sample-activity': { metadata, code: 'void 0;', enabled: true, capability },
  } }) });
  const port = {
    name: `chudpresence-activity-v1:sample-activity:1.0.0:${capability}`,
    sender: {
      userScriptWorldId: 'chudpresence.activity.sample-activity',
      tab: { id: 7 }, frameId: 0, documentId: 'document-7', url: 'https://example.com/watch',
    },
    onDisconnect: { addListener() {} },
  };

  assert.equal(await manager.handleUserScriptConnect(port), true);
  assert.equal(await manager.handleUserScriptConnect({ ...port, sender: { ...port.sender, userScriptWorldId: 'chudpresence.activity.other' } }), false);
  assert.equal(await manager.handleUserScriptConnect({ ...port, sender: { ...port.sender, userScriptWorldId: undefined } }), true);
  assert.equal(await manager.handleUserScriptConnect({ ...port, name: `chudpresence-activity-v1:sample-activity:1.0.0:${'b'.repeat(64)}`, sender: { ...port.sender, userScriptWorldId: undefined } }), false);
});

test('rotates ownership capability when an Activity is reinstalled', async () => {
  const registrations = [];
  const userScripts = {
    async execute() { return []; },
    async getScripts() { return []; },
    async configureWorld() {},
    async register(scripts) { registrations.push(scripts[0]); },
    async update(scripts) { registrations.push(scripts[0]); },
    async unregister() {},
  };
  const api = createApi({ userScripts });
  const manager = new ActivityManager({ api });
  const activityPackage = { metadata, source: 'ChudPresence.report({ kind: "video", media: { title: "x" } });' };

  await manager.install(activityPackage);
  const firstCapability = api.__storageData.installedActivities['sample-activity'].capability;
  await manager.install(activityPackage);
  const secondCapability = api.__storageData.installedActivities['sample-activity'].capability;

  assert.match(firstCapability, /^[a-f0-9]{64}$/);
  assert.match(secondCapability, /^[a-f0-9]{64}$/);
  assert.notEqual(secondCapability, firstCapability);
  assert.match(registrations.at(-1).js[0].code, new RegExp(secondCapability));
  assert.equal(await manager.handleUserScriptMessage({
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'sample-activity', capability: firstCapability,
    apiVersion: 1, requestId: 'stale-request', operation: 'settings.getAll', payload: {},
  }, {
    id: 'extension-id', url: 'https://example.com/watch', origin: 'https://example.com',
    frameId: 0, documentId: 'document-7', documentLifecycle: 'active', tab: { id: 7 },
  }), false);
});
