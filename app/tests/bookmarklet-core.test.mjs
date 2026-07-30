import assert from "node:assert/strict";
import test from "node:test";
import {
  fuzzyScore,
  isTargetAllowed,
  maySend,
  normalizeDraft,
  randomDelayMs,
  randomTemplate,
  redactLogValue,
  selectVault,
} from "../src/bookmarklet/core.js";

const targeting = {
  directExclusions: [{ id: "dm/excluded", label: "Excluded" }],
  selectedGroups: [{ id: "space/allowed", label: "Allowed" }],
};

test("random delay remains within inclusive configured bounds", () => {
  assert.equal(randomDelayMs(30, 90, () => 0), 30_000);
  assert.equal(randomDelayMs(30, 90, () => 0.99999), 90_000);
});

test("random templates select from the requested vault", () => {
  assert.equal(randomTemplate(["first", "second"], () => 0), "first");
  assert.equal(randomTemplate(["first", "second"], () => 0.99), "second");
  assert.equal(randomTemplate([], () => 0), "");
});

test("targeting allows non-excluded DMs and only mentioned allowed Spaces", () => {
  assert.equal(isTargetAllowed({ targeting }, { id: "dm/person", kind: "direct" }), true);
  assert.equal(isTargetAllowed({ targeting }, { id: "dm/excluded", kind: "direct" }), false);
  assert.equal(isTargetAllowed({ targeting }, {
    id: "space/allowed", kind: "space", mentionedSelf: true,
  }), true);
  assert.equal(isTargetAllowed({ targeting }, {
    id: "space/allowed", kind: "space", mentionedSelf: false, repliedToSelf: false,
  }), false);
  assert.equal(isTargetAllowed({ targeting }, {
    id: "space/other", kind: "space", mentionedSelf: true,
  }), false);
});

test("vault state requires a new trigger after the follow-up cooldown", () => {
  const firstSentAt = 1_000;
  assert.equal(selectVault({}, 1_000, 15), "vault1");
  assert.equal(selectVault({ firstSentAt }, firstSentAt + 14 * 60_000, 15), null);
  assert.equal(selectVault({ firstSentAt }, firstSentAt + 15 * 60_000, 15), "vault2");
  assert.equal(selectVault({ firstSentAt, secondSentAt: 2_000 }, firstSentAt + 99 * 60_000, 15), null);
});

test("circuit breakers enforce both session and rolling limits", () => {
  const now = 1_000_000;
  assert.equal(maySend({ sessionCount: 20, sentTimestamps: [], now }), false);
  assert.equal(maySend({
    sessionCount: 5,
    sentTimestamps: [1, 2, 3, 4, 5].map((offset) => now - offset * 1_000),
    now,
  }), false);
  assert.equal(maySend({ sessionCount: 19, sentTimestamps: [now - 400_000], now }), true);
});

test("model output is plain, bounded, and falls back when empty", () => {
  assert.equal(normalizeDraft("<b>Got it.</b> I need time. Third.", "fallback"), "Got it. I need time.");
  assert.equal(normalizeDraft("", "fallback"), "fallback");
});

test("fuzzy search and log redaction are deterministic", () => {
  assert.ok(fuzzyScore("proj", "Project Phoenix") > 0);
  assert.equal(fuzzyScore("xyz", "Project Phoenix"), 0);
  assert.deepEqual(
    redactLogValue({ apiKey: "secret", nested: { authorization: "Bearer secret", text: "secret value" } }, "secret"),
    { apiKey: "[REDACTED]", nested: { authorization: "[REDACTED]", text: "[REDACTED] value" } },
  );
});
