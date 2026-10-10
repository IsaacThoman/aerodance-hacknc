// One process: Spectrum message loop + HTTP API for the game.
import { loadTreasury } from "./solana.ts"; // importing this runs the devnet guard
import { setNotifier, startSweeper } from "./battles.ts";
import { createHttp } from "./http.ts";
import { startBot } from "./bot.ts";

const PORT = Number(process.env.PORT) || 4000;

const treasury = loadTreasury();
if (!treasury) console.warn("⚠️  No treasury at data/treasury.json. Run `npm run treasury` (new wallets won't be funded and receipts stay pending).");
else console.log("treasury:", treasury.publicKey.toBase58());

const bot = await startBot();
setNotifier(bot.notify);
startSweeper();

createHttp().listen(PORT, () => console.log(`🫧 aerodance agent: http://localhost:${PORT}`));

await bot.run();
