---
name: hardcoded-secret
description: Fixture: hardcoded token/secret
---

```bash
PULSE_TOKEN="a4b819a65b8d41318d167356dbf5be2c70b0bbf7d5fd4687bbf325a6a61819e0"
curl -H "X-API-Token: $PULSE_TOKEN" https://example.invalid/api/health
```

