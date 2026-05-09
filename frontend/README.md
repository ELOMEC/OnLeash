# onleash frontend

Next.js 16 + Privy embedded wallet (Solana) + onleash backend.

## Setup

1. **Privy app**: create one at <https://dashboard.privy.io>, enable Solana
   (Devnet). Copy the app ID.

2. **Env vars** — create `frontend/.env.local`:

   ```
   NEXT_PUBLIC_PRIVY_APP_ID=clx...your-app-id
   NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
   NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com
   ```

3. **Install + run** (from `frontend/`):

   ```bash
   npm install
   npm run dev
   ```

4. **Backend** — make sure the onleash backend is running on
   `localhost:3000` (`npm run backend` from repo root).

## Flow

1. User logs in via Privy (email / Google / Apple / external wallet).
2. Privy auto-creates a Solana embedded wallet for the user (the **owner**
   wallet for budgets).
3. User clicks "New agent" → frontend `POST /agents` to backend → backend
   generates a delegate keypair (or, in production, requests a Privy server
   wallet) and returns `{ id, delegateAddress }`.
4. User calls `initialize_budget` with the returned delegate address to fund
   and authorize the agent (this step still TODO in the UI — currently the
   page just lists created agents).
5. Once initialized, AI agents can call backend's `POST /agents/:id/pay` to
   spend within configured limits.

## What's wired here

- ✅ Privy provider with Solana embedded wallets + external wallet connectors
- ✅ Login / logout flow
- ✅ Agent creation via backend API
- ⏳ `initialize_budget` UI (constructs the tx via generated Codama client +
  signs with Privy embedded wallet) — not implemented
- ⏳ Top-up / pause / unpause / close UI
- ⏳ State display (current allowance, remaining, daily spent)
- ⏳ Per-agent payment history

## Why this lives in a sub-package

The Next.js frontend is intentionally separate from the root TypeScript
client (which ships demo + smoke + backend). They share `@solana/kit` and the
generated Codama client (which can be imported via path or extracted into a
shared workspace package later).
