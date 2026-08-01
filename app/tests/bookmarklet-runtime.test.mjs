import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
import { DEFAULT_CONFIG } from "../src/config.js";

function googleRuntimeConfig() {
  const config = structuredClone(DEFAULT_CONFIG);
  return {
    ...config,
    platform: "googleChat",
    presence: config.platforms.googleChat.presence,
    targeting: config.platforms.googleChat.targeting,
    invitations: config.platforms.googleChat.invitations,
  };
}

const runtimeSource = (await readFile(
  new URL("../public/chatbut-bookmarklet.min.js", import.meta.url),
  "utf8",
)).trim();
const bookmarkletArtifact = (await readFile(
  new URL("../public/chatbut-bookmarklet.txt", import.meta.url),
  "utf8",
)).trim();
const runtime = runtimeSource
  .replace("__CHATBUT_PAIRING_TOKEN__", "a".repeat(32))
  .replace(
    "__CHATBUT_BRIDGE_URL__",
    "https://jiannystein.github.io/chatbut/chatbut-bridge.html",
  );
const widgetCss = "#chatbut-runtime{border-radius:10px}#chatbut-runtime main[hidden]{display:none}";

test("distributed bookmarklet decodes to the generated runtime", () => {
  assert.match(bookmarkletArtifact, /^javascript:/);
  assert.equal(
    decodeURIComponent(bookmarkletArtifact.slice("javascript:".length)),
    runtimeSource,
  );
});

function makeDom(url, {
  popupBlocked = false,
  confirmResult = true,
  html = "<!doctype html><html><head></head><body></body></html>",
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
      window.confirmMessages = [];
      window.confirm = (message) => {
        window.confirmMessages.push(String(message));
        return confirmResult;
      };
      window.BroadcastChannel = class {
        postMessage() {}
        close() {}
      };
      Object.defineProperty(window.HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() { return this.parentElement || window.document.body; },
      });
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

test("bookmarklet explains the two-tab handoff and respects cancellation", () => {
  const { dom, openedWindows } = makeDom(
    "https://chat.google.com/app/home",
    { confirmResult: false },
  );
  try {
    dom.window.eval(runtime);
    assert.equal(dom.window.document.getElementById("chatbut-runtime"), null);
    assert.equal(openedWindows.length, 0);
    assert.match(dom.window.confirmMessages[0], /keep this tab open for automation/i);
    assert.match(dom.window.confirmMessages[0], /second Google Chat tab/i);
    assert.match(dom.window.confirmMessages[0], /leave this tab open/i);
  } finally {
    dom.window.close();
  }
});

test("bookmarklet indexes direct, group-DM, and Space rows with safe labels", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button aria-label="Google Account: Test User (test@example.com)"></button>
    <section aria-label="List of direct messages.">
      <div role="listitem" data-group-id="dm/person" data-display-timestamp="10">
        <span>Away</span><span>Unread</span><span dir="auto">Direct Person</span>
        <button>Open in a pop-up</button><button>Options</button>
      </div>
      <div role="listitem" data-group-id="space/group-dm" data-display-timestamp="20">
        <span aria-label="Press tab for more options."></span><span dir="auto">Project Group</span>
      </div>
    </section>
    <section aria-label="List of spaces.">
      <div role="listitem" data-group-id="space/project" data-display-timestamp="30">
        <span aria-label="Press tab for more options."></span><span dir="auto">Project Space</span>
      </div>
    </section>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom(
    "https://chat.google.com/app/home",
    { html },
  );
  const sent = [];
  const port = {
    onmessage: null,
    start() {},
    postMessage(message) { sent.push(message); },
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
        config: googleRuntimeConfig(),
        widgetCss,
        fileName: "Browser-local configuration",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const update = sent.find((message) => message.type === "chatbut:update-config");
    assert.ok(update);
    assert.deepEqual(
      JSON.parse(JSON.stringify(
        update.config.targeting.indexedChats.map(({ label, kind }) => ({ label, kind })),
      )),
      [
        { label: "Direct Person", kind: "direct" },
        { label: "Project Group", kind: "group-direct" },
        { label: "Project Space", kind: "space" },
      ],
    );
  } finally {
    dom.window.close();
  }
});

test("delayed sends for several chats are serialized instead of racing navigation", async () => {
  const ids = ["dm/original", "dm/one", "dm/two", "dm/three"];
  const rows = ids.map((id) => `
    <div role="listitem" data-group-id="${id}" data-display-timestamp="${Date.now() + 10_000}">
      <span dir="auto">${id}</span>
    </div>
  `).join("");
  const html = `<!doctype html><html><head></head><body>
    <section aria-label="List of direct messages.">${rows}</section>
    <main role="main" data-group-id="dm/original"></main>
  </body></html>`;
  const { dom } = makeDom("https://chat.google.com/app/home", { html });
  try {
    const main = dom.window.document.querySelector("main");
    for (const row of dom.window.document.querySelectorAll('[role="listitem"]')) {
      row.addEventListener("click", () => {
        main.dataset.groupId = row.dataset.groupId;
        main.innerHTML = `
          <div role="group" data-id="message-${row.dataset.groupId}" data-user-id="sender">
            <span data-message-id="message-${row.dataset.groupId}" data-member-id="user/sender">Hello</span>
          </div>
        `;
      });
    }
    dom.window.eval(runtime);
    const runtimeInstance = dom.window.document.getElementById("chatbut-runtime").chatbutRuntime;
    runtimeInstance.config = {
      ...googleRuntimeConfig(),
      delays: { minimumSeconds: 1, maximumSeconds: 1, followUpMinutes: 1 },
    };
    runtimeInstance.enabled = true;
    const events = [];
    runtimeInstance.sendFor = async (id) => {
      events.push(`start:${id}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push(`end:${id}`);
    };

    await runtimeInstance.queueConversation("dm/one");
    await runtimeInstance.queueConversation("dm/two");
    await runtimeInstance.queueConversation("dm/three");
    await new Promise((resolve) => setTimeout(resolve, 1_150));

    assert.deepEqual(events, [
      "start:dm/one", "end:dm/one",
      "start:dm/two", "end:dm/two",
      "start:dm/three", "end:dm/three",
    ]);
  } finally {
    dom.window.close();
  }
});

test("the rendered You author label prevents outgoing messages from becoming triggers", async () => {
  const html = `<!doctype html><html><head></head><body>
    <section aria-label="List of direct messages.">
      <div role="listitem" data-group-id="dm/person" data-display-timestamp="${Date.now() + 10_000}">
        <span>Direct Person</span>
      </div>
    </section>
    <main role="main" data-group-id="dm/person">
      <div role="group" data-id="outgoing-message" data-user-id="self">
        <span
          data-message-id="outgoing-message"
          data-member-id="user/self"
          data-compare-to-self-user="true"
        >You</span>
      </div>
    </main>
  </body></html>`;
  const { dom } = makeDom("https://chat.google.com/app/home", { html });
  try {
    dom.window.eval(runtime);
    const runtimeInstance = dom.window.document.getElementById("chatbut-runtime").chatbutRuntime;
    runtimeInstance.config = googleRuntimeConfig();
    runtimeInstance.enabled = true;
    runtimeInstance.enableAt = 0;

    await runtimeInstance.queueConversation("dm/person");

    assert.equal(runtimeInstance.pending.size, 0);
    assert.equal(runtimeInstance.processed.has("outgoing-message"), false);
  } finally {
    dom.window.close();
  }
});

test("comparison metadata shared by both authors does not hide an incoming message", async () => {
  const html = `<!doctype html><html><head></head><body>
    <section aria-label="List of direct messages.">
      <div role="listitem" data-group-id="dm/person" data-display-timestamp="${Date.now() + 10_000}">
        <span>Direct Person</span>
      </div>
    </section>
    <main role="main" data-group-id="dm/person">
      <div role="group" data-id="incoming-message" data-user-id="sender">
        <span
          data-message-id="incoming-message"
          data-member-id="user/sender"
          data-compare-to-self-user="true"
          data-show-self-user-as-you="true"
        >Direct Person</span>
      </div>
    </main>
  </body></html>`;
  const { dom } = makeDom("https://chat.google.com/app/home", { html });
  try {
    dom.window.eval(runtime);
    const runtimeInstance = dom.window.document.getElementById("chatbut-runtime").chatbutRuntime;
    runtimeInstance.config = {
      ...googleRuntimeConfig(),
      delays: { minimumSeconds: 1, maximumSeconds: 1, followUpMinutes: 1 },
    };
    runtimeInstance.enabled = true;
    runtimeInstance.enableAt = 0;

    await runtimeInstance.queueConversation("dm/person");

    assert.equal(runtimeInstance.pending.has("dm/person"), true);
    assert.equal(runtimeInstance.processed.has("incoming-message"), true);
    runtimeInstance.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});

test("a selected Space keeps its classification when its sidebar row becomes hidden", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button aria-label="Google Account: Test User (test@example.com)"></button>
    <section aria-label="List of direct messages.">
      <div role="listitem" data-group-id="dm/original" data-display-timestamp="1">
        <span>Original chat</span>
      </div>
    </section>
    <section aria-label="List of spaces.">
      <div role="listitem" data-group-id="space/project" data-display-timestamp="${Date.now() + 10_000}">
        <span>Project Space</span>
      </div>
    </section>
    <main role="main" data-group-id="dm/original"></main>
  </body></html>`;
  const { dom } = makeDom("https://chat.google.com/app/home", { html });
  try {
    const main = dom.window.document.querySelector("main");
    const spaceRow = dom.window.document.querySelector('[data-group-id="space/project"]');
    spaceRow.addEventListener("click", () => {
      Object.defineProperty(spaceRow, "offsetParent", { configurable: true, get: () => null });
      main.dataset.groupId = "space/project";
      main.innerHTML = `
        <div role="group" data-id="space-message" data-user-id="sender">
          <span data-message-id="space-message" data-member-id="user/sender">Sender</span>
          <span data-user-email="test@example.com" data-user-mention-type="3">Test User</span>
        </div>
      `;
    });
    dom.window.eval(runtime);
    const runtimeInstance = dom.window.document.getElementById("chatbut-runtime").chatbutRuntime;
    runtimeInstance.config = {
      ...googleRuntimeConfig(),
      targeting: {
        ...structuredClone(DEFAULT_CONFIG.platforms.googleChat.targeting),
        selectedGroups: [{ id: "space/project", label: "Project Space", kind: "space" }],
      },
      delays: { minimumSeconds: 60, maximumSeconds: 60, followUpMinutes: 1 },
    };
    runtimeInstance.enabled = true;
    runtimeInstance.enableAt = 0;
    runtimeInstance.selfEmail = "test@example.com";
    const debugEvents = [];
    runtimeInstance.debug = {
      async write(event, details) { debugEvents.push({ event, details }); },
    };

    await runtimeInstance.queueConversation("space/project");

    assert.equal(runtimeInstance.pending.has("space/project"), true, JSON.stringify({
      currentId: main.dataset.groupId,
      processed: [...runtimeInstance.processed],
      debugEvents,
    }));
    assert.equal(runtimeInstance.processed.has("space-message"), true);
    runtimeInstance.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});

test("a Space reply waits for Google Chat to enable its send control", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button aria-label="Google Account: Test User (test@example.com)"></button>
    <section aria-label="List of spaces.">
      <div role="listitem" data-group-id="space/project" data-display-timestamp="1">
        <span>Project Space</span>
      </div>
    </section>
    <main role="main" data-group-id="space/project">
      <div role="group" data-id="space-message" data-user-id="sender">
        <span data-message-id="space-message" data-member-id="user/sender">Sender</span>
        <span data-user-email="test@example.com" data-user-mention-type="3">Test User</span>
      </div>
      <div role="textbox" contenteditable="true"></div>
      <button aria-label="Send message" disabled>Send</button>
    </main>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://chat.google.com/app/home", { html });
  const port = {
    onmessage: null,
    start() {},
    postMessage(message) {
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
  try {
    const main = dom.window.document.querySelector("main");
    const composer = main.querySelector('[role="textbox"]');
    const send = main.querySelector('[aria-label="Send message"]');
    composer.addEventListener("input", () => {
      if (!composer.textContent) {
        send.disabled = true;
        return;
      }
      setTimeout(() => { send.disabled = false; }, 300);
    });
    send.addEventListener("click", () => {
      main.insertAdjacentHTML("beforeend", `
        <div role="group" data-id="outgoing-space-message" data-user-id="self">
          <span data-message-id="outgoing-space-message" data-member-id="user/self">You</span>
        </div>
      `);
    });
    dom.window.eval(runtime);
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce },
      origin: "https://jiannystein.github.io",
      source: bridgeWindow,
      ports: [port],
    }));
    const runtimeInstance = dom.window.document.getElementById("chatbut-runtime").chatbutRuntime;
    runtimeInstance.config = {
      ...googleRuntimeConfig(),
      targeting: {
        ...structuredClone(DEFAULT_CONFIG.platforms.googleChat.targeting),
        selectedGroups: [{ id: "space/project", label: "Project Space", kind: "space" }],
      },
    };
    runtimeInstance.enabled = true;
    runtimeInstance.scheduleOverride = true;
    runtimeInstance.selfEmail = "test@example.com";
    const debugEvents = [];
    runtimeInstance.debug = {
      async write(event, details) { debugEvents.push({ event, details }); },
    };

    await runtimeInstance.sendFor("space/project", "vault1", "space-message");

    assert.equal(runtimeInstance.sessionCount, 1);
    assert.equal(runtimeInstance.sessionChats.has("space/project"), true);
    assert.equal(runtimeInstance.processed.has("outgoing-space-message"), true);
    assert.equal(debugEvents.some(({ event }) => event === "sent"), true);
    assert.equal(
      debugEvents.some(({ event, details }) => event === "skip" && details.reason === "send_not_ready"),
      false,
    );
    runtimeInstance.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});

test("bookmarklet explains how to recover when Chrome blocks the helper tab", () => {
  const { dom } = makeDom(
    "https://chat.google.com/app/home",
    { popupBlocked: true },
  );
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    assert.ok(root);
    assert.match(root.textContent, /blocked the helper tab/i);
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
    assert.equal(openedWindows[0].name, "_blank");
    assert.equal(openedWindows[0].features, undefined);
    assert.match(openedWindows[0].url, /\.handoff\.googleChat$/);
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
        config: googleRuntimeConfig(),
        widgetCss,
        fileName: "chatbut.config.json",
        debugReady: true,
        latestRelease: "0.4.0",
      },
    });

    const root = dom.window.document.getElementById("chatbut-runtime");
    assert.match(root.textContent, /Waiting for the next window/i);
    assert.match(root.querySelector('[data-role="enable"]').textContent, /^Starts in \d{2,}:\d{2}:\d{2}$/);
    assert.equal(root.querySelector('[data-role="enable"]').disabled, true);
    assert.equal(root.querySelector('[data-role="override"]').hidden, false);
    assert.equal(root.querySelector('[data-role="connect"]').hidden, true);
    assert.match(root.querySelector('[data-role="release"]').textContent, /Update available.*latest v0\.4\.0/i);
    assert.equal(root.querySelector('[data-role="metric-replies"]').textContent, "0");
    assert.equal(root.querySelector(".cb-search"), null);

    await root.chatbutRuntime.saveConfig();
    assert.equal(sent.at(-1).type, "chatbut:update-config");

    port.onmessage({
      data: {
        type: "chatbut:config-changed",
        config: {
          ...googleRuntimeConfig(),
          schedule: {
            ...structuredClone(DEFAULT_CONFIG.schedule),
            days: [0, 1, 2, 3, 4, 5, 6],
            windows: [{ start: "00:00", end: "00:00" }],
          },
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(root.chatbutRuntime.enabled, true);
    assert.equal(root.querySelector('[data-role="mode"]').textContent, "Enabled");
    root.chatbutRuntime.stop("Test complete.");
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
    ...googleRuntimeConfig(),
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
        widgetCss,
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
    ...googleRuntimeConfig(),
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
        widgetCss,
        fileName: "Browser-local configuration",
        debugReady: true,
      },
    });

    const root = dom.window.document.getElementById("chatbut-runtime");
    root.querySelector('[data-role="override"]').click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(root.chatbutRuntime.scheduleOverride, true);
    assert.match(root.textContent, /Schedule overridden for this session/i);
    root.chatbutRuntime.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});

test("Google presence applies on enable, locks, resets, and minimize keeps the runtime active", async () => {
  const html = `<!doctype html><html><head></head><body>
    <div role="button" tabindex="0" aria-label="Status: Active">Status</div>
    <div role="menuitem" jsname="pms6R">Automatic</div>
    <div role="menuitem" jsname="wJfO6e">Do not disturb</div>
    <div role="menuitem" jsname="PCKjx">Away</div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://chat.google.com/app/home", { html });
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    const status = dom.window.document.querySelector('[aria-label^="Status:"]');
    dom.window.document.querySelector('[jsname="PCKjx"]').addEventListener("click", () => {
      status.setAttribute("aria-label", "Status: Away");
    });
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce },
      origin: "https://jiannystein.github.io",
      source: bridgeWindow,
      ports: [port],
    }));
    const config = googleRuntimeConfig();
    config.presence = "away";
    config.schedule = { ...config.schedule, days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "00:00" }] };
    port.onmessage({ data: { type: "chatbut:config", nonce, config, widgetCss, fileName: "Browser-local configuration" } });
    const select = root.querySelector('[data-role="presence"]');
    assert.equal(select.value, "away");
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(status.getAttribute("aria-label"), "Status: Away");
    assert.equal(root.chatbutRuntime.enabled, true);
    assert.equal(select.disabled, true);
    root.querySelector('[data-role="minimize"]').click();
    assert.equal(root.querySelector("main").hidden, true);
    assert.equal(root.chatbutRuntime.enabled, true);
    root.querySelector('[data-role="minimize"]').click();
    assert.equal(root.querySelector("main").hidden, false);
    root.chatbutRuntime.stop("Test complete.");
    assert.equal(select.disabled, false);
    assert.equal(select.value, "away");
  } finally {
    dom.window.close();
  }
});

test("Google presence ambiguity stops enable without starting automation", async () => {
  const html = `<!doctype html><html><head></head><body>
    <button aria-label="Status: Active">One</button><div role="button" tabindex="0" aria-label="Status: Active">Two</div>
    <div role="menuitem" jsname="PCKjx">Away</div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://chat.google.com/app/home", { html });
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce }, origin: "https://jiannystein.github.io", source: bridgeWindow, ports: [port],
    }));
    const config = googleRuntimeConfig();
    config.presence = "away";
    config.schedule = { ...config.schedule, days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "00:00" }] };
    port.onmessage({ data: { type: "chatbut:config", nonce, config, widgetCss } });
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(root.chatbutRuntime.enabled, false);
    assert.equal(root.querySelector('[data-role="presence"]').disabled, false);
    assert.match(root.querySelector('[data-role="status"]').textContent, /Enable stopped.*presence/i);
  } finally {
    dom.window.close();
  }
});

test("Google DND selects a native duration that covers the active response window", async () => {
  const html = `<!doctype html><html><head></head><body>
    <div role="button" tabindex="0" aria-label="Status: Active">Status</div>
    <div role="menuitem" jsname="wJfO6e">Do not disturb</div>
    <div role="menuitem">30 min</div><div role="menuitem">1 hour</div><div role="menuitem">2 hours</div>
    <div role="menuitem">4 hours</div><div role="menuitem">8 hours</div><div role="menuitem">24 hours</div>
  </body></html>`;
  const { dom, openedWindows, bridgeWindow } = makeDom("https://chat.google.com/app/home", { html });
  const port = { onmessage: null, start() {}, postMessage() {} };
  try {
    const status = dom.window.document.querySelector('[aria-label^="Status:"]');
    let clickedDuration = "";
    for (const duration of [...dom.window.document.querySelectorAll('[role="menuitem"]')].filter((node) => /min|hour/.test(node.textContent))) {
      duration.addEventListener("click", () => {
        clickedDuration = duration.textContent;
        status.setAttribute("aria-label", "Status: Do not disturb");
      });
    }
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    const nonce = new URL(openedWindows[0].url).hash.slice(1).split(".")[1];
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { type: "chatbut:bridge-port", nonce }, origin: "https://jiannystein.github.io", source: bridgeWindow, ports: [port],
    }));
    const config = googleRuntimeConfig();
    config.presence = "dnd";
    config.schedule = { ...config.schedule, days: [0, 1, 2, 3, 4, 5, 6], windows: [{ start: "00:00", end: "00:00" }] };
    port.onmessage({ data: { type: "chatbut:config", nonce, config, widgetCss } });
    root.querySelector('[data-role="enable"]').click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(status.getAttribute("aria-label"), "Status: Do not disturb");
    assert.match(clickedDuration, /^(30 min|1 hour|2 hours|4 hours|8 hours|24 hours)$/);
    assert.equal(root.chatbutRuntime.enabled, true);
    root.chatbutRuntime.stop("Test complete.");
  } finally {
    dom.window.close();
  }
});
