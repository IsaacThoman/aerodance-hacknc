// iMessage bot: the sender's handle (phone/email) is their identity and wallet.
import { Spectrum, type Message, type Space } from "spectrum-ts";
import { effect, imessage } from "spectrum-ts/providers/imessage";
import { markSeen } from "./store.ts";
import { explorerAddress, getBalanceSol } from "./solana.ts";
import { battleUrl, createBattle, ensureWallet, fundWallet, getWallet } from "./battles.ts";

const HELP = [
  "🫧 aerodance bot 🐠",
  "• battle: get a dance battle link",
  "• challenge <phone>: battle a friend",
  "• wallet: your Solana devnet wallet",
  "• help: this list",
].join("\n");

const mask = (handle: string) => `…${handle.slice(-4)}`;
const log = (...args: unknown[]) => console.log("[bot]", ...args);

// "(919) 555-0123" → "+19195550123". Emails pass through lowercased.
export function normalizeHandle(raw: string): string | undefined {
  const s = raw.trim();
  if (s.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : undefined;
  const digits = s.replace(/[^\d]/g, "");
  if (s.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return undefined;
}

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

    const { isNew } = ensureWallet(sender);
    if (message.content.type !== "text") {
      await space.send("🫧 I only speak text for now. Try 'battle' or 'help' 🐠");
      return;
    }

    const [first = "", ...rest] = message.content.text.trim().split(/\s+/);
    const cmd = first.toLowerCase();
    const known = ["battle", "challenge", "wallet", "help"].includes(cmd);
    log(`${mask(sender)} → ${known ? cmd : "(chat)"}`);

    if (isNew) {
      await space.send("🫧 Welcome to aerodance! 🐠 Your number is now your Solana devnet wallet. No signup, no login, it just works ✨");
      // First text ever: take them straight to a dance battle.
      if (!known) return sendBattle(space, sender);
    }

    switch (cmd) {
      case "battle":
        return sendBattle(space, sender);
      case "challenge":
        return challenge(space, sender, rest.join(" "));
      case "wallet":
        return space.responding(() => sendWallet(space, sender));
      case "help":
        await space.send(HELP);
        return;
      default:
        await space.send("🫧 Hmm, not sure what that means! Text 'battle' to start dancing, or 'help' to see everything I can do 🐠");
    }
  }

  async function sendBattle(space: Space, sender: string) {
    const battle = createBattle([sender]);
    await space.send(`🫧 Your dance battle is ready! 💃🐠\n${battleUrl(battle.id, battle.players[0]!.token)}`);
  }

  async function challenge(space: Space, sender: string, arg: string) {
    const opponent = normalizeHandle(arg);
    if (!opponent) {
      await space.send("🐠 Who are we challenging? Try: challenge +1 919 555 0123");
      return;
    }
    if (opponent === sender) {
      await space.send("🫧 Dancing against yourself? Bold. Text 'battle' for a solo round 🐠");
      return;
    }

    const battle = createBattle([sender, opponent]);
    const [me, them] = battle.players as [(typeof battle.players)[0], (typeof battle.players)[0]];
    const theirUrl = battleUrl(battle.id, them.token);
    await space.send(`🫧 Challenge sent! Here's your link 💃\n${battleUrl(battle.id, me.token)}`);

    try {
      await sendTo(opponent, `🫧 You've been challenged to a dance battle by ${mask(sender)}! 🐠\nTap to dance: ${theirUrl}\nText 'help' anytime.`);
      ensureWallet(opponent);
    } catch (err) {
      const msg = (err as Error).message ?? "";
      log(`challenge to ${mask(opponent)} failed:`, msg);
      delete them.handle; // we can't text them, so don't keep their number
      await space.send(
        /not allowed/i.test(msg)
          ? `🐠 I can't text that number yet. They need to join aerodance first! For now, send them this link yourself 🫧\n${theirUrl}`
          : `🐠 I couldn't reach them right now. Send them this link yourself 🫧\n${theirUrl}`,
      );
    }
  }

  async function sendWallet(space: Space, sender: string) {
    await fundWallet(sender); // no-op once funded; retries if the first try failed
    const wallet = getWallet(sender)!;
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
