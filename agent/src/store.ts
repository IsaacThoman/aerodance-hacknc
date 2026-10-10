// Tiny JSON-file persistence under agent/data/. Everything lives in memory and
// is flushed atomically (write temp file, then rename) after each change.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export const DATA_DIR = join(import.meta.dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

class JsonFile<T> {
  data: T;
  private path: string;
  private chain: Promise<void> = Promise.resolve();

  constructor(name: string, initial: T) {
    this.path = join(DATA_DIR, name);
    this.data = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as T)
      : initial;
  }

  // Writes are serialized so two quick saves never interleave.
  save(): Promise<void> {
    const snapshot = JSON.stringify(this.data, null, 2);
    this.chain = this.chain.then(async () => {
      const tmp = `${this.path}.${process.pid}.tmp`;
      await writeFile(tmp, snapshot, { mode: 0o600 });
      await rename(tmp, this.path);
    });
    return this.chain;
  }
}

// ---------- types ----------

export type Wallet = {
  address: string;
  secretKey: number[]; // solana-keygen format
  createdAt: string;
  fundedSig?: string;
};

export type Result = {
  score: number;
  pops: number;
  sync: number;
  flair: number;
  at: string;
};

// A person. Phone is optional; the profile id is the real identity.
export type Profile = {
  id: string;
  name: string;
  phone?: string; // E.164; only ever shown back to its owner
  photon?: "registered" | "failed"; // Photon allowlist registration
  decorated?: boolean; // got the chat background + contact card
  walletKey: string; // key into wallets.json
  deviceTokens: string[]; // browsers signed in as this profile
  createdAt: string;
  stats: { battles: number; wins: number; bestScore: number; pops: number; hypeCount: number; hypeSol: number };
};

export type Player = {
  token: string; // result-reporting credential, held by the game display
  profileId?: string; // set when someone claims the seat
  result?: Result;
};

export type Hype = { from: string; seat: number; sol: number; signature: string; at: string };

export type Receipt = {
  status: "pending" | "confirmed";
  signature?: string;
  tx?: string; // base64 signed tx, so retries resend the same signature
  lastValidBlockHeight?: number;
  attempts: number;
  notified?: boolean; // players got the explorer link
};

export type Battle = {
  id: string;
  createdAt: string;
  status: "open" | "finalizing" | "finished";
  players: Player[];
  hype?: Hype[];
  spectators?: string[]; // profile ids
  firstResultAt?: string;
  winnerToken?: string | null; // null = tie
  receipt?: Receipt;
};

// ---------- files ----------

export const wallets = new JsonFile<Record<string, Wallet>>("wallets.json", {});
export const profiles = new JsonFile<Record<string, Profile>>("profiles.json", {});
export const battles = new JsonFile<Record<string, Battle>>("battles.json", {});
const seen = new JsonFile<string[]>("seen.json", []);
const seenSet = new Set(seen.data);

// Returns true the first time an inbound message id is seen.
export function markSeen(messageId: string): boolean {
  if (seenSet.has(messageId)) return false;
  seenSet.add(messageId);
  seen.data.push(messageId);
  if (seen.data.length > 2000) seenSet.delete(seen.data.shift()!);
  void seen.save();
  return true;
}

// ---------- ids ----------

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

export function shortId(length = 6): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

export function playerToken(): string {
  return randomBytes(16).toString("base64url");
}
