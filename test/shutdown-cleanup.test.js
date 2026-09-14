import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('keeps Discord shutdown credentials on the private offscreen port', async () => {
  const source = await readFile(new URL('../extension/discord-cleanup.js', import.meta.url), 'utf8');
  const messageListeners = [];
  const disconnectListeners = [];
  const replies = [];
  const requests = [];
  const port = {
    onMessage: { addListener(listener) { messageListeners.push(listener); } },
    onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
    postMessage(message) { replies.push(message); },
  };
  const chrome = {
    runtime: {
      connect({ name }) {
        assert.equal(name, 'discord-shutdown-cleanup');
        return port;
      },
    },
  };

  vm.runInNewContext(source, {
    AbortController,
    Blob,
    chrome,
    fetchLater(url, options) {
      requests.push({ url, options });
      return { activated: false };
    },
    setTimeout,
  });

  assert.equal(messageListeners.length, 1);
  messageListeners[0]({
    type: 'ARM',
    requestId: 1,
    accessToken: 'private-access-token',
    sessionToken: 'private-session-token',
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://discord.com/api/v10/users/@me/headless-sessions/delete');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer private-access-token');
  assert.deepEqual(JSON.parse(await requests[0].options.body.text()), { token: 'private-session-token' });
  assert.deepEqual({ ...replies[0] }, { replyTo: 1, ok: true, supported: true });

  messageListeners[0]({
    type: 'ARM',
    requestId: 2,
    accessToken: 'new-access-token',
    sessionToken: 'new-session-token',
  });
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(requests[1].options.signal.aborted, false);

  messageListeners[0]({ type: 'DISARM', requestId: 3 });
  assert.equal(requests[1].options.signal.aborted, true);
  assert.deepEqual({ ...replies[2] }, { replyTo: 3, ok: true, supported: true });
});
