<p align="center">
  <img src="app/public/assets/chatbut-mark.png" width="92" height="92" alt="Chatbut logo">
</p>

<h1 align="center">Chatbut</h1>

<p align="center">
  Thoughtful, scheduled acknowledgements for Google Chat and Microsoft Teams—without installing an app or extension.
</p>

<p align="center">
  <a href="https://jiannystein.github.io/chatbut/"><strong>Open Chatbut</strong></a>
  ·
  <a href="#quick-start">Quick start</a>
  ·
  <a href="#privacy-and-security">Privacy</a>
  ·
  <a href="#limitations">Limitations</a>
</p>

<p align="center">
  <a href="https://github.com/jiannystein/chatbut/actions/workflows/deploy-pages.yml"><img alt="Test and deploy status" src="https://github.com/jiannystein/chatbut/actions/workflows/deploy-pages.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-1d1b18.svg"></a>
  <img alt="Chrome desktop" src="https://img.shields.io/badge/browser-Chrome%20desktop-b94f25.svg">
</p>

Chatbut is a local-first Chrome bookmarklet for people who receive Google Chat
or Microsoft Teams messages outside their working hours but cannot install
software on their work computer. While an enabled supported chat tab is open,
it watches for eligible new messages and sends a short acknowledge-and-defer
reply from the user's own signed-in account.

This repository is an experimental proof of concept. Start with non-sensitive
test conversations.

## Why a bookmarklet?

A bookmarklet is a browser bookmark that contains a small program. Chatbut
requires no extension, installer, Google OAuth consent, Chat app, hosted
account, or background service. The user must deliberately click the bookmark
for each session, then enable immediately or leave that tab waiting for the
next scheduled window.

The trade-off is equally deliberate: the dedicated chat tab must remain open,
the computer must stay awake, and Google or Microsoft interface changes can
require Chatbut updates.

## Features

- Schedule up to eight recurring time windows on selected days, including
  overnight windows, using the browser's timezone.
- Click before a window to see a one-shot **Starts in HH:MM:SS** countdown.
  Chatbut enables when that window opens while the same tab remains open.
- Use **Enable now** outside the schedule after an explicit one-session
  warning, or stop immediately at any time.
- Cover 1:1 direct messages except platform-specific saved exclusions.
- Cover multi-person DMs except exclusions only when the message contains a
  verified self-`@mention` or direct reply.
- Opt individual Google Spaces or Teams channels in; selected group surfaces
  still require a verified self-`@mention` or direct reply.
- Ignore Teams meeting chats unconditionally, including when another policy
  would otherwise make the conversation eligible.
- Treat a new manually authored message in Teams' built-in self chat as an
  automatic test trigger. The normal first/follow-up timing and templates
  apply, Chatbut-authored messages stay suppressed, and the self chat stops
  after two replies until the next enable session. Excluding the self chat in
  **People** disables this test path.
- Randomly choose a non-repeating first acknowledgement after a configurable
  1–60 second delay, default 5–10 seconds.
- Allow at most one follow-up after a configurable 1–5 minute wait and another
  eligible message, default 1 minute. Waiting by itself never sends a reply.
- Store a versioned, platform-scoped configuration in this Chrome profile with
  explicit JSON import, validation, recovery guidance, and export. Version 2
  Google Chat settings migrate losslessly into version 3; Teams starts with
  safe defaults.
- Keep debug logging off by default; when enabled, rotate the browser-local log
  at 10 MB and export it only on request.
- Enforce new-message baselines, one active instance per platform, a shared
  atomic five-send/five-minute lease, target and composer re-verification,
  non-repeating templates, and immediate Stop.
- Show the release on the configurator, bookmark name, and live widget. A
  non-blocking update notice tells the user when to replace the bookmark.

### Optional features not fully live-tested

- **LLM adaptation:** BYOK connections for DeepSeek, OpenAI, Claude, Kimi
  Global, and Kimi China include model discovery, a minimal validation request,
  one active provider, and saved-response fallback. The bridge and provider
  paths have automated coverage, but end-to-end live adaptation has not been
  accepted with every provider.
- **Invitation automation:** separate, off-by-default controls can accept a
  human 1:1 request on either platform or a Google Space invitation. Teams
  accepts only one unambiguous human direct request; bots, apps, groups,
  channels, and meetings are excluded. These fail-closed paths have automated
  coverage but have not completed the full live acceptance matrix.

Chatbut never answers the substance of a message. With LLM adaptation enabled,
the selected saved response remains the intent: the provider may adapt its
wording to the recent context and sentiment, but the result must remain a
two-sentence-or-shorter acknowledgement and deferral. Without a usable LLM,
Chatbut sends the original saved response.

## Quick start

1. Open [Chatbut](https://jiannystein.github.io/chatbut/) in current desktop
   Chrome.
2. Select **Create local configuration**. Import a JSON backup instead if you
   already have one.
3. Review the schedule, people, reply vaults, and safety settings. The default
   window is Monday–Friday, 06:00–08:00 in the browser's timezone.
4. Select **Google** or **Teams**, then drag the displayed
   **💬 Google Chat v0.3.0** or **💬 Teams v0.3.0** button into
   Chrome's bookmarks bar. The bookmarklets are independent; install both if
   you use both platforms.
5. Select **Open Google Chat** or **Open Teams**. Teams support is limited to
   the work/school v2 client at `https://teams.microsoft.com/v2/`.
6. On that chat page, click its matching Chatbut bookmark. The tab asks for
   confirmation, becomes the dedicated automation tab, and opens a clean tab
   for normal use. Leave the original automation tab open.
7. In the dedicated automation tab, review the compact status panel. Select
   **Enable** while the window is open. Before a window, leave the countdown
   running or select **Enable now** and confirm the override.

Setting changes save locally and reach the connected bookmark automatically.
Re-add the bookmark only when the version shown on this page is newer than the
version in the bookmark name or live widget. Invalid or incomplete
JSON backups are rejected before they can replace local state; Chatbut offers
to export a clean replacement, while the bad disk file must be deleted
manually.

Chrome controls the globe icon used for JavaScript bookmarks. If the bookmark
bar hides Chatbut's label, right-click the bookmark, select **Edit**, and
restore the platform-specific name shown in Chatbut.

The configurator may be closed after the bookmark connects. Chatbut remains
disabled after the chat client reloads, Chrome restarts, or the tab closes;
click the matching bookmark again to begin a new session.

LLM adaptation is optional. To add it, open **Replies → LLM connections**,
choose a provider, enter your key, and select **Validate and save**. Chatbut
lists the models available to that key, selects a suitable text model, and
verifies a minimal completion before persisting the connection.

## How it works

```text
GitHub Pages configurator
        │
        ├── browser-local IndexedDB configuration and logs
        ├── JSON import/export
        └── generated bookmarklet with a random pairing token
                         │
                   trusted helper
                  + SharedWorker
                         │
          ┌──────────────┼──────────────┐
          │              │              │
 Google Chat runtime  Teams runtime   optional LLM API
   rendered DOM only  rendered DOM only  key stays in worker
          │              │              │
          └────── saved/adapted reply ──┘
                         │
             target + composer re-check
                         │
                         ▼
            normal message from the user
```

Each runtime uses the supported client's rendered interface. It does not call
undocumented Google or Microsoft private APIs. At enable time it quarantines
every already-unread conversation, then coalesces later new-message bursts,
filters out excluded and non-opted-in conversations before navigating,
verifies the conversation and composer immediately before sending, and
restores the previously open chat.
Delayed sends are serialized so several chats arriving together cannot race
the single automation tab. Template selection also checks recent visible chat
history and current-session use to avoid repeating the same saved response
when another response is available.

The bookmark opens a helper at the Chatbut origin. The helper transfers a
paired `SharedWorker` message port only to the exact supported opener, then
turns itself into the clean chat tab. The original tab is visibly titled for
the active platform. Configuration changes are synchronized while both sides
are connected. LLM credentials stay inside the Chatbut-origin worker and are
removed from platform runtime copies.

Eligible conversations may be marked read or visibly change the automation tab
for a moment. The clean companion tab is left for normal user activity.

## Privacy and security

- Configuration and optional logs stay in this Chrome profile. Chatbut has no
  backend, account system, analytics, telemetry, or cloud sync.
- API keys are stored as plaintext browser data for this POC and are included
  in exported JSON backups. Anyone or any process with access to the Chrome
  profile or backup can read them.
- When adaptation is enabled, the selected template and the configured 3–10
  recent text messages are sent directly from the Chatbut-origin worker to the
  active provider.
- When adaptation is disabled, no conversation text is sent to an LLM.
- Imported LLM connections are marked **Needs attention** and must be
  revalidated in the current Chrome profile.
- A credential or model failure falls back to the saved response for the
  current message, marks the connection **Needs attention**, and stops
  automation. A transient provider failure falls back and continues.
- Debug mode may record full message context. Credentials and authorization
  headers are redacted, logs rotate at 10 MB, and **Start new** clears the
  current browser-local log.
- Local-only does not automatically mean policy-approved. Confirm your
  organization's data-handling and external-LLM rules.

Read [SECURITY.md](SECURITY.md) before testing with workplace conversations.

## Safety boundaries

- Only messages detected after the current enable time are eligible. A message
  attached to an invitation accepted during the session is the explicit
  exception.
- A manual user message stops automation for that conversation until the next
  enable. Chatbut's own composer activity and outgoing messages do not trigger
  this guard.
- Multi-person DMs require a verified self-mention or direct reply even when
  they are not excluded.
- Google Spaces and Teams channels must be selected individually, and the
  triggering message must mention or directly reply to the user.
- Teams meeting chats are never indexed, queued, accepted, or answered.
- Bots, apps, ambiguous identities, unsupported message structures, and
  uncertain reply targets are skipped.
- Chatbut stops after 20 automatic replies in a platform session. Google Chat
  and Teams share one atomic limit of 5 sends in a rolling five-minute period.
- A nonempty Teams composer is user-owned and is never overwritten.
- Schedule, enabled state, target identity, and composer are checked again
  immediately before each send.

## Verification

The current release passed 61 runtime, adapter, configuration, targeting,
provider, and bridge tests plus 4 hosting/package tests on 2026-08-01. The
encoded Google Chat bookmarklet is 31,514 bytes and the Teams bookmarklet is
32,610 bytes, each against an independently enforced 32,768-byte limit.

Earlier coordinated desktop-Chrome acceptance confirmed Google Chat first
replies in independent
1:1 conversations, a post-cooldown second reply, and suppression of immediate
follow-ups. For an opted-in Space, a message without a mention was ignored;
verified `@mentions` produced both the first and post-cooldown replies, while
an immediate eligible follow-up was suppressed. Every successful reply was
sent as an ordinary message from the signed-in account.

The Teams work/school v2 live smoke verified exact-origin/path gating, direct
chat indexing, the built-in self-chat identifier, selected-chat resolution,
profile identity, an empty composer, send readiness, and one labelled self-DM
message whose rendered author matched the resolved profile. Automated fixtures
cover Separate and Combined navigation, meeting exclusion, groups, channels,
mentions, replies, unread quarantine, drafts, requests, and the two-tab bridge.
Automatic self-chat testing, incoming auto-reply, Combined view, opted-in
channel, and request acceptance still require live acceptance.

## Teams support status

Microsoft Teams work/school web v2 is included as a separate bookmarklet and
DOM adapter. Personal/Free Teams, legacy web paths, mobile clients, and meeting
chats are outside scope. Teams supports both Separate and Combined navigation;
the user's existing Teams navigation preference is not changed.

## Limitations

- Chrome desktop only for the current release.
- The dedicated Google Chat or Teams tab must remain open and the computer
  awake.
- Managed-browser policy may block bookmarklets, helper tabs, SharedWorker,
  IndexedDB, or provider network access.
- DOM automation is inherently fragile and may break when Google or Microsoft
  changes a supported interface.
- Direct-reply detection fails closed when the target cannot be verified.
- Invitation/request discovery currently targets the English interfaces.
- Chrome does not expose a normal filesystem path for browser-local storage.
  JSON export is the explicit backup and transfer path.
- Teams Personal/Free, legacy Teams web, and mobile Teams are unsupported.

## Local development

Requirements: Node.js 24 and desktop Chrome.

```bash
cd app
npm ci
npm test
npm run test:sites
npm run build
npm run dev
```

`npm run build:bookmarklet` bundles the readable source into the bookmark
artifact and fails if the encoded result exceeds 32 KB.

## Repository map

```text
.
├── app/
│   ├── src/                    # React workbench and configuration model
│   │   └── bookmarklet/        # Readable Google Chat and Teams runtimes/adapters
│   ├── public/                 # Bridge worker, assets, generated bookmarklets
│   ├── scripts/                # Deterministic bookmarklet and hosting builds
│   └── tests/                  # Schedule, targeting, runtime, provider, hosting
├── .github/workflows/          # Test-gated GitHub Pages deployment
├── .hallmark/                  # Cached design-system preflight
├── plan.md                     # Product decisions and acceptance criteria
└── SECURITY.md                 # POC security guidance
```

## Project status

Chatbut is an experimental POC intended to improve response experience, not a
supported Google or Microsoft integration. It is not affiliated with, endorsed
by, or sponsored by Google, Google Chat, Microsoft, Microsoft Teams, DeepSeek,
OpenAI, Anthropic, or Moonshot AI.

The project took structural inspiration from the author's earlier bookmarklet
utility, InstaUnfollow, while using separate automation, privacy, safety, and
design decisions.

## License

[MIT](LICENSE)
