# ClawGuard — build plan (v1)

Goal: deterministic “guardian agent” for OpenClaw-style systems.
V1 focus: **MikeBot adapter first**, then OpenClaw adapter.
License: **Apache-2.0** (OSS core + paid hosted add-ons later).

## Product shape
- Core engine: pure scan + policy decisions (no side effects)
- CLI: JSON in/out; easiest adoption path
- Adapter (MikeBot): enforce decisions at two choke points:
  - skill enable/load
  - runtime tool-call execution

## Non-goals (v1)
- No LLM “allow/deny” (LLM ok for summaries later; not enforcement)
- No hosted console, SIEM, SSO, or threat feed (plan + interfaces only)
- No heavy “sandbox” implementation (adapter integrates with host runtime sandboxing)

## Principles
- Deterministic: same input → same output
- Explainable: every block includes **reasons + evidence**
- Minimal surface: core returns decisions; adapters enforce
- Stable contract: versioned JSON schemas for integration/forks

---

# 0) Repo + workspace setup

## 0.1 Scaffolding (monorepo)
- [ ] `pnpm` workspace (root `package.json` + `pnpm-workspace.yaml`)
- [ ] TypeScript base config (`tsconfig.base.json`)
- [ ] Node ESM everywhere (`"type": "module"`)
- [ ] Build output per package (`dist/`)
- [ ] Minimal scripts:
  - [ ] `pnpm -r build`
  - [ ] `pnpm -r test`
  - [ ] `pnpm -r lint` (optional; only if we pick a linter)

## 0.2 Trust + hygiene files
- [ ] `LICENSE` (Apache-2.0)
- [ ] `SECURITY.md` (reporting + supported versions)
- [ ] `CONTRIBUTING.md` (dev loop + conventions)
- [ ] `TRADEMARKS.md` (“ClawGuard” name usage)
- [ ] `README.md` (quickstart + architecture)

## 0.3 CI (optional but recommended for adoption)
- [ ] GitHub Actions: node matrix (current LTS), `pnpm install`, `pnpm -r build`, `pnpm -r test`

Deliverable: clean install/build/test on a fresh machine.

---

# 1) Freeze contracts (schemas first)

## 1.1 Versioning
- [ ] Add `api_version: 1` to all JSON outputs
- [ ] Define stable `reason_code` enum set (don’t churn)

## 1.2 Core input/output types (package: `@clawguard/core`)
- [ ] `SkillBundle`
  - `id`, `source` (`local|registry|git|unknown`), `version?`
  - `files[]`: `{ path, content_text? | content_bytes_b64?, sha256? }`
  - `entrypoint`: `SKILL.md` path
- [ ] `ScanReport`
  - `risk_score` (0–100)
  - `findings[]`: `{ rule_id, severity, reason_code, file, line?, column?, evidence }`
- [ ] `ToolCallContext`
  - `{ tool_name, args, session_id?, run_id?, source?, timestamp? }`
- [ ] `Decision`
  - `action`: `allow|deny|needs_approval|sandbox_only`
  - `reasons[]`: `{ reason_code, detail?, evidence? }`
  - `suggested_mitigations[]` (strings; stable-ish)

## 1.3 JSON Schema artifacts (package: `@clawguard/core` or `@clawguard/contracts`)
- [ ] Generate + ship `.schema.json` files for:
  - `skill-bundle`
  - `scan-report`
  - `tool-call`
  - `decision`
- [ ] CLI option: `clawguard validate --schema <name> --stdin`

Deliverable: any fork can integrate by shelling out with JSON.

---

# 2) Rules + scoring engine (deterministic)

## 2.1 Rule format (JSON/JSON5)
- [ ] `Rule` shape:
  - `id`, `title`, `severity` (`low|med|high|critical`)
  - `reason_code`
  - `selectors[]` (what to scan: markdown, codeblock, url, path, file-by-ext)
  - `match` (regex / string contains / glob)
  - `evidence_capture` (named groups or matched substring)
  - `score` (points)
- [ ] `RulePack`:
  - `pack_id`, `pack_version`, `rules[]`

## 2.2 Engine behavior
- [ ] Apply rules across extracted “signals”
- [ ] Produce findings with:
  - exact match snippet (bounded length)
  - location (file + line when possible)
- [ ] Risk scoring:
  - sum points + cap at 100
  - severity → minimum floor (e.g. critical always ≥ 80)
- [ ] Threshold mapping (policy):
  - `deny_at >= N`
  - `approval_at >= M`

Deliverable: rules are data; shipping new rules doesn’t require code changes.

---

# 3) Skill static scanner

## 3.1 Markdown extraction
- [ ] Frontmatter extract (best-effort; never crash)
- [ ] Code fence extraction (language + content + line offsets)
- [ ] URL + domain extraction (inline + reference links + bare URLs)
- [ ] “Command-like” block detection (heuristics)

## 3.2 Skill bundle graph
- [ ] Resolve referenced local files inside bundle:
  - relative paths referenced in markdown
  - common patterns: `./scripts/*`, `bin/*`, `assets/*`
- [ ] Extension-aware scanning:
  - shell scripts: `.sh`, `.bash`, `.zsh`
  - Node: `.js`, `.mjs`, `.ts`
  - Python: `.py`
  - PowerShell: `.ps1`

## 3.3 Heuristic rule packs (v1)
- [ ] Download-and-exec:
  - `curl ... | sh|bash|zsh`
  - `wget ... | sh|bash`
  - PowerShell `iwr|irm ... | iex`
- [ ] Obfuscation:
  - `base64 -d|--decode` piped to shell
  - long 1-liners (length thresholds)
- [ ] Credential hunting:
  - `.ssh`, `id_rsa`, `keychain`, `Cookies`, `.env`, `AWS_`, `GITHUB_TOKEN`
- [ ] Persistence:
  - `launchctl`, `~/Library/LaunchAgents`, `crontab`, `systemctl`
- [ ] Privilege escalation:
  - `sudo`, `chmod 777`, chown root
- [ ] macOS quarantine/Gatekeeper bypass patterns:
  - `xattr -dr com.apple.quarantine`
  - `spctl --master-disable`

## 3.4 Output UX
- [ ] `ScanReport` includes:
  - top findings summary
  - stable reason codes
  - actionable mitigations text

Deliverable: `clawguard scan-skill <dir>` gives a useful, explainable report.

---

# 4) Runtime tool-call policy evaluator (“firewall”)

## 4.1 Generic policy model
- [ ] Allowlist/denylist by tool name
- [ ] “Elevated tool” category rules (`system_*`, `browser_*`, `workflow_tool`)
- [ ] Argument-based checks per tool:
  - URL allowlist/denylist by domain + scheme
  - file path allow/deny (secret path patterns)
  - command allowlist (exec)
  - output redaction (optional; later)
- [ ] Time-boxed exceptions:
  - allow once
  - allow for N minutes

## 4.2 Tool-specific evaluators (MikeBot-first)
- [ ] `system_exec`:
  - block pipes/redirects by default (`|`, `>`, `&&`, `;`) unless explicitly allowed
  - enforce cmd basename allowlist
  - detect common exfil patterns (curl posting env/keys)
- [ ] `system_read_file` / `system_write_file`:
  - deny known secret paths (even if within mounted root)
  - deny writes outside allowed roots
- [ ] `browser_*`:
  - deny `file://`, `data:`, `javascript:`
  - deny localhost/metadata IP ranges unless explicitly allowed
- [ ] outbound tools (`system_send_*`):
  - optional recipient allowlist
  - block sending obvious secret blobs (heuristic)

Deliverable: `clawguard eval-tool-call` returns deterministic decision + reasons.

---

# 5) CLI package (`@clawguard/cli`)

## 5.1 Commands
- [ ] `clawguard scan-skill <path>` → JSON report + exit codes
- [ ] `clawguard eval-tool-call --stdin` → JSON decision
- [ ] `clawguard rules list|explain <rule_id>`
- [ ] `clawguard policy init` → writes starter policy file

## 5.2 Exit codes (stable)
- [ ] `0`: allowed / no high-risk findings
- [ ] `2`: denied (policy threshold hit)
- [ ] `3`: needs approval
- [ ] `1`: internal error / invalid input

Deliverable: easy drop-in wrapper for any fork/language.

---

# 6) MikeBot adapter (first enforcement integration)

## 6.1 Integration surfaces (in MikeBot)
- [ ] Skill load gate:
  - before injecting enabled skills into system prompt
  - on deny: exclude skill + log + Telegram alert
- [ ] Tool execution gate:
  - right before `tool.execute(args)`
  - enforce `deny|needs_approval|sandbox_only`

## 6.2 Adapter deliverables (in ClawGuard repo)
- [ ] `@clawguard/adapter-mikebot` package:
  - helper functions for MikeBot to call core
  - policy loader (JSON/JSON5)
  - audit logger (JSONL)
- [ ] Patch instructions (doc) for MikeBot:
  - exact hook points + minimal code snippet
  - config env vars

## 6.3 MikeBot validation checklist
- [ ] Denied tool call never reaches tool implementation
- [ ] Denied skill never injected into prompt
- [ ] Audit log lines include: session_id, run_id, tool_call_id, decision, reasons

Deliverable: one “small diff” PR to MikeBot that enables ClawGuard.

---

# 7) Testing (robust; ship confidence)

Testing philosophy: break-code proof. Every rule should have at least one “should block” fixture.

## 7.1 Core unit tests
- [ ] Rule engine:
  - deterministic ordering
  - stable scoring
  - evidence truncation bounds
- [ ] Markdown extraction:
  - code fences + line offsets
  - URL extraction correctness
- [ ] Tool evaluator:
  - `system_exec` pipe/redirect detection
  - URL scheme/host rules
  - secret-path denies

## 7.2 Golden fixtures
- [ ] `fixtures/skills/good/*` (no findings)
- [ ] `fixtures/skills/bad/*` (each maps to specific rule ids)
- [ ] Snapshot JSON outputs (goldens) for scan reports + decisions

## 7.3 CLI tests
- [ ] CLI JSON output shape validated against schema
- [ ] exit codes correct for allow/deny/approval

## 7.4 Adapter integration tests (MikeBot)
- [ ] A mocked tool call is denied and not executed
- [ ] Skill injection excludes denied skill
- [ ] Audit file append-only correctness

## 7.5 Regression tests for false positives
- [ ] “curl download to file” (no pipe) should not auto-deny (policy-dependent)
- [ ] base64 usage in benign contexts (tighten rules)

## 7.6 Test commands (single entry)
- [ ] `pnpm -r test` runs everything
- [ ] `pnpm -r build` required before tests (if needed)

Definition of done: tests fail if enforcement is bypassed.

---

# 8) Documentation (ship with v1)

- [ ] `README.md`:
  - what it is
  - quickstart (scan + eval)
  - threat model (skills + tool calls)
- [ ] `docs/policy.md`:
  - policy schema
  - thresholds + exceptions
  - recommended defaults
- [ ] `docs/rules.md`:
  - rule packs
  - severity + scoring
  - how to contribute rules
- [ ] `docs/adapters/mikebot.md`:
  - minimal patch points
  - env/config
  - audit logs

---

# 9) Release + adoption checklist (v1)

- [ ] NPM publish (scoped packages)
- [ ] Changelog
- [ ] Minimal “security posture” statement
- [ ] Example policy + example rule pack shipped in repo
- [ ] “Breaking changes” policy for `api_version`

---

# Milestones

## M1 — Core contracts + scanner (local only)
- Contracts + schemas
- Rule engine + v1 rule pack
- `scan-skill` CLI + fixtures

## M2 — Tool-call firewall
- Tool evaluator
- `eval-tool-call` CLI
- Goldens + break-code tests

## M3 — MikeBot adapter enforcement
- Skill gate + tool-call gate
- Audit log
- Integration tests

## M4 — Docs + release
- Docs complete
- CI green
- NPM publish (optional for local use)
