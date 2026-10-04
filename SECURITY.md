# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |
| < 1.0 | No |

## Reporting a vulnerability

Email **flunkeymanager@gmail.com** with steps to reproduce, impact, and any logs (redact API keys, transcripts, and screenshots).

Do not open a public issue for 0-days, key exfiltration, credential-storage bypass, or sandbox escapes. We will acknowledge within 72 hours and coordinate a fix and disclosure timeline.

## Handling sensitive data in reports

- Never send API keys, `%APPDATA%\com.flunkey.desktop\*.json` contents, or screenshots containing personal data.
- Flunkey stores API keys in Windows Credential Manager and history as local plaintext JSON — treat any files you attach as sensitive and redact them first.
