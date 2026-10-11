// iMessage bot: texting in creates your profile; your number is your wallet.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Spectrum, contact, type Message, type Space } from "spectrum-ts";
import { background, effect, imessage } from "spectrum-ts/providers/imessage";
import { getProfile, markSeen, pool, type Profile } from "./db.ts";
import { app as game } from "./app.ts";
import { explorerAddress, getBalanceSol } from "./solana.ts";
import { photonLine } from "./photon.ts";
import { ensureWallet, fundWallet, mask } from "./players.ts";

const ASSETS = join(import.meta.dirname, "..", "assets");
const CHAT_BACKGROUND = join(ASSETS, "chat-background.jpg");
const CONTACT_PHOTO = join(ASSETS, "contact-photo.png");

// "(919) 555-0123" → "+19195550123". US default for 10-digit numbers. Same rules as the app.
function normalizePhone(raw: string): string | undefined {
  const s = raw.trim();
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

const profileByPhone = async (phone: string) =>
  (await pool.query<Profile>("SELECT * FROM profiles WHERE phone = $1", [phone])).rows[0];

// Flips a once-per-player flag; true only for the caller that flipped it.
const claimOnce = async (id: string, flag: "decorated" | "contact_card") =>
  ((await pool.query(`UPDATE profiles SET ${flag} = true WHERE id = $1 AND NOT ${flag}`, [id])).rowCount ?? 0) > 0;

// Text a player typed, unwrapped from replies, effects and markdown. undefined for anything else.
type AnyContent = { type: string; text?: string; markdown?: string; content?: AnyContent };
function textOf(content: AnyContent | undefined): string | undefined {
  if (!content) return undefined;
  if (content.type === "text") return content.text;
  if (content.type === "markdown") return content.markdown;
  if (content.type === "reply" || content.type === "effect") return textOf(content.content);
  return undefined;
}
// Real things a person sent that we can't read yet. Everything else (read receipts, typing,
// tapbacks, edits, unsends, chat updates) is a background event and gets no reply.
const UNREADABLE = new Set(["attachment", "voice", "poll", "richlink", "app"]);

const HELP = [
  "🫧 aerodance bot 🐠",
  "• battle: get a dance battle link",
  "• challenge <phone>: battle a friend",
  "• hype <name>: tip a dancer and watch their battle",
  "• wallet: your Solana devnet wallet",
  "• stats: your dance stats",
  "• name <new name>: change your name",
  "• help: this list",
].join("\n");

const log = (...args: unknown[]) => console.log("[bot]", ...args);

export async function startBot() {
  const app = await Spectrum({
    projectId: process.env.PROJECT_ID!,
    projectSecret: process.env.PROJECT_SECRET!,
    providers: [imessage.config()],
  });
  const im = imessage(app);

  // Reuse the inbound DM space when we have one; otherwise open a DM.
  const spaces = new Map<string, Space>();

  async function sendTo(handle: string, text: string, celebrate = false): Promise<void> {
    let space = spaces.get(handle);
    if (!space) {
      space = await im.space.create(await im.user(handle));
      spaces.set(handle, space);
    }
    await space.send(celebrate ? effect(text, imessage.effect.message.confetti) : text);
    await decorate(space, await profileByPhone(handle));
  }

  // Once per player: the aero chat wallpaper, then an "aerodance" contact card for the
  // number that texts them (shared-pool lines can't carry our own name/photo). Best effort.
  async function decorate(space: Space, profile: Profile | undefined): Promise<void> {
    if (!profile?.phone || (profile.decorated && profile.contact_card)) return;
    const phone = profile.phone;
    const attempt = async (what: string, send: () => Promise<unknown>) => {
      try {
        await send();
      } catch (err) {
        log(`${what} for ${mask(phone)} failed:`, (err as Error).message);
      }
    };
    if (await claimOnce(profile.id, "decorated")) {
      await attempt("background", () => space.send(background(CHAT_BACKGROUND)));
    }
    if (await claimOnce(profile.id, "contact_card")) {
      await attempt("contact card", async () => {
        const line = profile.line ?? (await photonLine(phone));
        if (!line) throw new Error("no assigned line found");
        if (!profile.line) await pool.query("UPDATE profiles SET line = $2 WHERE id = $1", [profile.id, line]);
        const photo = { mimeType: "image/png", read: () => readFile(CONTACT_PHOTO) };
        await space.send(contact({ name: { first: "aerodance" }, phones: [{ value: line, type: "mobile" }], photo }));
        await space.send("👆 Tap that card and Save so I show up as aerodance 🫧");
      });
    }
  }

  // Never throws: used by background battle code.
  async function notify(handle: string, text: string, opts?: { celebrate?: boolean }): Promise<void> {
    try {
      await sendTo(handle, text, opts?.celebrate);
    } catch (err) {
      log(`notify ${mask(handle)} failed:`, (err as Error).message);
    }
  }

  async function handle(space: Space, message: Message): Promise<void> {
    if (message.direction === "outbound") return;
    if (!(await markSeen(message.id))) return;
    if (message.platform === "imessage" && imessage(space).type === "group") return; // DMs only on Pro
    const sender = message.sender?.id;
    if (!sender) return;
    spaces.set(sender, space);

    const text = textOf(message.content as AnyContent);
    if (text === undefined) {
      if (UNREADABLE.has(message.content.type)) await space.send("🫧 I only speak text for now. Try 'battle' or 'help' 🐠");
      return;
    }
    const linked = await game.profileForPhone(sender);
    const { isNew, justOptedIn } = linked;
    const profile = (await getProfile(linked.profile.id))!;

    const [first = "", ...rest] = text.trim().split(/\s+/);
    const cmd = first.toLowerCase();
    const known = ["battle", "challenge", "hype", "wallet", "stats", "name", "help"].includes(cmd);
    log(`${mask(sender)} → ${known ? cmd : "(chat)"}`);

    if (isNew) {
      await space.send(
        `🫧 Welcome to aerodance, ${profile.name}! 🐠 Your number is now your Solana devnet wallet. No signup, no login, it just works ✨\n(Text 'name <something>' to change your name.)`,
      );
      await decorate(space, profile);
      // First text ever: take them straight to a dance battle.
      if (!known) return sendBattle(space, profile);
    }
    if (justOptedIn) {
      await space.send(`🫧 You're linked, ${profile.name}! 🐠\nI'll text you battle results, hype and rewards here. Text 'help' anytime.`);
      await decorate(space, profile);
      if (!known) return;
    }
    await decorate(space, profile); // players from before backgrounds existed

    switch (cmd) {
      case "battle":
        return sendBattle(space, profile);
      case "challenge":
        return challenge(space, profile, rest.join(" "));
      case "hype":
        return space.responding(() => hype(space, profile, rest.join(" ")));
      case "wallet":
        return space.responding(() => sendWallet(space, profile));
      case "stats": {
        const { stats: s } = await game.profile(profile.id);
        await space.send(
          `🫧 ${profile.name}'s reef stats 🐠\nBattles: ${s.battles} · Wins: ${s.wins}\nBest score: ${s.bestScore} · Bubbles popped: ${s.pops}\nCrowd hype: ${s.hypeCount}× (+${s.hypeSol} SOL)`,
        );
        return;
      }
      case "name": {
        if (!rest.join(" ").trim()) {
          await space.send(`🐠 You're ${profile.name}. Try: name Glassy Orca`);
          return;
        }
        const { name } = await game.rename(profile.id, rest.join(" "));
        await space.send(`🫧 Splendid! You're now ${name} ✨`);
        return;
      }
      case "help":
        await space.send(HELP);
        return;
      default:
        await space.send("🫧 Hmm, not sure what that means! Text 'battle' to start dancing, or 'help' to see everything I can do 🐠");
    }
  }

  async function sendBattle(space: Space, profile: Profile) {
    const battle = await game.createBattle([profile.id]);
    await space.send(`🫧 Your dance battle is ready! 💃🐠\n${battle.players[0]!.url}`);
  }

  async function challenge(space: Space, me: Profile, arg: string) {
    const opponent = normalizePhone(arg);
    if (!opponent) {
      await space.send("🐠 Who are we challenging? Try: challenge +1 919 555 0123");
      return;
    }
    if (opponent === me.phone) {
      await space.send("🫧 Dancing against yourself? Bold. Text 'battle' for a solo round 🐠");
      return;
    }

    const battle = await game.createBattle([me.id, null]);
    const [mine, theirs] = battle.players as [(typeof battle.players)[0], (typeof battle.players)[0]];
    const theirUrl = theirs.url;
    await space.send(`🫧 Challenge sent! Here's your link 💃\n${mine.url}`);

    try {
      await sendTo(opponent, `🫧 ${me.name} challenged you to a dance battle! 🐠\nTap to dance: ${theirUrl}\nText 'help' anytime.`);
      // Only seat (and remember) them once we know we can reach them.
      await game.claimSeat(battle.id, theirs.seat, (await game.profileForPhone(opponent)).profile.id);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      log(`challenge to ${mask(opponent)} failed:`, msg);
      await space.send(
        /not allowed/i.test(msg)
          ? `🐠 I can't text that number yet. They need to join aerodance first! For now, send them this link yourself 🫧\n${theirUrl}`
          : `🐠 I couldn't reach them right now. Send them this link yourself 🫧\n${theirUrl}`,
      );
    }
  }

  // Tip the named player's live battle, then send the texter there to watch.
  async function hype(space: Space, me: Profile, name: string) {
    if (!name.trim()) {
      await space.send("🐠 Who are we hyping? Try: hype Glassy Orca");
      return;
    }
    let hyped;
    try {
      hyped = await game.hype(me.id, name);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      log(`hype from ${mask(me.phone ?? "")} failed:`, msg);
      if (msg === "no live battle") {
        await space.send(`🐠 I can't find ${name.trim()} in a live battle right now. Check the name, or try again once they're dancing 🫧`);
      } else if (msg === "dancers can't hype") {
        await space.send("🫧 You're dancing in that battle! Hype is for the crowd 🐠");
      } else if (msg === "out of hype SOL") {
        await space.send("🐠 Your wallet is out of hype SOL. Text 'wallet' to check your balance 🫧");
      } else if (msg === "one hype at a time") {
        await space.send("🫧 Easy there! Your last hype is still landing 🐠");
      } else if (msg === "battle already finished") {
        await space.send("🐠 That battle just ended! Too late to hype this time 🫧");
      } else {
        await space.send("🐠 Solana is being slow, so that hype didn't land. Try again in a moment 🫧");
      }
      return;
    }
    await space.send(
      [`📣 You hyped ${hyped.name} with ${hyped.sol} devnet SOL! 🫧`, `Watch them dance: ${hyped.url}`, hyped.explorer].join("\n"),
    );
  }

  async function sendWallet(space: Space, profile: Profile) {
    await fundWallet(profile.id).catch(() => {}); // no-op once funded; the wallet job keeps retrying
    const wallet = await ensureWallet(profile.id);
    let balance = "unavailable right now 🫧";
    try {
      balance = `${(await getBalanceSol(wallet.address)).toFixed(4)} SOL`;
    } catch {}
    await space.send(
      [`🐠 Your devnet wallet`, wallet.address, `Balance: ${balance}`, explorerAddress(wallet.address)].join("\n"),
    );
  }

  async function run() {
    for await (const [space, message] of app.messages) {
      // Handle concurrently; one bad message never stops the loop.
      void handle(space, message).catch((err) => log("handler error:", (err as Error).message));
    }
  }

  return { notify, run, stop: () => app.stop() };
}
