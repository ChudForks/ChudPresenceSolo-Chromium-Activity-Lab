const PORT_NAME = 'discord-shutdown-cleanup';
const DELETE_ENDPOINT = 'https://discord.com/api/v10/users/@me/headless-sessions/delete';

let cleanupAbort = null;

function reply(port, requestId, result) {
  port.postMessage({ replyTo: requestId, ...result });
}

function disarm() {
  cleanupAbort?.abort();
  cleanupAbort = null;
}

function arm(accessToken, sessionToken) {
  if (typeof globalThis.fetchLater !== 'function') {
    return { ok: true, supported: false };
  }

  if (typeof accessToken !== 'string' || !accessToken || typeof sessionToken !== 'string' || !sessionToken) {
    return { ok: false, error: 'Missing Discord cleanup credentials.' };
  }

  const nextAbort = new AbortController();
  const body = new Blob([JSON.stringify({ token: sessionToken })], { type: 'application/json' });

  try {
    globalThis.fetchLater(DELETE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: nextAbort.signal,
    });
  } catch (error) {
    nextAbort.abort();
    return { ok: false, error: error?.message || 'Could not schedule Discord cleanup.' };
  }

  // Keep the previous request armed until its replacement is known to exist.
  cleanupAbort?.abort();
  cleanupAbort = nextAbort;
  return { ok: true, supported: true };
}

function connect() {
  const port = chrome.runtime.connect({ name: PORT_NAME });

  port.onMessage.addListener((message) => {
    const requestId = message?.requestId;
    if (!requestId) return;

    if (message.type === 'ARM') {
      reply(port, requestId, arm(message.accessToken, message.sessionToken));
      return;
    }

    if (message.type === 'DISARM') {
      disarm();
      reply(port, requestId, { ok: true, supported: typeof globalThis.fetchLater === 'function' });
    }
  });

  port.onDisconnect.addListener(() => {
    setTimeout(connect, 250);
  });
}

connect();
