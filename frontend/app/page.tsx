"use client";

import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
import { useCallback, useState } from "react";

import { InitializeBudgetForm } from "./components/InitializeBudgetForm";
import { TestPayForm } from "./components/TestPayForm";

type AgentSummary = {
  id: string;
  delegateAddress: string;
};

type BudgetState = {
  address: string;
  mint: string;
  totalAllowance: string;
  spentTotal: string;
  dailyLimit: string;
  dailySpent: string;
  perTxLimit: string;
  paused: boolean;
  nonce: string;
};

type AgentDetail = AgentSummary & {
  ownerAddress?: string;
  mintAddress?: string;
  createdAt: number;
  budget: BudgetState | null;
};

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3000";

export default function Page() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const [agents, setAgents] = useState<AgentDetail[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const ownerWallet = wallets[0];

  const refreshAgent = useCallback(async (id: string) => {
    // Poll for up to ~20s; on-chain confirmation can lag the tx submission.
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${BACKEND}/agents/${id}`);
      if (res.ok) {
        const detail = (await res.json()) as AgentDetail;
        setAgents((prev) => prev.map((a) => (a.id === id ? detail : a)));
        if (detail.budget) return;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);

  async function createAgent() {
    if (!ownerWallet) return;
    setCreating(true);
    try {
      const res = await fetch(`${BACKEND}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: ownerWallet.address }),
      });
      const data = (await res.json()) as AgentSummary;
      setAgents((prev) => [
        ...prev,
        {
          ...data,
          ownerAddress: ownerWallet.address,
          createdAt: Date.now(),
          budget: null,
        },
      ]);
      setExpanded(data.id);
    } finally {
      setCreating(false);
    }
  }

  if (!ready) {
    return <main style={styles.main}>Loading…</main>;
  }

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1>onleash</h1>
        <p style={styles.tagline}>Bounded autonomous spending for AI agents</p>
      </header>

      {!authenticated ? (
        <button style={styles.primaryButton} onClick={login}>
          Login
        </button>
      ) : (
        <>
          <section style={styles.card}>
            <div style={styles.row}>
              <div>
                <strong>Account:</strong>{" "}
                {user?.email?.address ?? user?.id ?? "—"}
              </div>
              <button style={styles.linkButton} onClick={logout}>
                Logout
              </button>
            </div>
            <div style={styles.row}>
              <strong>Solana wallet:</strong>{" "}
              <code>{ownerWallet?.address ?? "(creating…)"}</code>
            </div>
          </section>

          <section style={styles.card}>
            <div style={styles.row}>
              <h2 style={{ margin: 0 }}>Agents</h2>
              <button
                style={styles.primaryButton}
                onClick={createAgent}
                disabled={creating || !ownerWallet}
              >
                {creating ? "Creating…" : "+ New agent"}
              </button>
            </div>

            {agents.length === 0 ? (
              <p style={{ color: "#666" }}>
                No agents yet. Click <em>New agent</em> to generate a delegate
                keypair on the backend, then initialize a budget with your
                owner wallet to fund it.
              </p>
            ) : (
              <ul style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
                {agents.map((a) => (
                  <li key={a.id} style={styles.agentRow}>
                    <div style={styles.agentHeader}>
                      <div>
                        <div>
                          <code>{a.id}</code>
                        </div>
                        <div style={{ color: "#666", fontSize: 13 }}>
                          delegate: <code>{a.delegateAddress}</code>
                        </div>
                      </div>
                      <button
                        style={styles.linkButton}
                        onClick={() =>
                          setExpanded((cur) => (cur === a.id ? null : a.id))
                        }
                      >
                        {expanded === a.id ? "Hide" : "Configure"}
                      </button>
                    </div>

                    {a.budget && (
                      <div style={styles.budgetBox}>
                        <strong>Budget:</strong> {a.budget.spentTotal} /{" "}
                        {a.budget.totalAllowance} spent · daily{" "}
                        {a.budget.dailySpent} / {a.budget.dailyLimit} ·{" "}
                        {a.budget.paused ? "PAUSED" : "active"}
                      </div>
                    )}

                    {expanded === a.id && ownerWallet && !a.budget && (
                      <InitializeBudgetForm
                        agentId={a.id}
                        ownerAddress={ownerWallet.address}
                        delegateAddress={a.delegateAddress}
                        onSuccess={() => refreshAgent(a.id)}
                      />
                    )}

                    {expanded === a.id && ownerWallet && a.budget && (
                      <TestPayForm
                        agentId={a.id}
                        ownerAddress={ownerWallet.address}
                        mintAddress={a.budget.mint}
                        perTxLimit={a.budget.perTxLimit}
                        onSuccess={() => refreshAgent(a.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    maxWidth: 720,
    margin: "40px auto",
    padding: "0 20px",
  },
  header: { marginBottom: 32 },
  tagline: { color: "#666", marginTop: -8 },
  card: {
    border: "1px solid #e5e5e5",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  primaryButton: {
    background: "#7c3aed",
    color: "white",
    border: 0,
    padding: "8px 16px",
    borderRadius: 6,
    cursor: "pointer",
  },
  linkButton: {
    background: "transparent",
    color: "#7c3aed",
    border: 0,
    cursor: "pointer",
    textDecoration: "underline",
  },
  agentRow: {
    padding: 12,
    borderRadius: 6,
    background: "#fafafa",
    marginBottom: 8,
  },
  agentHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  budgetBox: {
    marginTop: 8,
    padding: 8,
    background: "white",
    borderRadius: 4,
    fontSize: 13,
    border: "1px solid #e5e5e5",
  },
};
