export const SESSION_REPLY_LIMIT = 20;
export const ROLLING_REPLY_LIMIT = 5;
export const ROLLING_REPLY_WINDOW_MS = 5 * 60 * 1000;
export const CONVERSATION_KINDS = ["direct", "group-direct", "space"];

export function randomDelayMs(minimumSeconds, maximumSeconds, random = Math.random) {
  const minimum = Math.max(1, Math.round(Number(minimumSeconds) || 1));
  const maximum = Math.max(minimum, Math.round(Number(maximumSeconds) || minimum));
  return (minimum + Math.floor(random() * (maximum - minimum + 1))) * 1000;
}

export function randomTemplate(vault, random = Math.random) {
  if (!Array.isArray(vault) || vault.length === 0) return "";
  return vault[Math.min(vault.length - 1, Math.floor(random() * vault.length))];
}

export function nonRepeatingTemplate(
  vault,
  { recentMessages = [], usedTemplates = [], random = Math.random } = {},
) {
  const templates = Array.isArray(vault) ? vault : [];
  if (!templates.length) return "";
  const recent = recentMessages.map((item) => String(item?.text ?? item).toLowerCase()).join(" ");
  const unseen = templates.filter(
    (template) => !usedTemplates.includes(template) && !recent.includes(template.toLowerCase()),
  );
  const notPrevious = templates.filter((template) => template !== usedTemplates.at(-1));
  return randomTemplate(
    unseen.length ? unseen : notPrevious.length ? notPrevious : templates,
    random,
  );
}

export function isTargetAllowed(config, conversation) {
  if (!conversation?.id) return false;
  if (conversation.kind === "direct") {
    return !config.targeting.directExclusions.some((item) => item.id === conversation.id);
  }
  if (conversation.kind === "group-direct") {
    return !config.targeting.directExclusions.some((item) => item.id === conversation.id)
      && Boolean(conversation.mentionedSelf || conversation.repliedToSelf);
  }
  if (conversation.kind === "space") {
    return config.targeting.selectedGroups.some((item) => item.id === conversation.id)
      && Boolean(conversation.mentionedSelf || conversation.repliedToSelf);
  }
  return false;
}

export function mayInspectConversation(config, conversation) {
  if (!conversation?.id) return false;
  if (conversation.kind === "direct" || conversation.kind === "group-direct") {
    return !config.targeting.directExclusions.some((item) => item.id === conversation.id);
  }
  if (conversation.kind === "space") {
    return config.targeting.selectedGroups.some((item) => item.id === conversation.id);
  }
  return false;
}

export function classifyConversation(id, section) {
  const value = String(id ?? "");
  if (section === "direct") {
    if (value.startsWith("dm/")) return "direct";
    if (value.startsWith("space/")) return "group-direct";
  }
  if (section === "space" && value.startsWith("space/")) return "space";
  return "unknown";
}

export function normalizeConversationLabel(value, fallback = "Saved chat") {
  const label = String(value ?? "")
    .replace(/\s*Press tab for more options\.?\s*$/i, "")
    .replace(/\s*Open in a pop-up\s*$/i, "")
    .replace(/^\s*Options\s*$/i, "")
    .replace(/\s+Conversation\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return label || fallback;
}

export function mentionTargetsSelf(mentionEmails, selfEmail) {
  const identity = String(selfEmail ?? "").trim().toLowerCase();
  if (!identity) return false;
  return (Array.isArray(mentionEmails) ? mentionEmails : [])
    .some((email) => String(email ?? "").trim().toLowerCase() === identity);
}

export function selectVault(state, now, followUpMinutes) {
  if (!state?.firstSentAt) return "vault1";
  if (state.secondSentAt) return null;
  const elapsed = now - state.firstSentAt;
  return elapsed >= Number(followUpMinutes) * 60 * 1000 ? "vault2" : null;
}

export function maySend({ sessionCount, sentTimestamps, now = Date.now() }) {
  if (sessionCount >= SESSION_REPLY_LIMIT) return false;
  const recent = sentTimestamps.filter((time) => now - time < ROLLING_REPLY_WINDOW_MS);
  return recent.length < ROLLING_REPLY_LIMIT;
}

export function normalizeDraft(value, fallback) {
  const plain = String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return fallback;
  const sentences = plain.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [plain];
  return sentences.slice(0, 2).map((sentence) => sentence.trim()).join(" ").slice(0, 420) || fallback;
}

export function fuzzyScore(query, label) {
  const needle = String(query).trim().toLowerCase();
  const haystack = String(label).trim().toLowerCase();
  if (!needle) return 1;
  if (haystack.includes(needle)) return 100 - haystack.indexOf(needle);
  let index = 0;
  let score = 0;
  for (const character of haystack) {
    if (character === needle[index]) {
      index += 1;
      score += 2;
      if (index === needle.length) return score;
    }
  }
  return 0;
}

export function redactLogValue(value, secrets = []) {
  const secretList = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  const redacted = JSON.parse(JSON.stringify(value ?? null));
  const visit = (item) => {
    if (!item || typeof item !== "object") return;
    for (const key of Object.keys(item)) {
      if (/api.?key|authorization/i.test(key)) {
        item[key] = "[REDACTED]";
      } else if (typeof item[key] === "string") {
        for (const secret of secretList) {
          if (item[key].includes(secret)) item[key] = item[key].replaceAll(secret, "[REDACTED]");
        }
      } else {
        visit(item[key]);
      }
    }
  };
  visit(redacted);
  return redacted;
}
