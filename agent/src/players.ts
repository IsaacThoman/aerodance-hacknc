// Wallets, iMessage linking, and the notifier used to text players.
import { Keypair } from "@solana/web3.js";
import { getProfile, pool, updateProfile, type Profile } from "./db.ts";
import { handle } from "./jobs.ts";
import { fundFromTreasury, getBalanceSol } from "./solana.ts";
import { photonEnabled, registerPhotonUser } from "./photon.ts";

const log = (...args: unknown[]) => console.log("[players]", ...args);
export const mask = (phone: string) => `…${phone.slice(-4)}`;

// ---------- notifier (wired to Spectrum by index.ts) ----------

export type Notify = (phone: string, text: string, opts?: { celebrate?: boolean }) => Promise<void>;
let notifier: Notify | undefined;
export const imessageEnabled = () => !!notifier;
export function setNotifier(fn: Notify) {
  notifier = fn;
}
export function notify(profile: Profile | undefined, text: string, opts?: { celebrate?: boolean }): Promise<void> {
  if (!profile?.phone) return Promise.resolve();
  if (!notifier) {
    log(`(iMessage off) would text ${mask(profile.phone)}: ${text.split("\n")[0]}`);
    return Promise.resolve();
  }
  return notifier(profile.phone, text, opts);
}

// ---------- wallets ----------

export type Wallet = { address: string; secretKey: Uint8Array; fundedSig: string | null };

export async function walletOf(profileId: string): Promise<Wallet | undefined> {
  const { rows } = await pool.query<{ address: string; secret_key: Buffer; funded_sig: string | null }>(
    "SELECT address, secret_key, funded_sig FROM wallets WHERE profile_id = $1",
    [profileId],
  );
  const w = rows[0];
  return w && { address: w.address, secretKey: new Uint8Array(w.secret_key), fundedSig: w.funded_sig };
}

export async function ensureWallet(profileId: string): Promise<Wallet> {
  const existing = await walletOf(profileId);
  if (existing) return existing;
  const kp = Keypair.generate();
  await pool.query(
    "INSERT INTO wallets (profile_id, address, secret_key) VALUES ($1, $2, $3) ON CONFLICT (profile_id) DO NOTHING",
    [profileId, kp.publicKey.toBase58(), Buffer.from(kp.secretKey)],
  );
  return (await walletOf(profileId))!; // whoever won a race
}

const funding = new Set<string>();

// Throws if funding failed, so the wallet job retries.
export async function fundWallet(profileId: string): Promise<void> {
  const wallet = await ensureWallet(profileId);
  if (wallet.fundedSig || funding.has(profileId)) return;
  funding.add(profileId);
  try {
    // A timed-out transfer may still have landed; don't double-fund.
    let sig = "already-funded";
    if ((await getBalanceSol(wallet.address)) === 0) {
      sig = await fundFromTreasury(wallet.address);
      log("funded", wallet.address, sig);
    }
    await pool.query("UPDATE wallets SET funded_sig = $2 WHERE profile_id = $1", [profileId, sig]);
  } finally {
    funding.delete(profileId);
  }
}

handle("wallet", async ({ profileId }: { profileId: string }) => {
  if (await getProfile(profileId)) await fundWallet(profileId);
});

// ---------- iMessage linking ----------

// Put the number on Photon's allowlist. Photon only delivers once the player has texted
// their assigned line, so until then the phone view shows a "text the bot" button.
handle("link_phone", async ({ profileId }: { profileId: string }) => {
  const profile = await getProfile(profileId);
  if (!profile?.phone) return;
  if (!imessageEnabled()) return updateProfile(profile.id, { imessage: "off" });
  try {
    const user = photonEnabled() ? await registerPhotonUser(profile.phone, profile.name) : undefined;
    await updateProfile(profile.id, {
      imessage: "registered",
      ...(user?.line ? { line: user.line } : {}),
      ...(user?.optedIn ? { opted_in: true } : {}),
    });
    if (!user?.optedIn && !profile.opted_in) return; // the bot welcomes them when their first text arrives
    await notify(profile, `🫧 Hey ${profile.name}! You're linked to aerodance 🐠\nI'll text you battle results, hype and rewards here. Text 'help' anytime.`);
  } catch (err) {
    await updateProfile(profile.id, { imessage: "failed" });
    log(`photon registration for ${mask(profile.phone)} failed:`, (err as Error).message);
  }
});
