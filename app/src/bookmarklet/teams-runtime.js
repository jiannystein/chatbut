import {
  isRuntimeScheduleActive,
  validateRuntimeConfig,
} from "./runtime-config.js";
import {
  isTargetAllowed,
  mayInspectConversation,
  nonRepeatingTemplate,
  normalizeDraft,
  randomDelayMs,
  selectVault,
} from "./core.js";
import {
  activeTeamsApp,
  activeTeamsConversation,
  findAcceptableTeamsRequest,
  latestTeamsIncoming,
  recentTeamsContext,
  teamsAppControl,
  teamsComposer,
  teamsConversationRows,
  teamsText,
  teamsUnreadTransition,
  teamsVisible,
  visibleTeamsSelfName,
} from "./teams-adapter.js";
import { RELEASE_VERSION } from "../release.js";

const ROOT_ID = "chatbut-runtime";
const PLATFORM_ID = "teams";
const SELF_CHAT_ID = "48:notes";
const CHANNEL_NAME = "chatbut-single-instance";
const PAIRING_TOKEN = "__CHATBUT_PAIRING_TOKEN__";
const BRIDGE_URL = "__CHATBUT_BRIDGE_URL__";
const BRIDGE_ORIGIN = new URL(BRIDGE_URL).origin;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function uniqueVisible(selector, root = document) {
  const matches = [...root.querySelectorAll(selector)].filter(teamsVisible);
  return matches.length === 1 ? matches[0] : null;
}

function appendElement(parent, tag, text = "", role = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (role) element.dataset.role = role;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function styleText() {
  return `#${ROOT_ID}{position:fixed;z-index:2147483647;right:18px;bottom:18px;width:296px;font:14px Arial;background:#fffaf0;color:#191713;border:1px solid}#${ROOT_ID} header,#${ROOT_ID} .cb-actions{display:flex}#${ROOT_ID} header{padding:10px;background:#1d1b18;color:white}#${ROOT_ID} header span{margin-left:auto}#${ROOT_ID} main{padding:12px}#${ROOT_ID} p{margin:8px 0}#${ROOT_ID} button{min-height:38px}#${ROOT_ID} .cb-actions button{flex:1}`;
}

class TeamsRuntime {
  constructor() {
    this.root = null;
    this.config = null;
    this.connectionNonce = "";
    this.bridgeWindow = null;
    this.bridgePort = null;
    this.connectionTimeout = null;
    this.bridgeRequests = new Map();
    this.enabled = false;
    this.scheduleOverride = false;
    this.waitingForSchedule = false;
    this.activating = false;
    this.countdownTimer = null;
    this.timer = null;
    this.channel = null;
    this.selfName = "";
    this.originalContext = null;
    this.unreadState = new Map();
    this.quarantined = new Set();
    this.processed = new Set();
    this.states = new Map();
    this.pending = new Map();
    this.sessionCount = 0;
    this.sessionChats = new Set();
    this.lastIndexSync = 0;
    this.lastChannelScan = 0;
    this.busy = false;
    this.sending = false;
    this.automating = false;
    this.sendChain = Promise.resolve();
    this.selfTestArmed = false;
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
      this.syncConversationIndex();
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
    if (event.data?.type === "chatbut:error") {
      clearTimeout(this.connectionTimeout);
      this.setStatus(String(event.data.message || "The configurator could not connect."));
      return;
    }
    if (event.data?.type !== "chatbut:config") return;
    clearTimeout(this.connectionTimeout);
    if (event.data.widgetCss) this.style.textContent = event.data.widgetCss;
    this.config = event.data.config;
    this.root.querySelector('[data-role="connect"]').hidden = true;
    this.setStatus(`Connected to ${String(event.data.fileName || "local configuration")}.`, "ok");
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

  sendBridge(type, payload = {}) {
    this.bridgePort?.postMessage({ type, nonce: this.connectionNonce, ...payload });
  }

  writeDebug(event, details = {}) {
    if (!this.config?.debug?.enabled) return;
    this.sendBridge("chatbut:debug", {
      at: new Date().toISOString(),
      event,
      details: { platform: PLATFORM_ID, ...details },
    });
  }

  requestConfig() {
    this.sendBridge("chatbut:request-config");
    clearTimeout(this.connectionTimeout);
    this.connectionTimeout = setTimeout(() => {
      if (!this.config) this.setStatus("No local configuration was found. Return to Chatbut, create one, then retry.");
    }, 6_000);
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
    if (!this.bridgeWindow) this.setStatus("Chrome blocked the helper tab. Allow it, then retry.");
  }

  boot() {
    if (location.origin !== "https://teams.microsoft.com" || !location.pathname.startsWith("/v2/")) {
      alert("Chatbut for Teams works only on https://teams.microsoft.com/v2/");
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
      "Chatbut will keep this tab open for Teams automation and open a second Teams tab for normal use. Leave this tab open after enabling. Continue?",
    )) return;
    this.render();
    this.root.chatbutRuntime = this;
    document.title = "Chatbut automation · Teams";
    window.addEventListener("message", this.handleWindowMessage);
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => {
      if (event.data === "enabled" && this.enabled) this.stop("Another Teams tab enabled Chatbut.");
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
    this.root.setAttribute("aria-label", "Chatbut Teams controls");
    const header = appendElement(this.root, "header");
    appendElement(header, "strong", `Chatbut v${RELEASE_VERSION}`);
    appendElement(header, "span", "Disabled", "mode");
    const close = appendElement(header, "button", "×", "", "cb-close");
    close.setAttribute("aria-label", "Hide Chatbut");
    const main = appendElement(this.root, "main");
    const status = appendElement(main, "p", "", "status", "cb-status");
    status.setAttribute("role", "status");
    const metrics = appendElement(main, "dl", "", "", "cb-metrics");
    for (const [label, role] of [["Replies", "metric-replies"], ["Chats", "metric-chats"], ["Pending", "metric-pending"]]) {
      const metric = appendElement(metrics, "div");
      appendElement(metric, "dt", label);
      appendElement(metric, "dd", "0", role);
    }
    const actions = appendElement(main, "div", "", "", "cb-actions");
    appendElement(actions, "button", "Retry", "connect");
    const enable = appendElement(actions, "button", "Enable", "enable", "cb-primary");
    enable.disabled = true;
    appendElement(actions, "button", "Enable now", "override").hidden = true;
    appendElement(actions, "button", "Stop", "stop", "cb-stop").hidden = true;
    appendElement(main, "p", "Only new messages · meetings ignored · self-test limit 2 · session limit 20", "", "cb-mini");
    this.root.querySelector(".cb-close").addEventListener("click", () => {
      if (!this.enabled) this.cancelScheduleWait();
      this.root.hidden = true;
    });
    this.root.querySelector('[data-role="connect"]').addEventListener("click", () => this.connectToConfigurator());
    this.root.querySelector('[data-role="enable"]').addEventListener("click", () => this.enableNow());
    this.root.querySelector('[data-role="override"]').addEventListener("click", () => this.enableNow());
    this.root.querySelector('[data-role="stop"]').addEventListener("click", () => this.stop("Stopped by you."));
    document.body.append(this.root);
    this.updateMetrics();
  }

  setStatus(message, tone = "") {
    if (!this.root) return;
    const status = this.root.querySelector('[data-role="status"]');
    status.textContent = message;
    status.dataset.tone = tone;
  }

  updateMetrics() {
    if (!this.root) return;
    this.root.querySelector('[data-role="metric-replies"]').textContent = String(this.sessionCount);
    this.root.querySelector('[data-role="metric-chats"]').textContent = String(this.sessionChats.size);
    this.root.querySelector('[data-role="metric-pending"]').textContent = String(this.pending.size);
  }

  cancelScheduleWait() {
    this.waitingForSchedule = false;
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
  }

  armSchedule() {
    this.cancelScheduleWait();
    if (!this.config || this.enabled) return;
    const validation = validateRuntimeConfig(this.config);
    const enable = this.root.querySelector('[data-role="enable"]');
    const override = this.root.querySelector('[data-role="override"]');
    if (!validation.valid) {
      enable.disabled = true;
      override.hidden = true;
      this.setStatus(validation.errors.join(" "));
      return;
    }
    if (isRuntimeScheduleActive(this.config)) {
      enable.disabled = false;
      enable.textContent = "Enable";
      override.hidden = true;
      this.root.querySelector('[data-role="mode"]').textContent = "Disabled";
      this.setStatus("Ready. Enable when this dedicated Teams tab can stay open.", "ok");
      return;
    }
    this.waitingForSchedule = true;
    enable.disabled = true;
    override.hidden = false;
    this.root.querySelector('[data-role="mode"]').textContent = "Waiting";
    enable.textContent = "Waiting";
    this.setStatus("Waiting for the next response window. Leave this tab open.");
    const update = () => {
      if (!this.waitingForSchedule || this.enabled) return;
      if (isRuntimeScheduleActive(this.config)) {
        this.cancelScheduleWait();
        this.activate(false);
      }
    };
    this.countdownTimer = setInterval(update, 1_000);
  }

  async switchApp(app) {
    const control = teamsAppControl(app);
    if (!control) return activeTeamsApp() === "combined";
    if (
      control.getAttribute("aria-selected") === "true"
      || control.getAttribute("aria-current") === "page"
    ) return true;
    control.click();
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await sleep(100);
      if (activeTeamsApp() === app || teamsConversationRows().some((item) => (
        app === "teams" ? item.kind === "channel" : item.kind !== "channel"
      ))) return true;
    }
    return false;
  }

  async collectRows({ includeChannels = false } = {}) {
    const originalApp = activeTeamsApp();
    const byId = new Map();
    const merge = (items) => {
      for (const item of items) {
        const prior = byId.get(item.id);
        if (!prior) byId.set(item.id, item);
        else if (prior.element !== item.element) byId.set(item.id, { ...prior, unread: prior.unread || item.unread, ambiguous: true, element: null });
      }
    };
    merge(teamsConversationRows());
    const chatControl = teamsAppControl("chat");
    if (chatControl && await this.switchApp("chat")) merge(teamsConversationRows());
    const collapsed = [];
    if (includeChannels && this.config.targeting.selectedChannels?.length) {
      const teamsControl = teamsAppControl("teams");
      if (!teamsControl || await this.switchApp("teams")) {
        const selectedParents = new Set(
          this.config.targeting.selectedChannels.map((item) => item.parentId).filter(Boolean),
        );
        for (const parent of document.querySelectorAll('[role="treeitem"][aria-level="2"][aria-expanded="false"]')) {
          const key = String(parent.getAttribute("data-chatbut-team-id") || parent.getAttribute("data-fui-tree-item-value") || "").trim();
          if (selectedParents.has(key) && teamsVisible(parent)) {
            parent.click();
            collapsed.push(parent);
            await sleep(150);
          }
        }
        merge(teamsConversationRows());
      }
    }
    for (const parent of collapsed.reverse()) {
      if (parent.getAttribute("aria-expanded") === "true") parent.click();
    }
    if (originalApp === "chat" || originalApp === "teams") await this.switchApp(originalApp);
    return [...byId.values()];
  }

  context() {
    const conversation = activeTeamsConversation();
    return { app: activeTeamsApp(), id: conversation?.id || "", kind: conversation?.kind || "" };
  }

  indexedConversation(id) {
    return this.config.targeting.indexedChats?.find((item) => item.id === id) || null;
  }

  async expandChannelParent(parentId) {
    if (!parentId) return true;
    const matches = [...document.querySelectorAll('[role="treeitem"][aria-level="2"]')]
      .filter(teamsVisible)
      .filter((row) => String(row.getAttribute("data-chatbut-team-id") || row.getAttribute("data-fui-tree-item-value") || "").trim() === parentId);
    if (matches.length !== 1) return false;
    if (matches[0].getAttribute("aria-expanded") === "false") {
      matches[0].click();
      await sleep(200);
    }
    return true;
  }

  async navigateTo(item) {
    if (!item?.id || item.ambiguous) return false;
    const app = item.kind === "channel" ? "teams" : "chat";
    if (!(await this.switchApp(app))) return false;
    if (item.kind === "channel" && !(await this.expandChannelParent(item.parentId))) return false;
    const matches = teamsConversationRows().filter((candidate) => candidate.id === item.id && !candidate.ambiguous && candidate.element);
    if (matches.length !== 1) return false;
    matches[0].element.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(150);
      if (activeTeamsConversation()?.id === item.id) return true;
    }
    return false;
  }

  async restoreContext(context) {
    if (!context) return;
    if (context.id) {
      const item = this.indexedConversation(context.id)
        || teamsConversationRows().find((candidate) => candidate.id === context.id);
      if (item && await this.navigateTo(item)) return;
    }
    if (context.app === "chat" || context.app === "teams") await this.switchApp(context.app);
  }

  async resolveSelfName() {
    let name = visibleTeamsSelfName();
    if (name) return name;
    const controls = [...document.querySelectorAll(
      '[data-tid="me-control-avatar-trigger"], button[aria-label*="account manager" i], button[aria-label*="profile" i]',
    )].filter(teamsVisible);
    if (controls.length !== 1) return "";
    controls[0].click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await sleep(100);
      name = visibleTeamsSelfName();
      if (name) break;
    }
    const dialog = uniqueVisible('[data-tid="me-control-menu-dialog"]');
    if (dialog) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return name;
  }

  async saveConfig() {
    this.sendBridge("chatbut:update-config", { config: this.config });
  }

  async syncConversationIndex(rows = null) {
    if (!this.config || Date.now() - this.lastIndexSync < 1_500) return;
    this.lastIndexSync = Date.now();
    const discovered = rows || await this.collectRows({ includeChannels: true });
    const currentRows = discovered
      .filter((item) => !item.ambiguous)
      .map(({ id, label, kind, parentId }) => ({
        id,
        label,
        kind,
        ...(parentId ? { parentId } : {}),
      }));
    if (!currentRows.length) return;
    const existing = Array.isArray(this.config.targeting.indexedChats) ? this.config.targeting.indexedChats : [];
    const byId = new Map(existing.map((item) => [item.id, item]));
    let changed = false;
    for (const item of currentRows) {
      const prior = byId.get(item.id);
      if (JSON.stringify(prior) !== JSON.stringify(item)) changed = true;
      byId.set(item.id, item);
    }
    const visibleIds = new Set(currentRows.map((item) => item.id));
    const next = [...currentRows, ...[...byId.values()].filter((item) => !visibleIds.has(item.id))].slice(0, 200);
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
    const outsideSchedule = !isRuntimeScheduleActive(this.config);
    if (outsideSchedule && !window.confirm(
      "You are outside the configured schedule. Enable anyway until you stop Chatbut or reload this page?",
    )) {
      this.armSchedule();
      return;
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
    if (!scheduleOverride && !isRuntimeScheduleActive(this.config)) {
      this.armSchedule();
      return;
    }
    this.activating = true;
    try {
      this.selfName = await this.resolveSelfName();
      if (!this.selfName) throw new Error("Your Teams profile identity could not be verified. Open the profile menu, close it, then retry.");
      if (this.config.llm.enabled) {
        this.setStatus("Checking the active LLM connection…");
        const result = await this.requestBridge("chatbut:validate-active", {}, ["chatbut:active-valid"]);
        const connection = this.config.llm.connections.find((item) => item.providerId === this.config.llm.activeProviderId);
        if (connection) {
          connection.model = result.model;
          connection.status = "validated";
          connection.error = "";
        }
      }
      this.originalContext = this.context();
      const rows = await this.collectRows({ includeChannels: true });
      this.unreadState = new Map(rows.map((row) => [row.id, row.unread]));
      this.quarantined = new Set(rows.filter((row) => row.unread).map((row) => row.id));
      await this.syncConversationIndex(rows);
    } catch (error) {
      this.setStatus(`Enable stopped: ${error.message}`);
      this.activating = false;
      return;
    }
    this.cancelScheduleWait();
    this.scheduleOverride = scheduleOverride;
    this.enabled = true;
    this.activating = false;
    this.processed.clear();
    this.states.clear();
    this.pending.clear();
    this.sessionCount = 0;
    this.sessionChats.clear();
    this.sendChain = Promise.resolve();
    this.selfTestArmed = false;
    this.root.querySelector('[data-role="enable"]').hidden = true;
    this.root.querySelector('[data-role="override"]').hidden = true;
    this.root.querySelector('[data-role="stop"]').hidden = false;
    this.root.querySelector('[data-role="mode"]').textContent = "Enabled";
    this.updateMetrics();
    this.channel?.postMessage("enabled");
    this.setStatus(
      scheduleOverride
        ? "Schedule overridden. Watching new eligible Teams messages; meeting chats stay ignored."
        : "Watching new eligible Teams messages; meeting chats stay ignored.",
      "ok",
    );
    this.writeDebug("enabled", { conversation: this.originalContext?.id, quarantined: this.quarantined.size });
    this.attachManualGuard();
    this.timer = setInterval(() => this.tick(), 3_500);
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
      this.root.querySelector('[data-role="enable"]').hidden = false;
      this.root.querySelector('[data-role="stop"]').hidden = true;
      this.root.querySelector('[data-role="mode"]').textContent = "Disabled";
    }
    this.setStatus(reason || "Disabled.");
    this.writeDebug("disabled", { reason });
  }

  attachManualGuard() {
    const state = teamsComposer();
    const composer = state?.composer;
    if (!composer || composer.dataset.chatbutGuard === "true") return;
    composer.dataset.chatbutGuard = "true";
    composer.addEventListener("beforeinput", (event) => {
      if (!event.isTrusted || !this.enabled || this.automating) return;
      const conversation = activeTeamsConversation();
      if (!conversation) return;
      if (conversation.id === SELF_CHAT_ID) {
        const prior = latestTeamsIncoming(document, this.selfName, true);
        if (prior) this.processed.add(prior.id);
        this.selfTestArmed = true;
        return;
      }
      const current = this.states.get(conversation.id) || {};
      current.manual = true;
      this.states.set(conversation.id, current);
      this.writeDebug("manual_activity", { conversation: conversation.id });
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
      await this.acceptVisibleRequest();
      const includeChannels = Date.now() - this.lastChannelScan >= 30_000;
      if (includeChannels) this.lastChannelScan = Date.now();
      const rows = await this.collectRows({ includeChannels });
      if (Date.now() - this.lastIndexSync > 30_000) await this.syncConversationIndex(rows);
      for (const row of rows) {
        if (row.ambiguous || !mayInspectConversation(this.config, row)) continue;
        if (row.id === SELF_CHAT_ID) continue;
        const previous = this.unreadState.get(row.id);
        if (this.quarantined.has(row.id)) {
          if (!row.unread) this.quarantined.delete(row.id);
          this.unreadState.set(row.id, row.unread);
          continue;
        }
        const isNew = teamsUnreadTransition(previous, row.unread, false);
        this.unreadState.set(row.id, row.unread);
        if (isNew && !this.pending.has(row.id)) await this.queueConversation(row);
      }
      if (this.selfTestArmed) {
        const active = activeTeamsConversation();
        const composer = teamsComposer();
        if (active?.id === SELF_CHAT_ID && composer && !composer.draft) {
          this.selfTestArmed = false;
          const row = rows.find((item) => item.id === SELF_CHAT_ID);
          if (row && !row.ambiguous && mayInspectConversation(this.config, row) && !this.pending.has(row.id)) {
            await this.queueConversation(row);
          }
        }
      }
    } catch (error) {
      this.writeDebug("tick_error", { message: error.message });
    } finally {
      this.busy = false;
    }
  }

  async queueConversation(item, force = false) {
    const previous = this.context();
    if (!(await this.navigateTo(item))) {
      this.writeDebug("skip", { id: item.id, reason: "navigation_failed" });
      return;
    }
    this.attachManualGuard();
    const conversation = activeTeamsConversation();
    const message = conversation ? latestTeamsIncoming(document, this.selfName, conversation.id === SELF_CHAT_ID) : null;
    if (!conversation || conversation.id !== item.id || !message || (!force && this.processed.has(message.id))) {
      await this.restoreContext(previous);
      return;
    }
    const target = { ...item, ...message };
    if (!isTargetAllowed(this.config, target)) {
      this.processed.add(message.id);
      this.writeDebug("skip", { id: item.id, reason: "target_not_allowed" });
      await this.restoreContext(previous);
      return;
    }
    const state = this.states.get(item.id) || {};
    const composerState = teamsComposer();
    if (!composerState || composerState.draft) {
      state.manual = Boolean(composerState?.draft) || state.manual;
      this.states.set(item.id, state);
      this.processed.add(message.id);
      this.writeDebug("skip", { id: item.id, reason: composerState?.draft ? "user_draft_present" : "composer_uncertain" });
      await this.restoreContext(previous);
      return;
    }
    const vaultName = selectVault(state, Date.now(), this.config.delays.followUpMinutes);
    if (!vaultName || state.manual) {
      this.processed.add(message.id);
      await this.restoreContext(previous);
      return;
    }
    const delay = randomDelayMs(this.config.delays.minimumSeconds, this.config.delays.maximumSeconds);
    this.processed.add(message.id);
    const timeout = setTimeout(() => {
      this.sendChain = this.sendChain.then(async () => {
        while (this.busy && this.enabled) await sleep(100);
        if (!this.enabled) {
          this.pending.delete(item.id);
          this.updateMetrics();
          return;
        }
        this.sending = true;
        try {
          await this.sendFor(item, vaultName, message.id);
        } finally {
          this.sending = false;
        }
      }).catch((error) => {
        this.pending.delete(item.id);
        this.updateMetrics();
        this.writeDebug("send_error", { id: item.id, message: error.message });
      });
    }, delay);
    this.pending.set(item.id, timeout);
    this.updateMetrics();
    this.writeDebug("queued", { id: item.id, vaultName, delay });
    await this.restoreContext(previous);
  }

  clearComposer(composer) {
    composer.textContent = "";
    composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContent" }));
  }

  async sendFor(item, vaultName, triggerId) {
    this.pending.delete(item.id);
    this.updateMetrics();
    if (!this.enabled || (!this.scheduleOverride && !isRuntimeScheduleActive(this.config))) return;
    if (this.sessionCount >= 20) {
      this.stop("Safety limit reached. Enable again in the next scheduled window.");
      return;
    }
    const previous = this.context();
    if (!(await this.navigateTo(item))) return;
    const state = this.states.get(item.id) || {};
    const incoming = latestTeamsIncoming(document, this.selfName, item.id === SELF_CHAT_ID);
    const composerState = teamsComposer();
    if (
      activeTeamsConversation()?.id !== item.id
      || state.manual
      || !incoming
      || incoming.id !== triggerId
      || !composerState
      || composerState.draft
    ) {
      if (composerState?.draft) {
        state.manual = true;
        this.states.set(item.id, state);
      }
      this.writeDebug("skip", { id: item.id, reason: composerState?.draft ? "user_draft_present" : "trigger_changed" });
      await this.restoreContext(previous);
      return;
    }
    const templateHistory = state.usedTemplates?.[vaultName] || [];
    const template = nonRepeatingTemplate(this.config.responses[vaultName], {
      recentMessages: recentTeamsContext(document, 50, this.selfName),
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
          messages: recentTeamsContext(document, this.config.llm.recentMessageCount, this.selfName),
          language: this.config.llm.language,
        }, ["chatbut:adapted"]);
        reply = normalizeDraft(result.text, template);
      } catch (error) {
        fallback = true;
        stopAfterSend = Boolean(error.fatal);
        this.writeDebug("ai_fallback", { id: item.id, message: error.message });
      }
    }
    if (!this.enabled) return;
    const { composer, send } = composerState;
    this.automating = true;
    try {
      composer.focus();
      composer.textContent = reply;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: reply }));
      await sleep(700);
      const ready = teamsComposer();
      if (
        activeTeamsConversation()?.id !== item.id
        || !ready
        || ready.composer !== composer
        || ready.send !== send
        || !ready.ready
        || ready.draft !== reply
      ) {
        this.clearComposer(composer);
        this.writeDebug("skip", { id: item.id, reason: "send_not_ready" });
        await this.restoreContext(previous);
        return;
      }
      let lease;
      try {
        lease = await this.requestBridge("chatbut:request-send-lease", {}, ["chatbut:send-lease"], 6_000);
      } catch (error) {
        this.clearComposer(composer);
        this.writeDebug("skip", { id: item.id, reason: "send_lease_unavailable", message: error.message });
        await this.restoreContext(previous);
        return;
      }
      if (!lease.granted) {
        this.clearComposer(composer);
        this.setStatus("Global safety limit reached. Waiting for the five-minute window to clear.");
        this.writeDebug("skip", { id: item.id, reason: "global_send_limit", retryAfterMs: lease.retryAfterMs });
        await this.restoreContext(previous);
        return;
      }
      const before = new Set(
        [...document.querySelectorAll('[data-tid="chat-pane-message"][data-mid]')]
          .map((message) => message.getAttribute("data-mid")),
      );
      send.click();
      let sentId = "";
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await sleep(150);
        const candidate = [...document.querySelectorAll('[data-tid="chat-pane-message"][data-mid]')]
          .filter(teamsVisible)
          .find((message) => {
            const id = message.getAttribute("data-mid");
            if (!id || before.has(id)) return false;
            const author = teamsText(
              message.closest('[data-tid="chat-pane-item"]')?.querySelector('[data-tid="message-author-name"]'),
            ).replace(/\s*\(you\)\s*$/i, "").trim();
            return author === this.selfName;
          });
        if (candidate && !teamsComposer()?.draft) {
          sentId = candidate.getAttribute("data-mid");
          break;
        }
      }
      if (!sentId) {
        this.stop("Send verification failed. Check Teams before enabling again.");
        return;
      }
      this.processed.add(sentId);
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
    this.states.set(item.id, state);
    this.sessionCount += 1;
    this.sessionChats.add(item.id);
    this.updateMetrics();
    this.setStatus("Reply sent. Watching new eligible Teams messages.", "ok");
    this.writeDebug("sent", { id: item.id, triggerId, vaultName, fallback, reply });
    await this.restoreContext(previous);
    if (stopAfterSend) this.stop("The saved response was sent, then Chatbut stopped because the active LLM connection needs attention.");
  }

  async acceptVisibleRequest() {
    if (!this.config.invitations.autoAcceptDirect) return;
    const candidate = findAcceptableTeamsRequest();
    if (!candidate) return;
    candidate.accept.click();
    await sleep(700);
    const item = teamsConversationRows().find((row) => row.id === candidate.id && !row.ambiguous);
    if (!item) {
      this.writeDebug("skip", { id: candidate.id, reason: "accepted_request_not_found" });
      return;
    }
    this.unreadState.set(item.id, false);
    this.quarantined.delete(item.id);
    this.writeDebug("invitation_accepted", { type: "direct", id: item.id });
    await this.queueConversation(item, true);
  }
}

new TeamsRuntime().boot();
