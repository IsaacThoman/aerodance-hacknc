// Winner trophies: Metaplex Core NFTs, minted by the treasury on devnet.
import { create, fetchAsset, mplCore } from "@metaplex-foundation/mpl-core";
import { createSignerFromKeypair, keypairIdentity, publicKey, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import bs58 from "bs58";
import { RPC_URL, loadTreasury, withTimeout } from "./solana.ts";

let umi: Umi | undefined;
function treasuryUmi(): Umi {
  if (umi) return umi;
  const treasury = loadTreasury();
  if (!treasury) throw new Error("No treasury: set SOLANA_TREASURY_SECRET (see `npm run treasury`).");
  const u = createUmi(RPC_URL, "confirmed").use(mplCore());
  u.use(keypairIdentity(u.eddsa.createKeypairFromSecretKey(treasury.secretKey)));
  return (umi = u);
}

// The asset key is generated once per trophy and kept until the mint lands, so a retry
// after a timeout finds the already-minted asset instead of minting a second one.
export async function mintTrophy(
  assetSecret: Uint8Array,
  owner: string,
  name: string,
  uri: string,
): Promise<{ asset: string; signature: string | null }> {
  const u = treasuryUmi();
  const asset = createSignerFromKeypair(u, u.eddsa.createKeypairFromSecretKey(assetSecret));
  const address = asset.publicKey.toString();
  if (await fetchAsset(u, asset.publicKey).then(() => true, () => false)) return { asset: address, signature: null };
  const res = await withTimeout(
    create(u, { asset, owner: publicKey(owner), name, uri }).sendAndConfirm(u),
    45_000,
    "mint trophy",
  );
  return { asset: address, signature: bs58.encode(res.signature) };
}
