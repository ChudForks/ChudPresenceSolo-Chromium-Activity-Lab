/**
 * Check whether the extension can access the site origins required by an Activity.
 * `origins` must be the Activity's declared match patterns, not URLs inferred
 * from a page at runtime.
 */
export async function hasHostPermissions(origins, api = globalThis.chrome) {
  if (!Array.isArray(origins) || origins.length === 0) return true;
  if (typeof api?.permissions?.contains !== 'function') return false;

  try {
    return await api.permissions.contains({ origins });
  } catch {
    return false;
  }
}

/**
 * Chrome 138+ can withhold chrome.userScripts until the user enables
 * "Allow User Scripts". Checking the execute method handles both that state
 * and Chromium versions without the API. The permission check also makes a
 * missing manifest declaration visible during development.
 */
export async function hasUserScriptsPermission(api = globalThis.chrome) {
  if (typeof api?.userScripts?.execute !== 'function' ||
      typeof api?.userScripts?.getScripts !== 'function') return false;
  if (typeof api?.permissions?.contains !== 'function') return false;

  try {
    if (!await api.permissions.contains({ permissions: ['userScripts'] })) return false;
    // Chrome 138+ can revoke Allow User Scripts while an extension context is
    // still alive. In that case the namespace remains visible but calls fail.
    await api.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

/** Request an Activity's declared origins from a user gesture. */
export async function requestHostPermissions(origins, api = globalThis.chrome) {
  if (!Array.isArray(origins) || origins.length === 0) return true;
  if (typeof api?.permissions?.request !== 'function') return false;

  try {
    return await api.permissions.request({ origins });
  } catch {
    return false;
  }
}
