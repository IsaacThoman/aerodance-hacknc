// Battle lifecycle + phone-as-wallet. Shared by the bot and the HTTP API.
import { Keypair } from "@solana/web3.js";
import { battles, playerToken, shortId, wallets, type Battle, type Result, type Wallet } from "./store.ts";
import { buildMemo, explorerTx, fundFromTreasury, getBalanceSol, memoStatus, sendMemo } from "./solana.ts";

export const BATTLE_BASE_URL = (process.env.BATTLE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const RESULT_GRACE_MS = 90_000;
const RECEIPT_RETRY_MS = 30_000;

// Wired by index.ts so this module doesn't depend on Spectrum directly.
export type Notify = (handle: string, text: string, opts?: { celebrate?: boolean }) => Promise<void>;
let notify: Notify = async () => {};
export function setNotifier(fn: Notify) {
  notify = fn;
}

const log = (...args: unknown[]) => console.log("[battles]", ...args);

// ---------- wallets ----------

export function getWallet(handle: string): Wallet | undefined {
  return wallets.data[handle];
}

// Phone number = identity = wallet. Returns isNew so the bot can say hello.
export function ensureWallet(handle: string): { wallet: Wallet; isNew: boolean } {
  const existing = wallets.data[handle];
  if (existing) return { wallet: existing, isNew: false };
  const kp = Keypair.generate();
  const wallet: Wallet = {
    address: kp.publicKey.toBase58(),
    secretKey: Array.from(kp.secretKey),
    createdAt: new Date().toISOString(),
  };
  wallets.data[handle] = wallet;
  void wallets.save();
  void fundWallet(handle);
  return { wallet, isNew: true };
}

const funding = new Set<string>();

export async function fundWallet(handle: string): Promise<void> {
  const wallet = wallets.data[handle];
  if (!wallet || wallet.fundedSig || funding.has(handle)) return;
  funding.add(handle);
  try {
    // A timed-out transfer may still have landed; don't double-fund.
    if ((await getBalanceSol(wallet.address)) > 0) {
      wallet.fundedSig = "already-funded";
    } else {
      wallet.fundedSig = await fundFromTreasury(wallet.address);
      log("funded", wallet.address, wallet.fundedSig);
    }
    await wallets.save();
  } catch (err) {
    log("funding failed for", wallet.address, (err as Error).message);
  } finally {
    funding.delete(handle);
  }
}

// ---------- battles ----------

export function battleUrl(battleId: string, token: string): string {
  return `${BATTLE_BASE_URL}/battle/${battleId}?p=${encodeURIComponent(token)}`;
}

export function createBattle(handles: (string | undefined)[]): Battle {
  let id = shortId();
  while (battles.data[id]) id = shortId();
  const battle: Battle = {
    id,
    createdAt: new Date().toISOString(),
    status: "open",
    players: handles.map((handle) => ({ token: playerToken(), ...(handle ? { handle } : {}) })),
  };
  battles.data[id] = battle;
  void battles.save();
  return battle;
}

// Public view: no handles, ever.
export function publicBattle(b: Battle) {
  return {
    id: b.id,
    status: b.status,
    createdAt: b.createdAt,
    players: b.players.map((p) => ({
      token: p.token,
      wallet: p.handle ? wallets.data[p.handle]?.address ?? null : null,
      result: p.result ?? null,
    })),
    winnerToken: b.winnerToken,
    receipt: b.receipt
      ? b.receipt.status === "confirmed"
        ? { status: "confirmed", signature: b.receipt.signature, explorer: explorerTx(b.receipt.signature!) }
        : { status: "pending", signature: null, explorer: null }
      : null,
  };
}

export class BattleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function reportResult(battleId: string, token: string, r: Omit<Result, "at">): Battle {
  const battle = battles.data[battleId];
  if (!battle) throw new BattleError(404, "battle not found");
  if (battle.status !== "open") throw new BattleError(409, "battle already finished");
  const player = battle.players.find((p) => p.token === token);
  if (!player) throw new BattleError(403, "unknown player token");
  if (player.result) throw new BattleError(409, "result already reported");

  player.result = { ...r, at: new Date().toISOString() };
  battle.firstResultAt ??= player.result.at;
  void battles.save();

  if (battle.players.every((p) => p.result)) void finalize(battle);
  return battle;
}

// Label used on-chain: the player's devnet wallet if they have one (phone → wallet),
// otherwise their seat number. Tokens and phones never go on-chain.
function chainLabel(b: Battle, i: number): string {
  const handle = b.players[i]!.handle;
  return (handle && wallets.data[handle]?.address) || `p${i + 1}`;
}

const inFlight = new Set<string>();

async function finalize(battle: Battle): Promise<void> {
  if (battle.status !== "open") return;
  battle.status = "finalizing";
  inFlight.add(battle.id);
  try {
    await settle(battle);
  } finally {
    inFlight.delete(battle.id);
  }
}

async function settle(battle: Battle): Promise<void> {
  const reported = battle.players.filter((p) => p.result);
  const top = Math.max(...reported.map((p) => p.result!.score));
  const leaders = reported.filter((p) => p.result!.score === top);
  battle.winnerToken = leaders.length === 1 ? leaders[0]!.token : null;
  battle.receipt ??= { status: "pending", attempts: 0 }; // keep a signature from a crashed attempt
  await battles.save();

  const landed = await tryReceipt(battle, 20_000);
  battle.status = "finished";
  battle.receipt.notified = landed;
  await battles.save();
  log(`finished ${battle.id}`, landed ? battle.receipt.signature : "(receipt pending)");

  await Promise.all(
    battle.players.map(async (p) => {
      if (!p.handle) return;
      const won = battle.winnerToken === p.token;
      const lines = [
        battle.winnerToken === null ? "🫧 It's a tie! Perfectly in sync 🐠🐠" : won ? "🏆 You WON the battle! 🫧✨" : "🐠 So close! The reef salutes you 🫧",
        p.result
          ? `Your score: ${p.result.score} (pops ${p.result.pops} · sync ${p.result.sync} · flair ${p.result.flair})`
          : "We didn't get a score from you this round.",
        landed
          ? `On-chain receipt 🔗 ${explorerTx(battle.receipt!.signature!)}`
          : "On-chain receipt is pending 🫧 I'll text you the link once it lands.",
        "Text 'battle' to go again!",
      ];
      await notify(p.handle, lines.join("\n"), { celebrate: won });
    }),
  );
}

// One attempt to get the memo confirmed. Returns true once it's on-chain.
async function tryReceipt(battle: Battle, waitMs: number): Promise<boolean> {
  const receipt = battle.receipt!;
  receipt.attempts++;
  try {
    let signed =
      receipt.signature && receipt.tx && receipt.lastValidBlockHeight
        ? { signature: receipt.signature, tx: receipt.tx, lastValidBlockHeight: receipt.lastValidBlockHeight }
        : undefined;

    if (receipt.status === "confirmed") return true;
    if (signed) {
      const status = await memoStatus(signed);
      if (status === "confirmed") return markConfirmed(battle);
      if (status === "expired") signed = undefined;
    }
    if (!signed) {
      const scores = Object.fromEntries(
        battle.players.map((p, i) => [chainLabel(battle, i), p.result?.score ?? null]),
      );
      signed = await buildMemo(JSON.stringify({ app: "aerodance", battleId: battle.id, scores }));
      Object.assign(receipt, signed);
      await battles.save();
    }

    await sendMemo(signed);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const status = await memoStatus(signed);
      if (status === "confirmed") return markConfirmed(battle);
      if (status === "expired") break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    log(`receipt attempt ${receipt.attempts} for ${battle.id} failed:`, (err as Error).message.split("\n")[0]);
  }
  await battles.save();
  return false;
}

async function markConfirmed(battle: Battle): Promise<true> {
  battle.receipt!.status = "confirmed";
  delete battle.receipt!.tx;
  await battles.save();
  return true;
}

// ---------- background sweeper ----------
// Finalizes battles whose grace window passed and retries pending receipts.

let lastReceiptSweep = 0;
let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();
    for (const b of Object.values(battles.data)) {
      // "finalizing" after a restart means we crashed mid-finalize: resume it.
      if (b.status === "finalizing" && !inFlight.has(b.id)) b.status = "open";
      if (b.status === "open" && b.firstResultAt && now - Date.parse(b.firstResultAt) >= RESULT_GRACE_MS) {
        await finalize(b);
      }
    }
    if (now - lastReceiptSweep < RECEIPT_RETRY_MS) return;
    lastReceiptSweep = now;
    for (const b of Object.values(battles.data)) {
      if (b.status !== "finished" || !b.receipt || (b.receipt.status === "confirmed" && b.receipt.notified)) continue;
      if (b.receipt.status === "pending" && !(await tryReceipt(b, 15_000))) continue;
      b.receipt.notified = true;
      await battles.save();
      for (const p of b.players) {
        if (p.handle) await notify(p.handle, `🔗 Your battle ${b.id} receipt just landed on Solana devnet 🫧\n${explorerTx(b.receipt.signature!)}`);
      }
    }
  } catch (err) {
    log("sweep error:", (err as Error).message);
  } finally {
    sweeping = false;
  }
}

export function startSweeper(): void {
  setInterval(() => void sweep(), 5_000).unref();
}
