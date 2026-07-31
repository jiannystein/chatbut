import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { DEFAULT_CONFIG } from "../src/config.js";

const runtime = (await readFile(
  new URL("../public/chatbut-bookmarklet.min.js", import.meta.url),
  "utf8",
))
  .replace("__CHATBUT_PAIRING_TOKEN__", "a".repeat(32))
  .replace(
    "__CHATBUT_BRIDGE_URL__",
    "https://jiannystein.github.io/chatbut/chatbut-bridge.html",
  );

function makeDom(url, { popupBlocked = false } = {}) {
  const openedWindows = [];
  const bridgeWindow = { closed: false };
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url,
    pretendToBeVisual: true,
    runScripts: "dangerously",
    beforeParse(window) {
      window.alertMessages = [];
      window.alert = (message) => window.alertMessages.push(String(message));
      window.BroadcastChannel = class {
        postMessage() {}
        close() {}
      };
      window.open = (openedUrl, name, features) => {
        openedWindows.push({ url: openedUrl, name, features });
        return popupBlocked ? null : bridgeWindow;
      };
    },
  });
  return { dom, openedWindows, bridgeWindow };
}

test("bookmarklet refuses unsupported pages without injecting controls", () => {
  const { dom } = makeDom("https://example.com/");
  try {
    dom.window.eval(runtime);
    assert.equal(dom.window.document.getElementById("chatbut-runtime"), null);
    assert.match(dom.window.alertMessages[0], /chat\.google\.com/);
  } finally {
    dom.window.close();
  }
});

test("bookmarklet explains how to recover when Chrome blocks the helper popup", () => {
  const { dom } = makeDom(
    "https://chat.google.com/app/home",
    { popupBlocked: true },
  );
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    assert.ok(root);
    assert.match(root.textContent, /blocked the helper popup/i);
    assert.doesNotMatch(root.textContent, /Choose file/);
    assert.equal(root.querySelector('[data-role="mode"]').textContent, "Disabled");
    assert.equal(root.querySelector('[data-role="enable"]').disabled, true);
    assert.equal(root.querySelector('[data-role="stop"]').hidden, true);
  } finally {
    dom.window.close();
  }
});

test("bookmarklet receives an in-memory configuration from its trusted helper port", async () => {
  const { dom, openedWindows, bridgeWindow } = makeDom(
    "https://chat.google.com/app/home",
  );
  const sent = [];
  const port = {
    onmessage: null,
    start() {},
    postMessage(message) { sent.push(message); },
  };
  try {
    dom.window.eval(runtime);
    assert.equal(openedWindows.length, 1);
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: {
        type: "chatbut:bridge-port",
        nonce,
      },
      origin: "https://jiannystein.github.io",
      source: bridgeWindow,
      ports: [port],
    }));
    assert.equal(sent[0].type, "chatbut:request-config");
    port.onmessage({
      data: {
        type: "chatbut:config",
        nonce,
        config: DEFAULT_CONFIG,
        fileName: "chatbut.config.json",
        debugReady: true,
      },
    });

    const root = dom.window.document.getElementById("chatbut-runtime");
    assert.match(root.textContent, /Connected to chatbut\.config\.json/);
    assert.equal(root.querySelector('[data-role="enable"]').disabled, false);
    assert.equal(root.querySelector('[data-role="connect"]').hidden, true);

    await root.chatbutRuntime.saveConfig();
    assert.equal(sent.at(-1).type, "chatbut:update-config");
  } finally {
    dom.window.close();
  }
});

test("bookmarklet ignores configuration from the wrong origin or nonce", () => {
  const { dom, openedWindows, bridgeWindow } = makeDom(
    "https://chat.google.com/app/home",
  );
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    dom.window.eval(runtime);
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    const root = dom.window.document.getElementById("chatbut-runtime");
    const deliver = (origin, deliveredNonce) => dom.window.dispatchEvent(
      new dom.window.MessageEvent("message", {
        data: {
          type: "chatbut:bridge-port",
          nonce: deliveredNonce,
        },
        origin,
        source: bridgeWindow,
        ports: [port],
      }),
    );

    deliver("https://example.com", nonce);
    deliver("https://jiannystein.github.io", "wrong-nonce");

    assert.equal(root.querySelector('[data-role="enable"]').disabled, true);
    assert.doesNotMatch(root.textContent, /untrusted\.json/);
  } finally {
    dom.window.close();
  }
});
