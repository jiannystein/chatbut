export const DAY_OPTIONS = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
];

export const DEFAULT_CONFIG = Object.freeze({
  version: 1,
  schedule: {
    days: [1, 2, 3, 4, 5],
    start: "06:00",
    end: "08:00",
    timezone: "browser",
  },
  delays: {
    minimumSeconds: 30,
    maximumSeconds: 90,
    followUpMinutes: 15,
  },
  targeting: {
    directMode: "everyone-except",
    directExclusions: [],
    groupMode: "selected",
    selectedGroups: [],
  },
  invitations: {
    autoAcceptDirect: false,
    autoAcceptSpaces: false,
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
  ai: {
    provider: "deepseek",
    enabled: false,
    apiKey: "",
    model: "deepseek-v4-flash",
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

function cleanTargetList(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      label: String(item.label ?? "").trim(),
    }))
    .filter((item) => item.id && item.label)
    .slice(0, limit);
}

function cleanTime(value, fallback) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}

export function normalizeConfig(input = {}) {
  const fallback = cloneDefault();
  const source = input && typeof input === "object" ? input : {};
  const schedule = source.schedule && typeof source.schedule === "object" ? source.schedule : {};
  const delays = source.delays && typeof source.delays === "object" ? source.delays : {};
  const targeting = source.targeting && typeof source.targeting === "object" ? source.targeting : {};
  const responses = source.responses && typeof source.responses === "object" ? source.responses : {};
  const invitations = source.invitations && typeof source.invitations === "object" ? source.invitations : {};
  const ai = source.ai && typeof source.ai === "object" ? source.ai : {};
  const debug = source.debug && typeof source.debug === "object" ? source.debug : {};

  const days = Array.isArray(schedule.days)
    ? [...new Set(schedule.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : fallback.schedule.days;

  const minimumSeconds = Math.round(
    clampNumber(delays.minimumSeconds, 1, 3_600, fallback.delays.minimumSeconds),
  );
  const maximumSeconds = Math.round(
    clampNumber(delays.maximumSeconds, minimumSeconds, 3_600, fallback.delays.maximumSeconds),
  );

  return {
    version: 1,
    schedule: {
      days,
      start: cleanTime(schedule.start, fallback.schedule.start),
      end: cleanTime(schedule.end, fallback.schedule.end),
      timezone: "browser",
    },
    delays: {
      minimumSeconds,
      maximumSeconds,
      followUpMinutes: Math.round(
        clampNumber(delays.followUpMinutes, 1, 1_440, fallback.delays.followUpMinutes),
      ),
    },
    targeting: {
      directMode: "everyone-except",
      directExclusions: cleanTargetList(targeting.directExclusions),
      groupMode: "selected",
      selectedGroups: cleanTargetList(targeting.selectedGroups),
    },
    invitations: {
      autoAcceptDirect: Boolean(invitations.autoAcceptDirect),
      autoAcceptSpaces: Boolean(invitations.autoAcceptSpaces),
    },
    responses: {
      vault1: cleanStringList(responses.vault1, 50),
      vault2: cleanStringList(responses.vault2, 50),
    },
    ai: {
      provider: "deepseek",
      enabled: Boolean(ai.enabled),
      apiKey: typeof ai.apiKey === "string" ? ai.apiKey.trim() : "",
      model: "deepseek-v4-flash",
      recentMessageCount: Math.round(
        clampNumber(ai.recentMessageCount, 3, 10, fallback.ai.recentMessageCount),
      ),
      language: ai.language === "zh" ? "zh" : "en",
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

export function isScheduleActive(config, date = new Date()) {
  const normalized = normalizeConfig(config);
  const current = date.getHours() * 60 + date.getMinutes();
  const start = minutesFromTime(normalized.schedule.start);
  const end = minutesFromTime(normalized.schedule.end);
  const todaySelected = normalized.schedule.days.includes(date.getDay());
  if (start === end) return todaySelected;
  if (start < end) return todaySelected && current >= start && current < end;
  if (todaySelected && current >= start) return true;
  const previousDay = (date.getDay() + 6) % 7;
  return normalized.schedule.days.includes(previousDay) && current < end;
}

export function validateConfig(config) {
  const normalized = normalizeConfig(config);
  const errors = [];
  if (normalized.schedule.days.length === 0) errors.push("Select at least one scheduled day.");
  if (normalized.responses.vault1.length === 0) errors.push("Vault 1 needs at least one response.");
  if (normalized.responses.vault2.length === 0) errors.push("Vault 2 needs at least one response.");
  if (normalized.ai.enabled && !normalized.ai.apiKey) {
    errors.push("Add a DeepSeek API key or turn off AI adaptation.");
  }
  return { valid: errors.length === 0, errors, config: normalized };
}

export function formatClock(value) {
  const [hourValue, minute] = value.split(":").map(Number);
  const suffix = hourValue >= 12 ? "PM" : "AM";
  const hour = hourValue % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
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
  return `${formatDayRange(normalized.schedule.days)} · ${formatClock(normalized.schedule.start)}–${formatClock(normalized.schedule.end)}`;
}

export function nextWindowLabel(config, now = new Date()) {
  const normalized = normalizeConfig(config);
  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(0, 0, 0, 0);
    if (!normalized.schedule.days.includes(candidate.getDay())) continue;
    const [hours, minutes] = normalized.schedule.start.split(":").map(Number);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate <= now) continue;
    const dayLabel = offset === 0 ? "today" : offset === 1 ? "tomorrow" : DAY_OPTIONS.find((day) => day.value === candidate.getDay())?.label;
    return `Starts ${dayLabel} at ${formatClock(normalized.schedule.start)}`;
  }
  return "Review your schedule";
}
