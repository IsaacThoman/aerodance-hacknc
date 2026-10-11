// `npm run treasury`: make a devnet treasury (or check the one in SOLANA_TREASURY_SECRET)
// and try to airdrop to it.
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { connection, getBalanceSol, loadTreasury, withTimeout } from "./solana.ts";

const existing = loadTreasury();
const treasury = existing ?? Keypair.generate();
const address = treasury.publicKey.toBase58();
if (existing) {
  console.log("Treasury from SOLANA_TREASURY_SECRET:", address);
} else {
  console.log("New treasury:", address);
  console.log("\nAdd this to .env (or the deployment's environment). Keep it secret:\n");
  console.log(`  SOLANA_TREASURY_SECRET=${bs58.encode(treasury.secretKey)}\n`);
}

let balance = await getBalanceSol(address);
if (balance < 1) {
  try {
    const sig = await withTimeout(connection.requestAirdrop(treasury.publicKey, LAMPORTS_PER_SOL), 20_000, "airdrop");
    const latest = await connection.getLatestBlockhash();
    await withTimeout(connection.confirmTransaction({ signature: sig, ...latest }), 45_000, "confirm airdrop");
    balance = await getBalanceSol(address);
    console.log("Airdrop landed 🫧");
  } catch (err) {
    console.log(`Airdrop didn't work (${(err as Error).message.split("\n")[0]}).`);
    console.log(`Fund it manually at https://faucet.solana.com with address:\n\n  ${address}\n`);
  }
}
console.log(`Balance: ${balance} SOL (devnet)`);
