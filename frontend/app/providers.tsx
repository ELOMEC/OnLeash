"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <main style={{ fontFamily: "system-ui", padding: 32, maxWidth: 720 }}>
        <h1>onleash</h1>
        <p>
          <strong>NEXT_PUBLIC_PRIVY_APP_ID</strong> not set. Create a Privy app
          at{" "}
          <a href="https://dashboard.privy.io" target="_blank" rel="noreferrer">
            dashboard.privy.io
          </a>
          , add Solana support (Devnet), and put the app ID in{" "}
          <code>frontend/.env.local</code>.
        </p>
      </main>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
        },
        externalWallets: {
          solana: { connectors: toSolanaWalletConnectors() },
        },
        loginMethods: ["email", "google", "apple", "wallet"],
        appearance: {
          accentColor: "#7c3aed",
          theme: "light",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
