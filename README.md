<p align="center">
  <img src="app/public/assets/chatbut-mark.png" width="92" height="92" alt="Chatbut logo">
</p>

<h1 align="center">Chatbut</h1>

<p align="center">
  Thoughtful, scheduled acknowledgements for Google Chat—without installing an app or extension.
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
messages outside their working hours but cannot install software on their work
computer. While an enabled Google Chat tab is open, it watches for eligible new
messages and sends a short acknowledge-and-defer reply from the user's own
signed-in account.

This repository is an experimental proof of concept. Start with non-sensitive
test conversations.

## Why a bookmarklet?

A bookmarklet is a browser bookmark that contains a small program. Chatbut
requires no extension, installer, Google OAuth consent, Chat app, hosted
account, or background service. The user must deliberately click the bookmark
and enable each session.

The trade-off is equally deliberate: Google Chat must remain open, the computer
must stay awake, and Google interface changes can require Chatbut updates.

## MVP features

| Area | Tested behavior |
| --- | --- |
| Schedule | Up to 8 recurring time windows on selected days, including overnight windows, in the browser's timezone |
| Manual override | Warn and allow one-session enable outside the schedule; stop at reload or explicit Stop |
| 1:1 direct messages | Everyone except conversations on the exclusion list |
| Multi-person DMs | Everyone except exclusions, but only for a verified `@mention` or direct reply |
| Spaces | Selected Spaces only, and only for a verified `@mention` or direct reply |
| First reply | Random Vault 1 template after a configurable delay; default 30–90 seconds |
| Follow-up | At most one Vault 2 reply after a configurable cooldown and another eligible message; default 15 minutes |
| LLM adaptation | Optional BYOK connections for DeepSeek, OpenAI, Claude, Kimi Global, or Kimi China |
| Provider safety | Model discovery plus a tiny completion test before a connection is saved; one active provider at a time |
| Invitations | Separate, off-by-default controls for human 1:1 requests and Space invitations |
| Storage | Versioned browser-local configuration with explicit JSON import/export |
| Logging | Off by default; optional browser-local debug log, rotated at 10 MB and exportable on demand |
| Safety | New messages only, one active instance, send limits, re-verification before every send, immediate Stop |

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
4. Drag the orange **💬 Chatbut** button into Chrome's bookmarks bar once.
5. Select **Open Google Chat**, or use an existing
   `https://chat.google.com/app/home` tab.
6. While on the Google Chat page, click the **💬 Chatbut** bookmark. The tab
   becomes the dedicated automation tab and Chatbut opens a clean Google Chat
   tab for normal use.
7. In the dedicated automation tab, review the compact status panel and select
   **Enable**.

The configurator may be closed after the bookmark connects. Chatbut remains
disabled after Google Chat reloads, Chrome restarts, or the tab closes; click
the bookmark again to begin a new session.

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
          ┌──────────────┴──────────────┐
          │                             │
 Google Chat runtime             optional LLM API
 rendered DOM only              key stays in worker
          │                             │
          └──────── saved/adapted reply ┘
                         │
             target + composer re-check
                         │
                         ▼
            normal message from the user
```

The runtime uses Google Chat's rendered interface. It does not call
undocumented Google private APIs. At enable time it records a baseline, then
coalesces new message bursts, filters out excluded and non-opted-in
conversations before navigating, verifies the conversation and composer
immediately before sending, and restores the previously open chat.

The bookmark opens a helper at the Chatbut origin. The helper transfers a
paired `SharedWorker` message port to the exact Google Chat opener, then turns
itself into the clean Google Chat tab. The original tab is visibly titled
**Chatbut automation · Google Chat**. Configuration changes are synchronized
while both sides are connected. LLM credentials stay inside the
Chatbut-origin worker and are removed from configuration copies sent to Google
Chat.

Eligible conversations may be marked read or visibly change the automation tab
for a moment. The clean Google Chat tab is left for normal user activity.

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
  enable.
- Multi-person DMs require a verified mention or direct reply even when they
  are not excluded.
- Spaces must be selected and the triggering message must mention or directly
  reply to the user.
- Bots, apps, ambiguous identities, unsupported message structures, and
  uncertain reply targets are skipped.
- Chatbut stops after 20 automatic replies in a session or 5 in a rolling
  five-minute period.
- Schedule, enabled state, target identity, and composer are checked again
  immediately before each send.

## Limitations

- Chrome desktop only for the MVP.
- Google Chat must remain open and the computer awake.
- Managed-browser policy may block bookmarklets, helper tabs, SharedWorker,
  IndexedDB, or provider network access.
- DOM automation is inherently fragile and may break when Google changes the
  Chat interface.
- Direct-reply detection fails closed when the target cannot be verified.
- Invitation discovery currently targets the English Google Chat interface.
- Chrome does not expose a normal filesystem path for browser-local storage.
  JSON export is the explicit backup and transfer path.
- Microsoft Teams is not implemented yet.

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
│   │   └── bookmarklet/        # Readable Google Chat runtime and pure logic
│   ├── public/                 # Bridge worker, assets, generated bookmarklet
│   ├── scripts/                # Deterministic bookmarklet and hosting builds
│   └── tests/                  # Schedule, targeting, runtime, provider, hosting
├── .github/workflows/          # Test-gated GitHub Pages deployment
├── .hallmark/                  # Cached design-system preflight
├── plan.md                     # Product decisions and acceptance criteria
└── SECURITY.md                 # POC security guidance
```

## Project status

Chatbut is an experimental POC intended to improve response experience, not a
supported Google integration. It is not affiliated with, endorsed by, or
sponsored by Google, Google Chat, Microsoft, Microsoft Teams, DeepSeek, OpenAI,
Anthropic, or Moonshot AI.

The project took structural inspiration from the author's earlier bookmarklet
utility, InstaUnfollow, while using separate automation, privacy, safety, and
design decisions.

## License

[MIT](LICENSE)
