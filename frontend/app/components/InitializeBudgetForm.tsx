"use client";

import { useSolanaWallets } from "@privy-io/react-auth";
import { createNoopSigner, type Address } from "@solana/kit";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { useState } from "react";

import { codamaToWeb3 } from "../../lib/codamaToWeb3";
import { getInitializeBudgetInstructionAsync } from "../../lib/onleash-program";

type Props = {
  agentId: string;
  ownerAddress: string;
  delegateAddress: string;
  onSuccess: () => void;
};

// Default to the local test mint seeded via `tsx src/seed-owner.ts`.
// Override per-agent if using a different mint.
const DEFAULT_MINT = "5Wr6GBqfeSV74wcDrW8dM2LwmZNM7CdCR9eDa2CH4Nk8";

export function InitializeBudgetForm({
  agentId,
  ownerAddress,
  delegateAddress,
  onSuccess,
}: Props) {
  const { wallets } = useSolanaWallets();
  const ownerWallet = wallets.find((w) => w.address === ownerAddress);

  const [mint, setMint] = useState(DEFAULT_MINT);
  const [totalAllowance, setTotalAllowance] = useState("100000000"); // 100 USDC (6 decimals)
  const [perTxLimit, setPerTxLimit] = useState("10000000"); // 10 USDC
  const [dailyLimit, setDailyLimit] = useState("50000000"); // 50 USDC
  const [durationSeconds, setDurationSeconds] = useState("604800"); // 7 days
  const [depositAmount, setDepositAmount] = useState("100000000"); // 100 USDC (must be > 0)

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  async function submit() {
    if (!ownerWallet) {
      setError("Owner wallet not available");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSignature(null);
    try {
      const ix = await getInitializeBudgetInstructionAsync({
        owner: createNoopSigner(ownerAddress as Address),
        mint: mint as Address,
        delegate: delegateAddress as Address,
        totalAllowance: BigInt(totalAllowance),
        perTxLimit: BigInt(perTxLimit),
        dailyLimit: BigInt(dailyLimit),
        durationSeconds: BigInt(durationSeconds),
        depositAmount: BigInt(depositAmount),
      });

      const web3Ix = codamaToWeb3(ix);

      const rpcUrl =
        process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      const { blockhash } = await connection.getLatestBlockhash();

      const message = new TransactionMessage({
        payerKey: new PublicKey(ownerAddress),
        recentBlockhash: blockhash,
        instructions: [web3Ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);

      const sim = await connection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      console.log("simulate result:", sim.value);
      if (sim.value.err) {
        const logs = (sim.value.logs ?? []).join("\n");
        throw new Error(
          `Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`
        );
      }

      const sig = await ownerWallet.sendTransaction!(tx, connection);
      setSignature(sig as unknown as string);
      onSuccess();
    } catch (err) {
      console.error("initialize_budget failed:", err);
      const detail =
        err instanceof Error
          ? `${err.name}: ${err.message}${err.stack ? `\n${err.stack.split("\n").slice(0, 3).join("\n")}` : ""}`
          : JSON.stringify(err, null, 2);
      setError(detail);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.form}>
      <div style={styles.grid}>
        <label style={styles.label}>
          Mint (SPL token)
          <input
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Total allowance (raw)
          <input
            value={totalAllowance}
            onChange={(e) => setTotalAllowance(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Per-tx limit (raw)
          <input
            value={perTxLimit}
            onChange={(e) => setPerTxLimit(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Daily limit (raw)
          <input
            value={dailyLimit}
            onChange={(e) => setDailyLimit(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Duration (seconds)
          <input
            value={durationSeconds}
            onChange={(e) => setDurationSeconds(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Initial deposit (raw)
          <input
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            style={styles.input}
          />
        </label>
      </div>

      <button
        style={styles.button}
        onClick={submit}
        disabled={submitting || !ownerWallet}
      >
        {submitting ? "Signing…" : "Initialize budget"}
      </button>

      {signature && (
        <div style={styles.success}>
          ✓ Sent:{" "}
          <a
            href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#7c3aed" }}
          >
            {signature.slice(0, 16)}…
          </a>
        </div>
      )}
      {error && <div style={styles.error}>✕ {error}</div>}

      <div style={styles.hint}>
        Agent <code>{agentId.slice(0, 8)}…</code> · raw amounts use the token's
        native decimals (USDC = 6) · deposit must be &gt; 0 and ≤ your owner
        ATA balance for this mint.
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  form: { marginTop: 12, paddingTop: 12, borderTop: "1px dashed #ddd" },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 12,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    fontSize: 12,
    color: "#444",
    gap: 4,
  },
  input: {
    padding: "6px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
  },
  button: {
    background: "#7c3aed",
    color: "white",
    border: 0,
    padding: "8px 16px",
    borderRadius: 6,
    cursor: "pointer",
  },
  success: {
    marginTop: 8,
    fontSize: 13,
    color: "#0a7a3a",
    background: "#e6f7ed",
    padding: 8,
    borderRadius: 4,
  },
  error: {
    marginTop: 8,
    fontSize: 13,
    color: "#a00",
    background: "#fdecec",
    padding: 8,
    borderRadius: 4,
    whiteSpace: "pre-wrap",
  },
  hint: { marginTop: 8, fontSize: 12, color: "#888" },
};
