import {
  formatRuntimeCountdown,
  isRuntimeScheduleActive,
  nextRuntimeWindowStart,
  runtimeWindowEnd,
  validateRuntimeConfig,
} from "./runtime-config.js";
import {
  classifyConversation,
  isTargetAllowed,
  mayInspectConversation,
  maySend,
  mentionTargetsSelf,
  nonRepeatingTemplate,
  normalizeConversationLabel,
  normalizeDraft,
  randomDelayMs,
  redactLogValue,
  selectVault,
} from "./core.js";
import { isNewerRelease, RELEASE_VERSION } from "../release.js";

const ROOT_ID = "chatbut-runtime";
const CHANNEL_NAME = "chatbut-single-instance";
const PLATFORM_ID = "googleChat";
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

async function waitUnique(selector, root = document) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100);
    const match = uniqueVisible(selector, root);
    if (match) return match;
  }
  return null;
}

function appendElement(parent, tag, text = "", role = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (role) element.dataset.role = role;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function conversationSection(row) {
  if (row.closest('[aria-label*="list of spaces" i]')) return "space";
  if (row.closest('[aria-label*="direct messages" i]')) return "direct";
  return "unknown";
}

function safeLabel(row) {
  const blocked = /press tab|more options|open in a pop-up|unread|online|offline|away|active|busy|notifications?|conversation options|^conversation$|^options$/i;
  for (const node of row.querySelectorAll("*")) {
    if (node.children.length) continue;
    const label = normalizeConversationLabel(
      node.getAttribute("aria-label") || node.getAttribute("data-tooltip") || textOf(node),
      "",
    );
    if (label && label.length <= 120 && !blocked.test(label) && !/^\d{1,2}:\d{2}\b/.test(label)) {
      return label;
    }
  }
  return normalizeConversationLabel(textOf(row).slice(0, 100), row.dataset.groupId);
}

function recentRows() {
  return [...document.querySelectorAll(ROW_SELECTOR)]
    .filter(visible)
    .map((row) => {
      const section = conversationSection(row);
      return {
        id: row.dataset.groupId,
        label: safeLabel(row),
        kind: classifyConversation(row.dataset.groupId, section),
        timestamp: Number(row.dataset.displayTimestamp || 0),
        element: row,
      };
    })
    .filter((item) => item.id && item.kind !== "unknown");
}

function currentConversation() {
  const main = uniqueVisible(MAIN_SELECTOR);
  if (!main) return null;
  const id = main.dataset.groupId;
  const row = recentRows().find((item) => item.id === id);
  const sidebarRow = [...document.querySelectorAll(ROW_SELECTOR)]
    .find((item) => item.dataset.groupId === id);
  return {
    id,
    kind: row?.kind || classifyConversation(
      id,
      sidebarRow ? conversationSection(sidebarRow) : id.startsWith("dm/") ? "direct" : "unknown",
    ),
    main,
  };
}

function signedInEmail() {
  const accountControl = document.querySelector(
    'a[aria-label*="Google Account" i], button[aria-label*="Google Account" i]',
  );
  const label = accountControl?.getAttribute("aria-label") || "";
  return label.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || "";
}

function latestIncoming(main, selfEmail) {
  const groups = [...main.querySelectorAll(MESSAGE_SELECTOR)].filter(visible);
  const group = groups.at(-1);
  if (!group) return null;
  const author = group.querySelector("[data-message-id][data-member-id]");
  if (
    !author
    || author.dataset.originGsuiteApp === "1"
    || /^(you|你)$/i.test(textOf(author))
  ) return null;
  const mentionEmails = [...group.querySelectorAll("span[data-user-email]")]
    .map((node) => node.getAttribute("data-user-email"))
    .filter(Boolean);
  const repliedToSelf = Boolean(
    group.querySelector('[aria-label*="replied to you" i], [data-reply-to-self="true"]'),
  );
  return {
    id: group.dataset.id,
    userId: group.dataset.userId,
    memberId: author.dataset.memberId,
    text: textOf(group).slice(0, 1200),
    mentionedSelf: mentionTargetsSelf(mentionEmails, selfEmail),
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
  return `#${ROOT_ID}{position:fixed;z-index:2147483647;right:18px;bottom:18px;background:white}#${ROOT_ID} button{min-height:44px}`;
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
        { platform: PLATFORM_ID, ...details },
        this.config.llm.connections.map((connection) => connection.apiKey),
      ),
    });
  }
}

class ChatbutRuntime {
  constructor() {
    this.root = null;
    this.style = null;
    this.config = null;
    this.connectionNonce = "";
    this.bridgeWindow = null;
    this.bridgePort = null;
    this.connectionTimeout = null;
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
    this.sessionChats = new Set();
    this.originalId = "";
    this.lastSpaceInviteScan = 0;
    this.lastIndexSync = 0;
    this.selfEmail = "";
    this.channel = null;
    this.timer = null;
    this.countdownTimer = null;
    this.waitingForSchedule = false;
    this.activating = false;
    this.latestRelease = "";
    this.presenceTouched = false;
    this.busy = false;
    this.sending = false;
    this.sendChain = Promise.resolve();
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
      this.debug = this.config.debug.enabled
        ? new BridgeDebugWriter((type, payload) => this.sendBridge(type, payload), this.config)
        : null;
      this.syncConversationIndex();
      this.syncPresence();
      if (!this.enabled && !this.root.hidden) this.armSchedule();
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
    if (!event.data.widgetCss) {
      this.setStatus("Replace this bookmark from Chatbut.");
      return;
    }
    this.style.textContent = event.data.widgetCss;
    this.config = event.data.config;
    this.latestRelease = String(event.data["latestRelease"] || "");
    const configName = String(event.data.fileName || "local configuration");
    this.debug = this.config.debug.enabled
      ? new BridgeDebugWriter((type, payload) => this.sendBridge(type, payload), this.config)
      : null;
    this.root.querySelector('[data-role="connect"]').hidden = true;
    this.syncPresence();
    this.updateReleaseState();
    this.setStatus(`Connected to ${configName}.`, "ok");
    this.syncConversationIndex();
    this.armSchedule();
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
      `${BRIDGE_URL}#${PAIRING_TOKEN}.${this.connectionNonce}.handoff.${PLATFORM_ID}`,
      "_blank",
    );
    if (!this.bridgeWindow) {
      this.setStatus("Chrome blocked the helper tab. Allow it, then retry.");
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
      const runtime = existing.chatbutRuntime;
      if (!runtime?.config) runtime?.connectToConfigurator();
      else if (!runtime.enabled) runtime.armSchedule();
      return;
    }
    if (!window.confirm(
      "Chatbut will keep this tab open for automation and open a second Google Chat tab for normal use. Leave this tab open after enabling. Continue?",
    )) return;
    this.render();
    this.root.chatbutRuntime = this;
    this.selfEmail = signedInEmail();
    document.title = "Chatbut automation · Google Chat";
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
    this.style = style;
    this.root = document.createElement("section");
    this.root.id = ROOT_ID;
    this.root.setAttribute("aria-label", "Chatbut controls");
    const header = appendElement(this.root, "header");
    appendElement(header, "strong", "Chatbut");
    appendElement(header, "span", "Disabled", "mode");
    const windowControls = appendElement(header, "div", "", "", "cb-window");
    const minimize = appendElement(windowControls, "button", "−", "minimize");
    minimize.setAttribute("aria-label", "Minimize Chatbut");
    minimize.setAttribute("aria-expanded", "true");
    const close = appendElement(windowControls, "button", "×");
    close.setAttribute("aria-label", "Hide Chatbut");
    minimize.addEventListener("click", () => this.toggleMinimized());
    close.addEventListener("click", () => {
      if (!this.enabled) this.cancelScheduleWait();
      this.root.hidden = true;
    });
    const main = appendElement(this.root, "main");
    appendElement(main, "p", "", "status", "cb-status");
    const presence = appendElement(main, "label", "Presence", "", "cb-presence");
    const presenceSelect = appendElement(presence, "select", "", "presence");
    presenceSelect.setAttribute("aria-label", "Presence");
    for (const [value, label] of [["none", "No change"], ["active", "Active"], ["dnd", "Do not disturb"], ["away", "Away"]]) {
      const option = appendElement(presenceSelect, "option", label);
      option.value = value;
    }
    presenceSelect.addEventListener("change", () => { this.presenceTouched = true; });
    const metrics = appendElement(main, "dl", "", "", "cb-metrics");
    for (const [label, role] of [["Replies", "metric-replies"], ["Chats", "metric-chats"], ["Pending", "metric-pending"]]) {
      const metric = appendElement(metrics, "div");
      appendElement(metric, "dt", label);
      appendElement(metric, "dd", "0", role);
    }
    const actions = appendElement(main, "div", "", "", "cb-actions");
    const connect = appendElement(actions, "button", "Retry", "connect");
    const enable = appendElement(actions, "button", "Enable", "enable", "cb-primary");
    enable.disabled = true;
    const override = appendElement(actions, "button", "Enable now", "override");
    override.hidden = true;
    const stop = appendElement(actions, "button", "Stop", "stop", "cb-stop");
    stop.hidden = true;
    connect.addEventListener("click", () => this.connectToConfigurator());
    enable.addEventListener("click", () => this.enableNow());
    override.addEventListener("click", () => this.enableNow());
    stop.addEventListener("click", () => this.stop("Stopped by you."));
    const footer = appendElement(main, "div", "", "", "cb-footer");
    appendElement(footer, "p", "Only new eligible messages · session safety limit 20", "", "cb-mini");
    appendElement(footer, "p", "", "release", "cb-mini cb-release");
    document.body.append(this.root);
    this.updateMetrics();
  }

  setStatus(message, tone = "info") {
    const node = this.root?.querySelector('[data-role="status"]');
    if (node) {
      node.textContent = message;
      node.dataset.tone = tone;
    }
  }

  updateMetrics() {
    const metrics = {
      replies: this.sessionCount,
      chats: this.sessionChats.size,
      pending: this.pending.size,
    };
    for (const [role, value] of Object.entries(metrics)) {
      const node = this.root?.querySelector(`[data-role="metric-${role}"]`);
      if (node) node.textContent = String(value);
    }
  }

  updateReleaseState() {
    const node = this.root?.querySelector('[data-role="release"]');
    if (!node) return;
    if (isNewerRelease(this.latestRelease, RELEASE_VERSION)) {
      node.textContent = `Update available · installed v${RELEASE_VERSION}, latest v${this.latestRelease}. Replace the bookmark.`;
      node.dataset.tone = "warn";
    } else {
      node.textContent = `Installed bookmark v${RELEASE_VERSION}`;
      delete node.dataset.tone;
    }
  }

  toggleMinimized() {
    const main = this.root.querySelector("main");
    const button = this.root.querySelector('[data-role="minimize"]');
    main.hidden = !main.hidden;
    button.textContent = main.hidden ? "+" : "−";
    button.setAttribute("aria-label", main.hidden ? "Expand Chatbut" : "Minimize Chatbut");
    button.setAttribute("aria-expanded", String(!main.hidden));
  }

  syncPresence() {
    const select = this.root?.querySelector('[data-role="presence"]');
    if (select && !this.enabled && !this.activating && !this.presenceTouched) {
      select.value = this.config?.presence || "none";
    }
  }

  async applyPresence(scheduleOverride) {
    const select = this.root.querySelector('[data-role="presence"]');
    const value = select.value;
    if (value === "none") return;
    const control = uniqueVisible('[aria-label^="Status:"]');
    if (!control) throw new Error("Google Chat presence control was not found.");
    control.click();
    const selector = value === "active" ? '[role="menuitem"][jsname="pms6R"]'
      : value === "dnd" ? '[role="menuitem"][jsname="wJfO6e"]'
        : '[role="menuitem"][jsname="PCKjx"]';
    const item = await waitUnique(selector);
    if (!item) throw new Error("Google Chat presence menu was ambiguous.");
    item.click();
    if (value === "dnd") {
      const now = new Date();
      const target = scheduleOverride ? new Date(now.getTime() + 60 * 60 * 1_000) : runtimeWindowEnd(this.config, now);
      const remainingHours = Math.max(0.5, (target - now) / 3_600_000);
      const duration = [0.5, 1, 2, 4, 8, 24].find((hours) => hours >= remainingHours) || 24;
      let durationItem = null;
      for (let attempt = 0; attempt < 20 && !durationItem; attempt += 1) {
        await sleep(100);
        durationItem = [...document.querySelectorAll('[role="menuitem"]')]
          .filter(visible)
          .find((node) => textOf(node).startsWith(duration === 0.5 ? "30 min" : `${duration} hour`));
      }
      if (!durationItem) throw new Error("Google Chat DND duration was not found.");
      durationItem.click();
    }
    const expected = value === "active" ? /active|automatic/i : value === "dnd" ? /do not disturb/i : /away/i;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(100);
      if (expected.test(control.getAttribute("aria-label") || "")) return;
    }
    throw new Error("Google Chat did not confirm the requested presence.");
  }

  cancelScheduleWait() {
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    this.waitingForSchedule = false;
    const enable = this.root?.querySelector('[data-role="enable"]');
    const override = this.root?.querySelector('[data-role="override"]');
    if (enable) {
      enable.textContent = "Enable";
      enable.disabled = !this.config;
      enable.hidden = false;
    }
    if (override) override.hidden = true;
    if (!this.enabled) {
      const mode = this.root?.querySelector('[data-role="mode"]');
      if (mode) mode.textContent = "Disabled";
    }
  }

  armSchedule() {
    const wasWaiting = this.waitingForSchedule;
    this.cancelScheduleWait();
    if (!this.config || this.enabled) return;
    if (isRuntimeScheduleActive(this.config)) {
      if (wasWaiting) {
        this.activate(false);
        return;
      }
      this.setStatus("Schedule is open. Enable when ready.", "ok");
      return;
    }
    const next = nextRuntimeWindowStart(this.config);
    const enable = this.root.querySelector('[data-role="enable"]');
    const override = this.root.querySelector('[data-role="override"]');
    if (!next) {
      enable.disabled = true;
      this.setStatus("No upcoming window was found. Review the schedule in Chatbut.");
      return;
    }
    this.waitingForSchedule = true;
    enable.disabled = true;
    override.hidden = false;
    this.root.querySelector('[data-role="mode"]').textContent = "Waiting";
    this.setStatus("Waiting for the next window. Leave this tab open, or close the widget to cancel.");
    const update = () => {
      if (!this.waitingForSchedule || this.enabled) return;
      if (isRuntimeScheduleActive(this.config)) {
        this.cancelScheduleWait();
        this.activate(false);
        return;
      }
      enable.textContent = `Starts in ${formatRuntimeCountdown(next - Date.now())}`;
    };
    update();
    this.countdownTimer = setInterval(update, 1_000);
  }

  async saveConfig() {
    this.sendBridge("chatbut:update-config", {
      config: this.config,
    });
  }

  async syncConversationIndex() {
    if (!this.config || Date.now() - this.lastIndexSync < 1500) return;
    this.lastIndexSync = Date.now();
    const currentRows = recentRows().map(({ id, label, kind }) => ({
      id,
      label: normalizeConversationLabel(label),
      kind,
    }));
    if (!currentRows.length) return;
    const existing = Array.isArray(this.config.targeting.indexedChats)
      ? this.config.targeting.indexedChats
      : [];
    const byId = new Map(existing.map((item) => [item.id, item]));
    let changed = false;
    for (const item of currentRows) {
      const prior = byId.get(item.id);
      if (!prior || prior.label !== item.label || prior.kind !== item.kind) changed = true;
      byId.set(item.id, item);
    }
    const visibleIds = new Set(currentRows.map((item) => item.id));
    const next = [
      ...currentRows,
      ...[...byId.values()].filter((item) => !visibleIds.has(item.id)),
    ].slice(0, 200);
    if (!changed && next.length === existing.length) return;
    this.config.targeting.indexedChats = next;
    await this.saveConfig();
  }

  async enableNow() {
    const validation = validateRuntimeConfig(this.config);
    if (!validation.valid) {
      this.setStatus(validation.errors.join(" "));
      return;
    }
    this.config = validation.config;
    this.selfEmail = signedInEmail();
    const outsideSchedule = !isRuntimeScheduleActive(this.config);
    if (outsideSchedule) {
      if (!window.confirm("You are outside the configured schedule. Enable anyway until you stop Chatbut or reload this page?")) {
        this.armSchedule();
        return;
      }
    }
    await this.activate(outsideSchedule);
  }

  async activate(scheduleOverride) {
    if (this.enabled || this.activating) return;
    const validation = validateRuntimeConfig(this.config);
    if (!validation.valid) {
      this.setStatus(validation.errors.join(" "));
      return;
    }
    this.config = validation.config;
    if (!scheduleOverride && !isRuntimeScheduleActive(this.config)) {
      this.armSchedule();
      return;
    }
    this.activating = true;
    const presence = this.root.querySelector('[data-role="presence"]');
    presence.disabled = true;
    try {
      await this.applyPresence(scheduleOverride);
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
      this.activating = false;
      presence.disabled = false;
      return;
    }
    this.cancelScheduleWait();
    this.scheduleOverride = scheduleOverride;
    this.enabled = true;
    this.activating = false;
    this.enableAt = Date.now();
    this.originalId = currentConversation()?.id || "";
    this.baseline = new Map(recentRows().map((row) => [row.id, row.timestamp]));
    this.processed.clear();
    this.states.clear();
    this.pending.clear();
    this.sent = [];
    this.sessionCount = 0;
    this.sessionChats.clear();
    this.sendChain = Promise.resolve();
    this.updateMetrics();
    this.root.querySelector('[data-role="enable"]').hidden = true;
    this.root.querySelector('[data-role="stop"]').hidden = false;
    this.root.querySelector('[data-role="mode"]').textContent = "Enabled";
    this.channel?.postMessage("enabled");
    this.setStatus(
      this.scheduleOverride
        ? "Schedule overridden for this session. Watching new eligible messages."
        : "Watching new eligible messages.",
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
    this.activating = false;
    this.cancelScheduleWait();
    clearInterval(this.timer);
    for (const timeout of this.pending.values()) clearTimeout(timeout);
    this.pending.clear();
    this.updateMetrics();
    if (this.root) {
      const presence = this.root.querySelector('[data-role="presence"]');
      presence.disabled = false;
      this.presenceTouched = false;
      presence.value = this.config?.presence || "none";
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
      if (!event.isTrusted || !this.enabled || this.automating) return;
      const conversation = currentConversation();
      if (!conversation) return;
      const state = this.states.get(conversation.id) || {};
      state.manual = true;
      this.states.set(conversation.id, state);
      this.debug?.write("manual_activity", { conversation: conversation.id });
    });
  }

  async tick() {
    if (!this.enabled || this.busy || this.sending) return;
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
      if (Date.now() - this.lastIndexSync > 30_000) await this.syncConversationIndex();
      for (const row of recentRows()) {
        if (!mayInspectConversation(this.config, row)) continue;
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
    const message = conversation ? latestIncoming(conversation.main, this.selfEmail) : null;
    if (!conversation || !message || (!invitationMessageIsNew && this.processed.has(message.id))) {
      if (previousId) await navigateTo(previousId);
      return;
    }
    const target = { ...message, ...conversation };
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
    const timeout = setTimeout(() => {
      this.sendChain = this.sendChain
        .then(async () => {
          while (this.busy && this.enabled) await sleep(100);
          if (!this.enabled) {
            this.pending.delete(id);
            this.updateMetrics();
            return;
          }
          this.sending = true;
          try {
            await this.sendFor(id, vaultName, message.id);
          } finally {
            this.sending = false;
          }
        })
        .catch((error) => {
          this.pending.delete(id);
          this.updateMetrics();
          this.debug?.write("send_error", { id, message: error.message });
        });
    }, delay);
    this.pending.set(id, timeout);
    this.updateMetrics();
    await this.debug?.write("queued", { id, vaultName, delay });
    if (previousId) await navigateTo(previousId);
  }

  async sendFor(id, vaultName, triggerId) {
    this.pending.delete(id);
    this.updateMetrics();
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
    const templateHistory = state.usedTemplates?.[vaultName] || [];
    const template = nonRepeatingTemplate(this.config.responses[vaultName], {
      recentMessages: recentContext(conversation.main, 50),
      usedTemplates: templateHistory,
    });
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
    if (!this.enabled) return;
    const composer = uniqueVisible('[role="textbox"][contenteditable="true"]', conversation.main);
    const send = [...conversation.main.querySelectorAll('button[aria-label*="Send message" i]')].filter(visible);
    if (!composer || send.length !== 1 || currentConversation()?.id !== id) {
      await this.debug?.write("skip", { id, reason: "composer_uncertain" });
      if (previousId) await navigateTo(previousId);
      return;
    }
    this.automating = true;
    try {
      composer.focus();
      composer.textContent = reply;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: reply }));
      await sleep(1000);
      if (currentConversation()?.id !== id || send[0].disabled) {
        composer.textContent = "";
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
        await this.debug?.write("skip", { reason: "send_not_ready" });
        if (previousId) await navigateTo(previousId);
        return;
      }
      let lease;
      try {
        lease = await this.requestBridge(
          "chatbut:request-send-lease",
          {},
          ["chatbut:send-lease"],
          6_000,
        );
      } catch (error) {
        composer.textContent = "";
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
        await this.debug?.write("skip", { id, reason: "send_lease_unavailable", message: error.message });
        if (previousId) await navigateTo(previousId);
        return;
      }
      if (!lease.granted) {
        composer.textContent = "";
        composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
        this.setStatus("Global safety limit reached. Waiting for the five-minute window to clear.");
        await this.debug?.write("skip", { id, reason: "global_send_limit", retryAfterMs: lease.retryAfterMs });
        if (previousId) await navigateTo(previousId);
        return;
      }
      const messagesBeforeSend = new Set(
        [...conversation.main.querySelectorAll(MESSAGE_SELECTOR)].map((group) => group.dataset.id),
      );
      send[0].click();
      const verified = await this.markAutomatedSend(conversation.main, messagesBeforeSend);
      if (!verified) {
        this.stop("Send verification failed. Check Google Chat before enabling again.");
        return;
      }
    } finally {
      this.automating = false;
    }
    const sentAt = Date.now();
    if (vaultName === "vault1") state.firstSentAt = sentAt;
    else state.secondSentAt = sentAt;
    state.usedTemplates = {
      ...(state.usedTemplates || {}),
      [vaultName]: [...templateHistory, template].slice(-this.config.responses[vaultName].length),
    };
    this.states.set(id, state);
    this.sent.push(sentAt);
    this.sessionCount += 1;
    this.sessionChats.add(id);
    this.updateMetrics();
    this.setStatus("Reply sent. Watching new eligible messages.", "ok");
    await this.debug?.write("sent", { id, triggerId, vaultName, fallback, reply });
    if (previousId) await navigateTo(previousId);
    if (stopAfterSend) {
      this.stop("The saved response was sent, then Chatbut stopped because the active LLM connection needs attention.");
    }
  }

  async markAutomatedSend(main, previousIds) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(100);
      const groups = [...main.querySelectorAll(MESSAGE_SELECTOR)].filter(visible);
      const sentGroup = groups.find((group) => group.dataset.id && !previousIds.has(group.dataset.id));
      if (!sentGroup) continue;
      sentGroup.dataset.chatbutSelf = "true";
      this.processed.add(sentGroup.dataset.id);
      return true;
    }
    return false;
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
      this.config.targeting.selectedGroups.push({
        id: conversation.id,
        label: row?.label || "Accepted Space",
        kind: "space",
      });
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

}

new ChatbutRuntime().boot();
