import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  activeTeamsConversation,
  classifyTeamsConversation,
  extractTeamsConversationId,
  findAcceptableTeamsRequest,
  latestTeamsIncoming,
  teamsComposer,
  teamsConversationRows,
  teamsMentionTargetsSelf,
  teamsReplyTargetsSelf,
  teamsUnreadTransition,
  teamsVisible,
  visibleTeamsSelfName,
} from "../src/bookmarklet/teams-adapter.js";

const IDS = {
  direct: "19:direct_alpha@unq.gbl.spaces",
  group: "19:group_alpha@thread.v2",
  meeting: "19:meeting_alpha@thread.v2",
  channel: "19:channel_alpha@thread.skype",
};

function makeDom(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() { return this.parentElement || dom.window.document.body; },
  });
  return dom;
}

function row({ id, type = "chat", level = "2", label = "Conversation", extra = "" }) {
  return `<div role="treeitem" aria-level="${level}" data-item-type="${type}" data-fui-tree-item-value="${id}" aria-label="${label}" ${extra}><span>${label}</span></div>`;
}

test("fixed-position Teams profile content remains visible without an offset parent", () => {
  const dom = makeDom('<span data-tid="me-control-displayname">Operator</span>');
  const display = dom.window.document.querySelector('[data-tid="me-control-displayname"]');
  Object.defineProperty(display, "offsetParent", { configurable: true, get: () => null });
  Object.defineProperty(display, "getClientRects", {
    configurable: true,
    value: () => [{ width: 80, height: 20 }],
  });
  assert.equal(teamsVisible(display), true);
  assert.equal(visibleTeamsSelfName(dom.window.document), "Operator");
  display.style.display = "none";
  assert.equal(teamsVisible(display), false);
  assert.equal(visibleTeamsSelfName(dom.window.document), "");
  dom.window.close();
});

test("Separate and Combined navigation fixtures classify only supported non-meeting rows", () => {
  for (const layout of ["separate", "combined"]) {
    const dom = makeDom(`
      <nav data-layout="${layout}">
        ${row({ id: IDS.direct, label: "Direct" })}
        ${row({ id: IDS.group, label: "Group" })}
        ${row({ id: IDS.meeting, label: "Meeting chat" })}
        ${row({ id: "team-parent", type: "team", level: "2", label: "Team", extra: 'data-chatbut-team-id="team-parent" aria-expanded="true"' })}
        ${row({ id: IDS.channel, type: "channel", level: "3", label: "Channel" })}
        ${row({ id: "unsupported-value", label: "Missing canonical ID" })}
      </nav>
    `);
    const items = teamsConversationRows(dom.window.document);
    assert.deepEqual(items.map(({ kind }) => kind), ["direct", "group-direct", "channel"]);
    assert.equal(items.some(({ id }) => id === IDS.meeting), false);
    assert.equal(items.find(({ kind }) => kind === "channel").parentId, "team-parent");
    dom.window.close();
  }
});

test("canonical IDs fail closed on missing, duplicate, or meeting evidence", () => {
  const dom = makeDom(`
    ${row({ id: IDS.direct, label: "One" })}
    ${row({ id: IDS.direct, label: "Duplicate" })}
    ${row({ id: IDS.meeting, label: "Meeting" })}
    ${row({ id: "none", label: "None" })}
  `);
  const rows = teamsConversationRows(dom.window.document);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, IDS.direct);
  assert.equal(rows[0].ambiguous, true);
  assert.equal(rows[0].element, null);
  const meeting = dom.window.document.querySelector('[aria-label="Meeting"]');
  assert.equal(classifyTeamsConversation(meeting), "unknown");
  assert.equal(extractTeamsConversationId(dom.window.document.querySelector('[aria-label="None"]')), "");
  dom.window.close();
});

test("muted chats remain targetable and selected state requires one unambiguous row", () => {
  const dom = makeDom(`
    ${row({ id: IDS.direct, type: "muted-chat", label: "Muted", extra: 'aria-selected="true"' })}
  `);
  const item = teamsConversationRows(dom.window.document)[0];
  assert.equal(item.kind, "direct");
  assert.equal(item.muted, true);
  assert.equal(activeTeamsConversation(dom.window.document).id, IDS.direct);
  dom.window.close();
});

test("active chat falls back to Teams v2's unique roving-tabindex marker", () => {
  const dom = makeDom(`
    <div role="treeitem" data-item-type="chat" tabindex="0"
      data-fui-tree-item-value="self|chat|48:notes">Active self-chat</div>
    <div role="treeitem" data-item-type="chat" tabindex="-1"
      data-fui-tree-item-value="19:other@unq.gbl.spaces">Other</div>
  `);
  const active = activeTeamsConversation(dom.window.document);
  assert.equal(active?.id, "48:notes");
  assert.equal(active?.kind, "direct");
  dom.window.close();
});

test("unread baselines quarantine old unread rows and allow only later transitions", () => {
  assert.equal(teamsUnreadTransition(undefined, true, true), false);
  assert.equal(teamsUnreadTransition(true, true, false), false);
  assert.equal(teamsUnreadTransition(false, true, false), true);
  assert.equal(teamsUnreadTransition(undefined, true, false), true);
  assert.equal(teamsUnreadTransition(false, false, false), false);
});

test("incoming message parsing suppresses self except for the explicit self-chat path", () => {
  const incoming = makeDom(`
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Colleague</span><div data-tid="chat-pane-message" data-mid="incoming"><span data-message-content>Hello</span></div></div>
  `);
  assert.equal(latestTeamsIncoming(incoming.window.document, "Operator").id, "incoming");
  incoming.window.close();

  const self = makeDom(`
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Operator (You)</span><div data-tid="chat-pane-message" data-mid="self"><span data-message-content>Hello</span></div></div>
  `);
  assert.equal(latestTeamsIncoming(self.window.document, "Operator"), null);
  assert.equal(latestTeamsIncoming(self.window.document, "Operator", true).id, "self");
  self.window.close();

  const bot = makeDom(`
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Workflow</span><span data-author-type="bot"></span><div data-tid="chat-pane-message" data-mid="bot"><span data-message-content>Hello</span></div></div>
  `);
  assert.equal(latestTeamsIncoming(bot.window.document, "Operator"), null);
  bot.window.close();
});

test("self mentions require a structural token and exact resolved identity", () => {
  const dom = makeDom(`
    <div id="plain">Operator please review</div>
    <div id="mention"><span data-tid="mention" data-mention-name="Operator">Operator</span></div>
    <div id="other"><span data-tid="mention" data-mention-name="Other">Operator</span></div>
  `);
  assert.equal(teamsMentionTargetsSelf(dom.window.document.getElementById("plain"), "Operator"), false);
  assert.equal(teamsMentionTargetsSelf(dom.window.document.getElementById("mention"), "Operator"), true);
  assert.equal(teamsMentionTargetsSelf(dom.window.document.getElementById("other"), "Operator"), false);
  dom.window.close();
});

test("direct replies require one unique visible self-authored quote target", () => {
  const dom = makeDom(`
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Operator</span><div data-tid="chat-pane-message" data-mid="self-one"><span data-message-content>Known answer</span></div></div>
    <div data-tid="chat-pane-item"><span data-tid="message-author-name">Colleague</span><div data-tid="chat-pane-message" data-mid="reply"><div data-tid="quoted-reply-card"><span data-tid="quoted-reply-preview-content">Known answer</span></div><span data-message-content>Following up</span></div></div>
  `);
  const reply = dom.window.document.querySelector('[data-mid="reply"]');
  assert.equal(teamsReplyTargetsSelf(reply, "Operator", dom.window.document), true);
  dom.window.document.body.insertAdjacentHTML("afterbegin", `<div data-tid="chat-pane-item"><span data-tid="message-author-name">Operator</span><div data-tid="chat-pane-message" data-mid="self-two"><span data-message-content>Known answer</span></div></div>`);
  assert.equal(teamsReplyTargetsSelf(reply, "Operator", dom.window.document), false);
  dom.window.close();
});

test("composer detection preserves drafts and rejects ambiguous or disabled send state", () => {
  const dom = makeDom(`
    <div role="textbox" contenteditable="true" data-tid="ckeditor">My draft</div>
    <button data-tid="sendMessageCommands-send" disabled>Send</button>
  `);
  const state = teamsComposer(dom.window.document);
  assert.equal(state.draft, "My draft");
  assert.equal(state.ready, false);
  dom.window.document.body.insertAdjacentHTML("beforeend", '<div role="textbox" contenteditable="true" data-tid="ckeditor"></div>');
  assert.equal(teamsComposer(dom.window.document), null);
  dom.window.close();
});

test("automatic request acceptance allows one human direct request and blocks risky variants", () => {
  const allowed = makeDom(`
    <section data-chatbut-request="true" data-fui-tree-item-value="${IDS.direct}">
      <span data-chatbut-request-participant="true" data-persona-type="person">Person</span>
      <button>Accept</button>
    </section>
  `);
  assert.equal(findAcceptableTeamsRequest(allowed.window.document).id, IDS.direct);
  allowed.window.close();

  for (const risky of [
    "Preview messages",
    "Meeting request",
    "Group chat request",
  ]) {
    const blocked = makeDom(`
      <section data-chatbut-request="true" data-fui-tree-item-value="${IDS.direct}">
        <span>${risky}</span><span data-chatbut-request-participant="true">Person</span><button>Accept</button>
      </section>
    `);
    assert.equal(findAcceptableTeamsRequest(blocked.window.document), null);
    blocked.window.close();
  }
});
