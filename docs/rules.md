---
summary: Default rule pack and how to add rules.
read_when:
  - adding or changing rules
  - reviewing scanner coverage
---
# Rules

Rules live in `packages/core/rules/pack-v1.json`.

Each rule:
- has an id and severity
- targets selectors (`markdown`, `codeblock`, `file`, `url`, `path`)
- uses a regex `match`

Add a test for every new rule.
