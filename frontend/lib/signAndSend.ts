import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import { codamaToWeb3 } from "./codamaToWeb3";

type CodamaIx = Parameters<typeof codamaToWeb3>[0];

type OwnerWallet = {
  address: string;
  sendTransaction?: (
    tx: VersionedTransaction,
    connection: Connection
  ) => Promise<string>;
};

export type SignResult = { signature: string };

// Build, simulate, sign-and-send a single-instruction tx with Privy as the owner signer.
// Simulating first surfaces real Anchor errors that the wallet adapter would otherwise swallow.
export async function signAndSendOwnerTx(
  ownerWallet: OwnerWallet,
  codamaIx: CodamaIx,
  rpcUrl: string
): Promise<SignResult> {
  if (!ownerWallet.sendTransaction) {
    throw new Error("Owner wallet does not support sendTransaction");
  }
  const web3Ix: TransactionInstruction = codamaToWeb3(codamaIx);
  const connection = new Connection(rpcUrl, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash();

  const message = new TransactionMessage({
    payerKey: new PublicKey(ownerWallet.address),
    recentBlockhash: blockhash,
    instructions: [web3Ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  const sim = await connection.simulateTransaction(tx, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).join("\n");
    throw new Error(
      `Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`
    );
  }

  const signature = (await ownerWallet.sendTransaction(
    tx,
    connection
  )) as unknown as string;
  return { signature };
}
