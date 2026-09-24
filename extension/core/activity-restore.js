/** Wire Activity restoration to the Manifest V3 extension lifecycle. */
export function registerActivityRestoreHandlers({ runtime, manager, beforeInstallRestore = async () => {} }) {
  if (!runtime?.onInstalled?.addListener || !runtime?.onStartup?.addListener ||
      typeof manager?.restoreAll !== 'function' || typeof beforeInstallRestore !== 'function') {
    throw new TypeError('Activity restore handlers need runtime lifecycle events and an Activity manager.');
  }

  runtime.onInstalled.addListener(async (details) => {
    await beforeInstallRestore(details);
    await manager.restoreAll();
  });
  runtime.onStartup.addListener(() => manager.restoreAll().catch(() => {}));
}
