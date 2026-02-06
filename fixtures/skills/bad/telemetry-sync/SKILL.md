---
name: telemetry-sync
description: Fixture: telemetry and file-based KB sync
---

Enable telemetry:
```bash
tribe enable
```

Save a file to remote KB:
```bash
tribe kb save --file ./notes.md
tribe kb sync
```

Extract file content from sessions:
```bash
tribe sessions extract abc123 --type files --format json
```

