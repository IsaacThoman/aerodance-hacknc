// iMessage bot: texting in creates your profile; your number is your wallet.
import { join } from "node:path";
import { Spectrum, type Message, type Space } from "spectrum-ts";
import { background, effect, imessage, nativeContactCard } from "spectrum-ts/providers/imessage";
import { battles, markSeen, profiles, type Profile } from "./store.ts";
import { explorerAddress, getBalanceSol } from "./solana.ts";
import { battleUrl, createBattle } from "./battles.ts";
import { cleanName, fundWallet, mask, normalizePhone, profileByPhone, profileForPhone, walletOf } from "./players.ts";

const CHAT_BACKGROUND = join(import.meta.dirname, "..", "assets", "chat-background.jpg");

const HELP = [
  "🫧 aerodance bot 🐠",
  "• battle: get a dance battle link",
  "• challenge <phone>: battle a friend",
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
    await decorate(space, profileByPhone(handle));
  }

  // Once per player: the aero chat wallpaper plus the bot's name and photo. Best effort.
  async function decorate(space: Space, profile: Profile | undefined): Promise<void> {
    if (!profile?.phone || profile.decorated) return;
    profile.decorated = true;
    await profiles.save();
    const extras = [
      ["background", () => background(CHAT_BACKGROUND)],
      ["contact card", () => nativeContactCard()],
    ] as const;
    for (const [what, build] of extras) {
      try {
        await space.send(build());
      } catch (err) {
        log(`${what} for ${mask(profile.phone)} failed:`, (err as Error).message);
      }
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
    if (!markSeen(message.id)) return;
    if (message.platform === "imessage" && imessage(space).type === "group") return; // DMs only on Pro
    const sender = message.sender?.id;
    if (!sender) return;
    spaces.set(sender, space);

    const { profile, isNew } = profileForPhone(sender);
    if (message.content.type !== "text") {
      await space.send("🫧 I only speak text for now. Try 'battle' or 'help' 🐠");
      return;
    }

    const [first = "", ...rest] = message.content.text.trim().split(/\s+/);
    const cmd = first.toLowerCase();
    const known = ["battle", "challenge", "wallet", "stats", "name", "help"].includes(cmd);
    log(`${mask(sender)} → ${known ? cmd : "(chat)"}`);

    if (isNew) {
      await space.send(
        `🫧 Welcome to aerodance, ${profile.name}! 🐠 Your number is now your Solana devnet wallet. No signup, no login, it just works ✨\n(Text 'name <something>' to change your name.)`,
      );
      await decorate(space, profile);
      // First text ever: take them straight to a dance battle.
      if (!known) return sendBattle(space, profile);
    }
    await decorate(space, profile); // players from before backgrounds existed

    switch (cmd) {
      case "battle":
        return sendBattle(space, profile);
      case "challenge":
        return challenge(space, profile, rest.join(" "));
      case "wallet":
        return space.responding(() => sendWallet(space, profile));
      case "stats": {
        const s = profile.stats;
        await space.send(
          `🫧 ${profile.name}'s reef stats 🐠\nBattles: ${s.battles} · Wins: ${s.wins}\nBest score: ${s.bestScore} · Bubbles popped: ${s.pops}\nCrowd hype: ${s.hypeCount}× (+${s.hypeSol} SOL)`,
        );
        return;
      }
      case "name": {
        const name = cleanName(rest.join(" "));
        if (!name) {
          await space.send(`🐠 You're ${profile.name}. Try: name Glassy Orca`);
          return;
        }
        profile.name = name;
        await profiles.save();
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
    const battle = createBattle([profile.id]);
    await space.send(`🫧 Your dance battle is ready! 💃🐠\n${battleUrl(battle.id, battle.players[0]!.token)}`);
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

    const battle = createBattle([me.id, undefined]);
    const [mine, theirs] = battle.players as [(typeof battle.players)[0], (typeof battle.players)[0]];
    const theirUrl = battleUrl(battle.id, theirs.token);
    await space.send(`🫧 Challenge sent! Here's your link 💃\n${battleUrl(battle.id, mine.token)}`);

    try {
      await sendTo(opponent, `🫧 ${me.name} challenged you to a dance battle! 🐠\nTap to dance: ${theirUrl}\nText 'help' anytime.`);
      // Only seat (and remember) them once we know we can reach them.
      theirs.profileId = profileForPhone(opponent).profile.id;
      await battles.save();
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

  async function sendWallet(space: Space, profile: Profile) {
    await fundWallet(profile.walletKey); // no-op once funded; retries if the first try failed
    const wallet = walletOf(profile)!;
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
