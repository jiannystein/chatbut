export const DAY_OPTIONS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
];

export const PROVIDER_IDS = [
  "deepseek",
  "openai",
  "anthropic",
  "kimi-global",
  "kimi-china",
];

export const MAX_SCHEDULE_WINDOWS = 8;
export const PLATFORM_IDS = ["googleChat", "teams"];

export const DEFAULT_CONFIG = Object.freeze({
  version: 3,
  schedule: {
    days: [1, 2, 3, 4, 5],
    windows: [{ start: "06:00", end: "08:00" }],
    timezone: "browser",
  },
  delays: {
    minimumSeconds: 5,
    maximumSeconds: 10,
    followUpMinutes: 1,
  },
  platforms: {
    googleChat: {
      presence: "none",
      targeting: {
        directMode: "everyone-except",
        directExclusions: [],
        groupMode: "selected",
        selectedGroups: [],
        indexedChats: [],
      },
      invitations: {
        autoAcceptDirect: false,
        autoAcceptSpaces: false,
      },
    },
    teams: {
      presence: "none",
      targeting: {
        directMode: "everyone-except",
        directExclusions: [],
        groupMode: "mentions-and-replies",
        selectedChannels: [],
        indexedChats: [],
      },
      invitations: {
        autoAcceptDirect: false,
      },
    },
  },
  responses: {
    vault1: [
      "Got this — please give me a little time and I’ll get back to you soon.",
      "Thanks for the message. I’ll take a look and get back to you as soon as I can.",
      "I’ve seen this and will come back to you shortly.",
    ],
    vault2: [
      "I’m still tied up, but I haven’t forgotten this. I’ll get back to you as soon as I can.",
      "Sorry for the wait — I still need a little more time and will follow up soon.",
    ],
  },
  llm: {
    enabled: false,
    activeProviderId: "",
    connections: [],
    recentMessageCount: 5,
    language: "en",
    tone: "casual-empathetic-corporate",
    maxSentences: 2,
  },
  debug: {
    enabled: false,
    maximumLogBytes: 10_000_000,
  },
});

function cloneDefault() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function clampNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function cleanStringList(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function cleanTargetList(value, limit = 100, { requireKind = false } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const kind = ["direct", "group-direct", "space", "channel"].includes(item.kind) ? item.kind : "";
      const parentId = typeof item.parentId === "string" ? item.parentId.trim().slice(0, 320) : "";
      return {
        id: String(item.id ?? "").trim(),
        label: String(item.label ?? "").trim(),
        ...(kind ? { kind } : {}),
        ...(parentId ? { parentId } : {}),
      };
    })
    .filter((item) => item.id && item.label && (!requireKind || item.kind))
    .slice(0, limit);
}

function cleanTime(value, fallback) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}

function cleanScheduleWindows(schedule, fallback) {
  const sourceWindows = Array.isArray(schedule.windows)
    ? schedule.windows
    : schedule.start || schedule.end
      ? [{ start: schedule.start, end: schedule.end }]
      : fallback.schedule.windows;
  const seen = new Set();
  return sourceWindows
    .filter((window) => window && typeof window === "object")
    .map((window) => ({
      start: cleanTime(window.start, "06:00"),
      end: cleanTime(window.end, "08:00"),
    }))
    .filter((window) => {
      const key = `${window.start}-${window.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SCHEDULE_WINDOWS)
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

function cleanConnection(item) {
  if (!item || typeof item !== "object") return null;
  const providerId = String(item.providerId ?? "");
  if (!PROVIDER_IDS.includes(providerId)) return null;
  const apiKey = typeof item.apiKey === "string" ? item.apiKey.trim() : "";
  const model = typeof item.model === "string" ? item.model.trim() : "";
  if (!apiKey) return null;
  return {
    providerId,
    apiKey,
    model,
    status: item.status === "validated" ? "validated" : "needs-attention",
    validatedAt: typeof item.validatedAt === "string" ? item.validatedAt : "",
    error: typeof item.error === "string" ? item.error.slice(0, 240) : "",
  };
}

function cleanConnections(value) {
  if (!Array.isArray(value)) return [];
  const providers = new Set();
  return value
    .map(cleanConnection)
    .filter((connection) => {
      if (!connection || providers.has(connection.providerId)) return false;
      providers.add(connection.providerId);
      return true;
    })
    .slice(0, PROVIDER_IDS.length);
}

function migrateLegacyAi(source) {
  const ai = source.ai && typeof source.ai === "object" ? source.ai : {};
  const apiKey = typeof ai.apiKey === "string" ? ai.apiKey.trim() : "";
  return {
    enabled: Boolean(ai.enabled),
    activeProviderId: apiKey ? "deepseek" : "",
    connections: apiKey
      ? [{
        providerId: "deepseek",
        apiKey,
        model: typeof ai.model === "string" ? ai.model : "deepseek-v4-flash",
        status: "needs-attention",
        validatedAt: "",
        error: "Validate this migrated connection before enabling.",
      }]
      : [],
    recentMessageCount: ai.recentMessageCount,
    language: ai.language,
  };
}

function cleanGoogleChatPlatform(platform, legacyTargeting = {}, legacyInvitations = {}) {
  const source = platform && typeof platform === "object" ? platform : {};
  const targeting = source.targeting && typeof source.targeting === "object"
    ? source.targeting
    : legacyTargeting;
  const invitations = source.invitations && typeof source.invitations === "object"
    ? source.invitations
    : legacyInvitations;
  return {
    presence: ["active", "dnd", "away"].includes(source.presence) ? source.presence : "none",
    targeting: {
      directMode: "everyone-except",
      directExclusions: cleanTargetList(targeting.directExclusions),
      groupMode: "selected",
      selectedGroups: cleanTargetList(targeting.selectedGroups),
      indexedChats: cleanTargetList(targeting.indexedChats, 200, { requireKind: true })
        .filter((item) => item.kind !== "channel"),
    },
    invitations: {
      autoAcceptDirect: Boolean(invitations.autoAcceptDirect),
      autoAcceptSpaces: Boolean(invitations.autoAcceptSpaces),
    },
  };
}

function cleanTeamsPlatform(platform) {
  const source = platform && typeof platform === "object" ? platform : {};
  const targeting = source.targeting && typeof source.targeting === "object" ? source.targeting : {};
  const invitations = source.invitations && typeof source.invitations === "object" ? source.invitations : {};
  return {
    presence: ["available", "busy", "away"].includes(source.presence) ? source.presence : "none",
    targeting: {
      directMode: "everyone-except",
      directExclusions: cleanTargetList(targeting.directExclusions)
        .filter((item) => item.kind !== "space" && item.kind !== "channel"),
      groupMode: "mentions-and-replies",
      selectedChannels: cleanTargetList(targeting.selectedChannels)
        .filter((item) => !item.kind || item.kind === "channel")
        .map((item) => ({ ...item, kind: "channel" })),
      indexedChats: cleanTargetList(targeting.indexedChats, 200, { requireKind: true })
        .filter((item) => item.kind !== "space"),
    },
    invitations: {
      autoAcceptDirect: Boolean(invitations.autoAcceptDirect),
    },
  };
}

export function normalizeConfig(input = {}) {
  const fallback = cloneDefault();
  const source = input && typeof input === "object" ? input : {};
  const schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
  const delays = source.delays && typeof source.delays === "object" ? source.delays : {};
  const responses = source.responses && typeof source.responses === "object" ? source.responses : {};
  const legacyTargeting = source.targeting && typeof source.targeting === "object" ? source.targeting : {};
  const legacyInvitations = source.invitations && typeof source.invitations === "object" ? source.invitations : {};
  const platforms = source.platforms && typeof source.platforms === "object" ? source.platforms : {};
  const llm = source.llm && typeof source.llm === "object" ? source.llm : migrateLegacyAi(source);
  const debug = source.debug && typeof source.debug === "object" ? source.debug : {};
  const legacyTimingDefaults = Number(delays.minimumSeconds) === 30
    && Number(delays.maximumSeconds) === 90
    && Number(delays.followUpMinutes) === 15;

  const days = Array.isArray(schedule.days)
    ? [...new Set(schedule.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : fallback.schedule.days;

  const minimumSeconds = Math.round(
    clampNumber(
      legacyTimingDefaults ? fallback.delays.minimumSeconds : delays.minimumSeconds,
      1,
      60,
      fallback.delays.minimumSeconds,
    ),
  );
  const maximumSeconds = Math.round(
    clampNumber(
      legacyTimingDefaults ? fallback.delays.maximumSeconds : delays.maximumSeconds,
      minimumSeconds,
      60,
      fallback.delays.maximumSeconds,
    ),
  );
  const connections = cleanConnections(llm.connections);
  const requestedActive = PROVIDER_IDS.includes(llm.activeProviderId) ? llm.activeProviderId : "";
  const activeProviderId = connections.some((item) => item.providerId === requestedActive)
    ? requestedActive
    : connections[0]?.providerId ?? "";

  return {
    version: 3,
    schedule: {
      days,
      windows: cleanScheduleWindows(schedule, fallback),
      timezone: "browser",
    },
    delays: {
      minimumSeconds,
      maximumSeconds,
      followUpMinutes: Math.round(
        clampNumber(
          legacyTimingDefaults ? fallback.delays.followUpMinutes : delays.followUpMinutes,
          1,
          5,
          fallback.delays.followUpMinutes,
        ),
      ),
    },
    platforms: {
      googleChat: cleanGoogleChatPlatform(
        platforms.googleChat,
        legacyTargeting,
        legacyInvitations,
      ),
      teams: cleanTeamsPlatform(platforms.teams),
    },
    responses: {
      vault1: cleanStringList(responses.vault1, 50),
      vault2: cleanStringList(responses.vault2, 50),
    },
    llm: {
      enabled: Boolean(llm.enabled),
      activeProviderId,
      connections,
      recentMessageCount: Math.round(
        clampNumber(llm.recentMessageCount, 3, 10, fallback.llm.recentMessageCount),
      ),
      language: llm.language === "zh" ? "zh" : "en",
      tone: "casual-empathetic-corporate",
      maxSentences: 2,
    },
    debug: {
      enabled: Boolean(debug.enabled),
      maximumLogBytes: 10_000_000,
    },
  };
}

function minutesFromTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function windowIsActive(window, selectedDays, date) {
  const current = date.getHours() * 60 + date.getMinutes();
  const start = minutesFromTime(window.start);
  const end = minutesFromTime(window.end);
  const todaySelected = selectedDays.includes(date.getDay());
  if (start === end) return todaySelected;
  if (start < end) return todaySelected && current >= start && current < end;
  if (todaySelected && current >= start) return true;
  const previousDay = (date.getDay() + 6) % 7;
  return selectedDays.includes(previousDay) && current < end;
}

export function isScheduleActive(config, date = new Date()) {
  const normalized = normalizeConfig(config);
  return normalized.schedule.windows.some((window) => (
    windowIsActive(window, normalized.schedule.days, date)
  ));
}

function segmentsForWindow(window) {
  const start = minutesFromTime(window.start);
  const end = minutesFromTime(window.end);
  if (start === end) return [[0, 1_440]];
  if (start < end) return [[start, end]];
  return [[start, 1_440], [0, end]];
}

export function hasOverlappingWindows(windows) {
  const segments = windows.flatMap((window, windowIndex) => (
    segmentsForWindow(window).map(([start, end]) => ({ start, end, windowIndex }))
  ));
  return segments.some((segment, index) => segments.slice(index + 1).some((candidate) => (
    segment.windowIndex !== candidate.windowIndex
    && Math.max(segment.start, candidate.start) < Math.min(segment.end, candidate.end)
  )));
}

export function activeLlmConnection(config) {
  const normalized = normalizeConfig(config);
  return normalized.llm.connections.find(
    (connection) => connection.providerId === normalized.llm.activeProviderId,
  ) ?? null;
}

export function validateConfig(config) {
  const normalized = normalizeConfig(config);
  const errors = [];
  if (normalized.schedule.days.length === 0) errors.push("Select at least one scheduled day.");
  if (normalized.schedule.windows.length === 0) errors.push("Add at least one response window.");
  if (hasOverlappingWindows(normalized.schedule.windows)) {
    errors.push("Response windows cannot overlap.");
  }
  if (normalized.responses.vault1.length === 0) errors.push("Vault 1 needs at least one response.");
  if (normalized.responses.vault2.length === 0) errors.push("Vault 2 needs at least one response.");
  if (normalized.llm.enabled) {
    const connection = activeLlmConnection(normalized);
    if (!connection) errors.push("Choose an active LLM connection or turn off LLM adaptation.");
    else if (connection.status !== "validated" || !connection.model) {
      errors.push("Validate the active LLM connection before enabling.");
    }
  }
  return { valid: errors.length === 0, errors, config: normalized };
}

export function formatClock(value) {
  const [hourValue, minute] = value.split(":").map(Number);
  return `${String(hourValue).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatDayRange(days) {
  const selected = DAY_OPTIONS.filter((day) => days.includes(day.value));
  if (selected.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) {
    return "Mon–Fri";
  }
  return selected.map((day) => day.short).join(", ") || "No days";
}

export function formatSchedule(config) {
  const normalized = normalizeConfig(config);
  const windows = normalized.schedule.windows
    .map((window) => `${formatClock(window.start)}–${formatClock(window.end)}`)
    .join(" · ");
  return `${formatDayRange(normalized.schedule.days)} · ${windows || "No windows"}`;
}

export function nextWindowLabel(config, now = new Date()) {
  const normalized = normalizeConfig(config);
  const candidates = [];
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    day.setHours(0, 0, 0, 0);
    if (!normalized.schedule.days.includes(day.getDay())) continue;
    for (const window of normalized.schedule.windows) {
      const candidate = new Date(day);
      const [hours, minutes] = window.start.split(":").map(Number);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate > now) candidates.push({ candidate, offset, start: window.start });
    }
  }
  candidates.sort((a, b) => a.candidate - b.candidate);
  const next = candidates[0];
  if (!next) return "Review your schedule";
  const dayLabel = next.offset === 0
    ? "today"
    : next.offset === 1
      ? "tomorrow"
      : DAY_OPTIONS.find((day) => day.value === next.candidate.getDay())?.label;
  return `Starts ${dayLabel} at ${formatClock(next.start)}`;
}

export function markImportedConnectionsForValidation(config) {
  const normalized = normalizeConfig(config);
  return {
    ...normalized,
    llm: {
      ...normalized.llm,
      connections: normalized.llm.connections.map((connection) => ({
        ...connection,
        status: "needs-attention",
        validatedAt: "",
        error: "Validate this imported connection in this browser.",
      })),
    },
  };
}
