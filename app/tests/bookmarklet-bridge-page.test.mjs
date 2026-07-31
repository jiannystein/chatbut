import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/chatbut-bridge.js", import.meta.url),
  "utf8",
);

function runBridge(mode = "") {
  const calls = { close: 0, replace: [], openerMessages: [], workerMessages: [] };
  const port = {
    start() {},
    postMessage(message) { calls.workerMessages.push(message); },
  };
  const status = { textContent: "", dataset: {} };
  const context = {
    document: { getElementById: () => status },
    location: {
      hash: `#${"a".repeat(32)}.nonce-value${mode ? `.${mode}` : ""}`,
      replace(url) { calls.replace.push(url); },
    },
    SharedWorker: class {
      constructor() { this.port = port; }
    },
    window: {
      opener: {
        closed: false,
        postMessage(...args) { calls.openerMessages.push(args); },
      },
      close() { calls.close += 1; },
      setTimeout(callback) { callback(); },
    },
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
});

test("legacy bridge still closes after transferring the port", () => {
  const { calls } = runBridge();
  assert.equal(calls.close, 1);
  assert.equal(calls.replace.length, 0);
});
