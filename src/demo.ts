import { address, generateKeyPairSigner } from "@solana/kit";
import {
  findAgentBudgetPda,
  getExecutePaymentInstructionAsync,
  getInitializeBudgetInstructionAsync,
} from "./generated";

const USDC_MAINNET = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

async function main() {
  const owner = await generateKeyPairSigner();
  const delegate = await generateKeyPairSigner();
  const mint = USDC_MAINNET;

  const [agentBudget] = await findAgentBudgetPda({
    owner: owner.address,
    delegate: delegate.address,
  });

  console.log("Owner:   ", owner.address);
  console.log("Delegate:", delegate.address);
  console.log("Mint:    ", mint);
  console.log("Budget:  ", agentBudget);

  const initIx = await getInitializeBudgetInstructionAsync({
    owner,
    mint,
    delegate: delegate.address,
    totalAllowance: 100_000_000n,
    perTxLimit: 5_000_000n,
    dailyLimit: 50_000_000n,
    durationSeconds: 86_400n * 30n,
    depositAmount: 100_000_000n,
  });
  console.log("\ninitialize_budget");
  console.log("  program: ", initIx.programAddress);
  console.log("  accounts:", initIx.accounts.length);
  console.log("  data:    ", initIx.data.length, "bytes");

  // For demo purposes pass placeholder ATAs. In real usage these would be
  // derived via findAssociatedTokenPda from @solana-program/token.
  const budgetAta = address("11111111111111111111111111111112");
  const recipientAta = address("11111111111111111111111111111113");

  const payIx = await getExecutePaymentInstructionAsync({
    delegate,
    agentBudget,
    mint,
    budgetAta,
    recipientAta,
    amount: 1_000_000n,
  });
  console.log("\nexecute_payment");
  console.log("  program: ", payIx.programAddress);
  console.log("  accounts:", payIx.accounts.length);
  console.log("  data:    ", payIx.data.length, "bytes");
  console.log("  amount:  1.000000 USDC");

  console.log("\n✓ Both instructions constructed via Codama-generated client");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
