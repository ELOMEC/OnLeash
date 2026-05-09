# onleash

**Bounded autonomous spending for AI agents on Solana.**

Give an AI agent a budget without giving it your wallet. onleash is a Solana
program + TypeScript SDK that lets an owner authorize a delegate signer to
spend up to a configured limit per transaction, per day, and per total — all
enforced on-chain. Spending caps, daily windows, expiration, and pause are
non-bypassable; the agent never has access to your main wallet.

**Live on devnet:**
[`6M5XU4icTbfym3y6JxNNff2sXPiJTnKfBEWJr9D6XRr`](https://explorer.solana.com/address/6M5XU4icTbfym3y6JxNNff2sXPiJTnKfBEWJr9D6XRr?cluster=devnet)

## Why

- AI agents need to pay for things — APIs, services, other agents — but
  giving them custody of a real wallet is unacceptable for security.
- Subscriptions don't fit micro-actions ("agent consumes $0.0023 of OpenAI
  tokens"); per-transaction settlement does.
- Existing options either trust the agent fully (bad) or require human
  confirmation per transaction (kills automation).

onleash sits between: the agent has its own keypair (the "delegate"), but the
on-chain program enforces hard limits. If the agent or backend is compromised,
the blast radius is the budget you authorized — not your main wallet.

## How

```
   ┌──────────────┐                ┌─────────────┐
   │   AI Agent   │  intent        │  Backend    │
   │  (LLM tool)  │ ───────────────►│ delegate-   │
   └──────────────┘                │  signs tx   │
                                   └──────┬──────┘
                                          │ submit
                                          ▼
   ┌────────────┐  initialize     ┌──────────────────┐
   │   Owner    │  / top-up /     │  onleash         │
   │   wallet   │  pause / close ─►  Anchor program  │
   └────────────┘                 │  on Solana       │
                                  │  (enforces       │
                                  │   limits, signs  │
                                  │   USDC transfer) │
                                  └────────┬─────────┘
                                           │ CPI
                                           ▼
                                     SPL Token transfer
                                     to recipient
```

5 instructions: `initialize_budget`, `top_up`, `update_policy`,
`execute_payment`, `close_budget`. Owner controls structural changes; the
delegate can only spend within the policy.

## Quickstart (devnet)

Requires: Solana CLI (config'd to devnet with funded wallet), Anchor 1.0+,
Node 22+, Rust 1.95+.

```bash
git clone https://github.com/<you>/onleash
cd onleash
anchor build
anchor deploy             # ~1.7 SOL on devnet

npm install
npm run smoke             # full lifecycle: mint → init → pay → close on devnet
```

The smoke test creates a fresh USDC-like mint, opens an agent budget with
100 USDC allowance, pays out 2 USDC to a recipient, then closes and refunds.
Each step prints the tx signature.

## Integration

For builders adding onleash to an AI agent stack, see
[**docs/INTEGRATION.md**](docs/INTEGRATION.md).

The TypeScript client is generated from the on-chain IDL via
[Codama](https://github.com/codama-idl/codama) and ships
[`@solana/kit`](https://github.com/anza-xyz/kit)-compatible builders for
every instruction. A reference backend (Express + delegate signing) and a
GOAT SDK plugin are in `src/`.

```ts
import {
  getInitializeBudgetInstructionAsync,
  getExecutePaymentInstructionAsync,
} from "./src/generated";

// Owner builds initialize_budget tx, signs with their wallet:
const ix = await getInitializeBudgetInstructionAsync({
  owner,                                 // TransactionSigner (Privy embedded, etc.)
  mint: USDC_MINT,
  delegate: agentDelegateAddress,
  totalAllowance: 100_000_000n,          // 100 USDC
  perTxLimit:     5_000_000n,            // 5 USDC max per call
  dailyLimit:    50_000_000n,            // 50 USDC rolling window
  durationSeconds: BigInt(86_400 * 30),  // 30 days
  depositAmount:  100_000_000n,
});
```

## Status

| Component | State |
|---|---|
| Anchor program (5 instructions) | ✅ Live on devnet |
| LiteSVM Rust tests | ✅ 12/12 passing |
| TypeScript client (Codama + Kit) | ✅ |
| Devnet smoke test (full lifecycle) | ✅ |
| Backend HTTP service | ✅ Reference impl |
| GOAT SDK plugin | ✅ Reference impl |
| Privy embedded wallet (frontend) | ⚙️ Scaffolded |
| Privy Server Wallets (backend custody) | ⚙️ Integration points wired, needs Privy app |
| Mainnet deploy | ⏳ Pending audit |

## Architecture decisions

- **PDA-per-agent** with seeds `[b"agent", owner, delegate]` — one budget
  per (owner, delegate) pair, deterministic addressing.
- **has_one constraints** for delegate + mint match on every signed call,
  not self-referential seeds (Anchor doesn't support those outside `init`).
- **Box<Account<...>>** on every account — BPF stack is 4 KiB, this avoids
  overflow with `init` + 3+ token accounts.
- **Defense in depth**: backend co-signer enforces application policy
  off-chain; on-chain program enforces hard limits. Either layer alone is
  sufficient to bound losses.

## License

Currently unlicensed — contact for commercial use. Considering Apache-2 or
similar OSS license for v1.0 mainnet release.
