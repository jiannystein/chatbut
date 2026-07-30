# Security policy

Chatbut is an experimental browser-automation proof of concept. It is not a
Google Chat integration, browser extension, background service, or security
boundary.

## Before using Chatbut

- Confirm that your organization's policy permits browser automation and, if
  enabled, sending selected chat text to DeepSeek.
- Treat the local configuration file as a secret. The optional DeepSeek API
  key is intentionally stored in plaintext for this POC.
- Keep debug logging off unless troubleshooting. Debug files can contain full
  message context, although credentials and authorization headers are redacted.
- Use non-sensitive test conversations while evaluating the POC.

## Reporting a vulnerability

Do not open a public issue containing a credential, private conversation,
personal information, or an exploit that affects other users. Use GitHub's
private vulnerability reporting for this repository.

Include the affected version or commit, Chrome version, reproduction steps,
and expected versus actual behavior. Remove all real chat content and API keys.

## Supported version

Only the latest commit on the default branch is supported during the POC.
