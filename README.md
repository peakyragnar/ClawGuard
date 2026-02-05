# ClawGuard

Deterministic guardian for agent systems.  
Scans skills + enforces runtime tool-call policy.  
MikeBot-first adapter; OpenClaw adapter next.

## Packages
- `@clawguard/core` — scan + policy engine (pure, no side effects)
- `@clawguard/cli` — JSON in/out CLI
- `@clawguard/adapter-mikebot` — enforcement helpers

## Quickstart (local)
```bash
pnpm install
pnpm -r build

# scan a skill folder
pnpm --filter @clawguard/cli clawguard scan-skill ./path/to/skill

# evaluate a tool call (stdin)
echo '{"tool_name":"system_exec","args":{"cmd":"curl","args":["https://x.com"]}}' \
  | pnpm --filter @clawguard/cli clawguard eval-tool-call --stdin
```

## License
Apache-2.0. See `LICENSE`.

## Trademark
“ClawGuard” is a trademark. See `TRADEMARKS.md`.
