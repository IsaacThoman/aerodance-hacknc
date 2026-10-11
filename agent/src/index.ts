// One process: the jobs worker (wallets, receipts, texts), the internal HTTP API the app
// calls for hype and balances, and the Spectrum iMessage loop when credentials are set.
import { loadTreasury } from "./solana.ts"; // importing this runs the devnet guard
import { waitForSchema } from "./db.ts";
import { startJobs } from "./jobs.ts";
import { fundPendingWallets, setNotifier } from "./players.ts";
import "./battles.ts"; // registers the receipt jobs
import { createHttp } from "./http.ts";
import { startBot } from "./bot.ts";

// AGENT_PORT, not PORT: in local dev the agent shares the root .env with the app.
const PORT = Number(process.env.AGENT_PORT) || 4000;

const treasury = loadTreasury();
if (!treasury) console.warn("⚠️  No SOLANA_TREASURY_SECRET. Run `npm run treasury` (new wallets won't be funded and receipts stay pending).");
else console.log("treasury:", treasury.publicKey.toBase58());

await waitForSchema();

// Previews and local dev usually run without Photon credentials: texts are only logged.
let bot: Awaited<ReturnType<typeof startBot>> | undefined;
if (process.env.PROJECT_ID && process.env.PROJECT_SECRET) {
  try {
    bot = await startBot();
    setNotifier(bot.notify);
  } catch (err) {
    console.error("⚠️  iMessage bot failed to start, texts will only be logged:", (err as Error).message);
  }
} else {
  console.log("iMessage off (no PROJECT_ID / PROJECT_SECRET): texts are only logged");
}

startJobs();
if (treasury) setInterval(() => void fundPendingWallets(), 60_000).unref();
createHttp().listen(PORT, () => console.log(`🫧 aerodance agent: http://localhost:${PORT}`));

await bot?.run();
