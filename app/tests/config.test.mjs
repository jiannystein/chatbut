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
import { prepareImportedConfig } from "../src/file-store.js";
import {
  formatRuntimeCountdown,
  nextRuntimeWindowStart,
  runtimeWindowEnd,
  validateRuntimeConfig,
} from "../src/bookmarklet/runtime-config.js";
import { isNewerRelease, RELEASE_VERSION } from "../src/release.js";

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

  assert.equal(normalized.version, 3);
  assert.deepEqual(normalized.schedule.days, [1, 2]);
  assert.deepEqual(normalized.schedule.windows, [{ start: "06:00", end: "08:00" }]);
  assert.equal(normalized.delays.minimumSeconds, 1);
  assert.equal(normalized.delays.maximumSeconds, 60);
  assert.equal(normalized.delays.followUpMinutes, 1);
  assert.deepEqual(normalized.responses.vault1, ["hello"]);
  assert.equal(normalized.llm.activeProviderId, "deepseek");
  assert.equal(normalized.llm.connections[0].apiKey, "secret");
  assert.equal(normalized.llm.connections[0].status, "needs-attention");
  assert.equal(normalized.llm.recentMessageCount, 10);
  assert.equal(normalized.llm.language, "en");
});

test("old timing defaults migrate to the shorter POC defaults", () => {
  const normalized = normalizeConfig({
    ...DEFAULT_CONFIG,
    delays: { minimumSeconds: 30, maximumSeconds: 90, followUpMinutes: 15 },
  });
  assert.deepEqual(normalized.delays, {
    minimumSeconds: 5,
    maximumSeconds: 10,
    followUpMinutes: 1,
  });
});

test("import validation rejects non-Chatbut JSON before it can replace local state", () => {
  assert.throws(
    () => prepareImportedConfig({ arbitrary: "data" }),
    /incomplete or corrupt/i,
  );
  const imported = prepareImportedConfig(DEFAULT_CONFIG);
  assert.equal(imported.version, 3);
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
    platforms: undefined,
    invitations: { autoAcceptDirect: true, autoAcceptSpaces: false },
  });
  assert.equal(normalized.platforms.googleChat.invitations.autoAcceptDirect, true);
  assert.equal(normalized.platforms.googleChat.invitations.autoAcceptSpaces, false);
  assert.equal(normalized.platforms.teams.invitations.autoAcceptDirect, false);
});

test("presence defaults off and normalizes per platform", () => {
  assert.equal(normalizeConfig(DEFAULT_CONFIG).platforms.googleChat.presence, "none");
  assert.equal(normalizeConfig(DEFAULT_CONFIG).platforms.teams.presence, "none");
  const normalized = normalizeConfig({
    ...DEFAULT_CONFIG,
    platforms: {
      googleChat: { ...DEFAULT_CONFIG.platforms.googleChat, presence: "dnd" },
      teams: { ...DEFAULT_CONFIG.platforms.teams, presence: "busy" },
    },
  });
  assert.equal(normalized.platforms.googleChat.presence, "dnd");
  assert.equal(normalized.platforms.teams.presence, "busy");
  const invalid = normalizeConfig({
    ...DEFAULT_CONFIG,
    platforms: {
      googleChat: { ...DEFAULT_CONFIG.platforms.googleChat, presence: "busy" },
      teams: { ...DEFAULT_CONFIG.platforms.teams, presence: "dnd" },
    },
  });
  assert.equal(invalid.platforms.googleChat.presence, "none");
  assert.equal(invalid.platforms.teams.presence, "none");
});

test("version-2 targeting migrates losslessly while Teams starts fail-closed", () => {
  const migrated = normalizeConfig({
    ...DEFAULT_CONFIG,
    version: 2,
    platforms: undefined,
    targeting: {
      directMode: "everyone-except",
      directExclusions: [{ id: "dm/excluded", label: "Excluded", kind: "direct" }],
      groupMode: "selected",
      selectedGroups: [{ id: "space/allowed", label: "Allowed", kind: "space" }],
      indexedChats: [{ id: "space/allowed", label: "Allowed", kind: "space" }],
    },
    invitations: { autoAcceptDirect: true, autoAcceptSpaces: true },
  });
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.platforms.googleChat.targeting.directExclusions.map((item) => item.id), ["dm/excluded"]);
  assert.deepEqual(migrated.platforms.googleChat.targeting.selectedGroups.map((item) => item.id), ["space/allowed"]);
  assert.equal(migrated.platforms.googleChat.invitations.autoAcceptDirect, true);
  assert.equal(migrated.platforms.googleChat.invitations.autoAcceptSpaces, true);
  assert.deepEqual(migrated.platforms.teams.targeting.indexedChats, []);
  assert.deepEqual(migrated.platforms.teams.targeting.selectedChannels, []);
  assert.equal(migrated.platforms.teams.invitations.autoAcceptDirect, false);
});

test("recent conversation index retains only valid classified entries", () => {
  const normalized = normalizeConfig({
    ...DEFAULT_CONFIG,
    platforms: undefined,
    targeting: {
      indexedChats: [
        { id: "dm/person", label: "Person", kind: "direct" },
        { id: "space/group", label: "Group", kind: "group-direct" },
        { id: "space/project", label: "Project", kind: "space" },
        { id: "space/unknown", label: "Unknown", kind: "unsupported" },
      ],
    },
  });
  assert.deepEqual(
    normalized.platforms.googleChat.targeting.indexedChats.map((item) => item.kind),
    ["direct", "group-direct", "space"],
  );
});

test("schedule summary uses 24-hour times", () => {
  assert.equal(formatSchedule(DEFAULT_CONFIG), "Mon–Fri · 06:00–08:00");
  assert.equal(formatSchedule({
    ...DEFAULT_CONFIG,
    schedule: {
      ...DEFAULT_CONFIG.schedule,
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "16:00", end: "18:00" },
      ],
    },
  }), "Mon–Fri · 06:00–08:00 · 16:00–18:00");
});

test("the runtime finds the next window and formats total-hour countdowns", () => {
  const config = {
    ...DEFAULT_CONFIG,
    schedule: {
      days: [1],
      windows: [
        { start: "06:00", end: "08:00" },
        { start: "16:00", end: "18:00" },
      ],
    },
  };
  assert.equal(
    nextRuntimeWindowStart(config, new Date("2026-07-27T08:30:00")).toISOString(),
    new Date("2026-07-27T16:00:00").toISOString(),
  );
  assert.equal(formatRuntimeCountdown(27 * 3_600_000 + 2_000), "27:00:02");
  assert.equal(
    runtimeWindowEnd(config, new Date("2026-07-27T16:30:00")).toISOString(),
    new Date("2026-07-27T18:00:00").toISOString(),
  );
});

test("release comparison is semantic and runtime LLM validation accepts redacted keys", () => {
  assert.equal(RELEASE_VERSION, "0.3.5");
  assert.equal(isNewerRelease("0.4.0", RELEASE_VERSION), true);
  assert.equal(isNewerRelease("0.2.9", RELEASE_VERSION), false);
  assert.equal(isNewerRelease("not-a-version", RELEASE_VERSION), false);

  const runtimeConfig = {
    ...DEFAULT_CONFIG,
    targeting: DEFAULT_CONFIG.platforms.googleChat.targeting,
    invitations: DEFAULT_CONFIG.platforms.googleChat.invitations,
    llm: {
      ...DEFAULT_CONFIG.llm,
      enabled: true,
      activeProviderId: "deepseek",
      connections: [{
        providerId: "deepseek",
        model: "deepseek-chat",
        status: "validated",
      }],
    },
  };
  assert.equal(validateRuntimeConfig(runtimeConfig).valid, true);
});
