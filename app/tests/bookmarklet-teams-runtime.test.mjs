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
    assert.match(root.textContent, /self-test 2/i);
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
    assert.match(root.querySelector('[data-role="status"]').textContent, /replace this bookmark/i);
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
  } finally {
    dom.window.close();
  }
});

test("trusted manual typing in Teams self chat queues one automatic test response", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button data-tid="me-control-avatar-trigger" aria-label="Your profile">Profile</button>
    <button aria-label="Change the group profile picture">Group picture</button>
    <div role="treeitem" aria-level="2" aria-selected="true" tabindex="0" data-item-type="chat" data-fui-tree-item-value="self|chat|48:notes" aria-label="Self chat"><span>Self chat</span></div>
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Operator (You)</span><div data-tid="chat-pane-message" data-mid="baseline"><span data-message-content>Earlier note</span></div></div>
    <div role="textbox" contenteditable="true" data-tid="ckeditor"></div>
    <button data-tid="sendMessageCommands-send">Send</button>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://teams.microsoft.com/v2/", { html });
  const sent = [];
  const port = { onmessage: null, start() {}, postMessage(message) { sent.push(message); } };
  const composer = dom.window.document.querySelector('[data-tid="ckeditor"]');
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
  composer.addEventListener = (type, handler, options) => {
    if (type === "beforeinput") beforeInput = handler;
    return originalAddEventListener(type, handler, options);
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
    port.onmessage({
      data: {
        type: "chatbut:config",
        nonce,
        config: teamsRuntimeConfig(),
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
    assert.equal(typeof beforeInput, "function");
    beforeInput({ isTrusted: true });
    dom.window.document.body.insertAdjacentHTML("beforeend", '<div data-tid="chat-pane-item"><span data-tid="message-author-name">Operator (You)</span><div data-tid="chat-pane-message" data-mid="manual-trigger"><span data-message-content>Test this response</span></div></div>');
    const runtimeInstance = root.chatbutRuntime;
    const prototype = Object.getPrototypeOf(runtimeInstance);
    const tickName = Object.getOwnPropertyNames(prototype).find((name) => (
      name !== "constructor" && typeof prototype[name] === "function" && String(prototype[name]).includes("tick_error")
    ));
    assert.ok(tickName);
    await runtimeInstance[tickName]();
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "1");
    await runtimeInstance[tickName]();
    assert.equal(root.querySelector('[data-role="metric-pending"]').textContent, "1");
    assert.equal(sent.some((message) => message.type === "chatbut:send-lease"), false);
  } finally {
    dom.window.close();
  }
});
