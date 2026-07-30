import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const runtime = await readFile(
  new URL("../public/chatbut-bookmarklet.min.js", import.meta.url),
  "utf8",
);

function makeDom(url) {
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
    },
  });
  return dom;
}

test("bookmarklet refuses unsupported pages without injecting controls", () => {
  const dom = makeDom("https://example.com/");
  try {
    dom.window.eval(runtime);
    assert.equal(dom.window.document.getElementById("chatbut-runtime"), null);
    assert.match(dom.window.alertMessages[0], /chat\.google\.com/);
  } finally {
    dom.window.close();
  }
});

test("bookmarklet injects explicit disabled controls on Google Chat", () => {
  const dom = makeDom("https://chat.google.com/app/home");
  try {
    dom.window.eval(runtime);
    const root = dom.window.document.getElementById("chatbut-runtime");
    assert.ok(root);
    assert.match(root.textContent, /Choose your local configuration file/);
    assert.equal(root.querySelector('[data-role="mode"]').textContent, "Disabled");
    assert.equal(root.querySelector('[data-role="enable"]').disabled, true);
    assert.equal(root.querySelector('[data-role="stop"]').hidden, true);
  } finally {
    dom.window.close();
  }
});
