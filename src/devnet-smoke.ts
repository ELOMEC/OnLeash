import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type IInstruction,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstructionAsync,
  getInitializeMint2Instruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getCreateAccountInstruction } from "@solana-program/system";
import { readFileSync } from "node:fs";

import {
  fetchAgentBudget,
  findAgentBudgetPda,
  getCloseBudgetInstructionAsync,
  getExecutePaymentInstructionAsync,
  getInitializeBudgetInstructionAsync,
} from "./generated";

const RPC_URL = "https://api.devnet.solana.com";
const RPC_WS = "wss://api.devnet.solana.com";

const MINT_DECIMALS = 6;
const TOTAL_ALLOWANCE = 100_000_000n;
const PER_TX_LIMIT = 5_000_000n;
const DAILY_LIMIT = 50_000_000n;
const DURATION_SECONDS = BigInt(86_400 * 30);
const DEPOSIT_AMOUNT = 100_000_000n;
const INITIAL_USDC = 1_000_000_000n;

async function main() {
  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  const ownerKeyBytes = new Uint8Array(
    JSON.parse(
      readFileSync(
        `${process.env.HOME}/.config/solana/id-devnet.json`,
        "utf-8"
      )
    )
  );
  const owner = await createKeyPairSignerFromBytes(ownerKeyBytes);
  const delegate = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();

  console.log("Owner:   ", owner.address);
  console.log("Delegate:", delegate.address);
  console.log("Mint:    ", mint.address);
  console.log();

  const send = async (
    payer: TransactionSigner,
    ixs: IInstruction[],
    label: string
  ): Promise<Signature> => {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m)
    );
    const signed = await signTransactionMessageWithSigners(message);
    await sendAndConfirm(signed, { commitment: "confirmed" });
    const sig = getSignatureFromTransaction(signed);
    console.log(`✓ ${label}: ${sig}`);
    return sig;
  };

  const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();
  await send(
    owner,
    [
      getCreateAccountInstruction({
        payer: owner,
        newAccount: mint,
        lamports: mintRent,
        space: 82n,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint: mint.address,
        decimals: MINT_DECIMALS,
        mintAuthority: owner.address,
        freezeAuthority: null,
      }),
    ],
    "create + init mint"
  );

  const [ownerAta] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: owner.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  await send(
    owner,
    [
      await getCreateAssociatedTokenInstructionAsync({
        payer: owner,
        owner: owner.address,
        mint: mint.address,
      }),
    ],
    "create owner ATA"
  );

  await send(
    owner,
    [
      getMintToInstruction({
        mint: mint.address,
        token: ownerAta,
        mintAuthority: owner,
        amount: INITIAL_USDC,
      }),
    ],
    "mint USDC to owner"
  );

  const initBudgetIx = await getInitializeBudgetInstructionAsync({
    owner,
    mint: mint.address,
    delegate: delegate.address,
    totalAllowance: TOTAL_ALLOWANCE,
    perTxLimit: PER_TX_LIMIT,
    dailyLimit: DAILY_LIMIT,
    durationSeconds: DURATION_SECONDS,
    depositAmount: DEPOSIT_AMOUNT,
  });
  await send(owner, [initBudgetIx], "initialize_budget");

  const [agentBudget] = await findAgentBudgetPda({
    owner: owner.address,
    delegate: delegate.address,
  });
  console.log("\nAgent budget PDA:", agentBudget);

  const account = await fetchAgentBudget(rpc, agentBudget);
  console.log("\nOn-chain state:");
  console.log("  owner:           ", account.data.owner);
  console.log("  delegate:        ", account.data.delegate);
  console.log("  mint:            ", account.data.mint);
  console.log("  total_allowance: ", account.data.totalAllowance);
  console.log("  spent_total:     ", account.data.spentTotal);
  console.log("  per_tx_limit:    ", account.data.perTxLimit);
  console.log("  daily_limit:     ", account.data.dailyLimit);
  console.log("  paused:          ", account.data.paused);

  // Step 5: Create recipient ATA + execute_payment (delegate signs, owner pays fee)
  const recipientOwner = await generateKeyPairSigner();
  const [recipientAta] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: recipientOwner.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  await send(
    owner,
    [
      await getCreateAssociatedTokenInstructionAsync({
        payer: owner,
        owner: recipientOwner.address,
        mint: mint.address,
      }),
    ],
    "create recipient ATA"
  );

  const [budgetAta] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: agentBudget,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const paymentAmount = 2_000_000n;
  await send(
    owner,
    [
      await getExecutePaymentInstructionAsync({
        delegate,
        agentBudget,
        mint: mint.address,
        budgetAta,
        recipientAta,
        amount: paymentAmount,
      }),
    ],
    "execute_payment (2 USDC)"
  );

  const afterPayment = await fetchAgentBudget(rpc, agentBudget);
  console.log(
    `\nAfter payment: spent_total=${afterPayment.data.spentTotal} daily_spent=${afterPayment.data.dailySpent} nonce=${afterPayment.data.nonce}`
  );

  // Step 6: Close budget (refund remaining + close PDA + close ATA)
  await send(
    owner,
    [
      await getCloseBudgetInstructionAsync({
        owner,
        agentBudget,
        mint: mint.address,
        budgetAta,
        ownerAta,
      }),
    ],
    "close_budget"
  );

  const closedAccount = await rpc.getAccountInfo(agentBudget).send();
  console.log(
    `\nBudget PDA after close: ${
      closedAccount.value === null ? "closed (null)" : "still exists"
    }`
  );

  console.log(`\n✓ Smoke test passed (init → pay → close lifecycle on devnet)`);
  console.log(
    `Explorer (mint):     https://explorer.solana.com/address/${mint.address}?cluster=devnet`
  );
  console.log(
    `Explorer (budget):   https://explorer.solana.com/address/${agentBudget}?cluster=devnet`
  );
  console.log(
    `Explorer (recipient): https://explorer.solana.com/address/${recipientAta}?cluster=devnet`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
