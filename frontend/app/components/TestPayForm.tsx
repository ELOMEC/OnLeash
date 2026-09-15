"use client";

import {
  findAssociatedTokenPda,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { type Address } from "@solana/kit";
import { useState } from "react";

type Props = {
  agentId: string;
  ownerAddress: string;
  mintAddress: string;
  perTxLimit: string;
  onSuccess: () => void;
};

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

export function TestPayForm({
  agentId,
  ownerAddress,
  mintAddress,
  perTxLimit,
  onSuccess,
}: Props) {
  const [recipient, setRecipient] = useState(ownerAddress); // default: self
  const [amount, setAmount] = useState("1000000"); // 1 USDC (6 decimals)
  const [submitting, setSubmitting] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setSignature(null);
    setError(null);
    try {
      // Compute recipient ATA from recipient owner + mint.
      const [recipientAta] = await findAssociatedTokenPda({
        mint: mintAddress as Address,
        owner: recipient as Address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      const res = await fetch(`${BACKEND}/agents/${agentId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress,
          mintAddress,
          recipientAta,
          amount,
        }),
      });
      const data = (await res.json()) as { signature?: string; error?: string };
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSignature(data.signature ?? null);
      onSuccess();
    } catch (err) {
      console.error("pay failed:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.form}>
      <div style={styles.grid}>
        <label style={styles.label}>
          Recipient (owner address)
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Amount (raw, ≤ per-tx {perTxLimit})
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={styles.input}
          />
        </label>
      </div>
      <button
        style={styles.button}
        onClick={submit}
        disabled={submitting}
      >
        {submitting ? "Paying…" : "Simulate agent payment"}
      </button>
      {signature && (
        <div style={styles.success}>
          ✓ Paid:{" "}
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
        Backend signs as delegate (no owner approval needed) — that's the whole
        point. Limited by per-tx, daily, and total allowance.
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
    background: "#0a7a3a",
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
