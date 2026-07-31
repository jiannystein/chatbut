import { isRuntimeScheduleActive, validateRuntimeConfig } from "./runtime-config.js";
import {
  fuzzyScore,
  isTargetAllowed,
  maySend,
  normalizeDraft,
  randomDelayMs,
  randomTemplate,
  redactLogValue,
  selectVault,
} from "./core.js";

const ROOT_ID = "chatbut-runtime";
const CHANNEL_NAME = "chatbut-single-instance";
const ROW_SELECTOR = '[role="listitem"][data-group-id]';
const MAIN_SELECTOR = '[role="main"][data-group-id]';
const MESSAGE_SELECTOR = '[role="group"][data-id][data-user-id]';
const PAIRING_TOKEN = "__CHATBUT_PAIRING_TOKEN__";
const BRIDGE_URL = "__CHATBUT_BRIDGE_URL__";
const BRIDGE_ORIGIN = new URL(BRIDGE_URL).origin;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function visible(element) {
  return element instanceof HTMLElement && element.offsetParent !== null;
}

function textOf(element) {
  return String(element?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function uniqueVisible(selector, root = document) {
  const matches = [...root.querySelectorAll(selector)].filter(visible);
  return matches.length === 1 ? matches[0] : null;
}

function conversationKind(id) {
  return String(id).startsWith("dm/") ? "direct" : String(id).startsWith("space/") ? "space" : "unknown";
}

function safeLabel(row) {
  const candidates = [...row.querySelectorAll("[aria-label]")]
    .map((node) => node.getAttribute("aria-label"))
    .filter((value) => value && value.length < 160);
  return candidates[0] || textOf(row).slice(0, 100) || row.dataset.groupId;
}

function recentRows() {
  return [...document.querySelectorAll(ROW_SELECTOR)]
    .filter(visible)
    .map((row) => ({
      id: row.dataset.groupId,
      label: safeLabel(row),
      timestamp: Number(row.dataset.displayTimestamp || 0),
      element: row,
    }))
    .filter((item) => item.id);
}

function currentConversation() {
  const main = uniqueVisible(MAIN_SELECTOR);
  if (!main) return null;
  return {
    id: main.dataset.groupId,
    kind: conversationKind(main.dataset.groupId),
    main,
  };
}

function latestIncoming(main) {
  const groups = [...main.querySelectorAll(MESSAGE_SELECTOR)].filter(visible);
  const group = groups.at(-1);
  if (!group) return null;
  const author = group.querySelector("[data-message-id][data-member-id]");
  if (!author || author.dataset.originGsuiteApp === "1") return null;
  const mention = Boolean(group.querySelector('span[data-user-mention-type="1"][data-user-email]'));
  const repliedToSelf = Boolean(
    group.querySelector('[aria-label*="replied to you" i], [data-reply-to-self="true"]'),
  );
  return {
    id: group.dataset.id,
    userId: group.dataset.userId,
    memberId: author.dataset.memberId,
    text: textOf(group).slice(0, 1200),
    mentionedSelf: mention,
    repliedToSelf,
    element: group,
  };
}

function recentContext(main, count) {
  return [...main.querySelectorAll(MESSAGE_SELECTOR)]
    .filter(visible)
    .slice(-count)
    .map((group) => ({
      author: group.getAttribute("data-chatbut-self") === "true" ? "self" : "sender",
      text: textOf(group).slice(0, 800),
    }))
    .filter((message) => message.text);
}

async function navigateTo(id) {
  const row = recentRows().find((item) => item.id === id);
  if (!row) return false;
  row.element.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(150);
    if (currentConversation()?.id === id) return true;
  }
  return false;
}

function styleText() {
  return `
#${ROOT_ID}{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:min(360px,calc(100vw - 24px));font:14px/1.45 system-ui,-apple-system,sans-serif;color:#191713;background:#fffaf0;border:1px solid #d5cbbb;border-radius:16px;box-shadow:0 16px 48px #0003;overflow:hidden}
#${ROOT_ID} *{box-sizing:border-box}#${ROOT_ID} header{display:flex;align-items:center;gap:10px;padding:14px 16px;background:#1d1b18;color:#fffaf0}
#${ROOT_ID} header strong{font:700 19px/1.1 Georgia,serif}#${ROOT_ID} header span{margin-left:auto;color:#d8d1c5;font-size:12px}
#${ROOT_ID} main{display:grid;gap:12px;padding:16px}#${ROOT_ID} p{margin:0;color:#625c52}#${ROOT_ID} .cb-status{padding:10px 12px;border-left:4px solid #b94f25;background:#f7eee3}
#${ROOT_ID} .cb-status[data-tone="ok"]{border-color:#287459;background:#e8f2ec}#${ROOT_ID} .cb-actions{display:flex;flex-wrap:wrap;gap:8px}
#${ROOT_ID} button,#${ROOT_ID} input{font:inherit}#${ROOT_ID} button{min-height:38px;padding:0 13px;border:1px solid #bcb1a0;border-radius:9px;background:#fffaf0;color:#191713;font-weight:700;cursor:pointer}
#${ROOT_ID} button.cb-primary{border-color:#b94f25;background:#b94f25;color:white}#${ROOT_ID} button.cb-stop{border-color:#287459;background:#287459;color:white}
#${ROOT_ID} button:disabled{opacity:.5;cursor:not-allowed}#${ROOT_ID} .cb-search{display:grid;gap:7px;border-top:1px solid #ddd3c5;padding-top:12px}
#${ROOT_ID} input{width:100%;min-height:38px;padding:0 10px;border:1px solid #bcb1a0;border-radius:8px;background:white}
#${ROOT_ID} .cb-results{display:grid;gap:5px;max-height:120px;overflow:auto}#${ROOT_ID} .cb-results button{text-align:left;font-weight:600;white-space:normal}
#${ROOT_ID} .cb-mini{font-size:12px;color:#746c61}#${ROOT_ID} .cb-close{margin-left:0;padding:0;width:32px;min-height:32px;border-color:#655f56;background:transparent;color:white}
@media(prefers-reduced-motion:reduce){#${ROOT_ID} *{scroll-behavior:auto!important;transition:none!important}}
`;
}

class BridgeDebugWriter {
  constructor(send, config) {
    this.send = send;
    this.config = config;
  }

  async write(event, details = {}) {
    this.send("chatbut:debug", {
      at: new Date().toISOString(),
      event,
      details: redactLogValue(
        details,
        this.config.llm.connections.map((connection) => connection.apiKey),
      ),
    });
  }
}

class ChatbutRuntime {
  constructor() {
    this.root = null;
    this.config = null;
    this.configName = "";
    this.connectionNonce = "";
    this.bridgeWindow = null;
    this.bridgePort = null;
    this.connectionTimeout = null;
    this.debugReady = false;
    this.debug = null;
    this.bridgeRequests = new Map();
    this.enabled = false;
    this.scheduleOverride = false;
    this.enableAt = 0;
    this.baseline = new Map();
    this.processed = new Set();
    this.states = new Map();
    this.pending = new Map();
    this.sent = [];
    this.sessionCount = 0;
    this.originalId = "";
    this.lastSpaceInviteScan = 0;
    this.channel = null;
    this.timer = null;
    this.busy = false;
    this.handleWindowMessage = this.handleWindowMessage.bind(this);
    this.handlePortMessage = this.handlePortMessage.bind(this);
  }

  handleWindowMessage(event) {
    if (
      event.origin !== BRIDGE_ORIGIN
      || event.source !== this.bridgeWindow
      || event.data?.nonce !== this.connectionNonce
      || event.data?.type !== "chatbut:bridge-port"
      || event.ports.length !== 1
    ) return;
    this.bridgePort = event.ports[0];
    this.bridgePort.onmessage = this.handlePortMessage;
    this.bridgePort.start();
    this.requestConfig();
  }

  handlePortMessage(event) {
    if (event.data?.type === "chatbut:config-changed" && event.data.config) {
      this.config = event.data.config;
      return;
    }
    if (event.data?.nonce !== this.connectionNonce) return;
    if (event.data?.requestId && this.bridgeRequests.has(event.data.requestId)) {
      const pending = this.bridgeRequests.get(event.data.requestId);
      this.bridgeRequests.delete(event.data.requestId);
      clearTimeout(pending.timer);
      if (pending.successTypes.includes(event.data.type)) pending.resolve(event.data);
      else {
        const error = new Error(String(event.data.message || "The local provider bridge failed."));
        error.fatal = Boolean(event.data.fatal);
        pending.reject(error);
      }
      return;
    }
    if (event.data.type === "chatbut:error") {
      window.clearTimeout(this.connectionTimeout);
      this.setStatus(String(event.data.message || "The configurator could not connect."));
      return;
    }
    if (event.data.type !== "chatbut:config") return;
    window.clearTimeout(this.connectionTimeout);
    this.config = event.data.config;
    this.configName = String(event.data.fileName || "local configuration");
    this.debugReady = Boolean(event.data.debugReady);
    this.debug = this.config.debug.enabled
      ? new BridgeDebugWriter((type, payload) => this.sendBridge(type, payload), this.config)
      : null;
    this.root.querySelector('[data-role="enable"]').disabled = false;
    this.root.querySelector('[data-role="connect"]').hidden = true;
    this.setStatus(`Connected to ${this.configName}. Enable when ready.`, "ok");
  }

  requestBridge(type, payload, successTypes, timeoutMs = 45_000) {
    return new Promise((resolve, reject) => {
      if (!this.bridgePort) {
        reject(new Error("The local provider bridge is not connected."));
        return;
      }
      const requestId = globalThis.crypto?.randomUUID?.()
        || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        this.bridgeRequests.delete(requestId);
        reject(new Error("The local provider request timed out."));
      }, timeoutMs);
      this.bridgeRequests.set(requestId, { resolve, reject, timer, successTypes });
      this.sendBridge(type, { ...payload, requestId });
    });
  }

  requestConfig() {
    this.bridgePort?.postMessage({
      type: "chatbut:request-config",
      nonce: this.connectionNonce,
    });
    window.clearTimeout(this.connectionTimeout);
    this.connectionTimeout = window.setTimeout(() => {
      if (!this.config) {
        this.setStatus("No local configuration was found. Return to Chatbut, create one, then retry.");
      }
    }, 6000);
  }

  connectToConfigurator() {
    this.connectionNonce = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.config = null;
    this.root.querySelector('[data-role="enable"]').disabled = true;
    this.root.querySelector('[data-role="connect"]').hidden = false;
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(PAIRING_TOKEN)) {
      this.setStatus("Bookmark not paired. Reinstall it from Chatbut.");
      return;
    }
    if (this.bridgePort) {
      this.setStatus("Refreshing configuration…");
      this.requestConfig();
      return;
    }
    this.setStatus("Requesting your configuration…");
    this.bridgeWindow = window.open(
      `${BRIDGE_URL}#${PAIRING_TOKEN}.${this.connectionNonce}`,
      "chatbut-config-bridge",
      "popup,width=440,height=260",
    );
    if (!this.bridgeWindow) {
      this.setStatus("Chrome blocked the helper popup. Allow it, then retry.");
    }
  }

  sendBridge(type, payload = {}) {
    if (!this.bridgePort) return;
    this.bridgePort.postMessage({
      type,
      nonce: this.connectionNonce,
      ...payload,
    });
  }

  boot() {
    if (location.origin !== "https://chat.google.com" || !location.pathname.startsWith("/app")) {
      alert("Chatbut works only on https://chat.google.com/app/home");
      return;
    }
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      existing.hidden = false;
      if (!existing.chatbutRuntime?.config) existing.chatbutRuntime?.connectToConfigurator();
      return;
    }
    this.render();
    this.root.chatbutRuntime = this;
    window.addEventListener("message", this.handleWindowMessage);
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => {
      if (event.data === "enabled" && this.enabled) this.stop("Another Google Chat tab enabled Chatbut.");
      if (event.data === "probe" && this.enabled) this.channel.postMessage("enabled");
    };
    this.channel.postMessage("probe");
    this.connectToConfigurator();
  }

  render() {
    const style = document.createElement("style");
    style.textContent = styleText();
    document.head.append(style);
    this.root = document.createElement("section");
    this.root.id = ROOT_ID;
    this.root.setAttribute("aria-label", "Chatbut controls");
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "Chatbut";
    const mode = document.createElement("span");
    mode.textContent = "Disabled";
    mode.dataset.role = "mode";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cb-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Hide Chatbut");
    close.addEventListener("click", () => { this.root.hidden = true; });
    header.append(title, mode, close);
    const main = document.createElement("main");
    const status = document.createElement("p");
    status.className = "cb-status";
    status.dataset.role = "status";
    const actions = document.createElement("div");
    actions.className = "cb-actions";
    const connect = this.button("Retry connection", () => this.connectToConfigurator());
    connect.dataset.role = "connect";
    const enable = this.button("Enable", () => this.enable());
    enable.className = "cb-primary";
    enable.dataset.role = "enable";
    enable.disabled = true;
    const stop = this.button("Stop", () => this.stop("Stopped by you."));
    stop.className = "cb-stop";
    stop.dataset.role = "stop";
    stop.hidden = true;
    actions.append(connect, enable, stop);
    const search = document.createElement("div");
    search.className = "cb-search";
    const searchLabel = document.createElement("label");
    searchLabel.textContent = "Find chats to allow or exclude";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search recent conversations";
    input.addEventListener("input", () => this.renderSearch(input.value, results));
    const results = document.createElement("div");
    results.className = "cb-results";
    search.append(searchLabel, input, results);
    const note = document.createElement("p");
    note.className = "cb-mini";
    note.textContent = "The configurator tab may be closed after setup.";
    main.append(status, actions, search, note);
    this.root.append(header, main);
    document.body.append(this.root);
    this.renderSearch("", results);
  }

  button(label, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  setStatus(message, tone = "info") {
    const node = this.root?.querySelector('[data-role="status"]');
    if (node) {
      node.textContent = message;
      node.dataset.tone = tone;
    }
  }

  async saveConfig() {
    this.sendBridge("chatbut:update-config", {
      config: this.config,
    });
  }

  async enable() {
    const validation = validateRuntimeConfig(this.config);
    if (!validation.valid) {
      this.setStatus(validation.errors.join(" "));
      return;
    }
    this.config = validation.config;
    if (!isRuntimeScheduleActive(this.config)) {
      if (!window.confirm("You are outside the configured schedule. Enable anyway until you stop Chatbut or reload this page?")) {
        this.setStatus("Stayed disabled. Review the schedule or enable again to use a one-session override.");
        return;
      }
      this.scheduleOverride = true;
    } else {
      this.scheduleOverride = false;
    }
    try {
      if (this.config.llm.enabled) {
        this.setStatus("Checking the active LLM connection…");
        const result = await this.requestBridge("chatbut:validate-active", {}, ["chatbut:active-valid"]);
        const connection = this.config.llm.connections.find(
          (item) => item.providerId === this.config.llm.activeProviderId,
        );
        if (connection) {
          connection.model = result.model;
          connection.status = "validated";
          connection.error = "";
        }
      }
    } catch (error) {
      this.setStatus(`Enable stopped: ${error.message}`);
      return;
    }
    this.enabled = true;
    this.enableAt = Date.now();
    this.originalId = currentConversation()?.id || "";
    this.baseline = new Map(recentRows().map((row) => [row.id, row.timestamp]));
    this.processed.clear();
    this.states.clear();
    this.pending.clear();
    this.sent = [];
    this.sessionCount = 0;
    this.root.querySelector('[data-role="enable"]').hidden = true;
    this.root.querySelector('[data-role="stop"]').hidden = false;
    this.root.querySelector('[data-role="mode"]').textContent = "Enabled";
    this.channel?.postMessage("enabled");
    this.setStatus(
      this.scheduleOverride
        ? "Enabled with a one-session schedule override. Watching new messages only."
        : "Enabled. Watching new messages only.",
      "ok",
    );
    await this.debug?.write("enabled", { conversation: this.originalId });
    this.attachManualGuard();
    this.timer = setInterval(() => this.tick(), 3500);
    this.tick();
  }

  stop(reason) {
    this.enabled = false;
    this.scheduleOverride = false;
    clearInterval(this.timer);
    for (const timeout of this.pending.values()) clearTimeout(timeout);
    this.pending.clear();
    if (this.root) {
      this.root.querySelector('[data-role="enable"]').hidden = false;
      this.root.querySelector('[data-role="stop"]').hidden = true;
      this.root.querySelector('[data-role="mode"]').textContent = "Disabled";
    }
    this.setStatus(reason || "Disabled.");
    this.debug?.write("disabled", { reason });
  }

  attachManualGuard() {
    const composer = uniqueVisible('[role="textbox"][contenteditable="true"]');
    if (!composer || composer.dataset.chatbutGuard === "true") return;
    composer.dataset.chatbutGuard = "true";
    composer.addEventListener("beforeinput", (event) => {
      if (!event.isTrusted || !this.enabled) return;
      const conversation = currentConversation();
      if (!conversation) return;
      const state = this.states.get(conversation.id) || {};
      state.manual = true;
      this.states.set(conversation.id, state);
      this.debug?.write("manual_activity", { conversation: conversation.id });
    });
  }

  async tick() {
    if (!this.enabled || this.busy) return;
    if (!this.scheduleOverride && !isRuntimeScheduleActive(this.config)) {
      this.stop("The scheduled window closed. Enable again in the next window.");
      return;
    }
    this.busy = true;
    try {
      this.attachManualGuard();
      await this.acceptVisibleDirectRequest();
      await this.revealSpaceInvitation();
      await this.acceptVisibleSpaceInvitation();
      for (const row of recentRows()) {
        const baseline = this.baseline.get(row.id) || this.enableAt;
        if (row.timestamp > Math.max(baseline, this.enableAt) && !this.pending.has(row.id)) {
          await this.queueConversation(row.id);
        }
      }
    } catch (error) {
      this.debug?.write("tick_error", { message: error.message });
    } finally {
      this.busy = false;
    }
  }

  async queueConversation(id, invitationMessageIsNew = false) {
    const previousId = currentConversation()?.id || this.originalId;
    if (!(await navigateTo(id))) {
      await this.debug?.write("skip", { id, reason: "navigation_failed" });
      return;
    }
    const conversation = currentConversation();
    const message = conversation ? latestIncoming(conversation.main) : null;
    if (!conversation || !message || (!invitationMessageIsNew && this.processed.has(message.id))) {
      if (previousId) await navigateTo(previousId);
      return;
    }
    const target = { ...conversation, ...message };
    if (!isTargetAllowed(this.config, target)) {
      this.processed.add(message.id);
      await this.debug?.write("skip", { id, reason: "target_not_allowed" });
      if (previousId) await navigateTo(previousId);
      return;
    }
    const state = this.states.get(id) || {};
    const vaultName = selectVault(state, Date.now(), this.config.delays.followUpMinutes);
    if (!vaultName || state.manual) {
      this.processed.add(message.id);
      if (previousId) await navigateTo(previousId);
      return;
    }
    const delay = randomDelayMs(this.config.delays.minimumSeconds, this.config.delays.maximumSeconds);
    this.processed.add(message.id);
    const timeout = setTimeout(() => this.sendFor(id, vaultName, message.id), delay);
    this.pending.set(id, timeout);
    await this.debug?.write("queued", { id, vaultName, delay });
    if (previousId) await navigateTo(previousId);
  }

  async sendFor(id, vaultName, triggerId) {
    this.pending.delete(id);
    if (!this.enabled || (!this.scheduleOverride && !isRuntimeScheduleActive(this.config))) return;
    const now = Date.now();
    if (!maySend({ sessionCount: this.sessionCount, sentTimestamps: this.sent, now })) {
      this.stop("Safety limit reached. Enable again in the next scheduled window.");
      return;
    }
    const previousId = currentConversation()?.id || this.originalId;
    if (!(await navigateTo(id))) return;
    const conversation = currentConversation();
    const state = this.states.get(id) || {};
    if (!conversation || conversation.id !== id || state.manual) {
      if (previousId) await navigateTo(previousId);
      return;
    }
    const template = randomTemplate(this.config.responses[vaultName]);
    if (!template) return;
    let reply = template;
    let fallback = false;
    let stopAfterSend = false;
    if (this.config.llm.enabled) {
      try {
        const result = await this.requestBridge("chatbut:adapt", {
          template,
          messages: recentContext(conversation.main, this.config.llm.recentMessageCount),
          language: this.config.llm.language,
        }, ["chatbut:adapted"]);
        reply = normalizeDraft(result.text, template);
      } catch (error) {
        fallback = true;
        stopAfterSend = Boolean(error.fatal);
        await this.debug?.write("ai_fallback", { id, message: error.message });
      }
    }
    const composer = uniqueVisible('[role="textbox"][contenteditable="true"]', conversation.main);
    const send = [...conversation.main.querySelectorAll('button[aria-label*="Send message" i]')].filter(visible);
    if (!composer || send.length !== 1 || currentConversation()?.id !== id) {
      await this.debug?.write("skip", { id, reason: "composer_uncertain" });
      if (previousId) await navigateTo(previousId);
      return;
    }
    composer.focus();
    composer.textContent = reply;
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: reply }));
    await sleep(100);
    if (currentConversation()?.id !== id || send[0].disabled) {
      composer.textContent = "";
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
      if (previousId) await navigateTo(previousId);
      return;
    }
    send[0].click();
    const sentAt = Date.now();
    if (vaultName === "vault1") state.firstSentAt = sentAt;
    else state.secondSentAt = sentAt;
    this.states.set(id, state);
    this.sent.push(sentAt);
    this.sessionCount += 1;
    this.setStatus(`Sent ${vaultName === "vault1" ? "acknowledgement" : "follow-up"}. ${this.sessionCount}/20.`, "ok");
    await this.debug?.write("sent", { id, triggerId, vaultName, fallback, reply });
    if (previousId) await navigateTo(previousId);
    if (stopAfterSend) {
      this.stop("The saved response was sent, then Chatbut stopped because the active LLM connection needs attention.");
    }
  }

  async acceptVisibleDirectRequest() {
    if (!this.config.invitations.autoAcceptDirect) return;
    const request = [...document.querySelectorAll('[aria-label^="Message request from "]')].find(visible);
    if (!request) return;
    request.click();
    await sleep(500);
    const dialog = uniqueVisible('[role="alertdialog"]');
    const main = uniqueVisible(MAIN_SELECTOR);
    const bot = main?.querySelector('[data-origin-gsuite-app="1"], [data-member-id^="user/bot/"]');
    const accept = dialog
      ? [...dialog.querySelectorAll("button")].find((button) => /^accept$/i.test(textOf(button)) && visible(button))
      : null;
    if (!dialog || !main || bot || !accept) return;
    const id = main.dataset.groupId;
    accept.click();
    await sleep(600);
    this.baseline.set(id, 0);
    await this.saveConfig();
    await this.debug?.write("invitation_accepted", { type: "direct", id });
    await this.queueConversation(id, true);
  }

  async acceptVisibleSpaceInvitation() {
    if (!this.config.invitations.autoAcceptSpaces) return;
    const dialog = uniqueVisible('[role="alertdialog"]');
    if (!dialog || !/invited by/i.test(textOf(dialog))) return;
    const join = [...dialog.querySelectorAll("button")].find((button) => /^join$/i.test(textOf(button)) && visible(button));
    const bot = dialog.querySelector('[data-origin-gsuite-app="1"], [data-member-id^="user/bot/"]');
    if (!join || bot) return;
    join.click();
    await sleep(700);
    const conversation = currentConversation();
    if (!conversation || conversation.kind !== "space") return;
    const row = recentRows().find((item) => item.id === conversation.id);
    if (!this.config.targeting.selectedGroups.some((item) => item.id === conversation.id)) {
      this.config.targeting.selectedGroups.push({ id: conversation.id, label: row?.label || "Accepted Space" });
      await this.saveConfig();
    }
    this.baseline.set(conversation.id, 0);
    await this.debug?.write("invitation_accepted", { type: "space", id: conversation.id });
    await this.queueConversation(conversation.id, true);
  }

  async revealSpaceInvitation() {
    if (!this.config.invitations.autoAcceptSpaces) return;
    if (Date.now() - this.lastSpaceInviteScan < 60_000) return;
    this.lastSpaceInviteScan = Date.now();
    if (uniqueVisible('[role="alertdialog"]')) return;
    const originalId = currentConversation()?.id || this.originalId;
    const controls = [...document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]')]
      .filter(visible);
    const newChat = controls.find((node) => /^new chat$/i.test(
      node.getAttribute("aria-label") || textOf(node),
    ));
    if (!newChat) return;
    newChat.click();
    await sleep(350);
    const browse = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')]
      .filter(visible)
      .find((node) => /^browse spaces$/i.test(textOf(node)));
    if (!browse) {
      if (originalId) await navigateTo(originalId);
      return;
    }
    browse.click();
    await sleep(600);
    const invitation = [...document.querySelectorAll('[role="option"], [role="listitem"], button')]
      .filter(visible)
      .find((node) => /\binvited by\b/i.test(textOf(node)));
    if (!invitation) {
      if (originalId) await navigateTo(originalId);
      return;
    }
    invitation.click();
    await sleep(500);
    await this.debug?.write("space_invitation_found", {});
  }

  renderSearch(query, container) {
    container.replaceChildren();
    const ranked = recentRows()
      .map((row) => ({ ...row, score: fuzzyScore(query, row.label) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    for (const row of ranked) {
      const button = this.button(row.label, async () => {
        if (!this.config) {
          this.setStatus("Connect Chatbut first.");
          return;
        }
        const kind = conversationKind(row.id);
        const list = kind === "space"
          ? this.config.targeting.selectedGroups
          : this.config.targeting.directExclusions;
        const existing = list.findIndex((item) => item.id === row.id);
        if (existing >= 0) {
          list.splice(existing, 1);
          this.setStatus(`Removed ${row.label} from ${kind === "space" ? "Spaces" : "DM exclusions"}.`, "ok");
        } else {
          list.push({ id: row.id, label: row.label });
          this.setStatus(`Added ${row.label} to ${kind === "space" ? "Spaces" : "DM exclusions"}.`, "ok");
        }
        await this.saveConfig();
        this.renderSearch(query, container);
      });
      container.append(button);
    }
  }
}

new ChatbutRuntime().boot();
