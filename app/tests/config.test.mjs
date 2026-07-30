import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  formatSchedule,
  isScheduleActive,
  normalizeConfig,
  validateConfig,
} from "../src/config.js";

test("normalization constrains user-controlled values", () => {
  const normalized = normalizeConfig({
    schedule: { days: [1, 1, 9, "2"], start: "6:00", end: "25:00" },
    delays: { minimumSeconds: -20, maximumSeconds: 99_999, followUpMinutes: 0 },
    responses: { vault1: ["  hello  ", "", 42], vault2: ["later"] },
    ai: { apiKey: "  secret  ", recentMessageCount: 99, language: "invalid" },
  });

  assert.deepEqual(normalized.schedule.days, [1, 2]);
  assert.equal(normalized.schedule.start, "06:00");
  assert.equal(normalized.schedule.end, "08:00");
  assert.equal(normalized.delays.minimumSeconds, 1);
  assert.equal(normalized.delays.maximumSeconds, 3_600);
  assert.equal(normalized.delays.followUpMinutes, 1);
  assert.deepEqual(normalized.responses.vault1, ["hello"]);
  assert.equal(normalized.ai.apiKey, "secret");
  assert.equal(normalized.ai.recentMessageCount, 10);
  assert.equal(normalized.ai.language, "en");
  assert.deepEqual(normalized.invitations, {
    autoAcceptDirect: false,
    autoAcceptSpaces: false,
  });
});

test("same-day schedule is active only inside the selected window", () => {
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    schedule: { days: [1], start: "06:00", end: "08:00" },
  });

  assert.equal(isScheduleActive(config, new Date("2026-07-27T06:30:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T08:00:00")), false);
  assert.equal(isScheduleActive(config, new Date("2026-07-28T06:30:00")), false);
});

test("overnight schedules remain supported", () => {
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    schedule: { days: [1], start: "22:00", end: "06:00" },
  });

  assert.equal(isScheduleActive(config, new Date("2026-07-27T23:00:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-28T05:00:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T05:00:00")), false);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T12:00:00")), false);
});

test("enable validation requires schedule, both vaults, and a key only when AI is enabled", () => {
  const savedOnly = validateConfig(DEFAULT_CONFIG);
  assert.equal(savedOnly.valid, true);

  const valid = validateConfig({
    ...DEFAULT_CONFIG,
    ai: { ...DEFAULT_CONFIG.ai, enabled: true, apiKey: "test-key" },
  });
  assert.equal(valid.valid, true);

  const invalid = validateConfig({
    ...DEFAULT_CONFIG,
    ai: { ...DEFAULT_CONFIG.ai, enabled: true, apiKey: "" },
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /DeepSeek API key/);
});

test("invitation options are independently configurable and default off", () => {
  const normalized = normalizeConfig({
    ...DEFAULT_CONFIG,
    invitations: { autoAcceptDirect: true, autoAcceptSpaces: false },
  });
  assert.equal(normalized.invitations.autoAcceptDirect, true);
  assert.equal(normalized.invitations.autoAcceptSpaces, false);
});

test("schedule summary uses human-readable times", () => {
  assert.equal(formatSchedule(DEFAULT_CONFIG), "Mon–Fri · 6:00 AM–8:00 AM");
});
