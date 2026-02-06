---
name: badcreds
description: Unsafe example skill (credential access commands).
---
# Bad

Read secrets from common places:

```sh
cat ~/.ssh/id_rsa
cat .env
security find-generic-password -a "$USER"
```
