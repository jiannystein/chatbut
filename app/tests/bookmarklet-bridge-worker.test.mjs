import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { DEFAULT_CONFIG } from "../src/config.js";

const source = await readFile(
  new URL("../public/chatbut-bridge-worker.js", import.meta.url),
  "utf8",
);

class MockPort {
  constructor() {
    this.onmessage = null;
    this.sent = [];
  }

  start() {}

  postMessage(message) {
    this.sent.push(message);
  }

  receive(message) {
    this.onmessage?.({ data: message });
  }
}

function makeIndexedDb(configuration) {
  const stores = {
    state: new Map([["configuration", configuration]]),
    logs: new Map(),
  };
  const database = {
    objectStoreNames: { contains: (name) => name in stores },
    createObjectStore(name) { stores[name] = new Map(); },
    close() {},
    transaction(names) {
      const transaction = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: null,
        objectStore(name) {
          const store = stores[name];
          const request = (operation) => {
            const result = {};
            queueMicrotask(() => {
              try {
                result.result = operation();
                result.onsuccess?.();
              } catch (error) {
                result.error = error;
                result.onerror?.();
              }
              setTimeout(() => transaction.oncomplete?.(), 0);
            });
            return result;
          };
          return {
            get: (key) => request(() => store.get(key)),
            put: (value, key) => request(() => store.set(key, value)),
            add: (value) => request(() => store.set(store.size + 1, value)),
            clear: () => request(() => store.clear()),
          };
        },
      };
      return transaction;
    },
  };
  return {
    stores,
    open() {
      const request = {};
      setTimeout(() => {
        request.result = database;
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

function connect(workerScope, port) {
  workerScope.onconnect({ ports: [port] });
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the worker.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("bridge worker serves paired browser-local config without a configurator tab", async () => {
  const token = "a".repeat(32);
  const storedConfig = {
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      enabled: true,
      activeProviderId: "deepseek",
      connections: [{
        providerId: "deepseek",
        apiKey: "secret-that-must-stay-in-the-worker",
        model: "deepseek-chat",
        status: "validated",
        error: "",
      }],
    },
  };
  const indexedDB = makeIndexedDb({
    config: storedConfig,
    pairingToken: token,
    updatedAt: 1,
  });
  const workerScope = {};
  vm.runInNewContext(source, {
    self: workerScope,
    indexedDB,
    fetch: globalThis.fetch,
    AbortController,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  const configurator = new MockPort();
  const runtime = new MockPort();
  const unrelated = new MockPort();
  connect(workerScope, configurator);
  connect(workerScope, runtime);
  connect(workerScope, unrelated);

  configurator.receive({ type: "chatbut:register", role: "configurator", token });
  runtime.receive({ type: "chatbut:register", role: "runtime", platform: "googleChat", token, releaseVersion: "0.3.0" });
  unrelated.receive({ type: "chatbut:register", role: "runtime", platform: "teams", token: "b".repeat(32) });
  runtime.receive({ type: "chatbut:request-config", nonce: "nonce-123" });
  unrelated.receive({ type: "chatbut:request-config", nonce: "nonce-other" });
  await waitFor(() => runtime.sent.at(-1)?.type === "chatbut:config"
    && unrelated.sent.at(-1)?.type === "chatbut:error");

  assert.equal(runtime.sent.at(-1).type, "chatbut:config");
  assert.equal(runtime.sent.at(-1).nonce, "nonce-123");
  assert.equal(runtime.sent.at(-1).config.version, 3);
  assert.equal(runtime.sent.at(-1).config.platform, "googleChat");
  assert.equal(runtime.sent.at(-1).latestRelease, "0.3.0");
  assert.equal("apiKey" in runtime.sent.at(-1).config.llm.connections[0], false);
  assert.equal(unrelated.sent.at(-1).type, "chatbut:error");

  runtime.receive({
    type: "chatbut:update-config",
    config: {
      ...storedConfig,
      platform: "googleChat",
      targeting: storedConfig.platforms.googleChat.targeting,
      llm: {
        ...storedConfig.llm,
        connections: storedConfig.llm.connections.map(({ apiKey: _apiKey, ...connection }) => connection),
      },
      invitations: { autoAcceptDirect: true, autoAcceptSpaces: false },
    },
  });
  await waitFor(() => configurator.sent.at(-1)?.type === "chatbut:config-changed");
  assert.equal(configurator.sent.at(-1).type, "chatbut:config-changed");
  assert.equal(indexedDB.stores.state.get("configuration").config.platforms.googleChat.invitations.autoAcceptDirect, true);
  assert.equal(
    indexedDB.stores.state.get("configuration").config.llm.connections[0].apiKey,
    "secret-that-must-stay-in-the-worker",
  );

  const configuratorMessageCount = configurator.sent.length;
  configurator.receive({
    type: "chatbut:config-app-saved",
    config: {
      ...DEFAULT_CONFIG,
      platforms: {
        ...DEFAULT_CONFIG.platforms,
        googleChat: {
          ...DEFAULT_CONFIG.platforms.googleChat,
          invitations: { autoAcceptDirect: false, autoAcceptSpaces: true },
        },
      },
    },
  });
  await waitFor(() => runtime.sent.at(-1)?.type === "chatbut:config-changed"
    && runtime.sent.at(-1)?.config?.invitations?.autoAcceptSpaces === true);
  assert.equal(configurator.sent.length, configuratorMessageCount);
  assert.equal(indexedDB.stores.state.get("configuration").config.platforms.googleChat.invitations.autoAcceptSpaces, true);
});

test("Google Chat and Teams share one atomic five-send lease window", async () => {
  const token = "e".repeat(32);
  const indexedDB = makeIndexedDb({
    config: DEFAULT_CONFIG,
    pairingToken: token,
    updatedAt: 1,
  });
  const workerScope = {};
  vm.runInNewContext(source, {
    self: workerScope,
    indexedDB,
    fetch: globalThis.fetch,
    AbortController,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  const google = new MockPort();
  const teams = new MockPort();
  connect(workerScope, google);
  connect(workerScope, teams);
  google.receive({ type: "chatbut:register", role: "runtime", platform: "googleChat", token });
  teams.receive({ type: "chatbut:register", role: "runtime", platform: "teams", token });
  google.receive({ type: "chatbut:request-config", nonce: "google-config" });
  teams.receive({ type: "chatbut:request-config", nonce: "teams-config" });
  await waitFor(() => google.sent.at(-1)?.type === "chatbut:config" && teams.sent.at(-1)?.type === "chatbut:config");
  assert.equal(google.sent.at(-1).config.platform, "googleChat");
  assert.ok(Array.isArray(google.sent.at(-1).config.targeting.selectedGroups));
  assert.equal(google.sent.at(-1).widgetCss, "");
  assert.equal(teams.sent.at(-1).config.platform, "teams");
  assert.ok(Array.isArray(teams.sent.at(-1).config.targeting.selectedChannels));
  assert.match(teams.sent.at(-1).widgetCss, /border-radius:10px/);
  assert.match(teams.sent.at(-1).widgetCss, /button:focus-visible/);

  for (let index = 0; index < 5; index += 1) {
    const port = index % 2 ? teams : google;
    port.receive({
      type: "chatbut:request-send-lease",
      nonce: `nonce-${index}`,
      requestId: `lease-${index}`,
    });
  }
  await waitFor(() => [google, teams].flatMap((port) => port.sent).filter((message) => message.type === "chatbut:send-lease").length === 5);
  assert.equal(
    [google, teams].flatMap((port) => port.sent).filter((message) => message.type === "chatbut:send-lease").every((message) => message.granted),
    true,
  );

  teams.receive({
    type: "chatbut:request-send-lease",
    nonce: "nonce-denied",
    requestId: "lease-denied",
  });
  await waitFor(() => teams.sent.some((message) => message.requestId === "lease-denied"));
  const denied = teams.sent.find((message) => message.requestId === "lease-denied");
  assert.equal(denied.granted, false);
  assert.ok(denied.retryAfterMs > 0);
});

test("provider validation discovers and tests a ranked model without returning the secret", async () => {
  const token = "c".repeat(32);
  const indexedDB = makeIndexedDb({
    config: DEFAULT_CONFIG,
    pairingToken: token,
    updatedAt: 1,
  });
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (String(url).endsWith("/models")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "OK" } }] }),
    };
  };
  const workerScope = {};
  vm.runInNewContext(source, {
    self: workerScope,
    indexedDB,
    fetch,
    AbortController,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  const configurator = new MockPort();
  connect(workerScope, configurator);
  configurator.receive({ type: "chatbut:register", role: "configurator", token });
  configurator.receive({
    type: "chatbut:validate-provider",
    requestId: "request-1",
    providerId: "openai",
    apiKey: "secret-openai-key",
  });
  await waitFor(() => configurator.sent.at(-1)?.type === "chatbut:provider-valid");

  assert.equal(configurator.sent.at(-1).type, "chatbut:provider-valid");
  assert.equal(configurator.sent.at(-1).model, "gpt-4o-mini");
  assert.equal(JSON.stringify(configurator.sent.at(-1)).includes("secret-openai-key"), false);
  assert.equal(requests.length, 2);
  assert.match(requests[0].options.headers.Authorization, /^Bearer /);
});

test("provider validation returns a non-secret actionable authentication error", async () => {
  const token = "d".repeat(32);
  const indexedDB = makeIndexedDb({
    config: DEFAULT_CONFIG,
    pairingToken: token,
    updatedAt: 1,
  });
  const workerScope = {};
  vm.runInNewContext(source, {
    self: workerScope,
    indexedDB,
    fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    AbortController,
    TextEncoder,
    setTimeout,
    clearTimeout,
  });
  const configurator = new MockPort();
  connect(workerScope, configurator);
  configurator.receive({ type: "chatbut:register", role: "configurator", token });
  configurator.receive({
    type: "chatbut:validate-provider",
    requestId: "request-2",
    providerId: "deepseek",
    apiKey: "secret-deepseek-key",
  });
  await waitFor(() => configurator.sent.at(-1)?.type === "chatbut:provider-invalid");

  assert.equal(configurator.sent.at(-1).type, "chatbut:provider-invalid");
  assert.match(configurator.sent.at(-1).message, /rejected that API key/i);
  assert.equal(configurator.sent.at(-1).message.includes("secret-deepseek-key"), false);
});
