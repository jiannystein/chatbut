import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/chatbut-bridge.js", import.meta.url),
  "utf8",
);
const html = await readFile(
  new URL("../public/chatbut-bridge.html", import.meta.url),
  "utf8",
);

function runBridge(mode = "", platform = "googleChat") {
  const calls = { close: 0, replace: [], openerMessages: [], workerMessages: [], workers: [] };
  const port = {
    start() {},
    postMessage(message) { calls.workerMessages.push(message); },
  };
  const status = { textContent: "", dataset: {} };
  const context = {
    document: { getElementById: () => status },
    location: {
      hash: `#${"a".repeat(32)}.nonce-value${mode ? `.${mode}.${platform}` : ""}`,
      replace(url) { calls.replace.push(url); },
    },
    SharedWorker: class {
      constructor(url, options) {
        calls.workers.push({ url, options });
        this.port = port;
      }
    },
    window: {
      opener: {
        closed: false,
        postMessage(...args) { calls.openerMessages.push(args); },
      },
      close() { calls.close += 1; },
      setTimeout(callback) { callback(); },
    },
    CHATBUT_RELEASE_VERSION: "0.3.8",
  };
  vm.runInNewContext(source, context);
  return { calls, status };
}

test("handoff bridge becomes a clean Google Chat tab after transferring the port", () => {
  const { calls, status } = runBridge("handoff");
  assert.equal(calls.openerMessages.length, 1);
  assert.equal(calls.replace[0], "https://chat.google.com/app/home");
  assert.equal(calls.close, 0);
  assert.match(status.textContent, /Opening a clean Google Chat tab/i);
  assert.equal(calls.workerMessages[0].releaseVersion, "0.3.8");
  assert.equal(calls.workerMessages[0].platform, "googleChat");
  assert.equal(calls.workers[0].url, "./chatbut-bridge-worker.js?v=0.3.8");
  assert.equal(calls.workers[0].options.name, "chatbut-config-bridge-v0.3.8");
});

test("Teams handoff returns the helper tab to the work or school v2 client", () => {
  const { calls, status } = runBridge("handoff", "teams");
  assert.equal(calls.openerMessages[0][1], "https://teams.microsoft.com");
  assert.equal(calls.workerMessages[0].platform, "teams");
  assert.equal(calls.replace[0], "https://teams.microsoft.com/v2/");
  assert.match(status.textContent, /clean Teams tab/i);
});

test("legacy bridge still closes after transferring the port", () => {
  const { calls } = runBridge();
  assert.equal(calls.close, 1);
  assert.equal(calls.replace.length, 0);
});

test("bridge HTML cache-busts its release and bridge scripts with the bookmark version", () => {
  assert.match(html, /URLSearchParams\(location\.search\)/);
  assert.match(html, /chatbut-release\.js/);
  assert.match(html, /chatbut-bridge\.js/);
});
