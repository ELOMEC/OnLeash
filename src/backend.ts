import { PrivyClient } from "@privy-io/server-auth";
import {
  address,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  type Address,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import cors from "cors";
import express, { type Request, type Response } from "express";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  fetchAgentBudget,
  findAgentBudgetPda,
  getExecutePaymentInstructionAsync,
} from "./generated";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const RPC_WS = process.env.RPC_WS ?? "wss://api.devnet.solana.com";
const SERVICE_KEYPAIR_ENV = process.env.SERVICE_KEYPAIR;
const SERVICE_KEYPAIR_PATH =
  process.env.SERVICE_KEYPAIR_PATH ??
  `${process.env.HOME}/.config/solana/id-devnet.json`;
const PORT = Number(process.env.PORT ?? 3000);
const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ??
  "http://localhost:3000,https://onleash.io,https://www.onleash.io,https://app.onleash.io"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Privy Server Wallets — when both creds are set, delegates are minted via
// Privy's MPC infrastructure and their walletId is what we persist instead of
// raw key material. The service keypair still pays fees locally.
const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;
// CAIP-2 chain ID Privy expects when broadcasting. Devnet is the default
// since that's what the program is deployed on.
const PRIVY_SOLANA_CAIP2 =
  (process.env.PRIVY_SOLANA_CAIP2 as
    | "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    | "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    | "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z") ??
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const privy =
  PRIVY_APP_ID && PRIVY_APP_SECRET
    ? new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET)
    : null;

const rpc = createSolanaRpc(RPC_URL);
const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS);
const sendAndConfirm = sendAndConfirmTransactionFactory({
  rpc,
  rpcSubscriptions,
});

// Two flavors of delegate keypair backing. Local mode is for dev / when Privy
// isn't configured; Privy mode delegates key management to their MPC service.
type LocalDelegate = { kind: "local"; keyBytes: Uint8Array };
type PrivyDelegate = { kind: "privy"; walletId: string };
type DelegateBacking = LocalDelegate | PrivyDelegate;

type AgentRecord = {
  delegate: DelegateBacking;
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
  backing: DelegateBacking;
  address: Address;
}> {
  if (privy) {
    const wallet = await privy.walletApi.createWallet({ chainType: "solana" });
    return {
      backing: { kind: "privy", walletId: wallet.id },
      address: wallet.address as Address,
    };
  }
  const keyBytes = generateLocalDelegateKeyBytes();
  const signer = await createKeyPairSignerFromBytes(keyBytes);
  return {
    backing: { kind: "local", keyBytes },
    address: signer.address,
  };
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

// AccountRole bit flags from @solana/kit: 1 = writable, 2 = signer. The web3.js
// equivalent uses two booleans, so we translate here when handing instructions
// off to the Privy SDK (which speaks the v1 types).
type CodamaInstruction = {
  programAddress: string;
  accounts: ReadonlyArray<{ address: string; role: number }>;
  data: ArrayLike<number> & { length: number };
};
function codamaToWeb3(ix: CodamaInstruction): TransactionInstruction {
  return {
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: (a.role & 2) !== 0,
      isWritable: (a.role & 1) !== 0,
    })),
    data: Buffer.from(Uint8Array.from(ix.data)),
  } as TransactionInstruction;
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
  res.json({
    status: "ok",
    rpc: RPC_URL,
    agents: agents.size,
    delegateMode: privy ? "privy" : "local",
  });
});

app.post("/agents", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ownerAddress = body.ownerAddress;
    const mintAddress = body.mintAddress;
    const id = randomUUID();
    const { backing, address: delegateAddress } = await createDelegate();
    agents.set(id, {
      delegate: backing,
      delegateAddress,
      ownerAddress:
        typeof ownerAddress === "string" ? address(ownerAddress) : undefined,
      mintAddress:
        typeof mintAddress === "string" ? address(mintAddress) : undefined,
      createdAt: Date.now(),
    });
    res.status(201).json({ id, delegateAddress });
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
        error:
          "missing fields: ownerAddress, mintAddress, recipientAta, amount",
      });
      return;
    }

    const ownerAddr = address(ownerAddress);
    const mintAddr = address(mintAddress);
    const [agentBudget] = await findAgentBudgetPda({
      owner: ownerAddr,
      delegate: agent.delegateAddress,
    });
    const [budgetAta] = await findAssociatedTokenPda({
      mint: mintAddr,
      owner: agentBudget,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    if (agent.delegate.kind === "privy") {
      // Privy path: build instruction with NoopSigner placeholder for the
      // delegate, build VersionedTransaction with @solana/web3.js, partial-sign
      // as the fee payer locally, then hand off to Privy to add the delegate
      // signature and broadcast.
      if (!privy) {
        throw new Error("Privy delegate stored but PRIVY client unavailable");
      }
      const noopDelegate = createNoopSigner(agent.delegateAddress);
      const payIxCodama = await getExecutePaymentInstructionAsync({
        delegate: noopDelegate,
        agentBudget,
        mint: mintAddr,
        budgetAta,
        recipientAta: address(recipientAta),
        amount: BigInt(amount),
      });
      const web3Ix = codamaToWeb3({
        programAddress: payIxCodama.programAddress,
        accounts: payIxCodama.accounts.map((a) => ({
          address: a.address,
          role: a.role,
        })),
        data: payIxCodama.data as unknown as Uint8Array,
      });

      const serviceSigner = await loadServiceSigner();
      const connection = new Connection(RPC_URL, "confirmed");
      const { blockhash } = await connection.getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: new PublicKey(serviceSigner.address),
        recentBlockhash: blockhash,
        instructions: [web3Ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);

      // Sign as the fee payer locally. We use @solana/web3.js's secret-key
      // signing path by constructing a Keypair from the same 64-byte bundle
      // the service signer already holds.
      const serviceKeyBytes = SERVICE_KEYPAIR_ENV
        ? parseKeypairJson(SERVICE_KEYPAIR_ENV, "SERVICE_KEYPAIR env")
        : parseKeypairJson(
            readFileSync(SERVICE_KEYPAIR_PATH, "utf-8"),
            SERVICE_KEYPAIR_PATH
          );
      const { Keypair } = await import("@solana/web3.js");
      const serviceKp = Keypair.fromSecretKey(serviceKeyBytes);
      tx.sign([serviceKp]);

      const { hash } = await privy.walletApi.solana.signAndSendTransaction({
        walletId: agent.delegate.walletId,
        caip2: PRIVY_SOLANA_CAIP2,
        transaction: tx,
      });

      res.json({
        signature: hash,
        agentBudget,
        delegateAddress: agent.delegateAddress,
      });
      return;
    }

    // Local path: same as before — KeyPairSigner signs as the delegate, the
    // service signer pays fees, both via @solana/kit's sign-and-send pipeline.
    const delegate = await createKeyPairSignerFromBytes(
      agent.delegate.keyBytes
    );
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
      delegateAddress: agent.delegateAddress,
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
      privy
        ? `privy server wallets (${PRIVY_SOLANA_CAIP2})`
        : "local (Node crypto ed25519, in-memory)"
    }`
  );
});
