// Battle lifecycle: seats, spectators, hype, results and on-chain receipts.
import { Keypair } from "@solana/web3.js";
import { battles, playerToken, profiles, shortId, type Battle, type Profile, type Result } from "./store.ts";
import { buildMemo, explorerAddress, explorerTx, memoStatus, sendHype, sendMemo } from "./solana.ts";
import { mintTrophy } from "./nft.ts";
import { publicUrl } from "./urls.ts";
import { fundPendingWallets, getProfile, notify, walletOf } from "./players.ts";

export const BATTLE_BASE_URL = (process.env.BATTLE_BASE_URL || "http://localhost:5173").replace(/\/$/, "");
const RESULT_GRACE_MS = 90_000;
const RECEIPT_RETRY_MS = 30_000;
export const HYPE_SOL = 0.005;

const log = (...args: unknown[]) => console.log("[battles]", ...args);

export function battleUrl(battleId: string, token: string): string {
  return `${BATTLE_BASE_URL}/battle/${battleId}?p=${encodeURIComponent(token)}`;
}

// Seats may start claimed (bot battles) or empty (claimed by scanning the QR).
export function createBattle(seats: (string | undefined)[]): Battle {
  let id = shortId();
  while (battles.data[id]) id = shortId();
  const battle: Battle = {
    id,
    createdAt: new Date().toISOString(),
    status: "open",
    players: seats.map((profileId) => ({ token: playerToken(), ...(profileId ? { profileId } : {}) })),
    hype: [],
    spectators: [],
  };
  battles.data[id] = battle;
  void battles.save();
  return battle;
}

const seatProfile = (b: Battle, seat: number) => getProfile(b.players[seat]?.profileId);

// Public view for the display and every phone: names and seats, no tokens or phones.
export function publicBattle(b: Battle) {
  const winnerSeat = b.winnerToken ? b.players.findIndex((p) => p.token === b.winnerToken) : null;
  return {
    id: b.id,
    status: b.status,
    createdAt: b.createdAt,
    players: b.players.map((p, seat) => {
      const profile = getProfile(p.profileId);
      const hype = (b.hype ?? []).filter((h) => h.seat === seat);
      return {
        seat,
        name: profile?.name ?? null,
        wallet: profile ? walletOf(profile)?.address ?? null : null,
        result: p.result ?? null,
        hype: { count: hype.length, sol: round(hype.reduce((sum, h) => sum + h.sol, 0)) },
      };
    }),
    spectators: (b.spectators ?? []).length,
    winnerSeat: b.status === "finished" ? winnerSeat : null, // null + finished = tie
    receipt: b.receipt
      ? b.receipt.status === "confirmed"
        ? { status: "confirmed", signature: b.receipt.signature, explorer: explorerTx(b.receipt.signature!) }
        : { status: "pending", signature: null, explorer: null }
      : null,
    trophy: b.trophy
      ? b.trophy.status === "minted"
        ? { status: "minted", asset: b.trophy.asset, explorer: explorerAddress(b.trophy.asset!) }
        : { status: "pending", asset: null, explorer: null }
      : null,
  };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

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

// First people to scan get the empty seats; everyone after spectates.
export function joinBattle(battleId: string, profile: Profile): { role: "dancer" | "spectator"; seat: number | null } {
  const battle = battles.data[battleId];
  if (!battle) throw new BattleError(404, "battle not found");
  const mine = battle.players.findIndex((p) => p.profileId === profile.id);
  if (mine >= 0) return { role: "dancer", seat: mine };
  const free = battle.status === "open" && !battle.firstResultAt ? battle.players.findIndex((p) => !p.profileId) : -1;
  if (free >= 0) {
    battle.players[free]!.profileId = profile.id;
  } else if (!(battle.spectators ??= []).includes(profile.id)) {
    battle.spectators.push(profile.id);
  }
  void battles.save();
  return free >= 0 ? { role: "dancer", seat: free } : { role: "spectator", seat: null };
}

// A spectator tips a dancer real devnet SOL from their own wallet.
export async function hypeDancer(battleId: string, from: Profile, seat: number) {
  const battle = battles.data[battleId];
  if (!battle) throw new BattleError(404, "battle not found");
  if (battle.status === "finished") throw new BattleError(409, "battle already finished");
  if (battle.players.some((p) => p.profileId === from.id)) throw new BattleError(403, "dancers can't hype");
  const dancer = seatProfile(battle, seat);
  const to = dancer && walletOf(dancer);
  if (!to) throw new BattleError(409, "that seat is empty");
  const fromWallet = walletOf(from);
  if (!fromWallet) throw new BattleError(409, "no wallet yet");

  let signature: string;
  try {
    signature = await sendHype(fromWallet.secretKey, to.address, HYPE_SOL, JSON.stringify({ app: "aerodance", battleId, hype: seat }));
  } catch (err) {
    const msg = (err as Error).message;
    log(`hype from ${from.id} failed:`, msg.split("\n")[0]);
    throw new BattleError(/insufficient|debit|no record/i.test(msg) ? 402 : 503, /insufficient|debit|no record/i.test(msg) ? "out of hype SOL" : "Solana is slow, try again");
  }
  (battle.hype ??= []).push({ from: from.id, seat, sol: HYPE_SOL, signature, at: new Date().toISOString() });
  await battles.save();
  return { signature, explorer: explorerTx(signature) };
}

// Label used on-chain: the player's devnet wallet if they have one (phone → wallet),
// otherwise their seat number. Tokens, names and phones never go on-chain.
function chainLabel(b: Battle, i: number): string {
  const profile = seatProfile(b, i);
  return (profile && walletOf(profile)?.address) || `p${i + 1}`;
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

  recordStats(battle);
  startTrophy(battle);
  await Promise.all(
    battle.players.map(async (p, seat) => {
      const profile = getProfile(p.profileId);
      if (!profile?.phone) return;
      const won = battle.winnerToken === p.token;
      const hype = (battle.hype ?? []).filter((h) => h.seat === seat);
      const lines = [
        battle.winnerToken === null ? "🫧 It's a tie! Perfectly in sync 🐠🐠" : won ? `🏆 ${profile.name}, you WON the battle! 🫧✨` : `🐠 So close, ${profile.name}! The reef salutes you 🫧`,
        p.result
          ? `Your score: ${p.result.score} (pops ${p.result.pops} · sync ${p.result.sync} · flair ${p.result.flair})`
          : "We didn't get a score from you this round.",
        ...(hype.length ? [`📣 The crowd hyped you ${hype.length}× (+${round(hype.length * HYPE_SOL)} devnet SOL)`] : []),
        landed
          ? `On-chain receipt 🔗 ${explorerTx(battle.receipt!.signature!)}`
          : "On-chain receipt is pending 🫧 I'll text you the link once it lands.",
        "Text 'battle' to go again!",
      ];
      await notify(profile, lines.join("\n"), { celebrate: won });
    }),
  );
  await tryTrophy(battle);
}

// ---------- trophy NFTs ----------

function startTrophy(battle: Battle): void {
  if (battle.trophy || !battle.winnerToken) return;
  const seat = battle.players.findIndex((p) => p.token === battle.winnerToken);
  const winner = seatProfile(battle, seat);
  const wallet = winner && walletOf(winner);
  if (!wallet) return; // a seat nobody claimed has no wallet to receive it
  battle.trophy = { status: "pending", seat, owner: wallet.address, assetSecret: Array.from(Keypair.generate().secretKey), attempts: 0 };
  void battles.save();
}

async function tryTrophy(battle: Battle): Promise<void> {
  const trophy = battle.trophy;
  if (!trophy || trophy.status === "minted") return;
  trophy.attempts++;
  try {
    const { asset, signature } = await mintTrophy(trophy.assetSecret!, trophy.owner, `aerodance trophy #${battle.id}`, `${publicUrl()}/nft/${battle.id}.json`);
    Object.assign(trophy, { status: "minted", asset, signature });
    delete trophy.assetSecret;
    await battles.save();
    log(`trophy for ${battle.id}: ${asset}`);
  } catch (err) {
    log(`trophy attempt ${trophy.attempts} for ${battle.id} failed:`, (err as Error).message.split("\n")[0]);
    await battles.save();
    return;
  }
  const winner = seatProfile(battle, trophy.seat);
  await notify(winner, `🏆 Your trophy NFT for battle ${battle.id} just landed in your wallet 🫧\n${explorerAddress(trophy.asset!)}`);
  trophy.notified = true;
  await battles.save();
}

// Off-chain metadata the NFT's uri points to (Metaplex JSON standard).
export function trophyMetadata(battle: Battle) {
  const trophy = battle.trophy;
  if (!trophy) return undefined;
  const winner = battle.players[trophy.seat];
  const result = winner?.result;
  const hype = (battle.hype ?? []).filter((h) => h.seat === trophy.seat);
  const image = `${publicUrl()}/app/trophy.png`;
  return {
    name: `aerodance trophy #${battle.id}`,
    symbol: "AERO",
    description: `Won dance battle ${battle.id} on aerodance 🫧 Frutiger Aero dance battles, scored live.`,
    image,
    external_url: publicUrl(),
    attributes: [
      { trait_type: "battle", value: battle.id },
      { trait_type: "dancers", value: battle.players.length },
      { trait_type: "score", value: result?.score ?? 0 },
      { trait_type: "pops", value: result?.pops ?? 0 },
      { trait_type: "sync", value: result?.sync ?? 0 },
      { trait_type: "flair", value: result?.flair ?? 0 },
      { trait_type: "hype", value: hype.length },
      { trait_type: "date", value: battle.createdAt.slice(0, 10) },
    ],
    properties: { category: "image", files: [{ uri: image, type: "image/png" }] },
  };
}

function recordStats(battle: Battle): void {
  battle.players.forEach((p, seat) => {
    const profile = getProfile(p.profileId);
    if (!profile) return;
    const hype = (battle.hype ?? []).filter((h) => h.seat === seat);
    const s = profile.stats;
    s.battles++;
    if (battle.winnerToken === p.token) s.wins++;
    s.bestScore = Math.max(s.bestScore, p.result?.score ?? 0);
    s.pops += p.result?.pops ?? 0;
    s.hypeCount += hype.length;
    s.hypeSol = round(s.hypeSol + hype.length * HYPE_SOL);
  });
  void profiles.save();
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
// Finalizes battles whose grace window passed, retries pending receipts and unfunded wallets.

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
    await fundPendingWallets();
    for (const b of Object.values(battles.data)) {
      if (b.status === "finished" && b.trophy?.status === "pending") await tryTrophy(b);
    }
    for (const b of Object.values(battles.data)) {
      if (b.status !== "finished" || !b.receipt || (b.receipt.status === "confirmed" && b.receipt.notified)) continue;
      if (b.receipt.status === "pending" && !(await tryReceipt(b, 15_000))) continue;
      b.receipt.notified = true;
      await battles.save();
      for (const p of b.players) {
        await notify(getProfile(p.profileId), `🔗 Your battle ${b.id} receipt just landed on Solana devnet 🫧\n${explorerTx(b.receipt.signature!)}`);
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
