/** Wire Activity restoration to the Manifest V3 extension lifecycle. */
export function registerActivityRestoreHandlers({
  runtime, manager, beforeInstallRestore = async () => {}, afterInstallRestore = async () => {},
}) {
  if (!runtime?.onInstalled?.addListener || !runtime?.onStartup?.addListener ||
      typeof manager?.restoreAll !== 'function' || typeof beforeInstallRestore !== 'function' ||
      typeof afterInstallRestore !== 'function') {
    throw new TypeError('Activity restore handlers need runtime lifecycle events and an Activity manager.');
  }

  runtime.onInstalled.addListener(async (details) => {
    await beforeInstallRestore(details);
    await manager.restoreAll();
    await afterInstallRestore(details);
  });
  runtime.onStartup.addListener(() => manager.restoreAll()
    .then(() => afterInstallRestore({ reason: 'startup' })).catch(() => {}));
}
