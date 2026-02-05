---
summary: MikeBot integration points for ClawGuard.
read_when:
  - integrating ClawGuard into MikeBot
---
# MikeBot Adapter

## Skill gate (before injection)
- Call `scanSkillEntry` on each enabled skill.
- If action is `deny` or `needs_approval`, skip the skill and log.

## Tool-call gate (before execute)
- Call `evaluateToolCallForMikeBot(toolName, args)`.
- Enforce:
  - `deny` → block tool
  - `needs_approval` → route to approval flow

## Audit log
- Use `appendAuditLine(path, payload)` to write JSONL.
