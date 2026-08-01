function minutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

export function isRuntimeScheduleActive(config, date = new Date()) {
  const days = config?.schedule?.days;
  const windows = config?.schedule?.windows;
  if (!Array.isArray(days) || !Array.isArray(windows)) return false;
  const current = date.getHours() * 60 + date.getMinutes();
  return windows.some((window) => {
    const start = minutes(window.start);
    const end = minutes(window.end);
    if (start < 0 || end < 0) return false;
    const today = days.includes(date.getDay());
    if (start === end) return today;
    if (start < end) return today && current >= start && current < end;
    return (today && current >= start)
      || (days.includes((date.getDay() + 6) % 7) && current < end);
  });
}

export function nextRuntimeWindowStart(config, date = new Date()) {
  const days = config?.schedule?.days;
  const windows = config?.schedule?.windows;
  if (!Array.isArray(days) || !Array.isArray(windows)) return null;
  let next = null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const day = new Date(date);
    day.setDate(date.getDate() + offset);
    day.setHours(0, 0, 0, 0);
    if (!days.includes(day.getDay())) continue;
    for (const window of windows) {
      const start = minutes(window.start);
      if (start < 0) continue;
      const candidate = new Date(day);
      candidate.setMinutes(start);
      if (candidate > date && (!next || candidate < next)) next = candidate;
    }
  }
  return next;
}

export function runtimeWindowEnd(config, date = new Date()) {
  if (!isRuntimeScheduleActive(config, date)) return new Date(date.getTime() + 60 * 60 * 1_000);
  const current = date.getHours() * 60 + date.getMinutes();
  const ends = [];
  for (const window of config.schedule.windows) {
    const start = minutes(window.start);
    const end = minutes(window.end);
    const today = config.schedule.days.includes(date.getDay());
    const previous = config.schedule.days.includes((date.getDay() + 6) % 7);
    const active = start === end ? today
      : start < end ? today && current >= start && current < end
        : (today && current >= start) || (previous && current < end);
    if (!active) continue;
    const target = new Date(date);
    if (start === end) target.setDate(target.getDate() + 1);
    else if (start > end && current >= start) target.setDate(target.getDate() + 1);
    target.setHours(Math.floor(end / 60), end % 60, 0, 0);
    ends.push(target);
  }
  return new Date(Math.min(...ends.map((item) => item.getTime())));
}

export function formatRuntimeCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutesPart = Math.floor((seconds % 3_600) / 60);
  const secondsPart = seconds % 60;
  return [hours, minutesPart, secondsPart]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function validateRuntimeConfig(config) {
  const errors = [];
  if (!config || config.version !== 3) errors.push("Open Chatbut once to upgrade this configuration.");
  if (!Array.isArray(config?.schedule?.days) || !config.schedule.days.length) errors.push("Select at least one scheduled day.");
  if (!Array.isArray(config?.schedule?.windows) || !config.schedule.windows.length) errors.push("Add at least one response window.");
  if (!config?.responses?.vault1?.length) errors.push("Vault 1 needs at least one response.");
  if (!config?.responses?.vault2?.length) errors.push("Vault 2 needs at least one response.");
  if (config?.llm?.enabled) {
    const active = config.llm.connections?.find(
      (connection) => connection.providerId === config.llm.activeProviderId,
    );
    if (!active?.model || active.status !== "validated") {
      errors.push("Validate the active LLM connection before enabling.");
    }
  }
  return { valid: errors.length === 0, errors, config };
}
