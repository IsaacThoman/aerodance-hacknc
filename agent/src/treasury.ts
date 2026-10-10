// `npm run treasury`: create the devnet treasury keypair and try to airdrop to it.
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { connection, createTreasury, getBalanceSol, loadTreasury, withTimeout } from "./solana.ts";

const existing = loadTreasury();
const treasury = existing ?? (await createTreasury());
const address = treasury.publicKey.toBase58();
console.log(existing ? "Treasury already exists:" : "Created treasury at data/treasury.json:", address);

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
