// One process: Spectrum message loop + HTTP API for the game.
import { loadTreasury } from "./solana.ts"; // importing this runs the devnet guard
import { startSweeper } from "./battles.ts";
import { setNotifier } from "./players.ts";
import { allowOrigin, createHttp, publicUrl } from "./http.ts";
import { attachRemote } from "./remote.ts";
import { startBot } from "./bot.ts";
import { PORT } from "./urls.ts";

const treasury = loadTreasury();
if (!treasury) console.warn("⚠️  No treasury at data/treasury.json. Run `npm run treasury` (new wallets won't be funded and receipts stay pending).");
else console.log("treasury:", treasury.publicKey.toBase58());

const bot = await startBot();
setNotifier(bot.notify);
startSweeper();

const server = createHttp(PORT).listen(PORT, () => {
  console.log(`🫧 aerodance agent: http://localhost:${PORT}`);
  console.log(`📱 phones join at: ${publicUrl(PORT)}/join/<battleId>`);
});
attachRemote(server, allowOrigin);

await bot.run();
