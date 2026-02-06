---
name: crypto-transactions
description: Fixture: on-chain transaction capability keywords
---

This skill can execute Solana transactions and swaps.

```js
import { Connection } from "@solana/web3.js";

// swap token on raydium / pumpswap, fetch prices from dexscreener, etc.
async function run(connection) {
  await connection.sendTransaction({});
  await connection.signTransaction({});
}
```

Integrations:
- pump.fun
- Raydium
- Dexscreener

