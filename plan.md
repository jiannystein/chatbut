# Chatbut MVP plan

Status: Google Chat POC implemented and locally verified on 2026-07-31.

## Product objective

Build a public, accountless GitHub Pages app that installs a Chrome bookmarklet
for Google Chat web. While the user keeps a signed-in Google Chat tab open,
Chatbut monitors eligible new messages during selected windows and sends brief
acknowledge-and-defer replies from the user's normal account.

The product is for users who cannot install software on their work computer. It
requires no extension, desktop installer, Google Chat app, Google OAuth grant,
backend account, hosted database, analytics, or telemetry.

## Feasibility decision

The POC is feasible through browser-interface automation.

- Controlled Chrome checks confirmed usable direct-message and Space
  structures, unique composers and send controls, authorship signals, and a
  live Space `@mention`.
- The runtime uses Google Chat's rendered DOM rather than undocumented private
  network APIs.
- Browser automation is less stable than a supported integration. Every
  ambiguous target, author, reply, composer, or message structure fails closed.
- A browser security boundary prevented automated execution of the
  `javascript:` bookmark during the final Chrome pass. The user must perform
  the last real-send acceptance check by clicking the installed bookmark.

## Supported environment

- Current desktop Google Chrome.
- Google Chat at `https://chat.google.com/app/home`.
- GitHub Pages for the configuration workbench and bridge worker.
- A dedicated Google Chat tab remains open and the computer remains awake.
- Reloading or closing Google Chat, restarting Chrome, or clicking **Stop**
  disables the current session.
- Unsupported URLs stop with a clear warning.

### Non-goals

- Microsoft Teams, Edge, Firefox, Safari, or mobile browser support.
- Background operation while Chrome or the computer is closed, locked, or
  asleep.
- Google OAuth, a supported Google Chat API integration, a Chat app, or an
  extension.
- Cloud sync, accounts, server-side storage, analytics, or telemetry.
- Reading attachments, images, files, voice notes, or linked documents.
- Answering the substance of a message.

## Activation and local storage

- First run shows an explicit empty state. Bookmark installation and
  **Open Google Chat** remain locked until the user creates or imports a
  configuration.
- Configuration and optional debug logs use versioned IndexedDB records in the
  current Chrome profile.
- JSON import/export is the explicit backup and transfer mechanism.
- Chrome does not expose a normal absolute filesystem path for browser-local
  storage; the UI identifies the current Chrome profile instead.
- Imported credentials remain present but are marked **Needs attention** until
  they pass validation in the current profile.
- A random pairing token is embedded when the bookmark is installed.
- Clicking the bookmark turns the current Google Chat page into a dedicated
  automation tab and opens a helper at the exact Chatbut origin. The helper
  transfers a paired `SharedWorker` message port to the exact Google Chat
  opener, then navigates itself to a clean Google Chat tab for normal use.
- The worker can serve configuration after the configurator tab closes.
- Configuration edits synchronize to a connected runtime. Google Chat target
  changes synchronize back into browser-local storage.
- LLM keys stay in the Chatbut-origin worker. They are removed from
  configuration copies sent to Google Chat.
- Every enable is manual and non-persistent.

## Scheduling

- Default: Monday–Friday, 06:00–08:00 in the browser's current timezone.
- Support 1–8 recurring windows on the same selected days.
- Support same-day and overnight windows.
- Reject duplicate, overlapping, incomplete, or invalid windows.
- Only messages arriving after the current enable timestamp are eligible.
- Outside the configured schedule, require an explicit one-session warning and
  confirmation. The override lasts until **Stop** or reload.
- Without an override, automation stops when the schedule closes and does not
  restart until the next enable.
- The injected widget stays stationary and shows enabled/disabled state,
  immediate Stop, and current-session Replies/Chats/Pending metrics.
- A browser-local lease permits only one active Chatbut runtime.

## Conversation targeting

### Direct messages

- Default: every one-to-one conversation except saved exclusions.
- Ignore the user's own messages, bots/apps, unsupported message types, and
  unresolved identities.

### Multi-person direct messages

- Default: every multi-person DM except saved exclusions.
- Require a verified `@mention` of the signed-in account or a verified direct
  reply before responding.
- If the signed-in identity or reply target cannot be verified, skip.

### Spaces

- Spaces are opt-in through a saved allowlist.
- A selected Space triggers only for a verified `@mention` or a verified direct
  reply to the user.
- Preserve a source thread when Google Chat exposes a verifiable target.
- If the thread or reply target is ambiguous, skip the message.

### Conversation picker

- Index recent conversations visible in Google Chat.
- Fuzzy search results appear in a click-to-add dropdown.
- Save stable IDs and human-readable labels.
- Never silently retarget by display name.
- The runtime refreshes a browser-local recent-conversation index.
- The workbench provides one searchable policy list; the injected widget does
  not contain targeting controls.

### Invitation acceptance

- Separate **Auto-accept human 1:1 requests** and
  **Auto-accept Space invitations** switches.
- Both default off and include an accessible explanatory tooltip.
- Acceptance runs only while manually enabled and scheduled or overridden.
- Never accept an invitation from an uncertain identity or bot/app.
- A message attached to an accepted direct request is treated as new.
- An accepted Space is added to the allowlist and still requires a mention or
  direct reply.

## Reply state machine

State is per conversation and per enable session.

1. The first eligible message starts a randomized Vault 1 delay.
2. Default delay is 30–90 seconds; both bounds are configurable.
3. Eligible messages arriving during the delay are coalesced.
4. Immediately before sending, re-check schedule/override, enabled state,
   target, identity, manual activity, composer, and DOM structure.
5. Vault 2 may send at most once per conversation in the session.
6. Vault 2 requires another eligible message after Vault 1 and the configured
   cooldown, default 15 minutes.
7. Vault 2 never sends merely because the cooldown elapsed.
8. A manual user message stops automation for that conversation until the next
   enable.
9. Disabling and re-enabling starts a new session.

Circuit breakers:

- At most 20 automatic replies per enable session.
- At most 5 automatic replies in any rolling five-minute period.
- Coalesce bursts rather than replying to every message.
- Skip uncertain messages and continue monitoring other conversations.

## Saved responses

- Vault 1 stores first acknowledgements.
- Vault 2 stores follow-up deferrals.
- Each vault contains one or more editable templates.
- Select a template randomly from the required vault.
- Do not enable with an empty vault.
- Without LLM adaptation, send the selected template unchanged.

## Optional LLM adaptation

Supported connection types:

- DeepSeek — default provider.
- OpenAI.
- Anthropic Claude.
- Kimi Global.
- Kimi China.

Connection rules:

- Bring your own API key.
- Keep multiple provider connections, but exactly one may be active.
- A master switch controls whether adaptation is used.
- A new connection is persisted only after model discovery and a minimal
  completion both succeed.
- Provider model lists are ranked for a small general-purpose text model.
- Validate the active connection again before each enable.
- Show **Delete** whenever a saved connection is unusable so the user can
  replace it.
- Imported connections require revalidation.

Generation rules:

- Randomly choose the applicable saved template first.
- Send a configurable 3–10 recent text messages; default 5.
- Context may include both sides, excludes attachment contents, and is bounded.
- Adapt wording to the triggering content and sentiment without changing the
  governing intent.
- Always acknowledge and defer.
- Casual, empathetic, workplace-appropriate corporate tone.
- English by default; optional Chinese.
- Plain text only, at most two sentences.
- No new promise, deadline, fact, approval, commitment, or recommendation.
- Normalize and bound model output before insertion.

Failure behavior:

- A transient network, timeout, rate-limit, or provider failure sends the
  original template for that message and continues monitoring.
- A credential or model failure sends the original template for the current
  message, marks the connection **Needs attention**, and stops automation.
- No recipient-facing message indicates that a saved response or LLM was used.

## Debug logging

- Normal operation keeps no activity history.
- Debug mode defaults off.
- When enabled, write browser-local records with technical state, selector
  decisions, skip reasons, LLM latency/fallback, and send verification.
- Full message context may appear in debug mode.
- Always redact API keys, authorization headers, and known credential values.
- Rotate at 10 MB to a new numbered log.
- Let the user export the current log or select **Start new**.

## Engineering boundaries

- Maintain readable bookmarklet source and generate the encoded artifact during
  build.
- Hard-fail the build above a 32 KB encoded bookmarklet budget.
- Keep provider networking in the Chatbut-origin bridge worker so credentials
  are not copied into Google Chat.
- Treat chat content and provider output as untrusted text; never render either
  with `innerHTML`.
- Prefer unique accessibility roles, labels, and validated structural
  attributes.
- Reverify the target after navigation and immediately before send.
- Restore the previously open conversation after scanning when possible.
- Preserve normal keyboard, touch, and page behavior outside the overlay.

## UX and visual system

- Product Design established the selected Workbench structure.
- Hallmark applies the warm editorial utility system:
  Newsreader display type, Manrope body type, warm paper, black ink, orange
  action accent, and green ready/safe states.
- The UI uses centralized semantic OKLCH tokens.
- The workbench covers empty, saved, saving, disabled, warning, error, success,
  validation, needs-attention, enabled, and debug states.
- The Google Chat overlay stays compact and operational.
- Required responsive checks: 320, 375, 414, 768, and desktop widths.
- Required accessibility checks: visible focus, contrast, keyboard operation,
  reduced motion, non-color status labels, and no horizontal overflow.
- Recipients receive no Chatbut or AI attribution. The workbench still clearly
  discloses provider data transfer to the user.

## Verification record

Completed locally on 2026-07-31:

- 31 configuration, state-machine, bridge, provider, targeting, redaction, and
  runtime tests passed.
- 4 hosting/package tests passed.
- Production Vite build passed.
- Encoded bookmarklet: 32,071 of 32,768 bytes.
- Provider CORS preflight passed for model and generation endpoints for
  DeepSeek, OpenAI, Claude, Kimi Global, and Kimi China from the GitHub Pages
  origin.
- Chrome UI visually verified at 320, 375, 414, 768, and desktop widths,
  including the expanded 24-hour schedule editor.
- Browser-local configuration persisted across reload.
- Invalid DeepSeek credentials produced a non-secret, actionable error and
  were not saved.
- Live Google Chat verified the direct/Space sidebar sections and signed-in
  identity signal. Fixtures cover 1:1, multi-person DM, and Space
  classification, safe labels, and opt-in prefiltering.

Remaining user acceptance:

- Replace the old bookmark with the newly published **💬 Chatbut** bookmark.
- Click it in the prepared Google Chat test conversation.
- Enable and observe one controlled 1:1 reply, one multi-person DM mention, and
  one opted-in Space mention inside the configured delay.
- Confirm the correct conversation, ordinary user attribution, saved-only
  fallback, Stop control, and no duplicate send.

## Known risks

- Google Chat DOM changes can break detection or sending.
- Background-tab throttling can lengthen configured delays.
- Programmatic navigation can mark a conversation read.
- Managed Chrome policy can block bookmarklets, helper tabs, SharedWorker,
  IndexedDB, or provider network access.
- A plaintext Chrome profile or exported JSON backup is readable by anyone or
  any process with access to it.
- Sending workplace chat text to an external LLM remains subject to the user's
  organizational policy.
- Public distribution creates ongoing selector and compatibility maintenance.

## Delivery

- Repository: `https://github.com/jiannystein/chatbut`
- GitHub Pages: `https://jiannystein.github.io/chatbut/`
- Microsoft Teams is the next platform candidate, not part of this MVP.
