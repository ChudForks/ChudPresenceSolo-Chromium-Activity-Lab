import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { ActivityManager } from '../extension/core/activity-manager.js';
import { registerActivityRestoreHandlers } from '../extension/core/activity-restore.js';
import { shouldInvalidateActivityTab } from '../extension/core/tab-lifecycle.js';

function createFakeEvent() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    removeListener(listener) { listeners.delete(listener); },
    async dispatch(...args) { await Promise.all([...listeners].map((listener) => listener(...args))); },
  };
}

function createFakeApi() {
  const data = {};
  const permissions = new Set(['userScripts', 'https://example.com/*']);
  const scripts = new Map();
  const userScriptCalls = [];
  const sentMessages = [];
  const pageExecutions = [];
  const pageContext = { window: { someApplicationState: { title: 'Page-owned title', count: 3 } } };
  let nextPageExecutionResults = null;
  let fetchImplementation = async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } });
  let failNextWrite = false;
  let failNextScriptUpdate = false;
  const onInstalled = createFakeEvent();
  const onStartup = createFakeEvent();
  const project = (keys) => {
    if (keys == null) return structuredClone(data);
    const wanted = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])]));
  };
  const api = {
    storage: {
      local: {
        async get(keys) { return project(keys); },
        async set(values) {
          if (failNextWrite) {
            failNextWrite = false;
            throw new Error('Simulated storage failure');
          }
          Object.assign(data, structuredClone(values));
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
        },
      },
    },
    permissions: {
      async contains({ permissions: requested = [], origins = [] }) {
        return [...requested, ...origins].every((permission) => permissions.has(permission));
      },
      async getAll() { return { origins: [...permissions].filter((permission) => /^https?:\/\//.test(permission)) }; },
      async remove({ permissions: removedPermissions = [], origins = [] }) {
        for (const permission of [...removedPermissions, ...origins]) permissions.delete(permission);
        return true;
      },
    },
    userScripts: {
      async getScripts() { userScriptCalls.push({ type: 'getScripts' }); return [...scripts.values()]; },
      async configureWorld(options) { userScriptCalls.push({ type: 'configureWorld', options: structuredClone(options) }); },
      async execute(injection) {
        pageExecutions.push(injection);
        userScriptCalls.push({ type: 'execute', injection: structuredClone(injection) });
        if (injection.world === 'USER_SCRIPT') {
          return [{ documentId: injection.target.documentIds?.[0], frameId: 0, result: 'null' }];
        }
        if (nextPageExecutionResults) {
          const result = nextPageExecutionResults;
          nextPageExecutionResults = null;
          return result;
        }
        try {
          return [{
            documentId: injection.target.documentIds?.[0],
            frameId: 0,
            result: vm.runInNewContext(injection.js[0].code, pageContext),
          }];
        } catch (error) {
          return [{ documentId: injection.target.documentIds?.[0], frameId: 0, error: String(error?.message || error) }];
        }
      },
      async register(definitions) {
        userScriptCalls.push({ type: 'register', definitions: structuredClone(definitions) });
        for (const definition of definitions) scripts.set(definition.id, definition);
      },
      async update(definitions) {
        userScriptCalls.push({ type: 'update', definitions: structuredClone(definitions) });
        if (failNextScriptUpdate) {
          failNextScriptUpdate = false;
          throw new Error('Simulated script update failure');
        }
        for (const definition of definitions) scripts.set(definition.id, definition);
      },
      async unregister({ ids }) {
        userScriptCalls.push({ type: 'unregister', ids: [...ids] });
        for (const id of ids) scripts.delete(id);
      },
    },
    runtime: {
      getManifest() { return { version: '1.9.0' }; },
      onInstalled,
      onStartup,
    },
    tabs: { async sendMessage(tabId, message, options) { sentMessages.push({ tabId, message, options }); } },
  };
  return {
    api,
    scripts,
    userScriptCalls,
    data,
    sentMessages,
    pageExecutions,
    pageContext,
    permissions,
    fetchImpl(...args) { return fetchImplementation(...args); },
    setFetchImplementation(implementation) { fetchImplementation = implementation; },
    setNextPageExecutionResults(results) { nextPageExecutionResults = results; },
    failNextWrite() { failNextWrite = true; },
    failNextScriptUpdate() { failNextScriptUpdate = true; },
  };
}

function createActivityPort(fake, sender, version) {
  const messageListeners = new Set();
  const disconnectListeners = new Set();
  let disconnected = false;
  const activityId = typeof sender?.userScriptWorldId === 'string'
    ? sender.userScriptWorldId.slice('chudpresence.activity.'.length)
    : sender?.activityId || 'sample-activity';
  const capability = fake.data.installedActivities?.[activityId]?.capability || '';
  return {
    name: `chudpresence-activity-v1:${activityId}:${version}:${capability}`,
    sender,
    onMessage: {
      addListener(listener) { messageListeners.add(listener); },
      removeListener(listener) { messageListeners.delete(listener); },
    },
    onDisconnect: {
      addListener(listener) { disconnectListeners.add(listener); },
    },
    postMessage(message) {
      if (disconnected) throw new Error('Port is disconnected');
      fake.sentMessages.push({
        tabId: sender.tab.id,
        message: structuredClone(message),
        options: { documentId: sender.documentId },
      });
      for (const listener of messageListeners) listener(message);
      if (message.type === 'CHUDPRESENCE_ACTIVITY_ABORT') this.disconnect();
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      for (const listener of disconnectListeners) listener();
    },
  };
}

async function connectActivity(fake, manager, sender, version = '1.0.0') {
  const port = createActivityPort(fake, sender, version);
  assert.equal(await manager.handleUserScriptConnect(port), true);
  return port;
}

function activityPackage() {
  return {
    metadata: {
      id: 'sample-activity',
      name: 'Sample Activity',
      description: 'A sample observer.',
      version: '1.0.0',
      apiVersion: 1,
      matches: ['https://example.com/*'],
      entry: 'activity.js',
    },
    source: 'ChudPresence.report({ kind: "video", media: { title: "A page" } });',
    sourceType: 'local',
  };
}

function activityReport(title = 'A page') {
  return { kind: 'video', media: { title } };
}

function activityRequest(manager, operation, payload = {}, requestId = 'test-request', activityId = 'sample-activity') {
  const record = manager.records?.[activityId];
  return {
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST',
    activityId,
    activityVersion: record?.metadata?.version,
    capability: record?.capability,
    apiVersion: 1,
    requestId,
    operation,
    payload,
  };
}

test('installs into an isolated per-Activity world and restores after registrations are cleared', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });

  const activity = activityPackage();
  activity.metadata.excludeMatches = ['https://example.com/private/*'];
  await manager.install(activity);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal(fake.scripts.get('chudpresence-activity-sample-activity').world, 'USER_SCRIPT');
  assert.equal(fake.scripts.get('chudpresence-activity-sample-activity').worldId, 'chudpresence.activity.sample-activity');
  assert.equal(fake.scripts.get('chudpresence-activity-sample-activity').allFrames, false);
  assert.equal(fake.scripts.get('chudpresence-activity-sample-activity').runAt, 'document_idle');
  assert.deepEqual(fake.scripts.get('chudpresence-activity-sample-activity').matches, ['https://example.com/*']);
  assert.deepEqual(fake.scripts.get('chudpresence-activity-sample-activity').excludeMatches, ['https://example.com/private/*']);
  assert.deepEqual(fake.userScriptCalls.find((call) => call.type === 'configureWorld').options, {
    worldId: 'chudpresence.activity.sample-activity', messaging: true,
  });
  assert.match(fake.scripts.get('chudpresence-activity-sample-activity').js[0].code, /CHUDPRESENCE_ACTIVITY_REQUEST/);

  fake.scripts.clear();
  fake.userScriptCalls.length = 0;
  const restored = await manager.restoreAll();
  assert.equal(restored.restored, 1);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal(fake.userScriptCalls.some((call) => call.type === 'register'), true);
  assert.equal(fake.userScriptCalls.some((call) => call.type === 'configureWorld' &&
    call.options.worldId === 'chudpresence.activity.sample-activity'), true);
});

test('provides a frozen ChudPresence runtime with report, page, and network helpers', async (t) => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.com/*');
  const manager = new ActivityManager({ api: fake.api, fetchImpl: fake.fetchImpl });
  const activity = activityPackage();
  activity.metadata.network = ['https://api.example.com/*'];
  activity.metadata.settings = [
    { id: 'showAlbum', type: 'boolean', label: 'Show album', default: true },
    { id: 'displayMode', type: 'select', label: 'Display mode', default: 'artist', options: [
      { label: 'Artist', value: 'artist' }, { label: 'Album', value: 'album' },
    ] },
  ];
  activity.source = [
    'globalThis.__capturedPresence = ChudPresence;',
    'globalThis.__capturedPage = ChudPresence.page;',
    'globalThis.__settingChanges = [];',
    'ChudPresence.settings.onChange((change) => globalThis.__settingChanges.push(change));',
    'globalThis.__capturedSignal = ChudPresence.lifecycle.signal;',
    'globalThis.__upgradeEvents = [];',
    'ChudPresence.lifecycle.onUpgrade((change) => globalThis.__upgradeEvents.push(change));',
    'globalThis.__media = ChudPresence.media;',
    'globalThis.__mediaEvents = [];',
    'ChudPresence.media.onChange((event) => globalThis.__mediaEvents.push(event), { immediate: true });',
    'globalThis.__navigationEvents = [];',
    'globalThis.__navigation = ChudPresence.navigation;',
    'ChudPresence.navigation.onChange((change) => globalThis.__navigationEvents.push(change));',
    'ChudPresence.navigation.onChange(() => { globalThis.__navigationCallbackCount = (globalThis.__navigationCallbackCount || 0) + 1; });',
    'globalThis.__cleanupCount = 0;',
    'ChudPresence.lifecycle.onCleanup(() => { globalThis.__cleanupCount += 1; });',
    'globalThis.__timeoutTicks = 0;',
    'ChudPresence.lifecycle.timeout(() => { globalThis.__timeoutTicks += 1; }, 10000);',
    'ChudPresence.lifecycle.interval(() => { globalThis.__ticks = (globalThis.__ticks || 0) + 1; }, 5);',
    'globalThis.__directBrowser = typeof browser;',
    'globalThis.__windowBrowser = typeof window.browser;',
    'globalThis.__directChrome = typeof chrome;',
    'globalThis.__windowChrome = typeof window.chrome;',
  ].join('\n');
  await manager.install(activity);
  const script = fake.scripts.get('chudpresence-activity-sample-activity').js[0].code;
  const calls = [];
  const runtimeListeners = new Set();
  let runtimePort;
  const pageSender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 41 }, frameId: 0, documentId: 'page-exec-doc', url: 'https://example.com/watch/1',
  };
  const chrome = { runtime: {
    sendMessage(message) {
      calls.push(message);
      return manager.handleUserScriptMessage(structuredClone(message), pageSender);
    },
    connect({ name }) {
      runtimePort = {
        name,
        onMessage: { addListener(listener) { runtimeListeners.add(listener); } },
        onDisconnect: { addListener() {} },
        disconnect() {},
      };
      return runtimePort;
    },
  } };
  const eventListeners = new Map();
  const documentListeners = new Map();
  const observers = new Set();
  const video = {
    tagName: 'VIDEO', paused: false, ended: false, currentTime: 12, duration: 120,
    playbackRate: 1.25, volume: 0.5, muted: false,
    getBoundingClientRect() { return { width: 640, height: 360 }; },
  };
  const audio = {
    tagName: 'AUDIO', paused: true, ended: false, currentTime: 0, duration: 210,
    playbackRate: 1, volume: 1, muted: false,
    getBoundingClientRect() { return { width: 0, height: 0 }; },
  };
  const mediaElements = [video, audio];
  const domElements = [];
  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (selector === 'video, audio') return mediaElements;
      return domElements.filter((node) => node.matches(selector));
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); },
  };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.add(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; observers.delete(this); }
  }
  const pageWindow = {};
  const pageTimeouts = new Set();
  const pageIntervals = new Set();
  pageWindow.top = pageWindow;
  pageWindow.window = pageWindow;
  pageWindow.self = pageWindow;
  pageWindow.location = { href: 'https://example.com/start' };
  pageWindow.history = {
    pushState(_state, _title, url) { pageWindow.location.href = new URL(url, pageWindow.location.href).toString(); },
    replaceState(_state, _title, url) { pageWindow.location.href = new URL(url, pageWindow.location.href).toString(); },
  };
  pageWindow.addEventListener = (type, listener) => {
    if (!eventListeners.has(type)) eventListeners.set(type, new Set());
    eventListeners.get(type).add(listener);
  };
  pageWindow.removeEventListener = (type, listener) => eventListeners.get(type)?.delete(listener);
  pageWindow.setTimeout = (callback, delay) => {
    let timer;
    timer = setTimeout(() => { pageTimeouts.delete(timer); callback(); }, delay);
    pageTimeouts.add(timer);
    return timer;
  };
  pageWindow.clearTimeout = (timer) => { pageTimeouts.delete(timer); clearTimeout(timer); };
  pageWindow.setInterval = (callback, delay) => {
    const timer = setInterval(callback, delay);
    pageIntervals.add(timer);
    return timer;
  };
  pageWindow.clearInterval = (timer) => { pageIntervals.delete(timer); clearInterval(timer); };
  pageWindow.document = document;
  const scope = vm.createContext({
    window: pageWindow, location: pageWindow.location, history: pageWindow.history, chrome,
    document, MutationObserver: FakeMutationObserver,
    Date, Math, Object, Proxy, Reflect, WeakMap, AbortController,
  });
  vm.runInContext(script, scope);
  const installedCapability = fake.data.installedActivities['sample-activity'].capability;
  assert.equal(runtimePort.name,
    `chudpresence-activity-v1:sample-activity:1.0.0:${installedCapability}`);
  t.after(() => {
    for (const listener of eventListeners.get('pagehide') || []) listener({ type: 'pagehide' });
  });

  const api = pageWindow.__capturedPresence;
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.runtime), true);
  assert.equal(Object.isFrozen(api.lifecycle), true);
  assert.equal(Object.isFrozen(api.navigation), true);
  assert.equal(Object.isFrozen(api.media), true);
  assert.equal(api.runtime.activityId, 'sample-activity');
  assert.equal(api.runtime.activityVersion, '1.0.0');
  assert.equal(Object.hasOwn(api.runtime, 'capability'), false);
  assert.equal(api.runtime.apiVersion, 1);
  assert.equal(api.runtime.extensionVersion, '1.9.0');
  assert.equal(api.runtime.frame.isTop, true);
  assert.equal(api.runtime.has('report'), true);
  assert.equal(api.runtime.has('lifecycle'), true);
  assert.equal(api.runtime.has('navigation'), true);
  assert.equal(api.runtime.has('media'), true);
  assert.equal(api.runtime.has('pageExecute'), true);
  assert.equal(api.runtime.has('netFetch'), true);
  assert.equal(api.runtime.has('storage'), true);
  assert.equal(api.runtime.has('settings'), true);
  assert.equal(api.runtime.has('dom'), true);
  assert.equal(api.runtime.has('log'), true);
  assert.equal(Object.isFrozen(api.page), true);
  assert.equal(Object.isFrozen(api.net), true);
  assert.equal(Object.isFrozen(api.settings), true);
  assert.equal(Object.isFrozen(api.dom), true);
  assert.equal(Object.isFrozen(api.log), true);
  assert.equal(typeof api.settings.get, 'function');
  assert.equal(typeof api.settings.getAll, 'function');
  assert.equal(typeof api.settings.onChange, 'function');
  assert.equal(api.runtime.has('storage'), true);
  assert.equal(Object.isFrozen(api.storage), true);
  assert.equal(typeof api.storage.get, 'function');
  assert.equal(typeof api.storage.set, 'function');
  assert.equal(typeof api.storage.remove, 'function');
  assert.equal(typeof api.storage.clear, 'function');
  assert.equal(pageWindow.__directBrowser, 'undefined');
  assert.equal(pageWindow.__windowBrowser, 'undefined');
  assert.equal(pageWindow.__directChrome, 'undefined');
  assert.equal(pageWindow.__windowChrome, 'undefined');
  const pushState = pageWindow.history.pushState;
  const replaceState = pageWindow.history.replaceState;
  assert.equal(api.navigation.current, 'https://example.com/start');
  pageWindow.history.pushState({}, '', '/first');
  pageWindow.history.replaceState({}, '', '/final');
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(api.navigation.current, 'https://example.com/final');
  assert.equal(pageWindow.__navigationEvents.length, 1);
  assert.equal(pageWindow.__navigationEvents[0].oldUrl, 'https://example.com/start');
  assert.equal(pageWindow.__navigationEvents[0].newUrl, 'https://example.com/final');
  assert.equal(pageWindow.__navigationEvents[0].type, 'history');
  assert.equal(pageWindow.__navigationCallbackCount, 1);
  assert.equal(pageWindow.history.pushState, pushState);
  assert.equal(pageWindow.history.replaceState, replaceState);
  assert.equal(eventListeners.get('popstate').size, 1);
  assert.equal(pageWindow.__media.find(), video);
  const allMedia = pageWindow.__media.findAll();
  assert.equal(allMedia.length, 2);
  assert.equal(allMedia[0], video);
  const snapshot = pageWindow.__media.snapshot(video);
  assert.equal(snapshot.playing, true);
  assert.equal(snapshot.paused, false);
  assert.equal(snapshot.currentTime, 12);
  assert.equal(snapshot.duration, 120);
  assert.equal(snapshot.playbackRate, 1.25);
  assert.equal(snapshot.volume, 0.5);
  assert.equal(snapshot.muted, false);
  video.paused = true;
  for (const listener of documentListeners.get('pause') || []) listener({ type: 'pause', target: video });
  assert.equal(pageWindow.__mediaEvents.at(-1).snapshot.paused, true);
  audio.paused = false;
  audio.currentTime = 4;
  assert.equal(pageWindow.__media.find(), audio);

  const pageValue = await api.page.execute((key, suffix) => ({
    title: window[key].title,
    count: window[key].count,
    suffix,
  }), ['someApplicationState', '!']);
  assert.deepEqual(pageValue, { title: 'Page-owned title', count: 3, suffix: '!' });
  assert.deepEqual(await api.page.execute((first, second) => [first, second, window.someApplicationState.count], ['a', 9]), ['a', 9, 3]);
  assert.equal(await api.page.execute(() => 42), 42);
  await assert.rejects(api.page.execute(() => { throw new TypeError('page boom'); }), (error) =>
    error.name === 'TypeError' && error.code === 'page_execution_error' && error.message === 'page boom',
  );
  assert.equal(fake.pageExecutions.length, 4);
  assert.deepEqual(fake.pageExecutions[0].target, { tabId: 41, documentIds: ['page-exec-doc'] });
  assert.equal(fake.pageExecutions[0].world, 'MAIN');
  assert.deepEqual(await api.net.fetch('https://api.example.com/v1/status'), {
    status: 200, ok: true, contentType: 'application/json', data: { ok: true },
  });
  await assert.rejects(api.net.fetch('https://unlisted.example.net/v1/status'), (error) =>
    error.code === 'origin_not_declared');
  assert.equal(await api.settings.get('showAlbum'), true);
  assert.deepEqual(await api.settings.getAll(), { showAlbum: true, displayMode: 'artist' });
  await assert.rejects(api.settings.get('missingSetting'), (error) => error.code === 'invalid_setting_id');
  assert.equal(await api.storage.set('runtime-value', { enabled: true }), true);
  assert.deepEqual(await api.storage.get('runtime-value'), { enabled: true });
  assert.equal(await api.storage.remove('runtime-value'), true);
  await api.storage.set('clear-first', 1);
  await api.storage.set('clear-second', 2);
  assert.equal(await api.storage.clear(), 2);
  assert.equal(await api.storage.clear(), 0);
  const settingsEvent = {
    type: 'CHUDPRESENCE_ACTIVITY_SETTINGS_CHANGED', activityId: 'sample-activity', activityVersion: '1.0.0',
    settingId: 'displayMode', value: 'album', settings: { showAlbum: true, displayMode: 'album' },
  };
  for (const listener of runtimeListeners) listener(settingsEvent);
  for (const listener of runtimeListeners) listener({ ...settingsEvent, activityId: 'other-activity' });
  assert.equal(pageWindow.__settingChanges.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(pageWindow.__settingChanges[0])), {
    id: 'displayMode', value: 'album', settings: { showAlbum: true, displayMode: 'album' },
  });
  await Promise.all([...runtimeListeners].map((listener) => listener({
    type: 'CHUDPRESENCE_ACTIVITY_UPGRADE', activityId: 'sample-activity', activityVersion: '1.0.0',
    fromVersion: '0.9.0', toVersion: '1.0.0',
  })));
  assert.deepEqual(JSON.parse(JSON.stringify(pageWindow.__upgradeEvents)), [{ fromVersion: '0.9.0', toVersion: '1.0.0' }]);
  await Promise.all([...runtimeListeners].map((listener) => listener({
    type: 'CHUDPRESENCE_ACTIVITY_UPGRADE', activityId: 'sample-activity', activityVersion: '1.0.0',
    fromVersion: '0.9.0', toVersion: '1.0.0',
  })));
  assert.equal(pageWindow.__upgradeEvents.length, 1);
  await Promise.all([...runtimeListeners].map((listener) => listener({
    type: 'CHUDPRESENCE_ACTIVITY_UPGRADE', activityId: 'other-activity', activityVersion: '1.0.0',
    fromVersion: '0.9.0', toVersion: '1.0.0',
  })));
  assert.equal(pageWindow.__upgradeEvents.length, 1);

  const waitingForElement = api.dom.waitFor('.late', { timeoutMs: 500 });
  const lateElement = {
    nodeType: 1,
    selector: '.late',
    matches(selector) { return selector === this.selector; },
    querySelectorAll() { return []; },
  };
  domElements.push(lateElement);
  for (const observer of [...observers]) {
    if (observer.target === document) observer.callback([{ type: 'childList', addedNodes: [lateElement] }]);
  }
  assert.equal(await waitingForElement, lateElement);
  const observedElements = [];
  const stopObserving = api.dom.observe('.item', (node) => observedElements.push(node), { immediate: false });
  const itemElement = {
    nodeType: 1,
    selector: '.item',
    matches(selector) { return selector === this.selector; },
    querySelectorAll() { return []; },
  };
  domElements.push(itemElement);
  const itemObserver = [...observers].find((observer) => observer.target === document && !observer.disconnected);
  itemObserver.callback([{ type: 'childList', addedNodes: [itemElement] }]);
  assert.deepEqual(observedElements, [itemElement]);
  stopObserving();
  assert.equal(itemObserver.disconnected, true);
  await assert.rejects(api.dom.waitFor('.never', { timeoutMs: 1 }), (error) => error.name === 'TimeoutError' && error.code === 'timeout');
  const cancelController = new AbortController();
  const abortedWait = assert.rejects(api.dom.waitFor('.also-never', { signal: cancelController.signal }),
    (error) => error.name === 'AbortError' && error.code === 'aborted');
  cancelController.abort();
  await abortedWait;
  await api.log.info('Activity started', {
    access_token: 'discord-access-token-value',
    cookie: 'session-cookie-value',
    route: 'https://service.example/watch?id=secret',
  });
  const activityStatus = (await manager.listInstalled())[0];
  assert.deepEqual(activityStatus.activityLogs[0].args, [
    'Activity started',
    { access_token: '[redacted]', cookie: '[redacted]', route: 'https://service.example/watch' },
  ]);
  assert.equal(activityStatus.activityLogs[0].activityId, 'sample-activity');
  assert.equal(activityStatus.activityLogs[0].activityVersion, '1.0.0');
  assert.equal(activityStatus.activityLogs[0].tabId, 41);
  assert.equal(activityStatus.activityLogs[0].frameId, 0);
  assert.equal(typeof activityStatus.activityLogs[0].timestamp, 'string');

  await api.report(activityReport('A report'));
  await api.clear();
  assert.deepEqual(calls.map((message) => message.operation), [
    'page.execute', 'page.execute', 'page.execute', 'page.execute', 'net.fetch', 'net.fetch',
    'settings.get', 'settings.getAll', 'settings.get',
    'storage.set', 'storage.get', 'storage.remove', 'storage.set', 'storage.set', 'storage.clear', 'storage.clear',
    'lifecycle.upgradeComplete', 'log.write', 'presence.report', 'presence.clear',
  ]);
  assert.deepEqual(calls.find((message) => message.operation === 'presence.report').payload.report, activityReport('A report'));
  assert.equal(calls.every((message) => message.type === 'CHUDPRESENCE_ACTIVITY_REQUEST'), true);
  assert.equal(calls.every((message) => message.activityId === 'sample-activity' &&
    message.activityVersion === '1.0.0' && typeof message.capability === 'string'), true);

  await new Promise((resolve) => setTimeout(resolve, 18));
  const ticksAtTeardown = pageWindow.__ticks;
  for (const listener of runtimeListeners) listener({
    type: 'CHUDPRESENCE_ACTIVITY_ABORT', activityId: 'sample-activity', activityVersion: '1.0.0', reason: 'disabled',
  });
  assert.equal(pageWindow.__capturedSignal.aborted, true);
  assert.equal(pageWindow.__cleanupCount, 1);
  assert.equal(pageTimeouts.size, 0);
  assert.equal(pageIntervals.size, 0);
  assert.equal(pageWindow.__timeoutTicks, 0);
  assert.equal(documentListeners.get('pause').size, 0);
  assert.equal(observers.size, 0);
  await new Promise((resolve) => setTimeout(resolve, 18));
  assert.equal(pageWindow.__ticks, ticksAtTeardown);
  for (const listener of eventListeners.get('pagehide') || []) listener({ type: 'pagehide' });
  assert.equal(pageWindow.__cleanupCount, 1);
});

test('accepts reports only from the installed Activity world and declared site', async () => {
  const fake = createFakeApi();
  const reports = [];
  const manager = new ActivityManager({ api: fake.api, onReport: (value) => reports.push(value) });
  await manager.install(activityPackage());
  const message = activityRequest(manager, 'presence.report', { report: activityReport('Episode') });

  assert.deepEqual(await manager.handleUserScriptMessage(message, {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 4 },
    documentId: 'doc-a',
    url: 'https://example.com/watch/1',
  }), { ok: true, requestId: 'test-request', data: { accepted: true } });
  assert.equal(reports[0].track.activityId, 'sample-activity');
  assert.equal(reports[0].track.source, 'activity');
  assert.deepEqual(reports[0].track.playback, {
    state: 'playing', position: 0, duration: 0, live: false, rate: 1,
  });
  assert.equal(await manager.handleUserScriptMessage({ ...message, activityId: 'spoofed-id' }, {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 4 }, documentId: 'doc-a', url: 'https://example.com/watch/1',
  }), false);
  assert.equal(await manager.handleUserScriptMessage(message, {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 4 },
    url: 'https://elsewhere.example/watch/1',
  }), false);
  assert.equal(reports.length, 1);
});

test('excludes URLs declared by Activity excludeMatches', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  activity.metadata.excludeMatches = ['https://example.com/private/*'];
  await manager.install(activity);
  assert.deepEqual(fake.scripts.get('chudpresence-activity-sample-activity').excludeMatches, ['https://example.com/private/*']);
  const accepted = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }, 'public'), {
    userScriptWorldId: 'chudpresence.activity.sample-activity', tab: { id: 72 }, frameId: 0,
    documentId: 'public-doc', url: 'https://example.com/watch',
  });
  const excluded = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }, 'private'), {
    userScriptWorldId: 'chudpresence.activity.sample-activity', tab: { id: 73 }, frameId: 0,
    documentId: 'private-doc', url: 'https://example.com/private/watch',
  });
  assert.equal(accepted.ok, true);
  assert.equal(excluded, false);
  assert.equal((await manager.listInstalled())[0].lastReport.tabId, 72);
});

test('authenticates messages and connections against the provided Chromium world ID', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  activity.metadata.excludeMatches = ['https://example.com/private/*'];
  await manager.install(activity);
  const other = activityPackage();
  other.metadata.id = 'other-activity';
  other.metadata.name = 'Other Activity';
  await manager.install(other);

  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 74 }, frameId: 0, documentId: 'auth-document', url: 'https://example.com/watch',
  };
  const message = activityRequest(manager, 'settings.getAll', {}, 'auth-valid');
  assert.equal((await manager.handleUserScriptMessage(message, sender)).ok, true);

  assert.equal(await manager.handleUserScriptMessage(message, {
    ...sender, userScriptWorldId: 'chudpresence.activity.other-activity',
  }), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, activityId: 'other-activity' }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, capability: 'f'.repeat(64) }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, capability: 'malformed' }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, activityVersion: '9.9.9' }, sender), false);
  assert.equal(await manager.handleUserScriptMessage(message, { ...sender, url: 'https://outside.example/watch' }), false);
  assert.equal(await manager.handleUserScriptMessage(message, { ...sender, url: 'https://example.com/private/watch' }), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, activityId: 'missing-activity' }, {
    ...sender, userScriptWorldId: undefined,
  }), false);

  const validPort = createActivityPort(fake, sender, '1.0.0');
  assert.equal(await manager.handleUserScriptConnect(validPort), true);
  assert.equal(await manager.handleUserScriptConnect(createActivityPort(fake, sender, '9.9.9')), false);
  assert.equal(await manager.handleUserScriptConnect({
    ...validPort,
    name: `chudpresence-activity-v1:sample-activity:1.0.0:${'f'.repeat(64)}`,
  }), false);
  assert.equal(await manager.handleUserScriptConnect({
    ...validPort,
    name: `chudpresence-activity-v1:sample-activity:1.0.0:${fake.data.installedActivities['other-activity'].capability}`,
  }), false);
  assert.equal(await manager.handleUserScriptConnect({
    ...validPort,
    sender: { ...sender, userScriptWorldId: 'chudpresence.activity.other-activity' },
  }), false);
  assert.equal(await manager.handleUserScriptConnect(createActivityPort(fake, {
    ...sender, url: 'https://outside.example/watch',
  }, '1.0.0')), false);
  assert.equal(await manager.handleUserScriptConnect(createActivityPort(fake, {
    ...sender, url: 'https://example.com/private/watch',
  }, '1.0.0')), false);

  await manager.setEnabled('sample-activity', false);
  assert.equal(await manager.handleUserScriptMessage(message, sender), false);
  await manager.remove('sample-activity');
  assert.equal(await manager.handleUserScriptMessage(message, sender), false);
});

test('authenticates Chromium user-script messages by capability when userScriptWorldId is undefined', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const other = activityPackage();
  other.metadata.id = 'other-activity';
  other.metadata.name = 'Other Activity';
  await manager.install(other);
  const sender = {
    id: 'extension-id', url: 'https://example.com/watch', origin: 'https://example.com',
    userScriptWorldId: undefined, frameId: 0, documentId: 'no-world-id-document',
    documentLifecycle: 'active', tab: { id: 75 },
  };
  const message = activityRequest(manager, 'settings.getAll', {}, 'no-world-id-valid');
  const installedCapability = fake.data.installedActivities['sample-activity'].capability;
  const otherCapability = fake.data.installedActivities['other-activity'].capability;

  assert.equal(sender.userScriptWorldId, undefined);
  assert.equal((await manager.handleUserScriptMessage(message, sender)).ok, true);
  assert.equal(await manager.handleUserScriptMessage({ ...message, capability: otherCapability }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({
    ...message, activityId: 'other-activity', capability: installedCapability,
  }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({ ...message, activityId: '../sample-activity' }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({
    type: 'CHUDPRESENCE_ACTIVITY_REQUEST', activityId: 'sample-activity', apiVersion: 1,
    requestId: 'page-forgery', operation: 'settings.getAll', payload: {},
  }, sender), false);
  assert.equal(await manager.handleUserScriptMessage({
    type: 'CHUDPRESENCE_ACTIVITY_REPORT', report: activityReport('forged'),
  }, sender), false);
  assert.equal(await manager.handleUserScriptMessage(message, { ...sender, url: 'https://attacker.example/watch' }), false);
});

test('rotates the Activity capability on update and redacts it from public state', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.net/*');
  const reports = [];
  const manager = new ActivityManager({ api: fake.api, fetchImpl: fake.fetchImpl, onReport: (report) => reports.push(report) });
  const activity = activityPackage();
  activity.metadata.network = ['https://api.example.net/*'];
  await manager.install(activity);
  const capabilityA = fake.data.installedActivities['sample-activity'].capability;
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 76 }, frameId: 0, documentId: 'capability-document', url: 'https://example.com/watch',
  };
  const messageFor = (capability, requestId) => ({
    ...activityRequest(manager, 'presence.report', { report: activityReport('safe title') }, requestId),
    capability,
  });
  assert.match(capabilityA, /^[a-f0-9]{64}$/);
  assert.equal((await manager.handleUserScriptMessage(messageFor(capabilityA, 'capability-a'), sender)).ok, true);

  const updatedActivity = structuredClone(activity);
  updatedActivity.metadata.version = '1.1.0';
  await manager.install(updatedActivity);
  const capabilityB = fake.data.installedActivities['sample-activity'].capability;
  assert.match(capabilityB, /^[a-f0-9]{64}$/);
  assert.notEqual(capabilityB, capabilityA);
  assert.match(fake.scripts.get('chudpresence-activity-sample-activity').js[0].code, new RegExp(capabilityB));
  assert.equal(await manager.handleUserScriptMessage(messageFor(capabilityA, 'stale-capability-a'), sender), false);
  assert.equal(await manager.handleUserScriptMessage({
    ...messageFor(capabilityB, 'stale-version'), activityVersion: '1.0.0',
  }, sender), false);
  const reportWithCapability = {
    ...activityRequest(manager, 'presence.report', { report: activityReport(capabilityB) }, 'capability-b'),
    capability: capabilityB,
  };
  assert.equal((await manager.handleUserScriptMessage(reportWithCapability, sender)).ok, true);

  await manager.handleUserScriptMessage({
    ...activityRequest(manager, 'log.write', { level: 'info', args: [capabilityB] }, 'capability-log'),
  }, sender);
  await manager.handleUserScriptMessage(activityRequest(manager, 'net.fetch', {
    url: `https://api.example.net/data?token=${capabilityB}`,
  }, 'capability-network'), sender);
  manager.recordActivityError('sample-activity', sender, 'test_error', `error ${capabilityB}`);
  const publicState = JSON.stringify({ installed: await manager.listInstalled(), status: await manager.status() });
  assert.equal(publicState.includes(capabilityB), false);
  assert.equal(JSON.stringify(reports).includes(capabilityB), false);
  const installed = (await manager.listInstalled())[0];
  assert.equal(installed.lastError.message, 'error [redacted capability]');
  assert.equal(installed.rawReport.media.title, '[redacted capability]');
  assert.equal(installed.normalizedReport.media.title, '[redacted capability]');
  assert.equal(installed.activityLogs[0].args[0], '[redacted capability]');
  assert.equal(installed.networkRequests[0].activityId, 'sample-activity');
});

test('restores Chromium user-script registrations through the extension update event after a cold worker start', async () => {
  const fake = createFakeApi();
  const firstWorker = new ActivityManager({ api: fake.api });
  const current = activityPackage();
  await firstWorker.install(current);
  const upgrade = activityPackage();
  upgrade.metadata.version = '1.1.0';
  await firstWorker.install(upgrade);
  const activeCapability = fake.data.installedActivities['sample-activity'].capability;

  const disabled = activityPackage();
  disabled.metadata.id = 'disabled-activity';
  disabled.metadata.name = 'Disabled Activity';
  await firstWorker.install(disabled);
  await firstWorker.setEnabled('disabled-activity', false);

  const permissionLost = activityPackage();
  permissionLost.metadata.id = 'permission-lost-activity';
  permissionLost.metadata.name = 'Permission Lost Activity';
  permissionLost.metadata.matches = ['https://missing.example/*'];
  fake.permissions.add('https://missing.example/*');
  await firstWorker.install(permissionLost);
  fake.permissions.delete('https://missing.example/*');
  const disabledCapability = fake.data.installedActivities['disabled-activity'].capability;
  const permissionLostCapability = fake.data.installedActivities['permission-lost-activity'].capability;

  fake.scripts.clear(); // Chrome removes registered user scripts during an extension update.
  const coldWorker = new ActivityManager({ api: fake.api });
  const installEvents = [];
  registerActivityRestoreHandlers({
    runtime: fake.api.runtime,
    manager: coldWorker,
    beforeInstallRestore: async (details) => installEvents.push(details.reason),
  });
  await fake.api.runtime.onInstalled.dispatch({ reason: 'update' });

  assert.deepEqual(installEvents, ['update']);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal(fake.scripts.has('chudpresence-activity-disabled-activity'), false);
  assert.equal(fake.scripts.has('chudpresence-activity-permission-lost-activity'), false);
  assert.equal(fake.data.installedActivities['sample-activity'].capability, activeCapability);
  assert.match(fake.data.installedActivities['sample-activity'].capability, /^[a-f0-9]{64}$/);
  assert.match(fake.scripts.get('chudpresence-activity-sample-activity').js[0].code,
    new RegExp(fake.data.installedActivities['sample-activity'].capability));
  assert.equal(fake.data.installedActivities['disabled-activity'].capability, disabledCapability);
  assert.equal(fake.data.installedActivities['permission-lost-activity'].capability, permissionLostCapability);
  assert.deepEqual((await coldWorker.get('sample-activity')).pendingUpgrade, {
    fromVersion: '1.0.0', toVersion: '1.1.0',
  });
  const installed = await coldWorker.listInstalled();
  assert.equal(installed.find((record) => record.id === 'disabled-activity').status, 'disabled');
  assert.equal(installed.find((record) => record.id === 'permission-lost-activity').status, 'permission-missing');

  fake.scripts.clear();
  await fake.api.runtime.onStartup.dispatch();
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal(fake.scripts.has('chudpresence-activity-disabled-activity'), false);
});

test('executes page functions in the requesting Activity document and serializes results', async () => {
  const fake = createFakeApi();
  assert.equal(fake.api.scripting, undefined);
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  activity.metadata.matches.push('https://discord.com/*');
  fake.permissions.add('https://discord.com/*');
  await manager.install(activity);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 12 }, frameId: 2, documentId: 'doc-a', url: 'https://example.com/watch/1',
  };
  const request = activityRequest(manager, 'page.execute', {
    source: '(...args) => [window.someApplicationState, args, 7, null]',
    argsJson: '["from activity", {"enabled":true}]',
  }, 'page-call');
  request.payload.activityId = 'also-spoofed';
  assert.deepEqual(await manager.handleUserScriptMessage(request, sender), {
    ok: true,
    requestId: 'page-call',
    data: { value: [{ title: 'Page-owned title', count: 3 }, ['from activity', { enabled: true }], 7, null] },
  });
  assert.deepEqual(fake.pageExecutions[0].target, { tabId: 12, documentIds: ['doc-a'] });
  assert.equal(fake.pageExecutions[0].world, 'MAIN');

  assert.deepEqual(await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => window.someApplicationState.title', argsJson: '[]',
  }, 'primitive-result'), sender), {
    ok: true, requestId: 'primitive-result', data: { value: 'Page-owned title' },
  });
  assert.deepEqual(await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => { throw new TypeError("page exploded"); }', argsJson: '[]',
  }, 'thrown-error'), sender), {
    ok: false,
    requestId: 'thrown-error',
    error: { code: 'page_execution_error', name: 'TypeError', message: 'page exploded' },
  });

  const oversizedCode = await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: `() => ${' '.repeat(16_385)}`, argsJson: '[]',
  }, 'oversized-code'), sender);
  assert.equal(oversizedCode.error.code, 'invalid_page_request');
  const oversizedArguments = await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => 1', argsJson: JSON.stringify(['x'.repeat(16_385)]),
  }, 'oversized-arguments'), sender);
  assert.equal(oversizedArguments.error.code, 'invalid_page_request');
  const malformedArguments = await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => 1', argsJson: '[',
  }, 'malformed-arguments'), sender);
  assert.equal(malformedArguments.error.code, 'invalid_page_request');

  fake.setNextPageExecutionResults([{ documentId: 'doc-a', frameId: 2, result: 'not-json' }]);
  const malformedResult = await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => 1', argsJson: '[]',
  }, 'malformed-result'), sender);
  assert.equal(malformedResult.error.code, 'invalid_page_result');
  fake.setNextPageExecutionResults([{ documentId: 'doc-a', frameId: 2, result: 'x'.repeat(66_000) }]);
  const oversizedResult = await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => 1', argsJson: '[]',
  }, 'oversized-result'), sender);
  assert.equal(oversizedResult.error.code, 'invalid_page_result');

  const injectionCount = fake.pageExecutions.length;
  assert.equal(await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => 1', argsJson: '[]',
  }), { ...sender, userScriptWorldId: 'chudpresence.activity.other-activity' }), false);
  assert.equal(fake.pageExecutions.length, injectionCount);

  const protectedResult = await manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => window.localStorage', argsJson: '[]',
  }, 'protected-page'), { ...sender, url: 'https://discord.com/channels/1/2' });
  assert.deepEqual(protectedResult, {
    ok: false,
    requestId: 'protected-page',
    error: { code: 'protected_page', message: 'Page execution is unavailable on protected pages.' },
  });
  assert.equal(fake.pageExecutions.length, injectionCount);

  let finishExecution;
  fake.setNextPageExecutionResults(new Promise((resolve) => { finishExecution = resolve; }));
  const navigationPending = manager.handleUserScriptMessage(activityRequest(manager, 'page.execute', {
    source: '() => 1', argsJson: '[]',
  }, 'navigation-pending'), sender);
  await Promise.resolve();
  finishExecution([{ documentId: 'doc-after-navigation', frameId: 2, result: '{"ok":true,"value":1}' }]);
  assert.deepEqual(await navigationPending, {
    ok: false,
    requestId: 'navigation-pending',
    error: { code: 'stale_document', message: 'The page navigated while execution was pending.' },
  });
});

test('brokers allowlisted cross-origin requests without credentials and records Activity identity', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.net/v1/*');
  let capturedUrl = '';
  let capturedOptions;
  fake.setFetchImplementation(async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response('{"items":[1,2]}', {
      status: 201,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  });
  const manager = new ActivityManager({ api: fake.api, fetchImpl: fake.fetchImpl });
  const activity = activityPackage();
  activity.metadata.network = ['https://api.example.net/v1/*'];
  await manager.install(activity);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 27 }, frameId: 3, documentId: 'network-document',
    url: 'https://example.com/watch/1?session=sensitive',
  };
  const request = activityRequest(manager, 'net.fetch', {
    url: 'https://api.example.net/v1/items?token=private',
    options: {
      method: 'POST',
      headers: { Authorization: 'Activity-owned-key' },
      json: { query: 'latest' },
    },
  }, 'network-call');
  assert.deepEqual(await manager.handleUserScriptMessage(request, sender), {
    ok: true,
    requestId: 'network-call',
    data: {
      status: 201,
      ok: true,
      contentType: 'application/json; charset=utf-8',
      data: { items: [1, 2] },
    },
  });
  assert.equal(capturedUrl, 'https://api.example.net/v1/items?token=private');
  assert.equal(capturedOptions.method, 'POST');
  assert.deepEqual(capturedOptions.headers, {
    Authorization: 'Activity-owned-key',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  assert.equal(capturedOptions.body, '{"query":"latest"}');
  assert.equal(capturedOptions.credentials, 'omit');
  assert.equal(capturedOptions.redirect, 'error');
  assert.equal(capturedOptions.referrerPolicy, 'no-referrer');
  const diagnostic = (await manager.listInstalled())[0].networkRequests[0];
  assert.equal(diagnostic.activityId, 'sample-activity');
  assert.equal(diagnostic.activityName, 'Sample Activity');
  assert.equal(diagnostic.tabId, 27);
  assert.equal(diagnostic.frameId, 3);
  assert.equal(diagnostic.documentId, 'network-document');
  assert.equal(diagnostic.senderUrl, 'https://example.com/watch/1');
  assert.equal(diagnostic.url, 'https://api.example.net/v1/items');
  assert.equal(diagnostic.state, 'complete');
  assert.equal(diagnostic.status, 201);
});

test('restricts network URLs, response size, and timeout', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.net/*');
  fake.permissions.add('https://missing.api.example.net/*');
  const manager = new ActivityManager({ api: fake.api, fetchImpl: fake.fetchImpl });
  const activity = activityPackage();
  activity.metadata.network = ['https://api.example.net/*', 'https://missing.api.example.net/*'];
  await manager.install(activity);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 28 }, frameId: 0, documentId: 'network-document', url: 'https://example.com/watch/1',
  };
  const request = (url, options = {}, requestId = 'network-error') =>
    manager.handleUserScriptMessage(activityRequest(manager, 'net.fetch', { url, options }, requestId), sender);

  assert.deepEqual(await request('http://api.example.net/data'), {
    ok: false, requestId: 'network-error',
    error: { code: 'invalid_url', name: 'TypeError', message: 'Network URLs must be HTTPS and cannot contain credentials or fragments.' },
  });
  assert.deepEqual(await request('https://unlisted.example.org/data', {}, 'unlisted-origin'), {
    ok: false, requestId: 'unlisted-origin',
    error: { code: 'origin_not_declared', name: 'TypeError', message: 'This network origin is not declared in the Activity metadata.' },
  });
  assert.deepEqual(await request('https://discord.com/api/users/@me', {}, 'discord-endpoint'), {
    ok: false, requestId: 'discord-endpoint',
    error: { code: 'protected_endpoint', name: 'TypeError', message: 'Discord network endpoints are reserved for extension core.' },
  });
  assert.equal((await request('https://api.example.net/data', { method: 'PATCH' }, 'unsupported-method')).error.code,
    'invalid_method');
  for (const [header, value] of [
    ['Cookie', 'session=secret'], ['Host', 'attacker.example'], ['Origin', 'https://attacker.example'],
    ['Referer', 'https://attacker.example/'], ['Cookie2', 'legacy=secret'],
    ['Sec-Fetch-Site', 'cross-site'], ['Proxy-Authorization', 'secret'],
  ]) {
    const rejected = await request('https://api.example.net/data', { headers: { [header]: value } }, `blocked-${header}`);
    assert.equal(rejected.ok, false, `${header} should be rejected`);
    assert.equal(rejected.error.code, 'invalid_headers', `${header} should be rejected`);
  }
  assert.equal((await request('https://api.example.net/data', {
    method: 'POST', body: 'x'.repeat(64 * 1024 + 1),
  }, 'oversized-request-body')).error.code, 'request_body_too_large');
  assert.equal((await request('https://api.example.net/data', { timeoutMs: 99 }, 'invalid-timeout')).error.code,
    'invalid_timeout');

  fake.setFetchImplementation(async () => new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }));
  const oversized = await request('https://api.example.net/data', { responseType: 'text' }, 'oversized-response');
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.code, 'response_too_large');

  fake.setFetchImplementation(async () => new Response('not-json', { status: 200 }));
  const invalidJson = await request('https://api.example.net/data', {}, 'invalid-json');
  assert.equal(invalidJson.ok, false);
  assert.equal(invalidJson.error.code, 'invalid_json_response');

  fake.setFetchImplementation(async (_url, options) => {
    assert.equal(options.redirect, 'error');
    throw new TypeError('Redirect was rejected.');
  });
  const redirected = await request('https://api.example.net/redirect', {}, 'redirected-request');
  assert.equal(redirected.ok, false);
  assert.equal(redirected.error.code, 'network_error');

  fake.permissions.delete('https://missing.api.example.net/*');
  const missingPermission = await request('https://missing.api.example.net/v1/data', {}, 'missing-host-permission');
  assert.equal(missingPermission.ok, false);
  assert.equal(missingPermission.error.code, 'host_permission_missing');

  let capturedSignal;
  fake.setFetchImplementation((_url, options) => {
    capturedSignal = options.signal;
    return new Promise(() => {});
  });
  const timedOut = await request('https://api.example.net/slow', { timeoutMs: 100 }, 'timed-out');
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.code, 'timeout');
  assert.equal(capturedSignal.aborted, true);
  const diagnostic = (await manager.listInstalled())[0].networkRequests;
  assert.equal(diagnostic.find((item) => item.requestId === 'oversized-response').errorCode, 'response_too_large');
  assert.equal(diagnostic.find((item) => item.requestId === 'timed-out').errorCode, 'timeout');
});

test('limits concurrent network work per Activity', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.net/*');
  const pendingFetches = [];
  fake.setFetchImplementation(() => new Promise((resolve) => pendingFetches.push(resolve)));
  const manager = new ActivityManager({ api: fake.api, fetchImpl: fake.fetchImpl });
  const activity = activityPackage();
  activity.metadata.network = ['https://api.example.net/*'];
  await manager.install(activity);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 29 }, frameId: 0, documentId: 'network-document', url: 'https://example.com/watch/1',
  };
  const request = (requestId) => manager.handleUserScriptMessage(activityRequest(manager, 'net.fetch', {
    url: 'https://api.example.net/data',
  }, requestId), sender);
  const first = request('concurrent-1');
  await new Promise((resolve) => setImmediate(resolve));
  const second = request('concurrent-2');
  await new Promise((resolve) => setImmediate(resolve));
  const third = await request('concurrent-3');
  assert.equal(pendingFetches.length, 2);
  assert.equal(third.error.code, 'network_busy');
  for (const resolve of pendingFetches) resolve(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
});

test('enforces the global network concurrency limit across Activities', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.net/*');
  const pendingFetches = [];
  fake.setFetchImplementation(() => new Promise((resolve) => pendingFetches.push(resolve)));
  const manager = new ActivityManager({ api: fake.api, fetchImpl: fake.fetchImpl });
  for (const id of ['sample-activity', 'second-activity', 'third-activity']) {
    const activity = activityPackage();
    activity.metadata.id = id;
    activity.metadata.name = id;
    activity.metadata.network = ['https://api.example.net/*'];
    await manager.install(activity);
  }
  const request = (activityId, requestId) => manager.handleUserScriptMessage(
    activityRequest(manager, 'net.fetch', { url: 'https://api.example.net/data' }, requestId, activityId),
    {
      userScriptWorldId: `chudpresence.activity.${activityId}`,
      tab: { id: 80 + ['sample-activity', 'second-activity', 'third-activity'].indexOf(activityId) },
      frameId: 0, documentId: `${activityId}-${requestId}`, url: 'https://example.com/watch',
    },
  );

  const firstFour = [
    request('sample-activity', 'global-1'),
    request('sample-activity', 'global-2'),
    request('second-activity', 'global-3'),
    request('third-activity', 'global-4'),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingFetches.length, 4);
  const blocked = await request('second-activity', 'global-5');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'network_busy');
  assert.equal(pendingFetches.length, 4);

  for (const resolve of pendingFetches) {
    resolve(new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  }
  assert.equal((await Promise.all(firstFour)).every((result) => result.ok), true);
  assert.equal(manager.networkDiagnostics.length, 5);
});

test('returns structured errors for invalid reports and unsupported runtime requests', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 5 }, documentId: 'doc-a', url: 'https://example.com/watch/1',
  };
  assert.deepEqual(await manager.handleUserScriptMessage(
    activityRequest(manager, 'presence.report', { report: { kind: 'video', media: { title: 'Bad' }, source: 'spoof' } }, 'bad-report'),
    sender,
  ), {
    ok: false,
    requestId: 'bad-report',
    error: { code: 'invalid_report', message: 'Activity report contains unsupported field source.' },
  });
  assert.deepEqual(await manager.handleUserScriptMessage(
    activityRequest(manager, 'storage.get', { key: 'secret' }, 'unknown-request'),
    sender,
  ), {
    ok: true,
    requestId: 'unknown-request',
    data: { value: null },
  });
  assert.deepEqual(await manager.handleUserScriptMessage(
    activityRequest(manager, 'unsupported.operation', {}, 'unsupported-request'),
    sender,
  ), {
    ok: false,
    requestId: 'unsupported-request',
    error: { code: 'unsupported_operation', message: 'This Activity runtime operation is not supported.' },
  });
});

test('normalizes every supported report kind and the full playback, display, artwork and media contract', async () => {
  const fake = createFakeApi();
  const reports = [];
  const manager = new ActivityManager({ api: fake.api, onReport: (value) => reports.push(value) });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 91 }, frameId: 0, documentId: 'report-contract-document', url: 'https://example.com/watch',
  };
  for (const kind of ['video', 'movie', 'episode', 'song', 'stream', 'game', 'generic']) {
    const result = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
      report: { kind, media: { title: `A ${kind}` } },
    }, `kind-${kind}`), sender);
    assert.equal(result.data.accepted, true);
  }

  const detailed = {
    kind: 'episode',
    media: {
      title: 'Episode title', subtitle: 'Episode subtitle', artist: 'Artist', album: 'Album',
      series: 'Series', season: 2, episode: 4, creator: 'Creator', channel: 'Channel',
      category: 'Drama', game: 'Game', playlist: 'Playlist',
    },
    playback: { state: 'paused', position: 12.5, duration: 1800, live: false, rate: 1.25 },
    display: { details: 'Custom details', state: 'Custom state', statusDisplay: 'state' },
    artwork: {
      large: 'https://cdn.example.com/large.png', largeText: 'Large art',
      small: 'https://cdn.example.com/small.png', smallText: 'Small art',
    },
    buttons: [
      { label: 'Open', url: 'https://example.com/open' },
      { label: 'Queue', url: 'https://example.com/queue' },
    ],
    visibility: 'private',
  };
  const detailedResult = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: detailed,
  }, 'full-report-contract'), sender);
  assert.equal(detailedResult.data.accepted, true);
  assert.deepEqual(reports.at(-1).track, {
    ...detailed,
    source: 'activity',
    activityId: 'sample-activity',
    activityName: 'Sample Activity',
    activityCategory: 'other',
    activityVersion: '1.0.0',
  });

  const oversized = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: { kind: 'video', media: { title: 'x'.repeat(16 * 1024) } },
  }, 'oversized-report'), sender);
  assert.equal(oversized.ok, false);
  assert.equal(oversized.error.code, 'invalid_report');
  const invalidPlayback = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: { kind: 'video', media: { title: 'Bad playback' }, playback: { state: 'buffering' } },
  }, 'invalid-playback-state'), sender);
  assert.equal(invalidPlayback.ok, false);
  assert.equal(invalidPlayback.error.code, 'invalid_report');
});

test('rate limits excessive Activity runtime requests and keeps normal reporting functional', async () => {
  const fake = createFakeApi();
  const reports = [];
  const manager = new ActivityManager({ api: fake.api, onReport: (value) => reports.push(value) });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 89 }, frameId: 0, documentId: 'rate-limited-document', url: 'https://example.com/watch',
  };

  let last;
  for (let index = 0; index < 31; index += 1) {
    last = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
      report: activityReport(`Report ${index}`),
    }, `rate-${index}`), sender);
    if (index < 30) assert.equal(last.ok, true);
  }
  assert.equal(last.ok, false);
  assert.equal(last.error.code, 'rate_limited');
  assert.equal(reports.length, 30);

  const normal = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Normal tab'),
  }, 'rate-normal-tab'), { ...sender, tab: { id: 90 }, documentId: 'normal-document' });
  assert.equal(normal.ok, true);
  assert.equal(reports.at(-1).track.media.title, 'Normal tab');
});

test('isolates Activity storage and preserves it across updates while removing it on uninstall', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const activityA = activityPackage();
  const activityB = activityPackage();
  activityB.metadata.id = 'other-activity';
  activityB.metadata.name = 'Other Activity';
  await manager.install(activityA);
  await manager.install(activityB);
  const sender = (id) => ({
    userScriptWorldId: `chudpresence.activity.${id}`,
    tab: { id: 51 }, frameId: 0, documentId: `${id}-document`, url: 'https://example.com/watch/1',
  });
  const request = (activityId, operation, payload = {}, requestId = `${activityId}-${operation}`) =>
    manager.handleUserScriptMessage(activityRequest(manager, operation, payload, requestId, activityId), sender(activityId));

  assert.deepEqual(await request('sample-activity', 'storage.set', { key: 'token', value: { choice: 'A' } }), {
    ok: true, requestId: 'sample-activity-storage.set', data: { value: true },
  });
  assert.deepEqual(await request('sample-activity', 'storage.get', { key: 'token' }), {
    ok: true, requestId: 'sample-activity-storage.get', data: { value: { choice: 'A' } },
  });
  await request('other-activity', 'storage.set', { key: 'token', value: { choice: 'B' } });
  assert.deepEqual(await request('other-activity', 'storage.get', { key: 'token' }), {
    ok: true, requestId: 'other-activity-storage.get', data: { value: { choice: 'B' } },
  });

  const spoofed = await request('sample-activity', 'storage.set', {
    activityId: 'other-activity', key: 'token', value: 'still A',
  }, 'spoofed-storage-identity');
  assert.equal(spoofed.ok, true);
  assert.deepEqual((await request('other-activity', 'storage.get', { key: 'token' })).data.value, { choice: 'B' });

  const updated = activityPackage();
  updated.metadata.version = '1.1.0';
  await manager.install(updated);
  assert.deepEqual((await request('sample-activity', 'storage.get', { key: 'token' })).data.value, 'still A');

  assert.equal((await request('sample-activity', 'storage.remove', { key: 'token' })).data.value, true);
  assert.equal((await request('sample-activity', 'storage.remove', { key: 'token' })).data.value, false);
  await request('sample-activity', 'storage.set', { key: 'one', value: 1 });
  await request('sample-activity', 'storage.set', { key: 'two', value: 2 });
  assert.equal((await request('sample-activity', 'storage.clear')).data.value, 2);
  assert.equal((await request('sample-activity', 'storage.clear')).data.value, 0);
  await request('sample-activity', 'storage.set', { key: 'kept-until-uninstall', value: true });

  await manager.remove('sample-activity');
  assert.equal(Object.keys(fake.data).some((key) => key.startsWith('chudpresence.activityStorage:sample-activity:')), false);
  assert.deepEqual((await request('other-activity', 'storage.get', { key: 'token' })).data.value, { choice: 'B' });
  await manager.remove('other-activity');
  assert.equal(Object.keys(fake.data).some((key) => key.startsWith('chudpresence.activityStorage:other-activity:')), false);
});

test('enforces per-Activity storage quota and returns structured storage failures', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 52 }, frameId: 0, documentId: 'storage-document', url: 'https://example.com/watch/1',
  };
  const request = (operation, payload, requestId) => manager.handleUserScriptMessage(
    activityRequest(manager, operation, payload, requestId), sender,
  );

  const tooLarge = await request('storage.set', { key: 'large', value: 'x'.repeat(70 * 1024) }, 'over-quota');
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.error.code, 'storage_quota_exceeded');
  assert.equal((await request('storage.get', { key: 'large' }, 'large-read')).data.value, null);

  fake.failNextWrite();
  const failedWrite = await request('storage.set', { key: 'write-fails', value: 'value' }, 'storage-write-failure');
  assert.deepEqual(failedWrite, {
    ok: false,
    requestId: 'storage-write-failure',
    error: { code: 'storage_error', name: 'Error', message: 'Simulated storage failure' },
  });

  const invalidKey = await request('storage.get', { key: '\ud800' }, 'invalid-storage-key');
  assert.equal(invalidKey.ok, false);
  assert.equal(invalidKey.error.code, 'invalid_storage_key');
  assert.equal((await request('storage.get', { key: 'k'.repeat(129) }, 'oversized-storage-key')).error.code,
    'invalid_storage_key');
  assert.equal((await request('storage.set', { key: 'not-json', value: undefined }, 'non-json-storage-value')).error.code,
    'invalid_storage_value');
});

test('records report lifecycle diagnostics and bounds Activity logs', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 53 }, frameId: 0, documentId: 'diagnostic-document', url: 'https://example.com/watch?token=hidden',
  };
  const report = activityReport('access_token=should-not-be-visible');
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report }, 'diagnostic-report'), sender);
  let installed = (await manager.listInstalled())[0];
  assert.match(installed.rawReport.media.title, /\[redacted\]/);
  assert.match(installed.normalizedReport.media.title, /\[redacted\]/);
  assert.equal(installed.lastReport.senderUrl, 'https://example.com/watch');
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: { kind: 'unknown' } }, 'diagnostic-error'), sender);
  installed = (await manager.listInstalled())[0];
  assert.equal(installed.lastError.code, 'invalid_report');
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.clear', {}, 'diagnostic-clear'), sender);
  installed = (await manager.listInstalled())[0];
  assert.equal(installed.lastClear.reason, 'cleared');

  for (let index = 0; index < 205; index += 1) {
    await manager.handleUserScriptMessage(activityRequest(manager, 'log.write', {
      level: 'debug', args: [`entry-${index}`],
    }, `log-${index}`), {
      ...sender,
      tab: { id: 1000 + index },
      documentId: `log-document-${index}`,
    });
  }
  assert.equal(manager.activityLogs.length, 200);
  installed = (await manager.listInstalled())[0];
  assert.equal(installed.activityLogs.length, 10);
  assert.equal(installed.activityLogs[0].args[0], 'entry-195');
  assert.equal(installed.activityLogs.at(-1).args[0], 'entry-204');
  const invalidLevel = await manager.handleUserScriptMessage(activityRequest(manager, 'log.write', {
    level: 'trace', args: ['bad level'],
  }, 'invalid-log-level'), sender);
  assert.equal(invalidLevel.ok, false);
  assert.equal(invalidLevel.error.code, 'invalid_log_entry');
  const tooManyLogValues = await manager.handleUserScriptMessage(activityRequest(manager, 'log.write', {
    level: 'info', args: Array.from({ length: 9 }, (_, index) => index),
  }, 'too-many-log-values'), sender);
  assert.equal(tooManyLogValues.error.code, 'invalid_log_entry');
  const oversizedLog = await manager.handleUserScriptMessage(activityRequest(manager, 'log.write', {
    level: 'info', args: ['x'.repeat(4097)],
  }, 'oversized-log'), sender);
  assert.equal(oversizedLog.error.code, 'log_entry_too_large');
  const state = await manager.status();
  assert.deepEqual(state.grantedOrigins, ['https://example.com/*']);
});

test('reloads an installed Activity in its active Chrome document without restarting the service worker', async () => {
  const fake = createFakeApi();
  const cleared = [];
  const manager = new ActivityManager({ api: fake.api, onClear: (...args) => cleared.push(args) });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 54 }, frameId: 0, documentId: 'reload-document', url: 'https://example.com/watch',
  };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }), sender);
  await connectActivity(fake, manager, sender);
  const result = await manager.reload('sample-activity');
  assert.deepEqual(result, { id: 'sample-activity', reloadedFrames: 1 });
  const injection = fake.pageExecutions.at(-1);
  assert.equal(injection.world, 'USER_SCRIPT');
  assert.equal(injection.worldId, 'chudpresence.activity.sample-activity');
  assert.deepEqual(injection.target, { tabId: 54, documentIds: ['reload-document'] });
  assert.equal(fake.sentMessages.at(-1).message.reason, 'reloaded');
  assert.equal(cleared.length, 1);
  const resumedReport = await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Reloaded in the same document'),
  }, 'same-document-after-reload'), sender);
  assert.equal(resumedReport.data.accepted, true);
  assert.equal((await manager.listInstalled())[0].activeFrames[0].documentId, 'reload-document');
});

test('marks installed Activities that need a newer extension as incompatible', async () => {
  const fake = createFakeApi();
  const activity = activityPackage();
  activity.metadata.minExtensionVersion = '1.12.0';
  await fake.api.storage.local.set({
    installedActivities: {
      'sample-activity': {
        metadata: activity.metadata,
        code: activity.source,
        enabled: true,
        source: { type: 'repository' },
      },
    },
  });
  const manager = new ActivityManager({ api: fake.api });
  await manager.restoreAll();
  const [record] = await manager.listInstalled();
  assert.equal(record.status, 'incompatible');
  assert.equal(record.compatibilityStatus, 'Requires ChudPresence v1.12.0 or newer');
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), false);
});

test('stores immutable repository provenance after rechecking package hashes', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  const metadataSource = JSON.stringify(activity.metadata);
  const hash = async (value) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const provenance = {
    repository: 'ChudForks/ChudPresence-Activities',
    revision: 'c'.repeat(40),
    codeSha256: await hash(activity.source),
    metadataSha256: await hash(metadataSource),
  };
  await manager.install({ ...activity, metadataSource, sourceType: 'repository', provenance });
  assert.deepEqual((await manager.get('sample-activity')).source, {
    type: 'repository', ...provenance,
  });
  await assert.rejects(manager.install({
    ...activity,
    metadataSource,
    sourceType: 'repository',
    provenance: { ...provenance, codeSha256: '0'.repeat(64) },
  }), /code no longer matches/);
});

test('ignores a delayed clear from an older document in the same tab', async () => {
  const fake = createFakeApi();
  const cleared = [];
  const manager = new ActivityManager({ api: fake.api, onClear: (...args) => cleared.push(args) });
  await manager.install(activityPackage());
  const baseSender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 9 },
    url: 'https://example.com/new-page',
  };
  const oldSender = { ...baseSender, url: 'https://example.com/old-page', documentId: 'old-document' };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Old page'),
  }, 'old-page-report'), oldSender);
  await manager.handleUserScriptMessage({
    ...activityRequest(manager, 'presence.report', { report: activityReport('Current page') }),
  }, { ...baseSender, documentId: 'new-document' });

  assert.deepEqual(await manager.handleUserScriptMessage(
    activityRequest(manager, 'presence.clear', {}, 'old-clear'),
    oldSender,
  ), { ok: true, requestId: 'old-clear', data: { cleared: false, stale: true } });
  assert.deepEqual(await manager.handleUserScriptMessage(
    activityRequest(manager, 'presence.report', { report: activityReport('Delayed old report') }, 'old-report'),
    oldSender,
  ), {
    ok: false,
    requestId: 'old-report',
    error: { code: 'stale_document', message: 'This Activity document has already been replaced.' },
  });
  assert.equal((await manager.listInstalled())[0].status, 'detected');
  assert.equal((await manager.listInstalled())[0].lastReport.documentId, 'new-document');
  assert.deepEqual(cleared, [['sample-activity', 9, 'old-document', 0]]);

  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.clear', {}, 'new-clear'), {
    ...baseSender,
    documentId: 'new-document',
  });
  assert.equal((await manager.listInstalled())[0].status, 'waiting');
  assert.equal(cleared.length, 2);
  assert.deepEqual(cleared[1], ['sample-activity', 9, 'new-document', 0]);
});

test('supports top and embedded player frames and rejects reports from replaced child documents', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://player.example.com/*');
  const reports = [];
  const clears = [];
  const manager = new ActivityManager({
    api: fake.api,
    onReport: (report) => reports.push(report),
    onClear: (...args) => clears.push(args),
  });
  const activity = activityPackage();
  activity.metadata.matches.push('https://player.example.com/*');
  activity.metadata.frames = 'all';
  await manager.install(activity);
  const registered = fake.scripts.get('chudpresence-activity-sample-activity');
  assert.equal(registered.allFrames, true);
  assert.deepEqual(registered.matches, ['https://example.com/*', 'https://player.example.com/*']);

  const topSender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 21 }, frameId: 0, documentId: 'top-document', url: 'https://example.com/watch/1',
  };
  const childSender = {
    ...topSender,
    frameId: 4,
    parentFrameId: 0,
    documentId: 'child-document-a',
    url: 'https://player.example.com/embed/1',
  };
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Parent service'),
  }), topSender)).data.accepted, true);
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Embedded playback'),
  }), childSender)).data.accepted, true);
  assert.equal(reports[1].frameId, 4);
  assert.equal(reports[1].parentFrameId, 0);
  assert.equal(reports[1].senderUrl, 'https://player.example.com/embed/1');
  assert.deepEqual((await manager.listInstalled())[0].activeFrames.map((frame) => frame.frameId).sort(), [0, 4]);
  assert.equal((await manager.listInstalled())[0].activeFrames.find((frame) => frame.frameId === 4).parentFrameId, 0);

  const replacementSender = { ...childSender, documentId: 'child-document-b' };
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Replacement playback'),
  }), replacementSender)).data.accepted, true);
  assert.deepEqual(clears[0], ['sample-activity', 21, 'child-document-a', 4]);

  assert.deepEqual(await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Late old playback'),
  }, 'late-report'), childSender), {
    ok: false,
    requestId: 'late-report',
    error: { code: 'stale_document', message: 'This Activity document has already been replaced.' },
  });
  assert.deepEqual(await manager.handleUserScriptMessage(activityRequest(manager, 'presence.clear', {}, 'late-clear'), childSender), {
    ok: true,
    requestId: 'late-clear',
    data: { cleared: false, stale: true },
  });
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.clear', {}, 'current-clear'), replacementSender)).data.cleared, true);
  assert.equal((await manager.listInstalled())[0].status, 'detected');

  const childAfterParentNavigation = { ...childSender, documentId: 'child-document-c' };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Child before parent navigation'),
  }), childAfterParentNavigation);
  const nextTopSender = { ...topSender, documentId: 'top-document-next' };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Next parent page'),
  }), nextTopSender);
  const status = (await manager.listInstalled())[0];
  assert.deepEqual(status.activeFrames.map((frame) => frame.frameId), [0]);
  const retiredChild = status.frameContexts.find((frame) => frame.frameId === 4);
  assert.equal(retiredChild.state, 'retired');
  assert.equal(retiredChild.documentId, 'child-document-c');
  assert.deepEqual(retiredChild.retiredDocumentIds, ['child-document-c']);
  assert.deepEqual(await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Late child from old parent'),
  }, 'late-parent-child'), childAfterParentNavigation), {
    ok: false,
    requestId: 'late-parent-child',
    error: { code: 'stale_document', message: 'This Activity document has already been replaced.' },
  });
});

test('tab navigation retires reports from every old Activity frame', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://player.example.com/*');
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  activity.metadata.matches.push('https://player.example.com/*');
  activity.metadata.frames = 'all';
  await manager.install(activity);
  const base = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 23 }, url: 'https://example.com/watch/1',
  };
  const top = { ...base, frameId: 0, documentId: 'tab-old-top' };
  const child = { ...base, frameId: 2, documentId: 'tab-old-child', url: 'https://player.example.com/embed/1' };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport('old top') }), top);
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport('old child') }), child);

  assert.equal(await manager.invalidateTab(23), 2);
  const status = (await manager.listInstalled())[0];
  assert.equal(status.status, 'waiting');
  assert.equal(status.frameContexts.filter((frame) => frame.state === 'retired').length, 2);
  assert.deepEqual(await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('late child'),
  }, 'late-tab-child'), child), {
    ok: false,
    requestId: 'late-tab-child',
    error: { code: 'stale_document', message: 'This Activity document has already been replaced.' },
  });
});

test('a queue-style YouTube Music URL update keeps the same document eligible to report', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://music.youtube.com/*');
  const reports = [];
  const manager = new ActivityManager({ api: fake.api, onReport: (report) => reports.push(report) });
  const activity = activityPackage();
  activity.metadata.matches = ['https://music.youtube.com/*'];
  await manager.install(activity);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 24 }, frameId: 0, documentId: 'same-document',
    url: 'https://music.youtube.com/watch?v=first',
  };
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('First track'),
  }), sender)).ok, true);

  // Chrome keeps History API URL changes in the same document.
  assert.equal(shouldInvalidateActivityTab({ url: 'https://music.youtube.com/watch?v=next' }), false);
  const nextSender = { ...sender, url: 'https://music.youtube.com/watch?v=next' };
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Next track'),
  }), nextSender)).ok, true);
  assert.equal(reports.at(-1).track.media.title, 'Next track');

  assert.equal(shouldInvalidateActivityTab({ status: 'loading', url: 'https://music.youtube.com/new-page' }), true);
  await manager.invalidateTab(24);
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Old document'),
  }), nextSender)).error.code, 'stale_document');
  assert.equal(shouldInvalidateActivityTab({ discarded: true }), true);
});

test('disable and remove unregister the script and update installed state', async () => {
  const fake = createFakeApi();
  const cleared = [];
  const manager = new ActivityManager({ api: fake.api, onClear: (id) => cleared.push(id) });
  await manager.install(activityPackage());

  await manager.setEnabled('sample-activity', false);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), false);
  assert.equal((await manager.listInstalled())[0].status, 'disabled');

  assert.equal(await manager.remove('sample-activity'), true);
  assert.equal((await manager.listInstalled()).length, 0);
  assert.deepEqual(cleared, ['sample-activity', 'sample-activity']);
});

test('disable, enable, permission loss, and uninstall preserve or remove Activity state as intended', async () => {
  const fake = createFakeApi();
  fake.permissions.add('https://api.example.net/*');
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  activity.metadata.network = ['https://api.example.net/*'];
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 88 }, frameId: 0, documentId: 'lifecycle-document', url: 'https://example.com/watch',
  };
  await manager.install(activity);
  const capability = fake.data.installedActivities['sample-activity'].capability;
  await manager.handleUserScriptMessage(activityRequest(manager, 'storage.set', {
    key: 'keep-until-uninstall', value: 'persisted',
  }, 'lifecycle-storage'), sender);
  await manager.handleUserScriptMessage(activityRequest(manager, 'log.write', {
    level: 'info', args: ['before disable'],
  }, 'lifecycle-log'), sender);
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Before disable'),
  }, 'lifecycle-report'), sender);
  await connectActivity(fake, manager, sender);

  await manager.setEnabled('sample-activity', false);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), false);
  assert.equal((await manager.listInstalled())[0].status, 'disabled');
  assert.equal(fake.sentMessages.at(-1).message.reason, 'disabled');
  assert.equal(await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Disabled'),
  }, 'disabled-report'), sender), false);
  assert.equal(fake.data['chudpresence.activityStorage:sample-activity:keep-until-uninstall'], 'persisted');

  await manager.setEnabled('sample-activity', true);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal(fake.data.installedActivities['sample-activity'].capability, capability);
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'storage.get', {
    key: 'keep-until-uninstall',
  }, 'enabled-storage'), sender)).data.value, 'persisted');

  await connectActivity(fake, manager, sender);
  fake.permissions.delete('https://example.com/*');
  await manager.restoreAll();
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), false);
  assert.equal((await manager.listInstalled())[0].status, 'permission-missing');
  assert.equal(fake.sentMessages.at(-1).message.reason, 'permission-lost');
  await assert.rejects(manager.setEnabled('sample-activity', true), /Grant every website and network permission/);

  fake.permissions.add('https://example.com/*');
  await manager.setEnabled('sample-activity', true);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal((await manager.listInstalled())[0].status, 'waiting');
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('After enable'),
  }, 'after-enable'), sender);
  await manager.handleUserScriptMessage(activityRequest(manager, 'log.write', {
    level: 'info', args: ['before uninstall'],
  }, 'pre-uninstall-log'), sender);
  assert.ok((await manager.listInstalled())[0].activityLogs.length);
  await connectActivity(fake, manager, sender);

  await manager.remove('sample-activity');
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), false);
  assert.equal((await manager.listInstalled()).length, 0);
  assert.equal(manager.activityLogs.some((entry) => entry.activityId === 'sample-activity'), false);
  assert.equal(manager.activityDiagnostics.has('sample-activity'), false);
  assert.equal(fake.data['chudpresence.activityStorage:sample-activity:keep-until-uninstall'], undefined);
  assert.equal(fake.permissions.has('https://example.com/*'), false);
  assert.equal(fake.permissions.has('https://api.example.net/*'), false);
  assert.equal(fake.sentMessages.at(-1).message.reason, 'uninstalled');
});

test('notifies active Activity documents before disable, update, and uninstall', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 6 }, frameId: 3, documentId: 'doc-a', url: 'https://example.com/watch/1',
  };
  await manager.install(activityPackage());
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }), sender);
  await connectActivity(fake, manager, sender);
  await manager.install(activityPackage());
  const updateNotice = fake.sentMessages.find((item) => item.message.reason === 'updated');
  assert.ok(updateNotice);
  assert.deepEqual(updateNotice.options, { documentId: 'doc-a' });
  assert.equal(fake.sentMessages.filter((item) => item.message.reason === 'updated').length, 1);

  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }, 'report-2'), sender);
  await connectActivity(fake, manager, sender);
  await manager.setEnabled('sample-activity', false);
  assert.equal(fake.sentMessages.at(-1).message.reason, 'disabled');

  await manager.setEnabled('sample-activity', true);
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }, 'report-3'), sender);
  await connectActivity(fake, manager, sender);
  await manager.remove('sample-activity');
  assert.equal(fake.sentMessages.at(-1).message.reason, 'uninstalled');
});

test('persists and lists per-Activity presence preferences', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());

  assert.deepEqual(manager.preferencesFor('sample-activity'), {
    showPaused: true,
    statusDisplay: 'app',
    showArtwork: true,
    showTimestamps: true,
    showButtons: true,
  });
  const saved = await manager.setPreferences('sample-activity', {
    showPaused: false,
    statusDisplay: 'track',
    showArtwork: false,
  });
  assert.deepEqual(saved.preferences, {
    showPaused: false,
    statusDisplay: 'track',
    showArtwork: false,
    showTimestamps: true,
    showButtons: true,
  });
  assert.deepEqual((await manager.listInstalled())[0].preferences, saved.preferences);
  assert.deepEqual(manager.preferencesFor('sample-activity'), saved.preferences);
});

test('persists declarative Activity settings, rejects invalid values, and defaults values invalid under a new schema', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  activity.metadata.settings = [
    { id: 'showAlbum', type: 'boolean', label: 'Show album', default: true },
    { id: 'displayMode', type: 'select', label: 'Display mode', default: 'artist', options: [
      { label: 'Artist', value: 'artist' }, { label: 'Album', value: 'album' },
    ] },
    { id: 'prefix', type: 'string', label: 'Prefix', default: '', maxLength: 20 },
    { id: 'volume', type: 'range', label: 'Volume', default: 50, min: 0, max: 100, step: 5 },
    { id: 'offset', type: 'number', label: 'Offset', default: 0, min: -10, max: 10 },
  ];
  await manager.install(activity);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 65 }, frameId: 0, documentId: 'settings-document', url: 'https://example.com/watch',
  };
  await connectActivity(fake, manager, sender);
  assert.deepEqual((await manager.listInstalled())[0].settingValues, {
    showAlbum: true, displayMode: 'artist', prefix: '', volume: 50, offset: 0,
  });

  await manager.setActivitySetting('sample-activity', 'showAlbum', false);
  assert.equal(fake.sentMessages.at(-1).message.type, 'CHUDPRESENCE_ACTIVITY_SETTINGS_CHANGED');
  assert.deepEqual(fake.sentMessages.at(-1).message.settings, {
    showAlbum: false, displayMode: 'artist', prefix: '', volume: 50, offset: 0,
  });
  await manager.setActivitySetting('sample-activity', 'displayMode', 'album');
  await manager.setActivitySetting('sample-activity', 'prefix', '♫ ');
  await manager.setActivitySetting('sample-activity', 'volume', 75);
  await manager.setActivitySetting('sample-activity', 'offset', -2.5);
  await assert.rejects(manager.setActivitySetting('sample-activity', 'displayMode', 'unknown'), /invalid/);
  await assert.rejects(manager.setActivitySetting('sample-activity', 'volume', 74), /invalid/);
  await assert.rejects(manager.setActivitySetting('sample-activity', 'prefix', 'x'.repeat(21)), /invalid/);
  assert.deepEqual(manager.settingsFor('sample-activity'), {
    showAlbum: false, displayMode: 'album', prefix: '♫ ', volume: 75, offset: -2.5,
  });

  const updated = structuredClone(activity);
  updated.metadata.version = '1.1.0';
  await manager.install(updated);
  assert.equal(manager.settingsFor('sample-activity').displayMode, 'album');
  updated.metadata.version = '1.2.0';
  updated.metadata.settings[1] = {
    id: 'displayMode', type: 'select', label: 'Display mode', default: 'artist',
    options: [{ label: 'Artist', value: 'artist' }, { label: 'Title', value: 'title' }],
  };
  await manager.install(updated);
  assert.equal(manager.settingsFor('sample-activity').displayMode, 'artist');
  assert.equal(manager.settingsFor('sample-activity').showAlbum, false);
});

test('runs one persisted upgrade transition after a version change and records migration failures', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 70 }, frameId: 0, documentId: 'upgrade-doc', url: 'https://example.com/watch',
  };
  await manager.install(activityPackage());
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }), sender);
  await connectActivity(fake, manager, sender);

  const updated = activityPackage();
  updated.metadata.version = '1.1.0';
  await manager.install(updated);
  assert.deepEqual((await manager.get('sample-activity')).pendingUpgrade, {
    fromVersion: '1.0.0', toVersion: '1.1.0',
  });

  const newSender = { ...sender, documentId: 'upgrade-doc-new' };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }, 'new-version-report'), newSender);
  await connectActivity(fake, manager, newSender, '1.1.0');
  const upgradeNotice = fake.sentMessages.find((item) => item.message.type === 'CHUDPRESENCE_ACTIVITY_UPGRADE');
  assert.ok(upgradeNotice);
  assert.deepEqual(upgradeNotice.message, {
    type: 'CHUDPRESENCE_ACTIVITY_UPGRADE', activityId: 'sample-activity', activityVersion: '1.1.0',
    fromVersion: '1.0.0', toVersion: '1.1.0',
  });
  assert.deepEqual(upgradeNotice.options, { documentId: 'upgrade-doc-new' });

  const failed = await manager.handleUserScriptMessage(activityRequest(manager, 'lifecycle.upgradeError', {
    fromVersion: '1.0.0', toVersion: '1.1.0', name: 'MigrationError', message: 'could not migrate key',
  }, 'migration-failed'), newSender);
  assert.equal(failed.ok, true);
  assert.deepEqual((await manager.listInstalled())[0].pendingUpgrade, { fromVersion: '1.0.0', toVersion: '1.1.0' });
  assert.equal((await manager.listInstalled())[0].lastError.code, 'upgrade_migration_failed');

  const completed = await manager.handleUserScriptMessage(activityRequest(manager, 'lifecycle.upgradeComplete', {
    fromVersion: '1.0.0', toVersion: '1.1.0',
  }, 'migration-complete'), newSender);
  assert.equal(completed.ok, true);
  assert.deepEqual(completed.data, { completed: true, pending: false });
  assert.equal((await manager.get('sample-activity')).pendingUpgrade, undefined);
  assert.equal((await manager.listInstalled())[0].lastUpgrade.status, 'completed');

  const restartedManager = new ActivityManager({ api: fake.api });
  await restartedManager.restoreAll();
  assert.equal((await restartedManager.get('sample-activity')).pendingUpgrade, undefined);
  assert.equal(fake.sentMessages.filter((item) => item.message.type === 'CHUDPRESENCE_ACTIVITY_UPGRADE').length, 1);
});

test('does not create or dispatch an upgrade transition during ordinary restart or same-version install', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const restartedManager = new ActivityManager({ api: fake.api });
  await restartedManager.restoreAll();
  const sameVersion = await restartedManager.install(activityPackage());
  assert.equal(sameVersion.version, '1.0.0');
  assert.equal((await restartedManager.get('sample-activity')).pendingUpgrade, undefined);
  await restartedManager.handleUserScriptMessage(activityRequest(restartedManager, 'presence.report', { report: activityReport() }), {
    userScriptWorldId: 'chudpresence.activity.sample-activity', tab: { id: 71 }, frameId: 0,
    documentId: 'restart-doc', url: 'https://example.com/watch',
  });
  assert.equal(fake.sentMessages.some((item) => item.message.type === 'CHUDPRESENCE_ACTIVITY_UPGRADE'), false);
});

test('stores and exposes an optional package-local service icon', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const icon = 'data:image/png;base64,iVBORw0KGgo=';
  const activity = activityPackage();
  activity.metadata.icon = 'icon.png';
  activity.icon = icon;

  await manager.install(activity);
  assert.equal((await manager.get('sample-activity')).icon, 'iVBORw0KGgo=');
  assert.equal((await manager.listInstalled())[0].icon, icon);
  await assert.rejects(manager.install({ ...activity, icon: 'data:image/svg+xml;base64,PHN2Zz4=' }), /base64 PNG/);
  await assert.rejects(manager.install({ ...activity, icon: undefined }), /supplied together/);
});

test('rejects unsupported per-Activity preferences without changing saved values', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const original = manager.preferencesFor('sample-activity');

  await assert.rejects(manager.setPreferences('sample-activity', { showArtwork: 'no' }), /showArtwork must be a boolean/);
  await assert.rejects(manager.setPreferences('sample-activity', { applicationId: 'custom' }), /Unsupported Activity preference/);
  assert.deepEqual(manager.preferencesFor('sample-activity'), original);
});

test('rolls back script registration and in-memory records if storage fails', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  fake.failNextWrite();

  await assert.rejects(manager.install(activityPackage()), /Simulated storage failure/);
  assert.equal(fake.scripts.size, 0);
  assert.deepEqual(await manager.listInstalled(), []);
});

test('restores the prior enabled script if saving a disable fails', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  await manager.install(activityPackage());
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 57 }, frameId: 0, documentId: 'disable-rollback-document', url: 'https://example.com/watch',
  };
  fake.failNextWrite();

  await assert.rejects(manager.setEnabled('sample-activity', false), /Simulated storage failure/);
  assert.equal(fake.scripts.has('chudpresence-activity-sample-activity'), true);
  assert.equal((await manager.listInstalled())[0].enabled, true);
  assert.equal((await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', {
    report: activityReport('Still enabled'),
  }, 'disable-rollback-report'), sender)).ok, true);
});

test('keeps the previous Activity operational when an update fails before commit', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const previous = activityPackage();
  previous.source = 'globalThis.__activityRevision = "old";';
  await manager.install(previous);
  const sender = {
    userScriptWorldId: 'chudpresence.activity.sample-activity',
    tab: { id: 58 }, frameId: 0, documentId: 'update-document', url: 'https://example.com/watch',
  };
  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport() }), sender);

  const changed = activityPackage();
  changed.metadata.version = '1.1.0';
  changed.source = 'globalThis.__activityRevision = "new";';
  fake.failNextScriptUpdate();
  await assert.rejects(manager.install(changed), /Simulated script update failure/);
  assert.equal((await manager.get('sample-activity')).code, previous.source);
  assert.match(fake.scripts.get('chudpresence-activity-sample-activity').js[0].code, /__activityRevision = "old"/);
  assert.equal(fake.pageExecutions.at(-1).world, 'USER_SCRIPT');

  await manager.handleUserScriptMessage(activityRequest(manager, 'presence.report', { report: activityReport('Old still running') }), sender);
  fake.failNextWrite();
  await assert.rejects(manager.install(changed), /Simulated storage failure/);
  assert.equal((await manager.get('sample-activity')).code, previous.source);
  assert.match(fake.scripts.get('chudpresence-activity-sample-activity').js[0].code, /__activityRevision = "old"/);
  const accepted = await manager.handleUserScriptMessage(
    activityRequest(manager, 'presence.report', { report: activityReport('Old is operational') }), sender,
  );
  assert.equal(accepted.ok, true);
});

test('removes host permissions made obsolete by a committed update', async () => {
  const fake = createFakeApi();
  const manager = new ActivityManager({ api: fake.api });
  const activity = activityPackage();
  await manager.install(activity);
  fake.permissions.add('https://new.example.net/*');
  const updated = activityPackage();
  updated.metadata.version = '1.1.0';
  updated.metadata.matches = ['https://new.example.net/*'];
  await manager.install(updated);
  assert.equal(fake.permissions.has('https://example.com/*'), false);
  assert.equal(fake.permissions.has('https://new.example.net/*'), true);
});
