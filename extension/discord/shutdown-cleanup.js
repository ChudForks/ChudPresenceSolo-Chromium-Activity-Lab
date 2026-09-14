const DOCUMENT_PATH = 'discord-cleanup.html';
const DOCUMENT_URL = chrome.runtime.getURL(DOCUMENT_PATH);
const PORT_NAME = 'discord-shutdown-cleanup';
const RESPONSE_TIMEOUT_MS = 3_000;

let cleanupPort = null;
let creatingDocument = null;
let nextRequestId = 1;
const connectionWaiters = new Set();
const pendingResponses = new Map();

function rejectPendingResponses(message) {
  for (const { reject, timer } of pendingResponses.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pendingResponses.clear();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME || port.sender?.url !== DOCUMENT_URL) return;

  cleanupPort = port;
  for (const resolve of connectionWaiters) resolve(port);
  connectionWaiters.clear();

  port.onMessage.addListener((message) => {
    const pending = pendingResponses.get(message?.replyTo);
    if (!pending) return;
    pendingResponses.delete(message.replyTo);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message);
    else pending.reject(new Error(message.error || 'Discord cleanup command failed.'));
  });

  port.onDisconnect.addListener(() => {
    if (cleanupPort !== port) return;
    cleanupPort = null;
    rejectPendingResponses('Discord cleanup document disconnected.');
  });
});

async function hasCleanupDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [DOCUMENT_URL],
  });
  return contexts.length > 0;
}

async function ensureCleanupDocument() {
  if (await hasCleanupDocument()) return;
  if (!creatingDocument) {
    creatingDocument = chrome.offscreen.createDocument({
      url: DOCUMENT_PATH,
      reasons: ['BLOBS'],
      justification: 'Keep a document-scoped deferred Discord cleanup request with a Blob request body.',
    }).finally(() => {
      creatingDocument = null;
    });
  }
  await creatingDocument;
}

function waitForCleanupPort() {
  if (cleanupPort) return Promise.resolve(cleanupPort);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      connectionWaiters.delete(onConnect);
      reject(new Error('Discord cleanup document did not connect.'));
    }, RESPONSE_TIMEOUT_MS);
    const onConnect = (port) => {
      clearTimeout(timer);
      resolve(port);
    };
    connectionWaiters.add(onConnect);
  });
}

async function sendCommand(command) {
  await ensureCleanupDocument();
  const port = await waitForCleanupPort();
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingResponses.delete(requestId);
      reject(new Error('Discord cleanup command timed out.'));
    }, RESPONSE_TIMEOUT_MS);
    pendingResponses.set(requestId, { resolve, reject, timer });
    try {
      port.postMessage({ ...command, requestId });
    } catch (error) {
      clearTimeout(timer);
      pendingResponses.delete(requestId);
      reject(error);
    }
  });
}

export async function armShutdownCleanup(accessToken, sessionToken) {
  const result = await sendCommand({ type: 'ARM', accessToken, sessionToken });
  if (!result.supported && await hasCleanupDocument()) {
    await chrome.offscreen.closeDocument();
  }
  return result.supported;
}

export async function disarmShutdownCleanup() {
  if (!await hasCleanupDocument()) return;
  try {
    await sendCommand({ type: 'DISARM' });
  } finally {
    if (await hasCleanupDocument()) await chrome.offscreen.closeDocument();
  }
}
