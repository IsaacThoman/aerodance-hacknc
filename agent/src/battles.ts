// After the app settles a battle: write the on-chain receipt, text the players, and mint
// the winner's trophy NFT.
import { Keypair } from "@solana/web3.js";
import { getProfile, notifyChange, pool } from "./db.ts";
import { Retry, enqueue, handle } from "./jobs.ts";
import { mintTrophy } from "./nft.ts";
import { notify, walletOf } from "./players.ts";
import { buildMemo, explorerAddress, explorerTx, memoStatus, sendMemo, type SignedMemo } from "./solana.ts";

const RECEIPT_RETRY_MS = 30_000;
const TROPHY_RETRY_MS = 30_000;
// Where the trophy's metadata lives (served by the app at /nft/<id>.json).
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
const log = (...args: unknown[]) => console.log("[battles]", ...args);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

type Seat = {
  seat: number;
  profile_id: string | null;
  score: number | null;
  pops: number | null;
  sync: number | null;
  flair: number | null;
  reported_at: Date | null;
};
type BattleRow = {
  id: string;
  winner_seat: number | null;
  receipt_status: string | null;
  receipt_signature: string | null;
  receipt_tx: string | null;
  receipt_last_valid: string | null; // BIGINT
  trophy_status: string | null;
  trophy_owner: string | null;
  trophy_asset_secret: Buffer | null;
  trophy_asset: string | null;
};

const getBattle = async (id: string) =>
  (await pool.query<BattleRow>("SELECT * FROM battles WHERE id = $1 AND status = 'finished'", [id])).rows[0];
const getSeats = async (id: string) =>
  (await pool.query<Seat>("SELECT * FROM battle_seats WHERE battle_id = $1 ORDER BY seat", [id])).rows;

// Label used on-chain: the player's devnet wallet if they have one, otherwise their seat
// number. Tokens, names and phones never go on-chain.
async function chainLabel(s: Seat): Promise<string> {
  return (s.profile_id && (await walletOf(s.profile_id))?.address) || `p${s.seat + 1}`;
}

// One attempt to get the memo confirmed. Returns true once it's on-chain.
async function tryReceipt(battleId: string, waitMs: number): Promise<boolean> {
  const b = await getBattle(battleId);
  if (!b) return false;
  if (b.receipt_status === "confirmed") return true;
  await pool.query("UPDATE battles SET receipt_attempts = receipt_attempts + 1 WHERE id = $1", [battleId]);
  try {
    let signed: SignedMemo | undefined =
      b.receipt_signature && b.receipt_tx && b.receipt_last_valid
        ? { signature: b.receipt_signature, tx: b.receipt_tx, lastValidBlockHeight: Number(b.receipt_last_valid) }
        : undefined;

    if (signed) {
      const status = await memoStatus(signed);
      if (status === "confirmed") return markConfirmed(battleId);
      if (status === "expired") signed = undefined;
    }
    if (!signed) {
      const seats = await getSeats(battleId);
      const scores = Object.fromEntries(await Promise.all(seats.map(async (s) => [await chainLabel(s), s.score] as const)));
      signed = await buildMemo(JSON.stringify({ app: "aerodance", battleId, scores }));
      await pool.query(
        "UPDATE battles SET receipt_signature = $2, receipt_tx = $3, receipt_last_valid = $4 WHERE id = $1",
        [battleId, signed.signature, signed.tx, signed.lastValidBlockHeight],
      );
    }

    await sendMemo(signed);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const status = await memoStatus(signed);
      if (status === "confirmed") return markConfirmed(battleId);
      if (status === "expired") break;
      await new Promise((r) => setTimeout(r, 1500));
    }
  } catch (err) {
    log(`receipt for ${battleId} not sent:`, (err as Error).message.split("\n")[0]);
  }
  return false;
}

async function markConfirmed(battleId: string): Promise<true> {
  await pool.query("UPDATE battles SET receipt_status = 'confirmed', receipt_tx = NULL WHERE id = $1", [battleId]);
  await notifyChange({ battle: battleId });
  log(`receipt for ${battleId} confirmed`);
  return true;
}

// ---------- trophy NFTs ----------

// The winner's seat needs a profile with a wallet to receive it; ties get no trophy.
async function startTrophy(battle: BattleRow): Promise<void> {
  if (battle.trophy_status || battle.winner_seat === null) return;
  const seat = (await getSeats(battle.id)).find((s) => s.seat === battle.winner_seat);
  const wallet = seat?.profile_id ? await walletOf(seat.profile_id) : undefined;
  if (!wallet) return;
  await pool.query(
    `UPDATE battles SET trophy_status = 'pending', trophy_owner = $2, trophy_asset_secret = $3
      WHERE id = $1 AND trophy_status IS NULL`,
    [battle.id, wallet.address, Buffer.from(Keypair.generate().secretKey)],
  );
  await notifyChange({ battle: battle.id });
}

// One attempt to mint. Returns true once minted (or if there's nothing to mint).
async function tryTrophy(battleId: string): Promise<boolean> {
  const b = await getBattle(battleId);
  if (!b?.trophy_status || b.trophy_status === "minted") return true;
  await pool.query("UPDATE battles SET trophy_attempts = trophy_attempts + 1 WHERE id = $1", [battleId]);
  let asset: string;
  try {
    ({ asset } = await mintTrophy(
      new Uint8Array(b.trophy_asset_secret!),
      b.trophy_owner!,
      `aerodance trophy #${battleId}`,
      `${PUBLIC_URL}/nft/${battleId}.json`,
    ));
  } catch (err) {
    log(`trophy for ${battleId} not minted:`, (err as Error).message.split("\n")[0]);
    return false;
  }
  await pool.query(
    "UPDATE battles SET trophy_status = 'minted', trophy_asset = $2, trophy_asset_secret = NULL WHERE id = $1",
    [battleId, asset],
  );
  await notifyChange({ battle: battleId });
  log(`trophy for ${battleId}: ${asset}`);
  const winner = (await getSeats(battleId)).find((s) => s.seat === b.winner_seat);
  await notify(
    await getProfile(winner?.profile_id),
    `🏆 Your trophy NFT for battle ${battleId} just landed in your wallet 🫧\n${explorerAddress(asset)}`,
  );
  return true;
}

handle("trophy", async ({ battleId }: { battleId: string }) => {
  if (!(await tryTrophy(battleId))) throw new Retry("trophy still pending", TROPHY_RETRY_MS);
});

// First try at the receipt, then the results text (with the link if it landed in time).
handle("battle_finished", async ({ battleId }: { battleId: string }) => {
  const battle = await getBattle(battleId);
  if (!battle) return;
  await startTrophy(battle);
  const landed = await tryReceipt(battleId, 20_000);
  if (!landed) await enqueue("receipt", { battleId }, RECEIPT_RETRY_MS);
  const signature = landed ? (await getBattle(battleId))!.receipt_signature! : null;

  const { rows: hype } = await pool.query<{ seat: number; count: number }>(
    "SELECT seat, count(*)::int AS count FROM hype WHERE battle_id = $1 GROUP BY seat",
    [battleId],
  );
  for (const s of await getSeats(battleId)) {
    const profile = await getProfile(s.profile_id);
    if (!profile?.phone) continue;
    const won = battle.winner_seat === s.seat;
    const hypeCount = hype.find((h) => h.seat === s.seat)?.count ?? 0;
    const lines = [
      battle.winner_seat === null
        ? "🫧 It's a tie! Perfectly in sync 🐠🐠"
        : won
          ? `🏆 ${profile.name}, you WON the battle! 🫧✨`
          : `🐠 So close, ${profile.name}! The reef salutes you 🫧`,
      s.reported_at
        ? `Your score: ${s.score} (pops ${s.pops} · sync ${s.sync} · flair ${s.flair})`
        : "We didn't get a score from you this round.",
      ...(hypeCount ? [`📣 The crowd hyped you ${hypeCount}× (+${round(hypeCount * 0.005)} devnet SOL)`] : []),
      signature
        ? `On-chain receipt 🔗 ${explorerTx(signature)}`
        : "On-chain receipt is pending 🫧 I'll text you the link once it lands.",
      "Text 'battle' to go again!",
    ];
    await notify(profile, lines.join("\n"), { celebrate: won });
  }
  if (!(await tryTrophy(battleId))) await enqueue("trophy", { battleId }, TROPHY_RETRY_MS);
});

// Retries every 30 s until the memo lands, then sends everyone the link.
handle("receipt", async ({ battleId }: { battleId: string }) => {
  if (!(await getBattle(battleId))) return;
  if (!(await tryReceipt(battleId, 15_000))) throw new Retry("receipt still pending", RECEIPT_RETRY_MS);
  const { receipt_signature } = (await getBattle(battleId))!;
  for (const s of await getSeats(battleId)) {
    await notify(
      await getProfile(s.profile_id),
      `🔗 Your battle ${battleId} receipt just landed on Solana devnet 🫧\n${explorerTx(receipt_signature!)}`,
    );
  }
});
