// Profiles (the person), their wallets, and the notifier used to text them.
import { Keypair } from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import { profiles, shortId, wallets, type Profile, type Wallet } from "./store.ts";
import { explorerAddress, fundFromTreasury, getBalanceSol } from "./solana.ts";
import { photonEnabled, registerPhotonUser } from "./photon.ts";

const log = (...args: unknown[]) => console.log("[players]", ...args);
export const mask = (phone: string) => `…${phone.slice(-4)}`;

// ---------- notifier (wired to Spectrum by index.ts) ----------

export type Notify = (phone: string, text: string, opts?: { celebrate?: boolean }) => Promise<void>;
let notifier: Notify = async () => {};
export function setNotifier(fn: Notify) {
  notifier = fn;
}
export function notify(profile: Profile | undefined, text: string, opts?: { celebrate?: boolean }) {
  return profile?.phone ? notifier(profile.phone, text, opts) : Promise.resolve();
}

// ---------- names & phones ----------

const ADJECTIVES = ["Bubbly", "Glassy", "Aqua", "Sunny", "Dewy", "Glossy", "Breezy", "Crystal", "Misty", "Lagoon", "Shimmer", "Azure"];
const NOUNS = ["Koi", "Dolphin", "Orca", "Jellyfish", "Seahorse", "Fern", "Raindrop", "Cloud", "Bubble", "Lily", "Manta", "Sprout"];
const pick = <T,>(xs: T[]) => xs[randomBytes(1)[0]! % xs.length]!;
export const aeroName = () => `${pick(ADJECTIVES)} ${pick(NOUNS)}`;

export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24);
  return name || undefined;
}

// "(919) 555-0123" → "+19195550123". US default for 10-digit numbers.
export function normalizePhone(raw: string): string | undefined {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

// ---------- profiles ----------

export const getProfile = (id: string | undefined) => (id ? profiles.data[id] : undefined);
export const profileByDevice = (token: string) => Object.values(profiles.data).find((p) => p.deviceTokens.includes(token));
export const profileByPhone = (phone: string) => Object.values(profiles.data).find((p) => p.phone === phone);

function newProfile(fields: { name?: string; phone?: string }): Profile {
  let id = shortId(8);
  while (profiles.data[id]) id = shortId(8);
  const profile: Profile = {
    id,
    name: fields.name ?? aeroName(),
    ...(fields.phone ? { phone: fields.phone } : {}),
    // Texted the bot before profiles existed? Their wallet is keyed by phone: keep it.
    walletKey: fields.phone ?? `profile:${id}`,
    deviceTokens: [],
    createdAt: new Date().toISOString(),
    stats: { battles: 0, wins: 0, bestScore: 0, pops: 0, hypeCount: 0, hypeSol: 0 },
  };
  profiles.data[id] = profile;
  ensureWallet(profile.walletKey);
  return profile;
}

// The bot side: whoever texts us gets a profile keyed by their number.
export function profileForPhone(phone: string): { profile: Profile; isNew: boolean } {
  const existing = profileByPhone(phone);
  if (existing) return { profile: existing, isNew: false };
  const profile = newProfile({ phone });
  profile.photon = "registered"; // they reached us, so the line can reach them
  void profiles.save();
  return { profile, isNew: true };
}

// The join page: create or update the profile behind a device token.
// No phone verification by design: entering a number links to it.
export function upsertProfile(
  deviceToken: string | undefined,
  fields: { name?: string; phone?: string },
): { profile: Profile; deviceToken: string; phoneLinked: boolean } {
  const token = deviceToken && profileByDevice(deviceToken) ? deviceToken : randomBytes(18).toString("base64url");
  let profile = profileByDevice(token);
  let phoneLinked = false;

  if (fields.phone && fields.phone !== profile?.phone) {
    const owner = profileByPhone(fields.phone);
    if (owner) {
      // Returning player on a new device: switch this device to their profile.
      if (profile) profile.deviceTokens = profile.deviceTokens.filter((t) => t !== token);
      profile = owner;
    } else if (profile) {
      profile.phone = fields.phone;
      delete profile.photon;
      phoneLinked = true;
    } else {
      profile = newProfile({ phone: fields.phone });
      phoneLinked = true;
    }
  }
  profile ??= newProfile({});
  if (fields.name) profile.name = fields.name;
  if (!profile.deviceTokens.includes(token)) profile.deviceTokens.push(token);
  void profiles.save();
  if (phoneLinked || (profile.phone && profile.photon !== "registered")) void linkPhone(profile);
  return { profile, deviceToken: token, phoneLinked };
}

// Put the number on Photon's allowlist, then say hi over iMessage.
async function linkPhone(profile: Profile): Promise<void> {
  if (!profile.phone) return;
  try {
    if (photonEnabled()) await registerPhotonUser(profile.phone, profile.name);
    profile.photon = "registered";
    await profiles.save();
    await notify(profile, `🫧 Hey ${profile.name}! You're linked to aerodance 🐠\nI'll text you battle results, hype and rewards here. Text 'help' anytime.`);
  } catch (err) {
    profile.photon = "failed";
    await profiles.save();
    log(`photon registration for ${mask(profile.phone)} failed:`, (err as Error).message);
  }
}

// What the owner sees about themselves.
export async function selfView(profile: Profile) {
  const wallet = wallets.data[profile.walletKey];
  let balance: number | null = null;
  try {
    if (wallet) balance = await getBalanceSol(wallet.address);
  } catch {}
  return {
    id: profile.id,
    name: profile.name,
    phone: profile.phone ?? null,
    imessage: profile.phone ? (profile.photon ?? "pending") : "none",
    stats: profile.stats,
    wallet: wallet ? { address: wallet.address, balance, explorer: explorerAddress(wallet.address) } : null,
  };
}

// ---------- wallets ----------

export const walletOf = (profile: Profile) => wallets.data[profile.walletKey];

export function ensureWallet(key: string): Wallet {
  const existing = wallets.data[key];
  if (existing) return existing;
  const kp = Keypair.generate();
  const wallet: Wallet = {
    address: kp.publicKey.toBase58(),
    secretKey: Array.from(kp.secretKey),
    createdAt: new Date().toISOString(),
  };
  wallets.data[key] = wallet;
  void wallets.save();
  void fundWallet(key);
  return wallet;
}

const funding = new Set<string>();

export async function fundWallet(key: string): Promise<void> {
  const wallet = wallets.data[key];
  if (!wallet || wallet.fundedSig || funding.has(key)) return;
  funding.add(key);
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
    funding.delete(key);
  }
}
