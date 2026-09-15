"use client";

import { useSolanaWallets } from "@privy-io/react-auth";
import { createNoopSigner, none, some, type Address } from "@solana/kit";
import { useState } from "react";

import {
  getCloseBudgetInstructionAsync,
  getTopUpInstructionAsync,
  getUpdatePolicyInstruction,
} from "../../lib/onleash-program";
import { signAndSendOwnerTx } from "../../lib/signAndSend";

type Props = {
  ownerAddress: string;
  budgetAddress: string;
  mintAddress: string;
  paused: boolean;
  onSuccess: () => void;
};

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export function BudgetControls({
  ownerAddress,
  budgetAddress,
  mintAddress,
  paused,
  onSuccess,
}: Props) {
  const { wallets } = useSolanaWallets();
  const ownerWallet = wallets.find((w) => w.address === ownerAddress);

  const [topUpAmount, setTopUpAmount] = useState("10000000"); // 10 USDC
  const [busy, setBusy] = useState<null | "topup" | "pause" | "close">(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  async function runTopUp() {
    if (!ownerWallet) return;
    setBusy("topup");
    setError(null);
    setLastSig(null);
    try {
      const ix = await getTopUpInstructionAsync({
        owner: createNoopSigner(ownerAddress as Address),
        agentBudget: budgetAddress as Address,
        mint: mintAddress as Address,
        amount: BigInt(topUpAmount),
      });
      const { signature } = await signAndSendOwnerTx(ownerWallet, ix, RPC_URL);
      setLastSig(signature);
      onSuccess();
    } catch (err) {
      console.error("top_up failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runTogglePause() {
    if (!ownerWallet) return;
    setBusy("pause");
    setError(null);
    setLastSig(null);
    try {
      const ix = getUpdatePolicyInstruction({
        owner: createNoopSigner(ownerAddress as Address),
        agentBudget: budgetAddress as Address,
        newPerTxLimit: none(),
        newDailyLimit: none(),
        newPaused: some(!paused),
        newExpiresAt: none(),
      });
      const { signature } = await signAndSendOwnerTx(ownerWallet, ix, RPC_URL);
      setLastSig(signature);
      onSuccess();
    } catch (err) {
      console.error("update_policy failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runClose() {
    if (!ownerWallet) return;
    if (
      !confirm(
        "Close this budget? Remaining tokens return to your wallet and the budget PDA is closed."
      )
    ) {
      return;
    }
    setBusy("close");
    setError(null);
    setLastSig(null);
    try {
      const ix = await getCloseBudgetInstructionAsync({
        owner: createNoopSigner(ownerAddress as Address),
        agentBudget: budgetAddress as Address,
        mint: mintAddress as Address,
      });
      const { signature } = await signAndSendOwnerTx(ownerWallet, ix, RPC_URL);
      setLastSig(signature);
      onSuccess();
    } catch (err) {
      console.error("close_budget failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const disabled = !!busy || !ownerWallet;

  return (
    <div style={styles.box}>
      <div style={styles.label}>Owner controls</div>

      <div style={styles.row}>
        <label style={styles.field}>
          <span style={styles.fieldLabel}>Top-up amount (raw)</span>
          <input
            value={topUpAmount}
            onChange={(e) => setTopUpAmount(e.target.value)}
            style={styles.input}
          />
        </label>
        <button
          style={{ ...styles.button, background: "#7c3aed" }}
          onClick={runTopUp}
          disabled={disabled}
        >
          {busy === "topup" ? "…" : "Top up"}
        </button>
      </div>

      <div style={styles.actions}>
        <button
          style={{ ...styles.button, background: paused ? "#0a7a3a" : "#a07c00" }}
          onClick={runTogglePause}
          disabled={disabled}
        >
          {busy === "pause" ? "…" : paused ? "Unpause" : "Pause"}
        </button>
        <button
          style={{ ...styles.button, background: "#a02020" }}
          onClick={runClose}
          disabled={disabled}
        >
          {busy === "close" ? "…" : "Close budget"}
        </button>
      </div>

      {lastSig && (
        <div style={styles.success}>
          ✓ Tx:{" "}
          <a
            href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#7c3aed" }}
          >
            {lastSig.slice(0, 16)}…
          </a>
        </div>
      )}
      {error && <div style={styles.error}>✕ {error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  box: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px dashed #ddd",
  },
  label: {
    fontSize: 12,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  row: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    marginBottom: 8,
  },
  field: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 12, color: "#444" },
  input: {
    padding: "6px 8px",
    border: "1px solid #ddd",
    borderRadius: 4,
    fontFamily: "ui-monospace, monospace",
    fontSize: 13,
  },
  actions: { display: "flex", gap: 8 },
  button: {
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
};
