import {
  markImportedConnectionsForValidation,
  normalizeConfig,
} from "./config.js";

export const DATABASE_NAME = "chatbut-local";
export const DATABASE_VERSION = 2;
export const STATE_STORE = "state";
export const LOG_STORE = "logs";
export const CONFIG_KEY = "configuration";
export const LOG_META_KEY = "log-meta";
export const CONFIG_SYNC_CHANNEL = "chatbut-config-sync";
export const LOCAL_CONFIG_NAME = "Browser-local configuration";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function supportsBrowserStorage() {
  return typeof indexedDB !== "undefined";
}

export function openLocalDatabase() {
  if (!supportsBrowserStorage()) {
    return Promise.reject(new Error("Browser-local storage is unavailable in this Chrome profile."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE);
      }
      if (!database.objectStoreNames.contains(LOG_STORE)) {
        database.createObjectStore(LOG_STORE, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close older Chatbut tabs, then reload to finish the storage upgrade."));
  });
}

async function withStores(storeNames, mode, callback) {
  const database = await openLocalDatabase();
  try {
    const transaction = database.transaction(storeNames, mode);
    const result = await callback(transaction);
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

function announceConfigChange(updatedAt) {
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(CONFIG_SYNC_CHANNEL);
  channel.postMessage({ type: "chatbut:config-changed", updatedAt });
  channel.close();
}

export async function loadLocalConfig() {
  const record = await withStores([STATE_STORE], "readonly", (transaction) => (
    requestResult(transaction.objectStore(STATE_STORE).get(CONFIG_KEY))
  ));
  if (!record) return null;
  if (!record.config || typeof record.config !== "object") {
    throw new Error("The browser-local configuration is corrupt. Export diagnostics if needed, then create a new configuration.");
  }
  return {
    name: LOCAL_CONFIG_NAME,
    config: normalizeConfig(record.config),
    pairingToken: String(record.pairingToken ?? ""),
    updatedAt: Number(record.updatedAt) || 0,
  };
}

export async function saveLocalConfig(config, pairingToken) {
  const normalized = normalizeConfig(config);
  const updatedAt = Date.now();
  await withStores([STATE_STORE], "readwrite", (transaction) => {
    transaction.objectStore(STATE_STORE).put({
      config: normalized,
      pairingToken: String(pairingToken ?? ""),
      updatedAt,
    }, CONFIG_KEY);
  });
  announceConfigChange(updatedAt);
  return {
    name: LOCAL_CONFIG_NAME,
    config: normalized,
    pairingToken: String(pairingToken ?? ""),
    updatedAt,
  };
}

export async function createLocalConfig(config, pairingToken) {
  return saveLocalConfig(config, pairingToken);
}

export async function deleteLocalConfig() {
  await withStores([STATE_STORE], "readwrite", (transaction) => {
    transaction.objectStore(STATE_STORE).delete(CONFIG_KEY);
  });
  announceConfigChange(Date.now());
}

export async function importConfigFile(file, pairingToken) {
  if (!(file instanceof Blob)) throw new Error("Choose a Chatbut JSON file to import.");
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file is not valid JSON. Choose a Chatbut configuration backup.");
  }
  const config = markImportedConnectionsForValidation(parsed);
  return saveLocalConfig(config, pairingToken);
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportConfigFile(config) {
  const content = `${JSON.stringify(normalizeConfig(config), null, 2)}\n`;
  downloadBlob(new Blob([content], { type: "application/json" }), "chatbut.config.json");
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export async function appendDebugLog(entry, maximumLogBytes = 10_000_000) {
  const serialized = `${JSON.stringify(entry).slice(0, 100_000)}\n`;
  const size = byteLength(serialized);
  return withStores([STATE_STORE, LOG_STORE], "readwrite", async (transaction) => {
    const state = transaction.objectStore(STATE_STORE);
    const logs = transaction.objectStore(LOG_STORE);
    const meta = await requestResult(state.get(LOG_META_KEY)) ?? {
      bytes: 0,
      sequence: 1,
      startedAt: new Date().toISOString(),
    };
    if (meta.bytes > 0 && meta.bytes + size > maximumLogBytes) {
      logs.clear();
      meta.bytes = 0;
      meta.sequence += 1;
      meta.startedAt = new Date().toISOString();
    }
    logs.add(serialized);
    meta.bytes += size;
    meta.updatedAt = new Date().toISOString();
    state.put(meta, LOG_META_KEY);
    return meta;
  });
}

export async function getDebugLogStatus() {
  return withStores([STATE_STORE], "readonly", async (transaction) => (
    await requestResult(transaction.objectStore(STATE_STORE).get(LOG_META_KEY))
    ?? { bytes: 0, sequence: 1, startedAt: "" }
  ));
}

export async function clearDebugLog() {
  await withStores([STATE_STORE, LOG_STORE], "readwrite", (transaction) => {
    transaction.objectStore(LOG_STORE).clear();
    transaction.objectStore(STATE_STORE).put({
      bytes: 0,
      sequence: 1,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, LOG_META_KEY);
  });
}

export async function exportDebugLog() {
  const lines = await withStores([LOG_STORE], "readonly", (transaction) => (
    requestResult(transaction.objectStore(LOG_STORE).getAll())
  ));
  if (!lines.length) throw new Error("No debug entries are stored yet.");
  const meta = await getDebugLogStatus();
  downloadBlob(
    new Blob(lines, { type: "application/x-ndjson" }),
    `chatbut-debug-${String(meta.sequence || 1).padStart(3, "0")}.jsonl`,
  );
}
