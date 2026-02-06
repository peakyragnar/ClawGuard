# ClawGuard: simple design principles

Goal: let you try 3rd-party "skills" without your laptop turning into a credential pinata.

This is not a malware oracle. It is a deterministic safety layer that makes risky things visible, blocks the worst stuff, and forces a safer runtime stance by default.

## Two gates (simple mental model)

1. Install gate (static scan)
- Input: a skill source (folder, zip, URL)
- Output: `risk_score`, `findings[]`, and an `action`
- No execution. Content treated as untrusted strings.

2. Runtime gate (tool-call policy)
- Input: a proposed tool call (JSON)
- Output: `allow | needs_approval | deny | sandbox_only`
- Deterministic. No LLM vibes.

## Actions (what they mean)

- `allow`
  - Static: nothing matched that crosses your thresholds.
  - Runtime: tool call OK under policy.

- `needs_approval`
  - Human must approve. Default for "elevated" tools (shell, filesystem writes, browser) in the default policy.
  - Also used for high-blast-radius *capabilities* that are not necessarily malware (example: on-chain money movement).

- `deny`
  - Too risky. Do not install or execute.

- `sandbox_only`
  - Allowed only if executed inside an isolated sandbox with restricted capabilities.
  - This is the default stance for untrusted 3rd-party skills: isolate first, then decide.

## Risk score (what "90" means)

`risk_score` is computed from deterministic rules.

Default thresholds (configurable in policy):
- `scan_approve_at` (default `40`): at or above => `needs_approval`
- `scan_deny_at` (default `80`): at or above => `deny`

So a `risk_score` of `90` means: "one or more critical signals matched" and the default action is `deny`.

## Rule IDs (what `R005` means)

Rule IDs are stable identifiers from the built-in rule pack.

Example:
- `R001` curl piped to shell (download + execute)
- `R006` persistence mechanisms (launch agents, systemd, cron)
- `R012` zip path traversal entry (archive trying to write outside extraction root)

CLI helpers:
- `./clawguard rules list`
- `./clawguard rules explain R005`

## Default stance (what we actually promise)

- We never execute downloaded code during scanning.
- We hard-block common high-risk patterns (download+exec, obfuscation, traversal, etc).
- We surface sensitive behaviors (credential access attempts, persistence, binaries/executables in bundles).
- For runtime, we push you into safe defaults: approval gates and "sandbox only" for untrusted contexts.

We do not promise "catch 100% of malware". What we do promise is: you get a consistent, explainable safety decision, and you are much less likely to run a skill that does something obviously dangerous without noticing.

## Practical workflow

1. Before you install a skill:
- `./clawguard scan-source <path|url|zip>`
- If `deny`: do not install.
- If `needs_approval`: inspect findings and decide.

2. When integrating with an agent framework:
- route proposed tool calls through `./clawguard eval-tool-call --stdin`
- enforce `deny` and `sandbox_only` in your executor (do not "just run it anyway").

## Trust Model
See `trust-model.md` for the simple `untrusted` vs `trusted` model (trusted requires a local hash pin).
