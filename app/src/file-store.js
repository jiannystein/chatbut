import { normalizeConfig } from "./config.js";

const DATABASE_NAME = "chatbut-local";
const STORE_NAME = "handles";
const CONFIG_HANDLE_KEY = "config";
const debugFileIndexes = new WeakMap();

const pickerTypes = [
  {
    description: "Chatbut configuration",
    accept: { "application/json": [".json", ".chatbut"] },
  },
];

export function supportsFileSystemAccess() {
  return typeof window !== "undefined"
    && typeof window.showOpenFilePicker === "function"
    && typeof window.showSaveFilePicker === "function";
}

function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withHandleStore(mode, callback) {
  if (typeof indexedDB === "undefined") return undefined;
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await callback(transaction.objectStore(STORE_NAME));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  } finally {
    database.close();
  }
}

export async function rememberConfigHandle(handle) {
  await withHandleStore("readwrite", (store) => {
    store.put(handle, CONFIG_HANDLE_KEY);
  });
}

export async function getRememberedConfigHandle() {
  return withHandleStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.get(CONFIG_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  }));
}

export async function forgetRememberedConfigHandle() {
  await withHandleStore("readwrite", (store) => {
    store.delete(CONFIG_HANDLE_KEY);
  });
}

export async function requestConfigHandlePermission(handle) {
  if (!handle) return false;
  const existing = await handle.queryPermission({ mode: "readwrite" });
  if (existing === "granted") return true;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function readConfigHandle(handle) {
  const file = await handle.getFile();
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON. Choose another Chatbut configuration file.");
  }
  return {
    handle,
    name: file.name,
    config: normalizeConfig(parsed),
    lastModified: file.lastModified,
  };
}

export async function openConfigFile() {
  if (!supportsFileSystemAccess()) {
    throw new Error("Chrome file access is unavailable here. Open this page in a current desktop Chrome window.");
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: pickerTypes,
    excludeAcceptAllOption: false,
  });
  const record = await readConfigHandle(handle);
  await rememberConfigHandle(handle);
  return record;
}

export async function createConfigFile(config) {
  if (!supportsFileSystemAccess()) {
    throw new Error("Chrome file access is unavailable here. Open this page in a current desktop Chrome window.");
  }
  const handle = await window.showSaveFilePicker({
    suggestedName: "chatbut.config.json",
    types: pickerTypes,
    excludeAcceptAllOption: false,
  });
  await writeConfigFile(handle, config);
  await rememberConfigHandle(handle);
  return {
    handle,
    name: handle.name,
    config: normalizeConfig(config),
    lastModified: Date.now(),
  };
}

export async function writeConfigFile(handle, config) {
  if (!handle) throw new Error("Choose or create a configuration file first.");
  const writable = await handle.createWritable();
  try {
    await writable.write(`${JSON.stringify(normalizeConfig(config), null, 2)}\n`);
  } finally {
    await writable.close();
  }
}

export async function chooseDebugFolder() {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error("Folder access is unavailable in this Chrome window.");
  }
  return window.showDirectoryPicker({ mode: "readwrite" });
}

export async function appendDebugLog(folder, entry, maximumLogBytes = 10_000_000) {
  if (!folder) throw new Error("Choose a debug folder in the configurator first.");
  const serialized = JSON.stringify(entry).slice(0, 100_000);
  const line = `${serialized}\n`;
  const lineBytes = new TextEncoder().encode(line).byteLength;
  let index = debugFileIndexes.get(folder) ?? 1;
  let handle;
  let file;
  do {
    handle = await folder.getFileHandle(
      `chatbut-debug-${String(index).padStart(3, "0")}.jsonl`,
      { create: true },
    );
    file = await handle.getFile();
    if (file.size > 0 && file.size + lineBytes > maximumLogBytes) index += 1;
  } while (file.size > 0 && file.size + lineBytes > maximumLogBytes);
  debugFileIndexes.set(folder, index);
  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    await writable.seek(file.size);
    await writable.write(line);
  } finally {
    await writable.close();
  }
}
