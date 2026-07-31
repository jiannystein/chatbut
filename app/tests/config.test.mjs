import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  formatSchedule,
  hasOverlappingWindows,
  isScheduleActive,
  markImportedConnectionsForValidation,
  normalizeConfig,
  validateConfig,
} from "../src/config.js";

test("normalization constrains values and migrates a legacy DeepSeek config", () => {
  const normalized = normalizeConfig({
    schedule: { days: [1, 1, 9, "2"], start: "6:00", end: "25:00" },
    delays: { minimumSeconds: -20, maximumSeconds: 99_999, followUpMinutes: 0 },
    responses: { vault1: ["  hello  ", "", 42], vault2: ["later"] },
    ai: {
      enabled: true,
      apiKey: "  secret  ",
      model: "deepseek-chat",
      recentMessageCount: 99,
      language: "invalid",
    },
  });

  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.schedule.days, [1, 2]);
  assert.deepEqual(normalized.schedule.windows, [{ start: "06:00", end: "08:00" }]);
  assert.equal(normalized.delays.minimumSeconds, 1);
  assert.equal(normalized.delays.maximumSeconds, 3_600);
  assert.equal(normalized.delays.followUpMinutes, 1);
  assert.deepEqual(normalized.responses.vault1, ["hello"]);
  assert.equal(normalized.llm.activeProviderId, "deepseek");
  assert.equal(normalized.llm.connections[0].apiKey, "secret");
  assert.equal(normalized.llm.connections[0].status, "needs-attention");
  assert.equal(normalized.llm.recentMessageCount, 10);
  assert.equal(normalized.llm.language, "en");
});

test("multiple same-day windows are active independently", () => {
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    schedule: {
      days: [1],
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "16:00", end: "18:00" },
      ],
    },
  });

  assert.equal(isScheduleActive(config, new Date("2026-07-27T06:30:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T12:00:00")), false);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T16:30:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-28T06:30:00")), false);
});

test("overnight schedules remain supported", () => {
  const config = normalizeConfig({
    ...DEFAULT_CONFIG,
    schedule: { days: [1], windows: [{ start: "22:00", end: "06:00" }] },
  });

  assert.equal(isScheduleActive(config, new Date("2026-07-27T23:00:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-28T05:00:00")), true);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T05:00:00")), false);
  assert.equal(isScheduleActive(config, new Date("2026-07-27T12:00:00")), false);
});

test("duplicate windows are normalized and overlapping windows fail validation", () => {
  const normalized = normalizeConfig({
    ...DEFAULT_CONFIG,
    schedule: {
      days: [1],
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "06:00", end: "08:00" },
      ],
    },
  });
  assert.equal(normalized.schedule.windows.length, 1);
  assert.equal(hasOverlappingWindows([
    { start: "06:00", end: "08:00" },
    { start: "07:30", end: "09:00" },
  ]), true);
  assert.match(validateConfig({
    ...normalized,
    schedule: {
      ...normalized.schedule,
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "07:30", end: "09:00" },
      ],
    },
  }).errors.join(" "), /cannot overlap/i);
});

test("LLM adaptation requires one validated active connection", () => {
  assert.equal(validateConfig(DEFAULT_CONFIG).valid, true);

  const connection = {
    providerId: "openai",
    apiKey: "test-key",
    model: "gpt-4o-mini",
    status: "validated",
    validatedAt: new Date().toISOString(),
    error: "",
  };
  const valid = validateConfig({
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      enabled: true,
      activeProviderId: "openai",
      connections: [connection],
    },
  });
  assert.equal(valid.valid, true);

  const invalid = validateConfig({
    ...valid.config,
    llm: {
      ...valid.config.llm,
      connections: [{ ...connection, status: "needs-attention" }],
    },
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(" "), /Validate the active LLM/);
});

test("imported credentials are retained but require validation in this browser", () => {
  const imported = markImportedConnectionsForValidation({
    ...DEFAULT_CONFIG,
    llm: {
      ...DEFAULT_CONFIG.llm,
      enabled: true,
      activeProviderId: "deepseek",
      connections: [{
        providerId: "deepseek",
        apiKey: "secret",
        model: "deepseek-chat",
        status: "validated",
        validatedAt: "2026-07-31T00:00:00.000Z",
      }],
    },
  });
  assert.equal(imported.llm.connections[0].apiKey, "secret");
  assert.equal(imported.llm.connections[0].status, "needs-attention");
  assert.equal(validateConfig(imported).valid, false);
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
  assert.equal(formatSchedule({
    ...DEFAULT_CONFIG,
    schedule: {
      ...DEFAULT_CONFIG.schedule,
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "16:00", end: "18:00" },
      ],
    },
  }), "Mon–Fri · 6:00 AM–8:00 AM · 4:00 PM–6:00 PM");
});
