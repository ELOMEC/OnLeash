import {
  address,
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
  type Address,
  type IInstruction,
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

const RPC_URL = "https://api.devnet.solana.com";
const RPC_WS = "wss://api.devnet.solana.com";
const MINT_DECIMALS = 6;
const MINT_AMOUNT = 1_000_000_000n; // 1000 USDC equivalent (6 decimals)

async function main() {
  const ownerAddressArg = process.argv[2];
  if (!ownerAddressArg) {
    console.error("usage: tsx src/seed-owner.ts <ownerAddress>");
    process.exit(1);
  }
  const targetOwner = address(ownerAddressArg);

  const rpc = createSolanaRpc(RPC_URL);
  const rpcSubscriptions = createSolanaRpcSubscriptions(RPC_WS);
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // Payer + mint authority: existing devnet keypair with SOL.
  const payerBytes = new Uint8Array(
    JSON.parse(
      readFileSync(`${process.env.HOME}/.config/solana/id-devnet.json`, "utf-8")
    )
  );
  const payer = await createKeyPairSignerFromBytes(payerBytes);
  const mint = await generateKeyPairSigner();

  console.log("Payer (auth):", payer.address);
  console.log("Target owner:", targetOwner);
  console.log("New mint:    ", mint.address);
  console.log();

  const send = async (ixs: IInstruction[], label: string) => {
    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(payer as TransactionSigner, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(ixs, m)
    );
    const signed = await signTransactionMessageWithSigners(message);
    await sendAndConfirm(signed, { commitment: "confirmed" });
    const sig = getSignatureFromTransaction(signed);
    console.log(`✓ ${label}: ${sig}`);
  };

  // 1) Create mint account + initialize as SPL token with 6 decimals.
  const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();
  await send(
    [
      getCreateAccountInstruction({
        payer,
        newAccount: mint,
        lamports: mintRent,
        space: 82n,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint: mint.address,
        decimals: MINT_DECIMALS,
        mintAuthority: payer.address,
        freezeAuthority: null,
      }),
    ],
    "create + init mint"
  );

  // 2) Create target owner's ATA for this mint.
  const [ownerAta] = await findAssociatedTokenPda({
    mint: mint.address,
    owner: targetOwner as Address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  await send(
    [
      await getCreateAssociatedTokenInstructionAsync({
        payer,
        owner: targetOwner as Address,
        mint: mint.address,
      }),
    ],
    `create owner ATA (${ownerAta})`
  );

  // 3) Mint tokens into owner's ATA.
  await send(
    [
      getMintToInstruction({
        mint: mint.address,
        token: ownerAta,
        mintAuthority: payer,
        amount: MINT_AMOUNT,
      }),
    ],
    `mint ${MINT_AMOUNT} raw units to owner ATA`
  );

  console.log("\n=== READY ===");
  console.log("Mint address (use in form):");
  console.log(mint.address);
  console.log("\nOwner ATA:", ownerAta);
  console.log("Balance:  ", MINT_AMOUNT, "raw (", Number(MINT_AMOUNT) / 1e6, "USDC-equivalent)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
