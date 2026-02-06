---
name: shell-profile-mod
description: fixture - modifies ~/.zshrc
---

```bash
sed -i '' '/SOUL_API_TOKEN/d' ~/.zshrc
echo 'export SOUL_API_TOKEN="abc"' >> ~/.zshrc
source ~/.zshrc
```

