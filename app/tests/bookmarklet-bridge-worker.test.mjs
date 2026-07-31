import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/chatbut-bridge-worker.js", import.meta.url),
  "utf8",
);

class MockPort {
  constructor() {
    this.onmessage = null;
    this.sent = [];
  }

  start() {}

  postMessage(message) {
    this.sent.push(message);
  }

  receive(message) {
    this.onmessage?.({ data: message });
  }
}

function connect(workerScope, port) {
  workerScope.onconnect({ ports: [port] });
}

test("bridge worker relays only inside the paired room", () => {
  const workerScope = {};
  vm.runInNewContext(source, { self: workerScope });
  const token = "a".repeat(32);
  const otherToken = "b".repeat(32);
  const configurator = new MockPort();
  const runtime = new MockPort();
  const unrelated = new MockPort();
  connect(workerScope, configurator);
  connect(workerScope, runtime);
  connect(workerScope, unrelated);

  configurator.receive({ type: "chatbut:register", role: "configurator", token });
  runtime.receive({ type: "chatbut:register", role: "runtime", token });
  unrelated.receive({
    type: "chatbut:register",
    role: "runtime",
    token: otherToken,
  });
  runtime.receive({ type: "chatbut:request-config", nonce: "nonce-123" });

  assert.equal(configurator.sent.at(-1).type, "chatbut:request-config");
  assert.equal(configurator.sent.at(-1).nonce, "nonce-123");
  assert.equal(unrelated.sent.length, 1);

  configurator.receive({
    type: "chatbut:config",
    nonce: "nonce-123",
    config: { version: 1 },
  });

  assert.equal(runtime.sent.at(-1).type, "chatbut:config");
  assert.equal(runtime.sent.at(-1).nonce, "nonce-123");
  assert.equal(unrelated.sent.length, 1);
});
