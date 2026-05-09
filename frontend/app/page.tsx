"use client";

import { usePrivy, useSolanaWallets } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

type Agent = {
  id: string;
  delegateAddress: string;
};

export default function Page() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [creating, setCreating] = useState(false);

  const ownerWallet = wallets[0];

  async function createAgent() {
    if (!ownerWallet) return;
    setCreating(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BACKEND_URL}/agents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerAddress: ownerWallet.address,
            // mintAddress: pass when initializing budget
          }),
        }
      );
      const data = (await res.json()) as Agent;
      setAgents((prev) => [...prev, data]);
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
              {ownerWallet?.address ?? "(creating…)"}
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
                keypair on the backend, then call <code>initialize_budget</code>{" "}
                with your owner wallet to fund it.
              </p>
            ) : (
              <ul style={{ paddingLeft: 0, listStyle: "none" }}>
                {agents.map((a) => (
                  <li key={a.id} style={styles.agentRow}>
                    <div>
                      <code>{a.id}</code>
                    </div>
                    <div style={{ color: "#666", fontSize: 13 }}>
                      delegate: <code>{a.delegateAddress}</code>
                    </div>
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
  header: {
    marginBottom: 32,
  },
  tagline: {
    color: "#666",
    marginTop: -8,
  },
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
};
