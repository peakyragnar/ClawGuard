# ClawGuard

Deterministic guardian for agent systems.  
Scans skills + enforces runtime tool-call policy.  
Integrates via a simple JSON tool-call hook.

## Packages
- `@clawguard/core` — scan + policy engine (pure, no side effects)
- `@clawguard/cli` — JSON in/out CLI
- `@clawguard/adapter-mikebot` — enforcement helpers

## Quickstart (local)
```bash
pnpm install
pnpm -r build

# scan a source (folder, zip, or URL)
pnpm --filter @clawguard/cli clawguard scan-source ./path/to/skill
pnpm --filter @clawguard/cli clawguard scan-source ./path/to/skill.zip
pnpm --filter @clawguard/cli clawguard scan-tree ./skills-root

# evaluate a tool call (stdin)
echo '{"tool_name":"system_exec","args":{"cmd":"curl","args":["https://x.com"]}}' \
  | pnpm --filter @clawguard/cli clawguard eval-tool-call --stdin

# explain rules
./clawguard rules list
./clawguard rules explain R001
```

## Design
See `simple-design-principles.md`.
See `trust-model.md` for `untrusted` vs `trusted`.

## License
Apache-2.0. See `LICENSE`.

## Trademark
“ClawGuard” is a trademark. See `TRADEMARKS.md`.
