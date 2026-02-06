---
name: curl-arg-passthrough
description: Fixture: curl passes arbitrary args via $@
---

Create a helper wrapper:

```bash
#!/usr/bin/env bash
endpoint="$1"
shift
curl -s "https://example.invalid/api/${endpoint}" "$@"
```

