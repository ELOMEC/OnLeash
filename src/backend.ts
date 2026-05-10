import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  fetchAgentBudget,
  findAgentBudgetPda,
  getExecutePaymentInstructionAsync,
} from "./generated";

// === DELEGATE PROVIDER ===
// This backend currently creates ed25519 keypairs locally via Node crypto and
// holds raw bytes in process memory. For production, swap to Privy Server
// Wallets (MPC-backed, no raw keys ever held by backend):
//
//   import { PrivyClient } from "@privy-io/server-auth";
//   const privy = new PrivyClient(process.env.PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!);
//   const wallet = await privy.walletApi.createWallet({ chainType: "solana" });
//   // store wallet.id; sign via privy.walletApi.signTransaction(walletId, tx)
//
// Required env vars: PRIVY_APP_ID, PRIVY_APP_SECRET
// Trade-offs: Privy server wallets are MPC-secured and remove key-management
// burden from the backend at the cost of per-wallet fees. Local mode remains
// useful for tests and local dev.

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const RPC_WS = process.env.RPC_WS ?? "wss://api.devnet.solana.com";
// Service keypair loading — prefer SERVICE_KEYPAIR env (JSON array of 64 bytes,
// same format as Solana CLI keypair files) for hosted envs like Railway.
// Fall back to SERVICE_KEYPAIR_PATH for local dev.
const SERVICE_KEYPAIR_ENV = process.env.SERVICE_KEYPAIR;
const SERVICE_KEYPAIR_PATH =
  process.env.SERVICE_KEYPAIR_PATH ??
  `${process.env.HOME}/.config/solana/id-devnet.json`;
const PORT = Number(process.env.PORT ?? 3000);
// Comma-separated origins permitted to call this API. Set to "*" to allow any.
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ??
  "http://localhost:3000,https://onleash.io,https://www.onleash.io,https://app.onleash.io"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions,
});

type AgentRecord = {
  delegateKeyBytes: Uint8Array;
  delegateAddress: Address;
  ownerAddress?: Address;
  mintAddress?: Address;
  createdAt: number;
};
const agents = new Map<string, AgentRecord>();

function generateLocalDelegateKeyBytes(): Uint8Array {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const priv = pkcs8.subarray(pkcs8.length - 32);
  const pub = spki.subarray(spki.length - 32);
  const combined = new Uint8Array(64);
  combined.set(priv, 0);
  combined.set(pub, 32);
  return combined;
}

async function createDelegate(): Promise<{
  keyBytes: Uint8Array;
  address: Address;
}> {
  // TODO(privy): if PRIVY_APP_ID + PRIVY_APP_SECRET are set, replace with:
  //   const wallet = await privy.walletApi.createWallet({ chainType: "solana" });
  //   return { keyBytes: new Uint8Array(0), address: wallet.address as Address };
  // Then store wallet.id on the AgentRecord and use it during signing.
  const keyBytes = generateLocalDelegateKeyBytes();
  const signer = await createKeyPairSignerFromBytes(keyBytes);
  return { keyBytes, address: signer.address };
}

async function loadDelegateSigner(record: AgentRecord) {
  // TODO(privy): if record has privyWalletId, return a Privy-backed signer:
  //   return privy.walletApi.getSolanaSigner(record.privyWalletId);
  return createKeyPairSignerFromBytes(record.delegateKeyBytes);
}

let serviceSignerCache: Awaited<
  ReturnType<typeof createKeyPairSignerFromBytes>
> | null = null;
function parseKeypairJson(raw: string, source: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`service keypair (${source}) is not valid JSON: ${err}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(
      `service keypair (${source}) must be a JSON array of 64 bytes, got ${
        Array.isArray(parsed) ? `length ${parsed.length}` : typeof parsed
      }`
    );
  }
  return new Uint8Array(parsed as number[]);
}
async function loadServiceSigner() {
  if (serviceSignerCache) return serviceSignerCache;
  const bytes = SERVICE_KEYPAIR_ENV
    ? parseKeypairJson(SERVICE_KEYPAIR_ENV, "SERVICE_KEYPAIR env")
    : parseKeypairJson(
        readFileSync(SERVICE_KEYPAIR_PATH, "utf-8"),
        SERVICE_KEYPAIR_PATH
      );
  serviceSignerCache = await createKeyPairSignerFromBytes(bytes);
  return serviceSignerCache;
}

const app = express();
app.use(
  cors({
    origin: CORS_ORIGINS.includes("*") ? true : CORS_ORIGINS,
    methods: ["GET", "POST", "OPTIONS"],
  })
);
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", rpc: RPC_URL, agents: agents.size });
});

app.post("/agents", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerAddress = body.ownerAddress;
    const mintAddress = body.mintAddress;
    const id = randomUUID();
    const { keyBytes: delegateKeyBytes, address: delegateAddress } =
      await createDelegate();
    agents.set(id, {
      delegateKeyBytes,
      delegateAddress,
      ownerAddress:
        typeof ownerAddress === "string" ? address(ownerAddress) : undefined,
      mintAddress:
        typeof mintAddress === "string" ? address(mintAddress) : undefined,
      createdAt: Date.now(),
    });
    res.status(201).json({
      id,
      delegateAddress,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.get("/agents/:id", async (req: Request, res: Response) => {
  try {
    const agent = agents.get(req.params.id as string);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    let budget: Record<string, unknown> | null = null;
    if (agent.ownerAddress) {
      const [agentBudget] = await findAgentBudgetPda({
        owner: agent.ownerAddress,
        delegate: agent.delegateAddress,
      });
      try {
        const acc = await fetchAgentBudget(rpc, agentBudget);
        budget = {
          address: agentBudget,
          mint: acc.data.mint,
          totalAllowance: acc.data.totalAllowance.toString(),
          spentTotal: acc.data.spentTotal.toString(),
          dailyLimit: acc.data.dailyLimit.toString(),
          dailySpent: acc.data.dailySpent.toString(),
          perTxLimit: acc.data.perTxLimit.toString(),
          paused: acc.data.paused,
          nonce: acc.data.nonce.toString(),
        };
      } catch {
        // not yet initialized on-chain
      }
    }

    res.json({
      id: req.params.id as string,
      delegateAddress: agent.delegateAddress,
      ownerAddress: agent.ownerAddress,
      mintAddress: agent.mintAddress,
      createdAt: agent.createdAt,
      budget,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.post("/agents/:id/pay", async (req: Request, res: Response) => {
  try {
    const agent = agents.get(req.params.id as string);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerAddress = body.ownerAddress;
    const mintAddress = body.mintAddress;
    const recipientAta = body.recipientAta;
    const amount = body.amount;
    if (
      typeof ownerAddress !== "string" ||
      typeof mintAddress !== "string" ||
      typeof recipientAta !== "string" ||
      (typeof amount !== "string" && typeof amount !== "number")
    ) {
      res.status(400).json({
        error: "missing fields: ownerAddress, mintAddress, recipientAta, amount",
      });
      return;
    }

    const delegate = await loadDelegateSigner(agent);
    const ownerAddr = address(ownerAddress);
    const mintAddr = address(mintAddress);

    const [agentBudget] = await findAgentBudgetPda({
      owner: ownerAddr,
      delegate: delegate.address,
    });
    const [budgetAta] = await findAssociatedTokenPda({
      mint: mintAddr,
      owner: agentBudget,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    const payIx = await getExecutePaymentInstructionAsync({
      delegate,
      agentBudget,
      mint: mintAddr,
      budgetAta,
      recipientAta: address(recipientAta),
      amount: BigInt(amount),
    });

    const serviceSigner = await loadServiceSigner();
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(serviceSigner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([payIx], m)
    );
    const signed = await signTransactionMessageWithSigners(message);
    await sendAndConfirm(signed, { commitment: "confirmed" });
    const sig = getSignatureFromTransaction(signed);

    res.json({
      signature: sig,
      agentBudget,
      delegateAddress: delegate.address,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`✓ onleash backend on http://localhost:${PORT}`);
  console.log(`  RPC:             ${RPC_URL}`);
  console.log(
    `  Service keypair: ${
      SERVICE_KEYPAIR_ENV
        ? "SERVICE_KEYPAIR env (inline)"
        : SERVICE_KEYPAIR_PATH
    }`
  );
  console.log(`  CORS origins:    ${CORS_ORIGINS.join(", ")}`);
  console.log(
    `  Delegate mode:   ${
      process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET
        ? "PRIVY_* set but Privy provider not wired — using local fallback"
        : "local (Node crypto ed25519, in-memory)"
    }`
  );
});
