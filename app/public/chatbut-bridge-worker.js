const DATABASE_NAME = "chatbut-local";
const DATABASE_VERSION = 2;
const STATE_STORE = "state";
const LOG_STORE = "logs";
const CONFIG_KEY = "configuration";
const LOG_META_KEY = "log-meta";
const LOCAL_CONFIG_NAME = "Browser-local configuration";
const ROLLING_SEND_LIMIT = 5;
const ROLLING_SEND_WINDOW_MS = 5 * 60 * 1000;
const PLATFORM_IDS = new Set(["googleChat", "teams"]);
const TEAMS_WIDGET_CSS = "#chatbut-runtime{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:296px;max-width:calc(100% - 24px);font:14px/1.4 Arial,sans-serif;color:#191713;background:#fffaf0;border:1px solid #d5cbbb;border-radius:10px;box-shadow:0 12px 30px #0003;overflow:hidden}#chatbut-runtime *{box-sizing:border-box}#chatbut-runtime header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#1d1b18;color:#fffaf0}#chatbut-runtime header strong{font:700 18px Georgia,serif}#chatbut-runtime header span{margin-left:auto;color:#d8d1c5;font-size:12px}#chatbut-runtime main{display:grid;gap:9px;padding:12px}#chatbut-runtime p{margin:0;color:#625c52}#chatbut-runtime .cb-status{padding:8px;border-left:3px solid #b94f25;background:#f7eee3}#chatbut-runtime [data-tone=ok]{border-color:#287459;background:#e8f2ec}#chatbut-runtime .cb-actions{display:flex;gap:6px}#chatbut-runtime .cb-actions button{flex:1}#chatbut-runtime button{font:inherit;min-height:44px;padding:0 10px;border:1px solid #bcb1a0;border-radius:6px;background:#fffaf0;color:#191713;font-weight:700;cursor:pointer}#chatbut-runtime button:focus-visible{outline:3px solid #b94f25;outline-offset:2px}#chatbut-runtime .cb-primary{background:#b94f25;color:white}#chatbut-runtime .cb-stop{background:#287459;color:white}#chatbut-runtime button:disabled{opacity:.55;cursor:not-allowed}#chatbut-runtime .cb-metrics{display:grid;grid-template-columns:repeat(3,1fr);margin:0;border-block:1px solid #ddd3c5}#chatbut-runtime .cb-metrics div{padding:7px 5px}#chatbut-runtime .cb-metrics div+div{border-left:1px solid #ddd3c5}#chatbut-runtime dt,#chatbut-runtime .cb-mini{color:#746c61;font-size:11px}#chatbut-runtime dd{margin:0;font-size:17px;font-weight:700}#chatbut-runtime .cb-close{padding:0;width:44px;min-height:44px;background:transparent;color:white}";
const rooms = new Map();

const providers = {
  deepseek: {
    label: "DeepSeek",
    modelsUrl: "https://api.deepseek.com/models",
    completionUrl: "https://api.deepseek.com/chat/completions",
    auth: "bearer",
    preferred: [/deepseek-v4-flash/i, /^deepseek-chat$/i, /deepseek.*chat/i],
  },
  openai: {
    label: "OpenAI",
    modelsUrl: "https://api.openai.com/v1/models",
    completionUrl: "https://api.openai.com/v1/chat/completions",
    auth: "bearer",
    preferred: [/^gpt-5.*nano/i, /^gpt-5.*mini/i, /^gpt-4\.1-nano/i, /^gpt-4\.1-mini/i, /^gpt-4o-mini/i],
  },
  anthropic: {
    label: "Claude",
    modelsUrl: "https://api.anthropic.com/v1/models",
    completionUrl: "https://api.anthropic.com/v1/messages",
    auth: "anthropic",
    preferred: [/haiku/i, /sonnet/i, /opus/i],
  },
  "kimi-global": {
    label: "Kimi Global",
    modelsUrl: "https://api.moonshot.ai/v1/models",
    completionUrl: "https://api.moonshot.ai/v1/chat/completions",
    auth: "bearer",
    preferred: [/kimi-k3/i, /kimi-k2\.5/i, /kimi-k2/i, /moonshot-v1-8k/i, /moonshot/i],
  },
  "kimi-china": {
    label: "Kimi China",
    modelsUrl: "https://api.moonshot.cn/v1/models",
    completionUrl: "https://api.moonshot.cn/v1/chat/completions",
    auth: "bearer",
    preferred: [/kimi-k3/i, /kimi-k2\.5/i, /kimi-k2/i, /moonshot-v1-8k/i, /moonshot/i],
  },
};

class ProviderError extends Error {
  constructor(message, { fatal = false, status = 0 } = {}) {
    super(message);
    this.name = "ProviderError";
    this.fatal = fatal;
    this.status = status;
  }
}

function roomFor(token) {
  if (!rooms.has(token)) {
    rooms.set(token, {
      configurators: new Set(),
      runtimes: new Map(),
      sendAttempts: [],
    });
  }
  return rooms.get(token);
}

function send(port, message) {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

function configForRuntime(config, platform) {
  const platformConfig = config.platforms?.[platform];
  return {
    ...config,
    platform,
    platforms: undefined,
    targeting: platformConfig?.targeting ?? {},
    invitations: platformConfig?.invitations ?? {},
    llm: {
      ...config.llm,
      connections: (config.llm?.connections ?? []).map(({ apiKey: _apiKey, ...connection }) => connection),
    },
  };
}

function broadcastConfig(room, config, updatedAt, excludePort = null) {
  for (const port of room.configurators) {
    if (port === excludePort) continue;
    if (!send(port, { type: "chatbut:config-changed", config, updatedAt })) {
      room.configurators.delete(port);
    }
  }
  for (const [port, platform] of room.runtimes) {
    if (port === excludePort) continue;
    const runtimeConfig = configForRuntime(config, platform);
    if (!send(port, { type: "chatbut:config-changed", config: runtimeConfig, updatedAt })) {
      room.runtimes.delete(port);
    }
  }
}

function restoreRuntimeConfig(storedConfig, runtimeConfig, platform) {
  const secrets = new Map(
    (storedConfig.llm?.connections ?? []).map((connection) => [connection.providerId, connection.apiKey]),
  );
  return {
    ...storedConfig,
    version: storedConfig.version,
    schedule: runtimeConfig.schedule,
    delays: runtimeConfig.delays,
    responses: runtimeConfig.responses,
    debug: runtimeConfig.debug,
    platforms: {
      ...storedConfig.platforms,
      [platform]: {
        ...storedConfig.platforms?.[platform],
        targeting: runtimeConfig.targeting,
        invitations: runtimeConfig.invitations,
      },
    },
    llm: {
      ...runtimeConfig.llm,
      connections: (runtimeConfig.llm?.connections ?? []).map((connection) => ({
        ...connection,
        apiKey: secrets.get(connection.providerId) ?? "",
      })),
    },
  };
}

function sendLease(room, now = Date.now()) {
  room.sendAttempts = room.sendAttempts.filter((timestamp) => now - timestamp < ROLLING_SEND_WINDOW_MS);
  if (room.sendAttempts.length >= ROLLING_SEND_LIMIT) {
    return {
      granted: false,
      retryAfterMs: Math.max(1, ROLLING_SEND_WINDOW_MS - (now - room.sendAttempts[0])),
    };
  }
  room.sendAttempts.push(now);
  return { granted: true, retryAfterMs: 0 };
}

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

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE);
      if (!database.objectStoreNames.contains(LOG_STORE)) {
        database.createObjectStore(LOG_STORE, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStores(names, mode, callback) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(names, mode);
    const result = await callback(transaction);
    await transactionDone(transaction);
    return result;
  } finally {
    database.close();
  }
}

function loadRecord() {
  return withStores([STATE_STORE], "readonly", (transaction) => (
    requestResult(transaction.objectStore(STATE_STORE).get(CONFIG_KEY))
  ));
}

async function saveRecord(record) {
  const updatedAt = Date.now();
  const next = { ...record, updatedAt };
  await withStores([STATE_STORE], "readwrite", (transaction) => {
    transaction.objectStore(STATE_STORE).put(next, CONFIG_KEY);
  });
  return next;
}

function providerSecrets(config) {
  return (config?.llm?.connections ?? []).map((item) => item.apiKey).filter(Boolean);
}

function redact(value, secrets = []) {
  const redacted = JSON.parse(JSON.stringify(value ?? null));
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    for (const key of Object.keys(item)) {
      if (/api.?key|authorization|secret/i.test(key)) {
        item[key] = "[REDACTED]";
      } else if (typeof item[key] === "string") {
        for (const secret of secrets) {
          if (secret && item[key].includes(secret)) item[key] = item[key].replaceAll(secret, "[REDACTED]");
        }
      } else {
        visit(item[key]);
      }
    }
  };
  visit(redacted);
  return redacted;
}

async function appendLog(entry, maximumLogBytes = 10_000_000) {
  const line = `${JSON.stringify(entry).slice(0, 100_000)}\n`;
  const size = new TextEncoder().encode(line).byteLength;
  await withStores([STATE_STORE, LOG_STORE], "readwrite", async (transaction) => {
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
    logs.add(line);
    meta.bytes += size;
    meta.updatedAt = new Date().toISOString();
    state.put(meta, LOG_META_KEY);
  });
}

function authHeaders(provider, apiKey) {
  if (provider.auth === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function safeProviderMessage(provider, status) {
  if (status === 401 || status === 403) return `${provider.label} rejected that API key. Check the key and its permissions.`;
  if (status === 429) return `${provider.label} is rate-limiting this key. Wait briefly, then retry.`;
  if (status >= 500) return `${provider.label} is temporarily unavailable. Retry in a moment.`;
  return `${provider.label} rejected the validation request (${status}). Check the key and provider account.`;
}

async function providerFetch(provider, apiKey, url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      headers: { ...authHeaders(provider, apiKey), ...(options.headers ?? {}) },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new ProviderError(safeProviderMessage(provider, response.status), {
        fatal: [400, 401, 403, 404].includes(response.status),
        status: response.status,
      });
    }
    return response.json();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ProviderError(`${provider.label} did not respond in time. Retry the connection.`, { fatal: false });
    }
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(`Chrome could not reach ${provider.label}. Check the network and retry.`, { fatal: false });
  } finally {
    clearTimeout(timer);
  }
}

function modelIds(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return [...new Set(data.map((item) => String(item?.id ?? "").trim()).filter(Boolean))];
}

function rankModels(provider, models) {
  const excluded = /embed|image|audio|realtime|transcri|moderation|tts|whisper|vision/i;
  return models
    .filter((model) => !excluded.test(model))
    .map((model, index) => {
      const preferredIndex = provider.preferred.findIndex((pattern) => pattern.test(model));
      return { model, score: preferredIndex < 0 ? 1_000 + index : preferredIndex };
    })
    .sort((a, b) => a.score - b.score || a.model.localeCompare(b.model))
    .map((item) => item.model);
}

function completionBody(providerId, model, messages, maxTokens, temperature = 0) {
  if (providerId === "anthropic") {
    const system = messages.find((message) => message.role === "system")?.content;
    return {
      model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: messages.filter((message) => message.role !== "system"),
    };
  }
  return { model, messages, max_tokens: maxTokens, temperature, stream: false };
}

function completionText(providerId, payload) {
  if (providerId === "anthropic") {
    return payload?.content?.find((item) => item?.type === "text")?.text ?? "";
  }
  return payload?.choices?.[0]?.message?.content ?? "";
}

async function complete(providerId, apiKey, model, messages, maxTokens, temperature = 0) {
  const provider = providers[providerId];
  if (!provider) throw new ProviderError("Choose a supported LLM provider.", { fatal: true });
  const payload = await providerFetch(provider, apiKey, provider.completionUrl, {
    method: "POST",
    body: JSON.stringify(completionBody(providerId, model, messages, maxTokens, temperature)),
  });
  const text = String(completionText(providerId, payload)).trim();
  if (!text) throw new ProviderError(`${provider.label} returned an empty response. Retry validation.`, { fatal: false });
  return text;
}

async function validateProvider(providerId, apiKey) {
  const provider = providers[providerId];
  const key = String(apiKey ?? "").trim();
  if (!provider) throw new ProviderError("Choose a supported LLM provider.", { fatal: true });
  if (!key) throw new ProviderError(`Enter a ${provider.label} API key first.`, { fatal: true });
  const payload = await providerFetch(provider, key, provider.modelsUrl, { method: "GET" });
  const candidates = rankModels(provider, modelIds(payload)).slice(0, 6);
  if (!candidates.length) {
    throw new ProviderError(`${provider.label} returned no compatible text models for this key.`, { fatal: true });
  }
  let lastError = null;
  for (const model of candidates) {
    try {
      await complete(providerId, key, model, [{ role: "user", content: "Reply with OK." }], 8, 0);
      return { model };
    } catch (error) {
      lastError = error;
      if (error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500) break;
    }
  }
  throw lastError ?? new ProviderError(`${provider.label} could not complete the validation request.`, { fatal: false });
}

function activeConnection(config) {
  return config?.llm?.connections?.find(
    (connection) => connection.providerId === config.llm.activeProviderId,
  ) ?? null;
}

function adaptationMessages(template, messages, language) {
  const context = (Array.isArray(messages) ? messages : [])
    .slice(-10)
    .map((message) => `${message.author === "self" ? "Me" : "Sender"}: ${String(message.text ?? "").slice(0, 800)}`)
    .join("\n");
  const languageInstruction = language === "zh"
    ? "Write in natural workplace Chinese."
    : "Write in natural workplace English.";
  return [
    {
      role: "system",
      content: [
        "Adapt the supplied acknowledgement template to the conversation.",
        "Always acknowledge and defer. Never answer the request.",
        "Do not make a deadline, promise, factual claim, approval, commitment, or recommendation.",
        "Use a casual, empathetic, workplace-appropriate corporate tone.",
        "Return plain text only, at most two sentences.",
        languageInstruction,
      ].join(" "),
    },
    { role: "user", content: `Template:\n${template}\n\nRecent conversation:\n${context}` },
  ];
}

async function markConnection(record, providerId, patch) {
  const connections = (record.config?.llm?.connections ?? []).map((connection) => (
    connection.providerId === providerId ? { ...connection, ...patch } : connection
  ));
  const next = await saveRecord({
    ...record,
    config: { ...record.config, llm: { ...record.config.llm, connections } },
  });
  const room = rooms.get(record.pairingToken);
  if (room) broadcastConfig(room, next.config, next.updatedAt);
  return next;
}

self.onconnect = (event) => {
  const port = event.ports[0];
  let role = "";
  let token = "";
  let room = null;
  let releaseVersion = "";
  let platform = "";

  port.onmessage = async (messageEvent) => {
    const message = messageEvent.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "chatbut:register") {
      token = String(message.token ?? "");
      role = message.role;
      platform = role === "runtime" && PLATFORM_IDS.has(String(message.platform ?? ""))
        ? String(message.platform)
        : "";
      releaseVersion = /^\d+\.\d+\.\d+$/.test(String(message.releaseVersion ?? ""))
        ? String(message.releaseVersion)
        : "";
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return;
      if (role !== "configurator" && role !== "runtime") return;
      if (role === "runtime" && !platform) return;
      room = roomFor(token);
      if (role === "configurator") room.configurators.add(port);
      else room.runtimes.set(port, platform);
      send(port, { type: "chatbut:registered", role, platform });
      return;
    }
    if (!room || !role) return;

    let record;
    try {
      record = await loadRecord();
    } catch {
      send(port, { type: "chatbut:error", nonce: message.nonce, requestId: message.requestId, message: "Browser-local storage could not be read." });
      return;
    }
    if (!record || record.pairingToken !== token) {
      send(port, { type: "chatbut:error", nonce: message.nonce, requestId: message.requestId, message: "Return to Chatbut and create or import a local configuration first." });
      return;
    }

    if (message.type === "chatbut:request-config") {
      send(port, {
        type: "chatbut:config",
        nonce: message.nonce,
        config: configForRuntime(record.config, platform),
        widgetCss: platform === "teams" ? TEAMS_WIDGET_CSS : "",
        fileName: LOCAL_CONFIG_NAME,
        debugReady: true,
        latestRelease: releaseVersion,
      });
      return;
    }

    if (message.type === "chatbut:update-config" && role === "runtime") {
      const next = await saveRecord({
        ...record,
        config: restoreRuntimeConfig(record.config, message.config, platform),
      });
      broadcastConfig(room, next.config, next.updatedAt);
      return;
    }

    if (message.type === "chatbut:request-send-lease" && role === "runtime") {
      send(port, {
        type: "chatbut:send-lease",
        nonce: message.nonce,
        requestId: message.requestId,
        ...sendLease(room),
      });
      return;
    }

    if (message.type === "chatbut:config-app-saved" && role === "configurator") {
      const next = await saveRecord({ ...record, config: message.config });
      broadcastConfig(
        room,
        next.config,
        next.updatedAt,
        port,
      );
      return;
    }

    if (message.type === "chatbut:debug" && role === "runtime" && record.config?.debug?.enabled) {
      await appendLog({
        at: typeof message.at === "string" ? message.at : new Date().toISOString(),
        event: String(message.event ?? "runtime").slice(0, 100),
        details: redact(message.details, providerSecrets(record.config)),
        platform,
      }, Number(record.config.debug.maximumLogBytes) || 10_000_000);
      return;
    }

    if (message.type === "chatbut:validate-provider" && role === "configurator") {
      try {
        const result = await validateProvider(message.providerId, message.apiKey);
        send(port, { type: "chatbut:provider-valid", requestId: message.requestId, providerId: message.providerId, model: result.model });
      } catch (error) {
        send(port, { type: "chatbut:provider-invalid", requestId: message.requestId, providerId: message.providerId, message: String(error.message || "Provider validation failed.") });
      }
      return;
    }

    if (message.type === "chatbut:validate-active" && role === "runtime") {
      const connection = activeConnection(record.config);
      if (!connection) {
        send(port, { type: "chatbut:active-invalid", nonce: message.nonce, requestId: message.requestId, fatal: true, message: "No active LLM connection is available." });
        return;
      }
      try {
        const result = await validateProvider(connection.providerId, connection.apiKey);
        if (result.model !== connection.model || connection.status !== "validated") {
          record = await markConnection(record, connection.providerId, {
            model: result.model,
            status: "validated",
            validatedAt: new Date().toISOString(),
            error: "",
          });
        }
        send(port, { type: "chatbut:active-valid", nonce: message.nonce, requestId: message.requestId, providerId: connection.providerId, model: result.model });
      } catch (error) {
        await markConnection(record, connection.providerId, {
          status: "needs-attention",
          error: String(error.message || "Validation failed.").slice(0, 240),
        });
        send(port, { type: "chatbut:active-invalid", nonce: message.nonce, requestId: message.requestId, fatal: Boolean(error.fatal), message: String(error.message || "Provider validation failed.") });
      }
      return;
    }

    if (message.type === "chatbut:adapt" && role === "runtime") {
      const connection = activeConnection(record.config);
      if (!connection) {
        send(port, { type: "chatbut:adapt-error", nonce: message.nonce, requestId: message.requestId, fatal: true, message: "The active LLM connection is missing." });
        return;
      }
      try {
        const text = await complete(
          connection.providerId,
          connection.apiKey,
          connection.model,
          adaptationMessages(message.template, message.messages, message.language),
          140,
          0.45,
        );
        send(port, { type: "chatbut:adapted", nonce: message.nonce, requestId: message.requestId, text });
      } catch (error) {
        if (error.fatal) {
          await markConnection(record, connection.providerId, {
            status: "needs-attention",
            error: String(error.message || "The connection needs attention.").slice(0, 240),
          });
        }
        send(port, { type: "chatbut:adapt-error", nonce: message.nonce, requestId: message.requestId, fatal: Boolean(error.fatal), message: String(error.message || "LLM adaptation failed.") });
      }
    }
  };

  port.start();
};
