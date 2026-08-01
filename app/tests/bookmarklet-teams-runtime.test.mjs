import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { DEFAULT_CONFIG } from "../src/config.js";

const runtimeSource = (await readFile(new URL("../public/chatbut-teams-bookmarklet.min.js", import.meta.url), "utf8")).trim();
const googleRuntimeSource = (await readFile(new URL("../public/chatbut-google-bookmarklet.min.js", import.meta.url), "utf8")).trim();
const artifact = (await readFile(new URL("../public/chatbut-teams-bookmarklet.txt", import.meta.url), "utf8")).trim();
const runtime = runtimeSource
  .replace("__CHATBUT_PAIRING_TOKEN__", "a".repeat(32))
  .replace("__CHATBUT_BRIDGE_URL__", "https://jiannystein.github.io/chatbut/chatbut-bridge.html");

function teamsRuntimeConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  return {
    ...config,
    platform: "teams",
    presence: config.platforms.teams.presence,
    targeting: config.platforms.teams.targeting,
    invitations: config.platforms.teams.invitations,
  };
}

function makeDom(url, {
  confirmResult = true,
  html = "<!doctype html><html><head></head><body></body></html>",
  rejectInnerHtml = false,
} = {}) {
  const openedWindows = [];
  const bridgeWindow = { closed: false };
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: "dangerously",
    beforeParse(window) {
      window.alertMessages = [];
      window.alert = (message) => window.alertMessages.push(String(message));
      window.confirm = () => confirmResult;
      window.BroadcastChannel = class { postMessage() {} close() {} };
      Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() { return this.parentElement || window.document.body; },
      });
      window.open = (openedUrl) => {
        openedWindows.push({ url: openedUrl });
        return bridgeWindow;
      };
    },
  });
  let restoreInnerHtml = () => {};
  if (rejectInnerHtml) {
    const descriptor = Object.getOwnPropertyDescriptor(dom.window.Element.prototype, "innerHTML");
    Object.defineProperty(dom.window.Element.prototype, "innerHTML", {
      ...descriptor,
      set() { throw new TypeError("This document requires TrustedHTML assignment."); },
    });
    restoreInnerHtml = () => Object.defineProperty(dom.window.Element.prototype, "innerHTML", descriptor);
  }
  return { dom, openedWindows, bridgeWindow, restoreInnerHtml };
}

test("Teams bookmarklet artifact decodes to its generated standalone runtime", () => {
  assert.match(artifact, /^javascript:/);
  assert.equal(decodeURIComponent(artifact.slice("javascript:".length)), runtimeSource);
  assert.notEqual(runtimeSource, googleRuntimeSource);
});

test("Teams bookmarklet refuses personal, legacy, and non-Teams pages", () => {
  for (const url of ["https://example.com/", "https://teams.live.com/v2/", "https://teams.microsoft.com/"]) {
    const { dom } = makeDom(url);
    dom.window.eval(runtime);
    assert.equal(dom.window.document.getElementById("chatbut-runtime"), null);
    assert.match(dom.window.alertMessages[0], /teams\.microsoft\.com\/v2/i);
    dom.window.close();
  }
});

test("Teams widget renders without an innerHTML sink under Trusted Types", () => {
  const { dom, openedWindows, restoreInnerHtml } = makeDom("https://teams.microsoft.com/v2/", { rejectInnerHtml: true });
  try {
    assert.doesNotThrow(() => dom.window.eval(runtime));
    const root = dom.window.document.getElementById("chatbut-runtime");
    assert.ok(root);
    assert.equal(root.querySelector('[data-role="status"]').getAttribute("role"), "status");
    assert.ok(root.querySelector(".cb-metrics"));
    assert.match(root.textContent, /Only new eligible messages · session safety limit 20/i);
    assert.match(root.textContent, /Installed bookmark v0\.3\.6/i);
    assert.ok(root.querySelector('[data-role="presence"]'));
    assert.ok(root.querySelector('[data-role="minimize"]'));
    assert.equal(openedWindows.length, 1);
  } finally {
    restoreInnerHtml();
    dom.window.close();
  }
});

test("Teams refuses configuration from a stale bridge that cannot provide the widget theme", () => {
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/");
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce },
      origin: "https://jiannystein.github.io",
      source: bridgeWindow,
      ports: [port],
    }));
    port.onmessage({ data: { type: "chatbut:config", nonce, config: teamsRuntimeConfig() } });
    assert.match(root.querySelector('[data-role="status"]').textContent, /reinstall/i);
    assert.equal(root.querySelector('[data-role="enable"]').disabled, true);
    assert.equal(root.chatbutRuntime.config, null);
  } finally {
    dom.window.close();
  }
});

test("Teams work or school v2 uses the two-tab handoff and excludes meetings from its index", async () => {
  const direct = "19:direct_runtime@unq.gbl.spaces";
  const group = "19:group_runtime@thread.v2";
  const meeting = "19:meeting_runtime@thread.v2";
  const channel = "19:channel_runtime@thread.skype";
  const html = `<!doctype html><html><head></head><body>
    <div role="treeitem" aria-level="1" aria-selected="true" data-item-type="chat" data-fui-tree-item-value="${direct}" aria-label="Direct"><span>Direct</span></div>
    <div role="treeitem" aria-level="1" data-item-type="chat" data-fui-tree-item-value="${group}" aria-label="Group"><span>Group</span></div>
    <div role="treeitem" aria-level="1" data-item-type="chat" data-fui-tree-item-value="${meeting}" aria-label="Meeting chat"><span>Meeting</span></div>
    <div role="treeitem" aria-level="2" data-item-type="team" data-chatbut-team-id="team-a" aria-expanded="true"><span>Team</span></div>
    <div role="treeitem" aria-level="3" data-item-type="channel" data-fui-tree-item-value="${channel}" aria-label="Channel"><span>Channel</span></div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/", { html });
  const sent = [];
  const port = { onmessage: null, start() {}, postMessage(message) { sent.push(message); } };
  try {
    dom.window.eval(runtime);
    assert.match(openedWindows[0].url, /\.handoff\.teams$/);
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce },
      origin: "https://jiannystein.github.io",
      source: bridgeWindow,
      ports: [port],
    }));
    port.onmessage({
      data: {
        type: "chatbut:config",
        nonce,
        config: teamsRuntimeConfig(),
        widgetCss: "#chatbut-runtime{border-radius:10px}#chatbut-runtime button:focus-visible{outline:3px solid}",
        fileName: "Browser-local configuration",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const update = sent.find((message) => message.type === "chatbut:update-config");
    assert.ok(update);
    assert.deepEqual(
      JSON.parse(JSON.stringify(update.config.targeting.indexedChats.map(({ kind }) => kind))),
      ["direct", "group-direct", "channel"],
    );
    assert.equal(update.config.targeting.indexedChats.some(({ id }) => id === meeting), false);
    assert.match(dom.window.document.querySelector("style").textContent, /border-radius:10px/);
    assert.match(dom.window.document.querySelector("style").textContent, /button:focus-visible/);
    assert.equal(dom.window.document.title, "Chatbut automation · Teams");
    assert.match(dom.window.document.querySelector('[data-role="enable"]').textContent, /^Starts in \d{2,}:\d{2}:\d{2}$/);
  } finally {
    dom.window.close();
  }
});

test("Teams ad-hoc presence applies on enable, locks, and resets on stop", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button data-tid="me-control-avatar-trigger">Profile</button>
    <div data-tid="me-control-menu-dialog" hidden>
      <span data-tid="me-control-displayname">Operator</span>
      <div role="menuitem" data-tid="set-presence-status-menu-item" aria-label="Available, change status">Available</div>
      <div role="menuitemradio" data-tid="me_control_presence_availability_available">Available</div>
      <div role="menuitemradio" data-tid="me_control_presence_availability_busy">Busy</div>
      <div role="menuitemradio" data-tid="me_control_presence_availability_appear_away">Away</div>
    </div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/", { html });
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    const status = dom.window.document.querySelector('[data-tid="set-presence-status-menu-item"]');
    const profile = dom.window.document.querySelector('[data-tid="me-control-avatar-trigger"]');
    const menu = dom.window.document.querySelector('[data-tid="me-control-menu-dialog"]');
    for (const element of [menu, ...menu.querySelectorAll("*")]) {
      Object.defineProperty(element, "offsetParent", {
        configurable: true,
        get() { return menu.hidden ? null : menu; },
      });
    }
    profile.addEventListener("click", () => { menu.hidden = !menu.hidden; });
    dom.window.document.querySelector('[data-tid="me_control_presence_availability_busy"]').addEventListener("click", () => {
      setTimeout(() => {
        const replacement = status.cloneNode(true);
        replacement.setAttribute("aria-label", "Busy, change status");
        status.replaceWith(replacement);
      }, 500);
    });
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce }, origin: "https://jiannystein.github.io", source: bridgeWindow, ports: [port],
    }));
    const config = teamsRuntimeConfig();
    config.presence = "available";
    config.schedule = { ...config.schedule, days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "00:00" }] };
    port.onmessage({ data: { type: "chatbut:config", nonce, config, widgetCss: "#chatbut-runtime main[hidden]{display:none}" } });
    const select = root.querySelector('[data-role="presence"]');
    assert.equal(select.value, "available");
    select.value = "busy";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    assert.equal(root.chatbutRuntime.enabled, true);
    assert.equal(dom.window.document.querySelector('[data-tid="set-presence-status-menu-item"]').getAttribute("aria-label"), "Busy, change status");
    assert.equal(menu.hidden, true);
    assert.equal(select.disabled, true);
    root.querySelector('[data-role="minimize"]').click();
    assert.equal(root.querySelector("main").hidden, true);
    assert.equal(root.chatbutRuntime.enabled, true);
    root.querySelector('[data-role="minimize"]').click();
    root.querySelector('[data-role="stop"]').click();
    assert.equal(select.disabled, false);
    assert.equal(select.value, "available");
  } finally {
    dom.window.close();
  }
});

test("Teams verifies Away when Out of office masks the availability label", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button data-tid="me-control-avatar-trigger">Profile</button>
    <div data-tid="me-control-menu-dialog">
      <span data-tid="me-control-displayname">Operator</span>
      <div role="menuitem" data-tid="set-presence-status-menu-item" aria-label="Available, Out of office, change status">Available, Out of office</div>
      <div role="menuitemradio" data-tid="me_control_presence_availability_appear_away">Away</div>
    </div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/", { html });
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    const status = dom.window.document.querySelector('[data-tid="set-presence-status-menu-item"]');
    dom.window.document.querySelector('[data-tid="me_control_presence_availability_appear_away"]').addEventListener("click", () => {
      setTimeout(() => {
        const replacement = status.cloneNode(true);
        replacement.setAttribute("aria-label", "Out of office, change status");
        status.replaceWith(replacement);
      }, 500);
    });
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce }, origin: "https://jiannystein.github.io", source: bridgeWindow, ports: [port],
    }));
    const config = teamsRuntimeConfig();
    config.presence = "away";
    config.schedule = { ...config.schedule, days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "00:00" }] };
    port.onmessage({ data: { type: "chatbut:config", nonce, config, widgetCss: "#chatbut-runtime{}" } });
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    assert.equal(root.chatbutRuntime.enabled, true);
    assert.equal(dom.window.document.querySelector('[data-tid="set-presence-status-menu-item"]').getAttribute("aria-label"), "Out of office, change status");
  } finally {
    dom.window.close();
  }
});

test("Teams presence ambiguity fails closed before automation starts", async () => {
  const html = `<!doctype html><html><head></head><body>
    <span data-tid="me-control-displayname">Operator</span>
    <button data-tid="me-control-avatar-trigger">One</button><button data-tid="me-control-avatar-trigger">Two</button>
    <div data-tid="set-presence-status-menu-item" aria-label="Available, change status">Available</div>
    <div data-tid="me_control_presence_availability_busy">Busy</div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/", { html });
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce }, origin: "https://jiannystein.github.io", source: bridgeWindow, ports: [port],
    }));
    const config = teamsRuntimeConfig();
    config.presence = "busy";
    config.schedule = { ...config.schedule, days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "00:00" }] };
    port.onmessage({ data: { type: "chatbut:config", nonce, config, widgetCss: "#chatbut-runtime{}" } });
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(root.chatbutRuntime.enabled, false);
    assert.equal(root.querySelector('[data-role="presence"]').disabled, false);
    assert.match(root.querySelector('[data-role="status"]').textContent, /Enable stopped.*presence/i);
  } finally {
    dom.window.close();
  }
});

test("Teams self chat sends two verified responses and caps the enabled session", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button data-tid="me-control-avatar-trigger" aria-label="Your profile">Profile</button>
    <button aria-label="Change the group profile picture">Group picture</button>
    <button data-tid="app-bar-chat" aria-label="Chat">Chat</button>
    <div role="treeitem" aria-level="2" aria-selected="true" tabindex="0" data-item-type="chat" data-fui-tree-item-value="self|chat|48:notes" aria-label="Self chat"><span>Self chat</span></div>
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Operator (You)</span><div data-tid="chat-pane-message" data-mid="baseline"><span data-message-content>Earlier note</span></div></div>
    <div role="textbox" contenteditable="true" data-tid="ckeditor"></div>
    <button data-tid="sendMessageCommands-send">Send</button>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/", { html });
  const sent = [];
  const port = {
    onmessage: null,
    start() {},
    postMessage(message) {
      sent.push(message);
      if (message.type === "chatbut:request-send-lease") {
        queueMicrotask(() => port.onmessage({
          data: {
            type: "chatbut:send-lease",
            nonce: message.nonce,
            requestId: message.requestId,
            granted: true,
            retryAfterMs: 0,
          },
        }));
      }
    },
  };
  const composer = dom.window.document.querySelector('[data-tid="ckeditor"]');
  const chatControl = dom.window.document.querySelector('[data-tid="app-bar-chat"]');
  let selfRow = dom.window.document.querySelector('[data-fui-tree-item-value="self|chat|48:notes"]');
  chatControl.addEventListener("click", () => {
    const replacement = selfRow.cloneNode(true);
    selfRow.replaceWith(replacement);
    selfRow = replacement;
  });
  const profile = dom.window.document.querySelector('[data-tid="me-control-avatar-trigger"]');
  profile.addEventListener("click", () => {
    dom.window.document.body.insertAdjacentHTML("beforeend", `
      <div data-tid="me-control-menu-dialog" style="position:fixed">
        <span data-tid="me-control-displayname">Operator</span>
      </div>
    `);
    for (const element of dom.window.document.querySelectorAll('[data-tid="me-control-menu-dialog"], [data-tid="me-control-displayname"]')) {
      Object.defineProperty(element, "offsetParent", { configurable: true, get: () => null });
      Object.defineProperty(element, "getClientRects", {
        configurable: true,
        value: () => [{ width: 80, height: 20 }],
      });
    }
  });
  const originalAddEventListener = composer.addEventListener.bind(composer);
  let beforeInput = null;
  let automatedResponseCount = 0;
  composer.addEventListener = (type, handler, options) => {
    if (type === "beforeinput") beforeInput = handler;
    return originalAddEventListener(type, handler, options);
  };
  composer.addEventListener("input", () => {
    if (!composer.textContent) return;
    const replacementComposer = composer.cloneNode(false);
    const paragraph = dom.window.document.createElement("p");
    paragraph.textContent = composer.textContent;
    replacementComposer.append(paragraph);
    composer.replaceWith(replacementComposer);
    const currentSend = dom.window.document.querySelector('[data-tid="sendMessageCommands-send"]');
    const replacementSend = currentSend.cloneNode(true);
    currentSend.replaceWith(replacementSend);
    replacementSend.addEventListener("click", () => {
      const sentText = replacementComposer.textContent;
      replacementComposer.textContent = "";
      const item = dom.window.document.createElement("div");
      item.dataset.tid = "chat-pane-item";
      const author = dom.window.document.createElement("span");
      author.dataset.tid = "message-author-name";
      author.textContent = "Operator (You)";
      const message = dom.window.document.createElement("div");
      message.dataset.tid = "chat-pane-message";
      automatedResponseCount += 1;
      message.dataset.mid = `automated-response-${automatedResponseCount}`;
      const content = dom.window.document.createElement("span");
      content.dataset.messageContent = "";
      content.textContent = sentText;
      message.append(content);
      item.append(author, message);
      dom.window.document.body.append(item);
    });
  });
  composer.ckeditorInstance = {
    setData(value) {
      composer.textContent = value;
    },
    model: {
      change(callback) {
        callback({ createText: (value) => value });
      },
      insertContent(value) {
        composer.textContent = value;
        composer.dispatchEvent(new dom.window.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: value,
        }));
      },
    },
  };
  dom.window.document.execCommand = () => true;
  const appendSelfMessage = (id, text) => {
    const item = dom.window.document.createElement("div");
    item.dataset.tid = "chat-pane-item";
    const author = dom.window.document.createElement("span");
    author.dataset.tid = "message-author-name";
    author.textContent = "Operator (You)";
    const message = dom.window.document.createElement("div");
    message.dataset.tid = "chat-pane-message";
    message.dataset.mid = id;
    const content = dom.window.document.createElement("span");
    content.dataset.messageContent = "";
    content.textContent = text;
    message.append(content);
    item.append(author, message);
    dom.window.document.body.append(item);
  };
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce },
      origin: "https://jiannystein.github.io",
      source: bridgeWindow,
      ports: [port],
    }));
    const config = teamsRuntimeConfig();
    config.delays.minimumSeconds = 1;
    config.delays.maximumSeconds = 1;
    config.delays.followUpMinutes = 0;
    config.responses.vault1 = ["Self reply"];
    config.responses.vault2 = ["Second self reply"];
    config.debug.enabled = true;
    port.onmessage({
      data: {
        type: "chatbut:config",
        nonce,
        config,
        widgetCss: "#chatbut-runtime{border-radius:10px}",
        fileName: "Browser-local configuration",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    root.querySelector('[data-role="override"]').click();
    for (let attempt = 0; attempt < 20 && root.querySelector('[data-role="mode"]').textContent !== "Enabled"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(root.querySelector('[data-role="mode"]').textContent, "Enabled");
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(typeof beforeInput, "function");
    const runtimeInstance = root.chatbutRuntime;
    const falseBooleanKeys = Object.entries(runtimeInstance)
      .filter(([, value]) => value === false)
      .map(([key]) => key);
    beforeInput({ isTrusted: true });
    const armedKeys = falseBooleanKeys.filter((key) => runtimeInstance[key] === true);
    assert.equal(armedKeys.length, 1);
    appendSelfMessage("manual-trigger-1", "Test this response");
    const prototype = Object.getPrototypeOf(runtimeInstance);
    const tickName = Object.getOwnPropertyNames(prototype).find((name) => (
      name !== "constructor" && typeof prototype[name] === "function" && String(prototype[name]).includes("tick_error")
    ));
    const collectName = Object.getOwnPropertyNames(prototype).find((name) => (
      name !== "constructor" && typeof prototype[name] === "function" && String(prototype[name]).includes('aria-expanded="false"')
    ));
    assert.ok(tickName);
    assert.ok(collectName);
    const collected = await runtimeInstance[collectName]();
    const collectedSelf = collected.find((item) => item.id === "48:notes");
    assert.ok(collectedSelf, JSON.stringify(collected));
    assert.ok(
      Object.values(collectedSelf).some((value) => value instanceof dom.window.HTMLElement),
      JSON.stringify(collectedSelf),
    );
    await runtimeInstance[tickName]();
    assert.equal(
      root.querySelector('[data-role="metric-pending"]').textContent,
      "1",
      JSON.stringify(sent.filter((message) => message.type === "chatbut:debug")),
    );
    await runtimeInstance[tickName]();
    assert.equal(
      root.querySelector('[data-role="metric-pending"]').textContent,
      "1",
      JSON.stringify(sent.filter((message) => message.type === "chatbut:debug")),
    );
    assert.equal(sent.some((message) => message.type === "chatbut:send-lease"), false);
    await new Promise((resolve) => setTimeout(resolve, 1_250));
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "1");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "0");
    assert.equal(root.querySelector('[data-role="metric-replies"]').textContent, "1");
    assert.equal(
      dom.window.document.querySelector('[data-mid="automated-response-1"] [data-message-content]').textContent,
      "Self reply",
    );
    beforeInput({ isTrusted: true });
    appendSelfMessage("manual-trigger-2", "Test the follow-up response");
    for (let attempt = 0; attempt < 20 && root.querySelector('[data-role="metric-pending"]').textContent !== "1"; attempt += 1) {
      await runtimeInstance[tickName]();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "1");
    await new Promise((resolve) => setTimeout(resolve, 2_250));
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "0");
    assert.equal(root.querySelector('[data-role="metric-replies"]').textContent, "2");
    assert.equal(
      dom.window.document.querySelector('[data-mid="automated-response-2"] [data-message-content]').textContent,
      "Second self reply",
    );
    beforeInput({ isTrusted: true });
    appendSelfMessage("manual-trigger-3", "Confirm the two-response cap");
    await runtimeInstance[tickName]();
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "0");
    assert.equal(root.querySelector('[data-role="metric-replies"]').textContent, "2");
    assert.equal(automatedResponseCount, 2);
  } finally {
    dom.window.close();
  }
});
