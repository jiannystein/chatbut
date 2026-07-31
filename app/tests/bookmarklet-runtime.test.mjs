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
      window.confirm = () => true;
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

test("bookmarklet revalidates the active LLM connection before enabling", async () => {
  const { dom, openedWindows, bridgeWindow } = makeDom(
    "https://chat.google.com/app/home",
  );
  const sent = [];
  const port = {
    onmessage: null,
    start() {},
    postMessage(message) {
      sent.push(message);
      if (message.type === "chatbut:validate-active") {
        queueMicrotask(() => port.onmessage({
          data: {
            type: "chatbut:active-valid",
            nonce: message.nonce,
            requestId: message.requestId,
            providerId: "deepseek",
            model: "deepseek-chat",
          },
        }));
      }
    },
  };
  const connection = {
    providerId: "deepseek",
    apiKey: "test-key",
    model: "deepseek-chat",
    status: "validated",
    validatedAt: new Date().toISOString(),
    error: "",
  };
  const config = {
    ...DEFAULT_CONFIG,
    schedule: {
      ...DEFAULT_CONFIG.schedule,
      days: [0, 1, 2, 3, 4, 5, 6],
      windows: [{ start: "00:00", end: "00:00" }],
    },
    llm: {
      ...DEFAULT_CONFIG.llm,
      enabled: true,
      activeProviderId: "deepseek",
      connections: [connection],
    },
  };
  try {
    dom.window.eval(runtime);
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
        config,
        fileName: "Browser-local configuration",
        debugReady: true,
      },
    });

    const root = dom.window.document.getElementById("chatbut-runtime");
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(sent.some((message) => message.type === "chatbut:validate-active"), true);
    assert.equal(root.querySelector('[data-role="mode"]').textContent, "Enabled");
    root.chatbutRuntime.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});

test("outside-schedule confirmation creates a one-session override", async () => {
  const { dom, openedWindows, bridgeWindow } = makeDom(
    "https://chat.google.com/app/home",
  );
  const port = { onmessage: null, start() {}, postMessage() {} };
  const tomorrow = (new Date().getDay() + 1) % 7;
  const config = {
    ...DEFAULT_CONFIG,
    schedule: {
      ...DEFAULT_CONFIG.schedule,
      days: [tomorrow],
      windows: [{ start: "00:00", end: "00:00" }],
    },
  };
  try {
    dom.window.eval(runtime);
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
        config,
        fileName: "Browser-local configuration",
        debugReady: true,
      },
    });

    const root = dom.window.document.getElementById("chatbut-runtime");
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(root.chatbutRuntime.scheduleOverride, true);
    assert.match(root.textContent, /one-session schedule override/i);
    root.chatbutRuntime.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});
