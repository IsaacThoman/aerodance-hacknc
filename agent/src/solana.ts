// Devnet-only Solana helpers: treasury, transfers, and memo receipts.
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createMemoInstruction } from "@solana/spl-memo";
import bs58 from "bs58";

export const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Hard guard: this app must never touch mainnet.
const host = new URL(RPC_URL).hostname;
if (!/devnet/i.test(RPC_URL) && !["localhost", "127.0.0.1", "::1"].includes(host)) {
  throw new Error(`Refusing to start: SOLANA_RPC_URL must be devnet or localhost (got ${host})`);
}

export const connection = new Connection(RPC_URL, "confirmed");
export const NEW_WALLET_SOL = 0.05;

// SOLANA_TREASURY_SECRET: base58 secret key, or the JSON byte array solana-keygen writes.
// One treasury per deployment, kept out of the database. `npm run treasury` makes one.
let treasury: Keypair | null | undefined;
export function loadTreasury(): Keypair | undefined {
  if (treasury === undefined) {
    const raw = process.env.SOLANA_TREASURY_SECRET?.trim();
    treasury = raw ? Keypair.fromSecretKey(raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw)) : null;
  }
  return treasury ?? undefined;
}

function requireTreasury(): Keypair {
  const kp = loadTreasury();
  if (!kp) throw new Error("No treasury: set SOLANA_TREASURY_SECRET (see `npm run treasury`).");
  return kp;
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddress(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export async function getBalanceSol(address: string): Promise<number> {
  const lamports = await withTimeout(connection.getBalance(new PublicKey(address)), 10_000, "getBalance");
  return lamports / LAMPORTS_PER_SOL;
}

export async function fundFromTreasury(address: string, sol = NEW_WALLET_SOL): Promise<string> {
  const treasury = requireTreasury();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasury.publicKey,
      toPubkey: new PublicKey(address),
      lamports: Math.round(sol * LAMPORTS_PER_SOL),
    }),
  );
  return withTimeout(sendAndConfirmTransaction(connection, tx, [treasury]), 30_000, "fund");
}

// Spectator → dancer tip. The sender's own wallet pays; the memo tags it on-chain.
export async function sendHype(fromSecret: Uint8Array, toAddress: string, sol: number, memo: string): Promise<string> {
  const from = Keypair.fromSecretKey(fromSecret);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: Math.round(sol * LAMPORTS_PER_SOL),
    }),
    createMemoInstruction(memo, [from.publicKey]),
  );
  return withTimeout(sendAndConfirmTransaction(connection, tx, [from]), 20_000, "hype");
}

// ---------- memo receipts ----------
// Built and signed once, then (re)sent by raw bytes, so a retry can never
// produce a second memo while the first one might still land.

export type SignedMemo = { signature: string; tx: string; lastValidBlockHeight: number };

export async function buildMemo(memo: string): Promise<SignedMemo> {
  const treasury = requireTreasury();
  const { blockhash, lastValidBlockHeight } = await withTimeout(
    connection.getLatestBlockhash("confirmed"),
    10_000,
    "getLatestBlockhash",
  );
  const tx = new Transaction({ feePayer: treasury.publicKey, blockhash, lastValidBlockHeight }).add(
    createMemoInstruction(memo, [treasury.publicKey]),
  );
  tx.sign(treasury);
  return {
    signature: bs58.encode(tx.signature!),
    tx: tx.serialize().toString("base64"),
    lastValidBlockHeight,
  };
}

export async function sendMemo(signed: SignedMemo): Promise<void> {
  await withTimeout(
    connection.sendRawTransaction(Buffer.from(signed.tx, "base64"), { skipPreflight: false, maxRetries: 3 }),
    10_000,
    "sendRawTransaction",
  );
}

export async function memoStatus(signed: SignedMemo): Promise<"confirmed" | "pending" | "expired"> {
  const { value } = await withTimeout(
    connection.getSignatureStatuses([signed.signature], { searchTransactionHistory: true }),
    10_000,
    "getSignatureStatuses",
  );
  const status = value[0];
  if (status?.err) return "expired"; // failed on-chain; rebuild
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return "confirmed";
  const height = await withTimeout(connection.getBlockHeight("confirmed"), 10_000, "getBlockHeight");
  return height > signed.lastValidBlockHeight ? "expired" : "pending";
}
