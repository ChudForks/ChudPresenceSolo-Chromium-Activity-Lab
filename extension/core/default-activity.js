import { hasUserScriptsPermission } from './activity-permissions.js';
import { compareActivityVersions } from './activity-repository.js';

export const DEFAULT_YOUTUBE_DECISION_KEY = 'defaultYouTubeActivityDecision';

export async function loadBundledYouTubePackage(runtime = chrome.runtime, fetchImpl = fetch) {
  const base = 'default-activities/youtube/';
  const [metadataResponse, sourceResponse, iconResponse] = await Promise.all([
    fetchImpl(runtime.getURL(`${base}metadata.json`)),
    fetchImpl(runtime.getURL(`${base}activity.js`)),
    fetchImpl(runtime.getURL(`${base}icon.png`)),
  ]);
  if (!metadataResponse.ok || !sourceResponse.ok || !iconResponse.ok) {
    throw new Error('The bundled YouTube Activity files are unavailable.');
  }
  const [metadataText, source, iconBuffer] = await Promise.all([
    metadataResponse.text(), sourceResponse.text(), iconResponse.arrayBuffer(),
  ]);
  const iconBytes = new Uint8Array(iconBuffer);
  let iconBinary = '';
  for (const byte of iconBytes) iconBinary += String.fromCharCode(byte);
  return {
    metadata: JSON.parse(metadataText),
    source,
    icon: `data:image/png;base64,${btoa(iconBinary)}`,
    sourceType: 'bundled',
  };
}

/** Install and update the included Activity while honoring removal and replacement. */
export async function ensureBundledYouTubeInstalled({
  manager,
  storage,
  api = chrome,
  loadPackage = () => loadBundledYouTubePackage(api.runtime),
}) {
  const state = (await storage.get(DEFAULT_YOUTUBE_DECISION_KEY))[DEFAULT_YOUTUBE_DECISION_KEY];
  if (state === 'removed') return state;
  const current = await manager.get('youtube');
  if (current && current.source?.type !== 'bundled') {
    await storage.set({ [DEFAULT_YOUTUBE_DECISION_KEY]: 'installed' });
    return 'installed';
  }
  if (!await hasUserScriptsPermission(api)) return current ? 'installed' : 'pending';
  const bundled = await loadPackage();
  if (current && compareActivityVersions(current.metadata.version, bundled.metadata.version) >= 0) {
    if (state !== 'installed') await storage.set({ [DEFAULT_YOUTUBE_DECISION_KEY]: 'installed' });
    return 'installed';
  }
  await manager.install(bundled);
  if (current?.enabled === false) await manager.setEnabled('youtube', false);
  await storage.set({ [DEFAULT_YOUTUBE_DECISION_KEY]: 'installed' });
  return 'installed';
}

export async function rememberBundledYouTubeRemoval(storage) {
  await storage.set({ [DEFAULT_YOUTUBE_DECISION_KEY]: 'removed' });
}
