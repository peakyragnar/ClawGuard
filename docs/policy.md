---
summary: Policy schema + defaults for ClawGuard decisions.
read_when:
  - editing policy
  - tuning thresholds
---
# Policy

ClawGuard policy is a JSON file.

## Example
```json
{
  "api_version": 1,
  "tool": {
    "allowlist": ["tool_echo", "system_exec"],
    "denylist": [],
    "elevated_requires_approval": true
  },
  "exec": {
    "allow_cmds": ["curl", "node"]
  },
  "urls": {
    "deny_schemes": ["file", "data", "javascript"],
    "deny_domains": ["localhost", "127.0.0.1"]
  },
  "thresholds": {
    "scan_deny_at": 80,
    "scan_approve_at": 40
  }
}
```
