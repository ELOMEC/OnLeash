# Integrating onleash into an AI agent stack

This is for builders. If you have an AI agent that needs to spend tokens
on Solana — paying for APIs, settling between agents, tipping creators —
this guide gets you from zero to a paying agent in ~30 minutes.

## What you get

- An on-chain budget that **you control** (top up, pause, close, refund).
- A **delegate keypair** your agent uses to sign payments.
- **Hard limits** enforced by the on-chain program: per-tx, daily window,
  total allowance, expiration, and an emergency pause flag.
- A drop-in **GOAT SDK plugin** if you're using GOAT, or raw TypeScript
  builders if you're rolling your own.

If anything is compromised — backend, agent, delegate keypair — the
maximum loss is the budget you funded. Your owner wallet is never at risk.

## Mental model

```
Owner   ──── initialize_budget(delegate, allowance, per_tx, daily, expires)
              │
              ▼
        AgentBudget PDA  ◄── budget_ata holds USDC under PDA authority
              │
              │ delegate signs
              ▼
        execute_payment(amount)  ──► SPL Token CPI ──► recipient_ata
              │
              │ owner signs
              ▼
        top_up / update_policy / close_budget
```

The owner does anything that changes the budget structure. The delegate
can only spend within the configured limits. The PDA is the on-chain
authority over the budget's funds.

## Step-by-step (TypeScript)

### 1. Get the generated client

```bash
git clone https://github.com/<you>/onleash
cd onleash && anchor build && npm install && npm run codama
```

You now have `src/generated/` with typed builders for every instruction.

### 2. Owner: open a budget

The owner wallet (could be a Privy embedded wallet, a hardware wallet, a
multisig, etc.) signs `initialize_budget`. This creates the PDA, opens
its USDC ATA, and transfers the initial deposit.

```ts
import { getInitializeBudgetInstructionAsync, findAgentBudgetPda } from "./src/generated";

const ix = await getInitializeBudgetInstructionAsync({
  owner,                                  // TransactionSigner
  mint: USDC_MINT,                        // SPL Token mint address
  delegate: agentDelegateAddress,         // pubkey only — agent keeps its key elsewhere
  totalAllowance:    100_000_000n,        // 100 USDC cap
  perTxLimit:          5_000_000n,        // 5 USDC max per single call
  dailyLimit:         50_000_000n,        // 50 USDC rolling 24h window
  durationSeconds:   BigInt(86_400 * 30), // budget expires after 30d
  depositAmount:    100_000_000n,         // owner deposits the full cap upfront
});

// Send via @solana/kit's sendAndConfirmTransactionFactory.
```

After this, `findAgentBudgetPda({owner, delegate})` returns the PDA
address; this is the agent's budget account on-chain.

### 3. Agent: spend within the budget

The agent (or your backend acting on its behalf) signs `execute_payment`
with the delegate keypair:

```ts
import { getExecutePaymentInstructionAsync } from "./src/generated";

const ix = await getExecutePaymentInstructionAsync({
  delegate,                               // TransactionSigner — your delegate keypair
  agentBudget,                            // from findAgentBudgetPda
  mint: USDC_MINT,
  budgetAta,                              // ATA of agentBudget for the mint
  recipientAta,                           // where the payment goes
  amount: 1_000_000n,                     // 1 USDC
});

// Sign with delegate; fee payer can be anyone (typically your service wallet
// or the agent itself if it has SOL).
```

The on-chain program rejects the call if any of: paused, expired,
amount > per_tx_limit, daily_spent + amount > daily_limit, or
spent_total + amount > total_allowance.

### 4. (Optional) Use the reference backend

If you don't want to manage delegate keypairs yourself, run the included
backend. It generates a delegate per agent, persists it (in-memory in the
demo; Privy Server Wallets in production), and signs `execute_payment`
when the agent posts an intent.

```bash
npm run backend          # listens on :3000

# create an agent (returns id + delegate address)
curl -X POST localhost:3000/agents \
  -H 'Content-Type: application/json' \
  -d '{"ownerAddress":"<your owner pubkey>","mintAddress":"<USDC mint>"}'

# agent intent → backend signs + submits
curl -X POST localhost:3000/agents/<id>/pay \
  -H 'Content-Type: application/json' \
  -d '{"ownerAddress":"...","mintAddress":"...","recipientAta":"...","amount":"1000000"}'
```

For production, swap the local keypair generation for Privy Server Wallets
(MPC-backed, no raw keys held by the backend). Integration points are
marked with `TODO(privy)` comments in `src/backend.ts`.

### 5. (Optional) Use the GOAT SDK plugin

If your agent uses [GOAT SDK](https://github.com/goat-sdk/goat), import
the onleash tools directly:

```ts
import { onleashTools } from "./src/goat-plugin";

// Pass to your LLM as available tools:
const tools = [...yourTools, ...onleashTools];
```

The plugin exposes `create_agent_budget`, `pay_from_agent_budget`, and
`get_agent_budget_state`. Each tool calls the backend HTTP API.

## Limits & gotchas

- **Token-2022 not yet supported.** v0.5 uses classic SPL Token. Token-2022
  with confidential transfers is on the roadmap.
- **Allowance cap is the hard ceiling.** Once `spent_total + amount` would
  exceed `total_allowance`, the agent stops. To extend, owner calls
  `top_up` (which both transfers more USDC and raises the cap).
- **Daily window is rolling.** It resets the first time `execute_payment`
  is called after `daily_reset_at`. If the agent doesn't call for >24h,
  the next call resets.
- **Expiration is not auto-cleanup.** When `expires_at` passes,
  `execute_payment` rejects. Owner has to call `close_budget` to refund
  the remaining funds; we may add a permissionless reclaim path later.
- **Service keypair pays gas.** In the reference backend, a service
  keypair pays tx fees for `execute_payment`. Plan SOL accordingly.
- **Devnet program ID** (`6M5XU4icTbfym3y6JxNNff2sXPiJTnKfBEWJr9D6XRr`)
  is what you'll target until mainnet deploy ships.

## Where to ask

- GitHub issues for protocol-level questions.
- Direct contact for partnership / pilot integration.
