import { isScheduleActive, normalizeConfig, validateConfig } from "../config.js";
import { adaptResponse, validateDeepSeekKey } from "../deepseek.js";
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

class DebugWriter {
  constructor(folder, config) {
    this.folder = folder;
    this.config = config;
    this.index = 1;
  }

  async write(event, details = {}) {
    if (!this.folder) return;
    try {
      let handle;
      let file;
      do {
        handle = await this.folder.getFileHandle(
          `chatbut-debug-${String(this.index).padStart(3, "0")}.jsonl`,
          { create: true },
        );
        file = await handle.getFile();
        if (file.size >= this.config.debug.maximumLogBytes) this.index += 1;
      } while (file.size >= this.config.debug.maximumLogBytes);
      const line = `${JSON.stringify({
        at: new Date().toISOString(),
        event,
        details: redactLogValue(details, this.config.ai.apiKey),
      })}\n`;
      const writable = await handle.createWritable({ keepExistingData: true });
      await writable.seek(file.size);
      await writable.write(line);
      await writable.close();
    } catch {
      // Logging is diagnostic only and must never stop message monitoring.
    }
  }
}

class ChatbutRuntime {
  constructor() {
    this.root = null;
    this.config = null;
    this.configHandle = null;
    this.debug = null;
    this.enabled = false;
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
  }

  boot() {
    if (location.origin !== "https://chat.google.com" || !location.pathname.startsWith("/app")) {
      alert("Chatbut works only on https://chat.google.com/app/home");
      return;
    }
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      existing.hidden = !existing.hidden;
      return;
    }
    this.render();
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (event) => {
      if (event.data === "enabled" && this.enabled) this.stop("Another Google Chat tab enabled Chatbut.");
      if (event.data === "probe" && this.enabled) this.channel.postMessage("enabled");
    };
    this.channel.postMessage("probe");
    this.setStatus("Choose your local configuration file to begin.");
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
    const open = this.button("Choose file", () => this.openFile());
    const enable = this.button("Enable", () => this.enable());
    enable.className = "cb-primary";
    enable.dataset.role = "enable";
    enable.disabled = true;
    const stop = this.button("Stop", () => this.stop("Stopped by you."));
    stop.className = "cb-stop";
    stop.dataset.role = "stop";
    stop.hidden = true;
    actions.append(open, enable, stop);
    const search = document.createElement("div");
    search.className = "cb-search";
    const searchLabel = document.createElement("label");
    searchLabel.textContent = "Find recent chats to allow or exclude";
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search recent conversations";
    input.addEventListener("input", () => this.renderSearch(input.value, results));
    const results = document.createElement("div");
    results.className = "cb-results";
    search.append(searchLabel, input, results);
    const note = document.createElement("p");
    note.className = "cb-mini";
    note.textContent = "Runs only in this tab and stops on reload. No activity history is kept unless debug is enabled.";
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

  async openFile() {
    try {
      const [handle] = await showOpenFilePicker({
        multiple: false,
        types: [{ description: "Chatbut configuration", accept: { "application/json": [".json", ".chatbut"] } }],
      });
      const file = await handle.getFile();
      this.config = normalizeConfig(JSON.parse(await file.text()));
      this.configHandle = handle;
      this.root.querySelector('[data-role="enable"]').disabled = false;
      this.setStatus(`Loaded ${file.name}. Enable only when the schedule is open.`, "ok");
    } catch (error) {
      if (error?.name !== "AbortError") this.setStatus(`Could not load the file: ${error.message}`);
    }
  }

  async saveConfig() {
    if (!this.configHandle) return;
    const writable = await this.configHandle.createWritable();
    await writable.write(`${JSON.stringify(normalizeConfig(this.config), null, 2)}\n`);
    await writable.close();
  }

  async enable() {
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      this.setStatus(validation.errors.join(" "));
      return;
    }
    this.config = validation.config;
    if (!isScheduleActive(this.config)) {
      this.setStatus("Outside the configured time. Review your schedule, then try again.");
      return;
    }
    try {
      if (this.config.ai.enabled) {
        this.setStatus("Checking the DeepSeek key…");
        await validateDeepSeekKey(this.config.ai.apiKey);
      }
      if (this.config.debug.enabled) {
        const folder = await showDirectoryPicker({ mode: "readwrite" });
        this.debug = new DebugWriter(folder, this.config);
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
    this.setStatus("Enabled. Watching only messages that arrive from now on.", "ok");
    await this.debug?.write("enabled", { conversation: this.originalId });
    this.attachManualGuard();
    this.timer = setInterval(() => this.tick(), 3500);
    this.tick();
  }

  stop(reason) {
    this.enabled = false;
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
    if (!isScheduleActive(this.config)) {
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
    if (!this.enabled || !isScheduleActive(this.config)) return;
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
    if (this.config.ai.enabled) {
      try {
        reply = normalizeDraft(await adaptResponse({
          apiKey: this.config.ai.apiKey,
          template,
          messages: recentContext(conversation.main, this.config.ai.recentMessageCount),
          language: this.config.ai.language,
        }), template);
      } catch (error) {
        fallback = true;
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
    this.setStatus(`Sent ${vaultName === "vault1" ? "an acknowledgement" : "a follow-up"}. ${this.sessionCount}/20 this session.`, "ok");
    await this.debug?.write("sent", { id, triggerId, vaultName, fallback, reply });
    if (previousId) await navigateTo(previousId);
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
          this.setStatus("Choose a configuration file first.");
          return;
        }
        const kind = conversationKind(row.id);
        const list = kind === "space"
          ? this.config.targeting.selectedGroups
          : this.config.targeting.directExclusions;
        const existing = list.findIndex((item) => item.id === row.id);
        if (existing >= 0) {
          list.splice(existing, 1);
          this.setStatus(`Removed ${row.label} from the ${kind === "space" ? "Space allowlist" : "DM exclusion list"}.`, "ok");
        } else {
          list.push({ id: row.id, label: row.label });
          this.setStatus(`Added ${row.label} to the ${kind === "space" ? "Space allowlist" : "DM exclusion list"}.`, "ok");
        }
        await this.saveConfig();
        this.renderSearch(query, container);
      });
      container.append(button);
    }
  }
}

new ChatbutRuntime().boot();
