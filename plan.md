# Chatbut MVP Plan

## Product objective

Build a public, accountless GitHub Pages app that installs a Chrome bookmarklet for Google Chat web. While the user keeps a dedicated `https://chat.google.com/app/home` tab open, the bookmarklet monitors eligible new messages and sends brief acknowledgements from the user's normal Google Chat account.

The product exists for users who cannot install software on their work computers. It must require no extension, desktop installation, Google Chat app installation, Google OAuth authorization, backend account, or hosted database.

## Feasibility decision

The POC is feasible with browser-interface automation.

- A controlled live test confirmed that the signed-in Google Chat interface exposes usable structural signals for recent conversation IDs, conversation types, and unread state.
- A controlled live test also confirmed the pending-request acceptance, composer, send-button, and sent-message verification flow.
- The supported Google Chat API is intentionally not used because messages sent with user authentication visibly attribute the Chat app beside the user's name.
- Browser automation is less stable than the supported API and can break when Google changes its interface. The app must fail softly, skip uncertain messages, and expose a compatibility warning instead of guessing.

## MVP scope

### Supported environment

- Google Chrome desktop only.
- Google Chat at `https://chat.google.com/app/home`.
- GitHub Pages for the setup/configuration site.
- A dedicated Google Chat tab must remain open and the computer must remain awake.
- Reloading Google Chat, closing the tab, restarting Chrome, or restarting the computer disables automation. The user must click the bookmarklet and enable it again.
- The bookmarklet detects an unsupported URL or incompatible page and stops with a clear warning.

### Explicit non-goals

- Microsoft Teams support.
- Edge, Firefox, Safari, or mobile-browser support.
- Background operation while the browser or computer is closed, locked, or asleep.
- Google OAuth, the supported Google Chat API, a Google Chat app, or a browser extension.
- Cloud sync, user accounts, server-side storage, analytics, or telemetry.
- Reading attachment contents, images, files, voice notes, or linked documents.
- Answering the substance of a sender's question.

## Activation and scheduling

- The user opens or creates a local Chatbut configuration in the GitHub Pages configurator.
- The user clicks the bookmarklet in Google Chat, and the injected overlay checks that the page is supported.
- The paired bookmarklet opens a short-lived helper page on the configurator origin. The helper transfers a `SharedWorker` message port to the exact Google Chat opener, then closes.
- The runtime requests the current configuration through that port. The worker relays only within the room named by the random pairing token embedded when the bookmark was installed, and each request also uses a fresh connection nonce.
- Google Chat never prompts for the configuration file and does not persist the configuration in local storage. The configurator remains the only file owner and must stay open.
- A reloaded Google Chat tab is no longer connected. Clicking the bookmarklet creates a fresh in-memory connection.
- The user selects a local Chatbut configuration file in the configurator, or approves the remembered file handle when Chrome still permits access.
- A stale or unavailable remembered handle is forgotten, after which the user can select or create a new configuration file.
- Chrome does not expose an absolute local path to webpages. Show the file name and access status, plus a **Change file** action, rather than claiming to show the full filesystem path.
- DeepSeek adaptation is optional. When enabled, the API key is loaded from the local plaintext configuration file and validated before the **Enable** control becomes available. Without AI, Chatbut sends the selected saved response unchanged.
- Enabling is manual and non-persistent.
- Only messages arriving after the current enable timestamp are eligible. Existing history and unread messages are ignored.
- Users select recurring days and start/end times.
- Schedules use the browser's current timezone.
- An enable attempt outside the configured day/time is refused. Show a warning and route the user to review the schedule.
- Automation disables itself at the configured end time.
- The overlay always shows an unmistakable enabled/disabled state and an immediate kill switch.
- Use a `BroadcastChannel` or equivalent browser-local lease so only one Chatbut instance can be enabled for the same origin at a time.

## Conversation targeting

### Direct messages

- Default mode: respond to all one-to-one direct messages except explicitly excluded conversations.
- Ignore the user's own messages, bots/apps, unsupported message types, and conversations whose identity cannot be resolved confidently.

### Group conversations

- Groups are opt-in through an allowed-group list; all other groups are ignored.
- An allowed group triggers only when the new message @mentions the user or directly replies to the user.
- Preserve the source thread when Google Chat presents a threaded reply target. If the thread cannot be identified safely, skip the message.

### Optional invitation acceptance

- Expose separate **Auto-accept human 1:1 requests** and **Auto-accept Space invitations** switches.
- Both switches are off by default and include an accessible information tooltip.
- Acceptance runs only while Chatbut is manually enabled and the schedule is open.
- Never accept a bot/app invitation or an invitation whose identity cannot be classified confidently.
- A message attached to an accepted 1:1 request is treated as new after acceptance and may trigger Vault 1.
- An accepted Space is added to the selected-Space allowlist. Its messages still require an @mention or direct reply to the user.

### Conversation picker

- Build an index from recent conversations currently exposed by Google Chat.
- Provide fuzzy search with a dropdown and click-to-add behavior.
- Save stable conversation identifiers and human-readable labels in the configuration file.
- Mark saved entries as unavailable when a current recent-chat index cannot resolve them; never silently retarget by display name.
- The GitHub Pages editor can edit already-saved targets. Live indexing and adding current conversations occurs in the injected Google Chat overlay.

## Response state machine

State is maintained per conversation for the current enable session.

1. The first eligible new incoming message starts a randomized Vault 1 delay.
2. Default Vault 1 delay: 30–90 seconds; users can configure both bounds.
3. Multiple eligible messages arriving during the delay are coalesced into one reply using the newest permitted context.
4. Immediately before sending, re-check the schedule, enabled state, target, conversation identity, manual-user activity, and current DOM structure.
5. After Vault 1 sends, Vault 2 may send at most once in that conversation during the enable session.
6. Vault 2 requires a subsequent eligible incoming message and a minimum 15-minute cooldown after Vault 1. The cooldown is configurable.
7. Vault 2 never sends proactively merely because 15 minutes elapsed.
8. If the user manually sends a message in the conversation, stop automation for that conversation until the next scheduled window or the next manual enable.
9. Disabling and re-enabling starts a new enable session.

Default circuit breakers:

- At most 20 automatic replies per enable session.
- At most 5 automatic replies in any rolling five-minute period.
- Coalesce bursts rather than replying to every message.
- Skip an uncertain message and continue monitoring other conversations.

## Response vaults

- Vault 1 contains first-acknowledgement templates.
- Vault 2 contains follow-up/defer templates.
- Each vault supports multiple saved responses.
- Randomly select one response from the applicable vault.
- If a vault is empty, do not enable automation.
- Templates remain editable from the GitHub Pages setup screen. Google Chat target changes made in the injected overlay are sent to the connected configurator and written back to the selected configuration file.

## DeepSeek integration

- Bring-your-own DeepSeek API key.
- The POC stores the key in plaintext in the local configuration file. The UI must warn that local plaintext is not equivalent to encrypted storage.
- Never place the key in the bookmarklet URL, DOM attributes, console output, or debug logs.
- Validate the key with a minimal API request before enabling.
- Initial model: `deepseek-v4-flash` with thinking disabled for low-latency acknowledgement drafting.
- Send a configurable 3–10 recent text messages for context; default to 5.
- Context can include both sides of the conversation but excludes attachment contents.
- Cap and truncate context defensively to avoid sending an unbounded transcript.
- The chosen vault response is the governing intent. DeepSeek may adapt it to the triggering message's context and sentiment but may not replace that intent.
- Replies must:
  - acknowledge and defer rather than answer;
  - use casual, empathetic, workplace-appropriate corporate language;
  - default to English, with optional Chinese output;
  - contain at most two sentences;
  - make no new promise, deadline, factual claim, approval, commitment, or substantive recommendation;
  - reference a message topic only when it is unambiguous and safe to do so;
  - return plain text only.
- Validate and normalize the model output before insertion.
- If DeepSeek fails, times out, rejects the request, or returns unusable content, send the original randomly selected vault response.

## Local configuration and debug files

- Use a versioned, machine-readable JSON configuration file managed through the UI; users should not need to edit raw JSON.
- The file includes schedules, targeting rules, selected conversation identifiers/labels, vaults, AI settings, language, delay/cooldown settings, debug settings, and the plaintext DeepSeek key.
- Do not place secrets or personal data in the GitHub repository.
- Normal operation keeps no activity history.
- Debug mode is off by default.
- When debug mode is enabled, require the user to select the folder containing the configuration file so Chrome can create rotating logs beside it.
- Debug logs may contain full message context and DeepSeek request/response content, as approved for the POC, but must always redact the API key and authorization headers.
- The Google Chat runtime sends debug records only through its paired message port. The configurator re-redacts each record and performs serialized file writes.
- Append until a log reaches 10 MB, then create the next numbered log file.
- Log technical state transitions, selector decisions, skip reasons, AI latency, fallback use, and send verification.

## Bookmarklet engineering constraints

- Use documented browser APIs plus Google Chat's rendered interface; do not call undocumented Google private network endpoints.
- Keep the distributed bookmarklet self-contained so it does not depend on external-script injection that Google Chat's Content Security Policy could block.
- Maintain readable source code separately and generate a minified bookmarklet artifact during the build.
- Target a practical encoded bookmarklet size budget of 32 KB. If the build exceeds the budget, reduce dependencies and split setup-only functionality into GitHub Pages rather than weakening security controls.
- Treat all chat content and model output as untrusted text. Never render either with `innerHTML`.
- Prefer stable accessibility roles/labels and validated structural attributes. Never use a selector unless it resolves uniquely in the expected UI state.
- Verify the target conversation again after every programmatic navigation and immediately before sending.
- Navigate to eligible unread conversations automatically, then restore the conversation that was open before scanning. Disclose that this can alter read state and visible UI.
- Preserve normal touch/keyboard/page behavior and avoid changing Google Chat styles outside the Chatbut overlay.

## UX and visual design workflow

- Invoke **Product Design** before designing or implementing the user interface.
- Product Design owns:
  - the GitHub Pages setup and configuration experience;
  - configuration-file creation, selection, validation, and recovery;
  - schedules, vaults, targeting, recent-chat fuzzy search, and exclusions;
  - the injected Google Chat overlay;
  - enabled, disabled, warning, error, fallback, unsupported-page, and debug states;
  - logo exploration and selection.
- This is a greenfield product without a selected visual target. Run Product Design context gathering and visual ideation, present exactly three directions, and wait for the user's selection before UI implementation.
- After a direction is selected, invoke **Hallmark** for the professional design pass and anti-generic quality gates.
- Hallmark must:
  - run its greenfield pre-flight;
  - establish a specific product tone rather than relying on “clean and modern”;
  - use a locked token system;
  - cover all required interactive states;
  - verify focus visibility, contrast, reduced motion, and responsive layouts;
  - run its final slop test before handoff.
- Visual intent: professional, modern, trustworthy, calm, and unobtrusive. Avoid generic AI imagery and decorative effects that compete with the primary enable/disable state.
- Recipients must not see Chatbut or AI attribution. The user-facing setup experience must still disclose clearly to the user that eligible chat content is sent to DeepSeek.

## Public GitHub delivery

- Intended repository: public `jiannystein/chatbut`.
- Intended hosting: GitHub Pages.
- Suggested implementation split:
  - a lightweight static setup/configuration app;
  - a plain TypeScript bookmarklet runtime;
  - a deterministic build step that produces the minified bookmarklet;
  - automated tests for pure scheduling, targeting, state-machine, prompt, fallback, and configuration logic.
- Include a privacy disclosure, plaintext-key warning, DeepSeek data-transfer disclosure, browser-automation maintenance warning, and “not affiliated with Google” disclaimer.
- Do not publish, create the repository, commit, push, or deploy until the design direction is selected and the implementation has passed local and controlled live verification.

## Acceptance criteria

- Correctly refuses unsupported URLs and out-of-schedule activation.
- Rejects an invalid DeepSeek key and enables only after successful validation.
- Ignores all messages that predate the current enable timestamp.
- Handles a controlled one-to-one DM with a Vault 1 reply inside the configured randomized range.
- Coalesces a burst into one reply.
- Honors the DM exclusion list.
- Honors the group allowlist and responds only to @mentions or direct replies.
- Sends at most one Vault 2 follow-up after the configured cooldown and a subsequent eligible message.
- Cancels pending automation after a manual user reply.
- Falls back to the original template on DeepSeek failure.
- Never sends to a conversation when identity or composer verification is uncertain.
- Prevents duplicate sends from multiple enabled tabs.
- Produces no normal-operation history.
- Produces debug logs only when explicitly enabled, redacts credentials, and rotates at 10 MB.
- Preserves configuration through save/reopen flows and recovers cleanly from a stale file handle.
- Never opens a file picker from Google Chat; an unconnected tab remains disabled with a recovery instruction.
- Ignores bridge messages from an unexpected origin, window, pairing room, or connection nonce.
- Landing page and overlay pass keyboard, contrast, reduced-motion, and responsive checks required by the selected design workflows.
- Controlled live tests produce zero wrong-conversation sends.

## Known risks

- Google Chat DOM changes can break detection or sending.
- Background-tab throttling can make randomized delays longer than configured.
- Opening a conversation can mark it read.
- Managed Chrome policies may block bookmarklets, local-file APIs, or DeepSeek network access.
- Popup or opener policy changes can break the connected-tab bridge. Chatbut must remain disabled rather than fall back to untrusted configuration transport.
- A plaintext configuration file and full debug logs are readable by anyone or any process with local access.
- Sending corporate chat content to DeepSeek remains subject to each user's organizational policy, even though this POC has approval.
- Public distribution can require ongoing selector maintenance and compatibility testing.
