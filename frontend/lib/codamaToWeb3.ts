import { PublicKey, TransactionInstruction } from "@solana/web3.js";

type CodamaAccountMeta = {
  address: string;
  role: number;
};

type CodamaInstruction = {
  programAddress: string;
  accounts: ReadonlyArray<CodamaAccountMeta>;
  data: ArrayLike<number> & { length: number };
};

// @solana/kit AccountRole bit flags: 1 = writable, 2 = signer.
export function codamaToWeb3(ix: CodamaInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: (a.role & 2) !== 0,
      isWritable: (a.role & 1) !== 0,
    })),
    data: Buffer.from(Uint8Array.from(ix.data)),
  });
}
