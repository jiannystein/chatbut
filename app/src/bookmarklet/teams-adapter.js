const CHAT_ROW_SELECTOR = '[role="treeitem"][data-item-type="chat"], [role="treeitem"][data-item-type="muted-chat"]';
const CHANNEL_ROW_SELECTOR = '[role="treeitem"][data-item-type="channel"][aria-level="3"]';
const MESSAGE_SELECTOR = '[data-tid="chat-pane-message"][data-mid]';
const CONVERSATION_ID_PATTERN = /(?:19:[A-Za-z0-9._~!$&'()*+,;=:@%-]+@(?:unq\.gbl\.spaces|thread\.v2|thread\.skype)|48:notes)/gi;

export function teamsVisible(element) {
  if (!element || element.nodeType !== 1) return false;
  if (element.offsetParent !== null) return true;
  if (typeof element.getClientRects !== "function" || !element.getClientRects().length) return false;
  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  return Boolean(style && style.display !== "none" && style.visibility !== "hidden");
}

export function teamsText(element) {
  return String(element?.innerText ?? element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function uniqueVisible(selector, root = document) {
  const matches = [...root.querySelectorAll(selector)].filter(teamsVisible);
  return matches.length === 1 ? matches[0] : null;
}

function decoded(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractTeamsConversationId(element) {
  if (!element) return "";
  const candidates = [
    element.getAttribute?.("data-fui-tree-item-value"),
    element.getAttribute?.("data-chat-id"),
    element.getAttribute?.("data-conversation-id"),
  ].filter(Boolean);
  const matches = new Set();
  for (const candidate of candidates) {
    for (const match of decoded(String(candidate)).match(CONVERSATION_ID_PATTERN) ?? []) {
      matches.add(match);
    }
  }
  return matches.size === 1 ? [...matches][0] : "";
}

function meetingEvidence(row, id) {
  if (/^19:meeting_/i.test(id)) return true;
  if (row.matches('[data-chatbut-meeting="true"]') || row.querySelector('[data-tid*="meeting" i]')) {
    return true;
  }
  const accessible = row.getAttribute("aria-label") || "";
  return /\bmeeting (chat|conversation)\b/i.test(accessible);
}

export function classifyTeamsConversation(row, id = extractTeamsConversationId(row)) {
  if (!id || meetingEvidence(row, id)) return "unknown";
  const itemType = row.getAttribute("data-item-type") || "";
  if ((id === "48:notes" || id.endsWith("@unq.gbl.spaces")) && /^(chat|muted-chat)$/.test(itemType)) return "direct";
  if (id.endsWith("@thread.v2") && /^(chat|muted-chat)$/.test(itemType)) return "group-direct";
  if (id.endsWith("@thread.skype") && itemType === "channel" && row.getAttribute("aria-level") === "3") {
    return "channel";
  }
  return "unknown";
}

function rowLabel(row, id) {
  const accessible = String(row.getAttribute("aria-label") || "")
    .replace(/\bunread\b/ig, "")
    .replace(/\bmuted\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();
  if (accessible && accessible.length <= 160) return accessible;
  for (const node of row.querySelectorAll("[data-tid], span, div")) {
    if (node.children.length) continue;
    const label = teamsText(node);
    if (label && label.length <= 160 && !/^(unread|muted|more options)$/i.test(label)) return label;
  }
  return id;
}

function parentKey(row) {
  return String(
    row.getAttribute("data-chatbut-team-id")
    || row.getAttribute("data-fui-tree-item-value")
    || "",
  ).trim().slice(0, 320);
}

export function teamsConversationRows(root = document) {
  const rows = [...root.querySelectorAll(`[role="treeitem"], ${CHAT_ROW_SELECTOR}, ${CHANNEL_ROW_SELECTOR}`)]
    .filter(teamsVisible);
  const byId = new Map();
  let currentParentId = "";
  for (const row of rows) {
    if (row.getAttribute("aria-level") === "2" && !row.matches(CHAT_ROW_SELECTOR)) {
      currentParentId = parentKey(row);
      continue;
    }
    if (!row.matches(CHAT_ROW_SELECTOR) && !row.matches(CHANNEL_ROW_SELECTOR)) continue;
    const id = extractTeamsConversationId(row);
    const kind = classifyTeamsConversation(row, id);
    if (!id || kind === "unknown") continue;
    const item = {
      id,
      label: rowLabel(row, id),
      kind,
      unread: Boolean(row.querySelector('[data-tid="unread"]')),
      muted: row.getAttribute("data-item-type") === "muted-chat",
      parentId: kind === "channel" ? currentParentId : "",
      element: row,
      ambiguous: false,
    };
    const prior = byId.get(id);
    if (!prior) byId.set(id, item);
    else {
      byId.set(id, {
        ...prior,
        unread: prior.unread || item.unread,
        element: null,
        ambiguous: true,
      });
    }
  }
  return [...byId.values()];
}

export function activeTeamsConversation(root = document) {
  const rows = teamsConversationRows(root).filter((item) => !item.ambiguous && item.element);
  let selected = rows.filter((item) => (
    ["true", "page"].includes(item.element.getAttribute("aria-selected"))
    || ["true", "page"].includes(item.element.getAttribute("aria-current"))
  ));
  if (!selected.length) selected = rows.filter((item) => item.element.tabIndex === 0);
  return selected.length === 1 ? selected[0] : null;
}

export function visibleTeamsSelfName(root = document) {
  const display = uniqueVisible('[data-tid="me-control-displayname"]', root);
  return teamsText(display).replace(/\s*\(you\)\s*$/i, "").trim();
}

function exactAuthor(message) {
  const group = message.closest('[data-tid="chat-pane-item"]') || message;
  const authors = [...group.querySelectorAll('[data-tid="message-author-name"]')]
    .filter(teamsVisible)
    .map(teamsText)
    .filter(Boolean);
  return new Set(authors).size === 1 ? authors[0] : "";
}

function exactContent(message) {
  const contents = [...message.querySelectorAll("[data-message-content]")].filter(teamsVisible);
  if (message.matches("[data-message-content]")) contents.unshift(message);
  const values = [...new Set(contents.map(teamsText).filter(Boolean))];
  return values.length === 1 ? values[0].slice(0, 1200) : "";
}

function isBotOrApp(message) {
  const group = message.closest('[data-tid="chat-pane-item"]') || message;
  return Boolean(group.querySelector(
    '[data-tid*="bot" i], [data-tid*="app-message" i], [data-author-type="bot" i], [data-author-type="app" i]',
  ));
}

export function teamsMentionTargetsSelf(message, selfName) {
  const identity = String(selfName || "").trim().toLocaleLowerCase();
  if (!identity) return false;
  const tokens = [...message.querySelectorAll(
    '[data-tid="mention"], [data-mention-id], [data-mention="true"]',
  )].filter(teamsVisible);
  return tokens.some((token) => {
    const resolved = String(
      token.getAttribute("data-mention-name")
      || token.getAttribute("data-display-name")
      || teamsText(token),
    ).replace(/\s*\(you\)\s*$/i, "").trim().toLocaleLowerCase();
    return resolved === identity;
  });
}

export function teamsReplyTargetsSelf(message, selfName, root = document) {
  const quote = uniqueVisible('[data-tid="quoted-reply-card"] [data-tid="quoted-reply-preview-content"]', message)
    || uniqueVisible('[data-tid="quoted-reply-preview-content"]', message);
  const preview = teamsText(quote);
  if (!preview) return false;
  const prior = [...root.querySelectorAll(MESSAGE_SELECTOR)]
    .filter(teamsVisible)
    .filter((candidate) => candidate !== message && exactAuthor(candidate) === selfName)
    .filter((candidate) => exactContent(candidate) === preview);
  return prior.length === 1;
}

export function latestTeamsIncoming(root = document, selfName = "", allowSelf = false) {
  const messages = [...root.querySelectorAll(MESSAGE_SELECTOR)].filter(teamsVisible);
  const message = messages.at(-1);
  if (!message) return null;
  const id = String(message.getAttribute("data-mid") || "").trim();
  const author = exactAuthor(message).replace(/\s*\(you\)\s*$/i, "").trim();
  const normalizedSelf = String(selfName || "").replace(/\s*\(you\)\s*$/i, "").trim();
  const text = exactContent(message);
  if (!id || !author || !normalizedSelf || (!allowSelf && author === normalizedSelf) || !text || isBotOrApp(message)) return null;
  if (message.querySelector('[data-tid*="attachment" i], [data-tid*="system-message" i]')) return null;
  return {
    id,
    author,
    text,
    mentionedSelf: teamsMentionTargetsSelf(message, normalizedSelf),
    repliedToSelf: teamsReplyTargetsSelf(message, normalizedSelf, root),
    element: message,
  };
}

export function recentTeamsContext(root = document, count = 5, selfName = "") {
  return [...root.querySelectorAll(MESSAGE_SELECTOR)]
    .filter(teamsVisible)
    .slice(-Math.max(1, Number(count) || 1))
    .map((message) => ({
      author: exactAuthor(message).replace(/\s*\(you\)\s*$/i, "").trim() === selfName ? "self" : "sender",
      text: exactContent(message).slice(0, 800),
    }))
    .filter((message) => message.text);
}

export function teamsComposer(root = document) {
  const composer = uniqueVisible('div[role="textbox"][contenteditable="true"][data-tid="ckeditor"]', root);
  const send = uniqueVisible('button[data-tid="sendMessageCommands-send"]', root);
  if (!composer || !send) return null;
  return {
    composer,
    send,
    draft: teamsText(composer),
    ready: !send.disabled && send.getAttribute("aria-disabled") !== "true",
  };
}

export function findAcceptableTeamsRequest(root = document) {
  const requests = [...root.querySelectorAll(
    '[data-tid="message-request"], [data-tid="chat-request"], [data-chatbut-request="true"]',
  )].filter(teamsVisible);
  if (requests.length !== 1) return null;
  const request = requests[0];
  const requestText = teamsText(request);
  if (/preview messages|meeting|group chat|multiple participants/i.test(requestText)) return null;
  if (request.querySelector('[data-tid*="bot" i], [data-persona-type="bot" i], [data-persona-type="app" i]')) return null;
  const participants = [...request.querySelectorAll(
    '[data-tid="request-participant"], [data-chatbut-request-participant="true"]',
  )].filter(teamsVisible);
  if (participants.length !== 1) return null;
  const accept = [...request.querySelectorAll("button")]
    .filter(teamsVisible)
    .filter((button) => /^accept$/i.test(teamsText(button)));
  if (accept.length !== 1) return null;
  const id = extractTeamsConversationId(request);
  if (!id || !id.endsWith("@unq.gbl.spaces")) return null;
  return { id, request, accept: accept[0] };
}

export function teamsUnreadTransition(previous, current, quarantined = false) {
  if (quarantined || !current) return false;
  return previous === false || typeof previous === "undefined";
}

export function teamsAppControl(app, root = document) {
  const selectors = app === "teams"
    ? [
      '[data-tid="app-bar-teams"]',
      '[data-tid="app-bar-item-teams"]',
      'button[aria-label="Teams"]',
    ]
    : [
      '[data-tid="app-bar-chat"]',
      '[data-tid="app-bar-item-chat"]',
      'button[aria-label="Chat"]',
    ];
  const matches = selectors.flatMap((selector) => [...root.querySelectorAll(selector)])
    .filter(teamsVisible);
  return new Set(matches).size === 1 ? matches[0] : null;
}

export function activeTeamsApp(root = document) {
  for (const app of ["chat", "teams"]) {
    const control = teamsAppControl(app, root);
    if (control && (
      control.getAttribute("aria-selected") === "true"
      || control.getAttribute("aria-current") === "page"
    )) return app;
  }
  return "combined";
}
