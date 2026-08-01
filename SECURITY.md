# Security policy

Chatbut is an experimental browser-automation proof of concept. It is not a
Google Chat or Microsoft Teams integration, browser extension, background
service, or security boundary.

## Before using Chatbut

- Confirm that your organization permits browser automation and, when enabled,
  sending selected chat text to the chosen LLM provider.
- Treat this Chrome profile and exported Chatbut JSON backups as sensitive.
  API keys are intentionally stored in plaintext for this POC.
- Keep debug logging off unless troubleshooting. Debug records may contain full
  message context even though credentials and authorization headers are
  redacted.
- Start with non-sensitive test conversations.

## Local data boundary

Configuration and optional logs are stored in IndexedDB at the Chatbut GitHub
Pages origin in the current Chrome profile. Chatbut has no backend, account,
analytics, telemetry, or cloud-sync service.

LLM credentials stay in the Chatbut-origin `SharedWorker` and are removed from
configuration copies sent to the selected Google Chat or Teams runtime. When
adaptation is enabled, the selected response template and configured recent
text context pass from that runtime to the worker and then directly to the
selected provider.

This boundary reduces credential exposure; it does not make a bookmarklet an
isolated extension. Code already running in either page origin and processes
with access to the Chrome profile remain in the security model.

## Connected-tab boundary

The bookmark contains a random pairing token generated locally by the
configurator. Its short-lived helper transfers a `SharedWorker` message port
only to an exact supported opener: `https://chat.google.com` or the work/school
client at `https://teams.microsoft.com/v2/`. The worker isolates messages by
pairing token and platform, and runtime responses require a fresh connection
nonce. A reloaded chat tab remains disabled until the matching bookmark is
clicked again.

Configuration edits, target updates, provider requests, and optional debug
records travel through the paired port. The configurator tab may close after
connection; the worker continues only while Chrome keeps the connected
session alive.

Before each send, either platform must acquire one atomic worker lease. No more
than five leases are issued across Google Chat and Teams in a rolling
five-minute window. The lease is recorded before the page clicks Send so a tab
or navigation failure cannot accidentally reopen capacity.

Teams starts with request acceptance disabled. When enabled, it accepts only
one unambiguous human direct request and excludes bots, apps, groups, channels,
and meeting chats. Meeting chats are also excluded from indexing, queuing, and
replying. A nonempty Teams composer is treated as user-owned and is never
overwritten. These are fail-closed DOM controls, not a substitute for workplace
policy or a stable Microsoft API contract.

Teams' built-in self chat is the only self-authorship exception. Trusted manual
typing arms one test trigger after the composer clears; the prior visible
message and every Chatbut-authored message are recorded as processed. The
normal first/follow-up state limits the self chat to two replies per enable
session, and the saved direct-message exclusion disables it. Self-chat text is
normal conversation context and may reach the active LLM provider when
adaptation is enabled.

## Provider credentials

- Never commit an API key or exported user configuration.
- New credentials are persisted only after model discovery and a minimal
  completion both succeed.
- Imported credentials require revalidation.
- Credential/model errors mark the connection **Needs attention** and stop
  automation after the current saved-response fallback.
- Debug redaction is defense in depth, not a guarantee that arbitrary sensitive
  conversation content is removed.

## Reporting a vulnerability

Do not open a public issue containing a credential, private conversation,
personal information, or an exploit that affects other users. Use GitHub's
private vulnerability reporting for this repository.

Include the affected version or commit, Chrome version, reproduction steps,
and expected versus actual behavior. Remove all real chat content and API keys.

## Supported version

Only the latest commit on the default branch is supported during the POC.
