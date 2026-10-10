// Internal API for the app (Compose network only): wallet balances and hype transfers.
// Battle rules live in the app; this only moves devnet SOL between players' wallets.
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { RPC_URL, getBalanceSol, loadTreasury, sendHype } from "./solana.ts";
import { ensureWallet, fundWallet, imessageEnabled } from "./players.ts";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_HYPE_SOL = 0.05;
const log = (...args: unknown[]) => console.log("[http]", ...args);

export function createHttp() {
  const app = express();
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      cluster: "devnet",
      rpc: new URL(RPC_URL).host,
      treasury: loadTreasury()?.publicKey.toBase58() ?? null,
      imessage: imessageEnabled(),
    });
  });

  const secret = process.env.INTERNAL_SECRET ? Buffer.from(process.env.INTERNAL_SECRET) : null;
  app.use((req, _res, next) => {
    const given = Buffer.from(req.get("x-internal-secret") ?? "");
    if (secret && (given.length !== secret.length || !timingSafeEqual(given, secret))) {
      return next(new HttpError(401, "bad internal secret"));
    }
    next();
  });

  // The phone view's wallet card. Creating the wallet here too means it never shows as missing.
  app.get("/wallets/:profileId", async (req, res) => {
    const wallet = await ensureWallet(req.params.profileId);
    if (!wallet.fundedSig) void fundWallet(req.params.profileId).catch(() => {}); // the wallet job retries
    let balance: number | null = null;
    try {
      balance = await getBalanceSol(wallet.address);
    } catch {}
    res.json({ address: wallet.address, balance });
  });

  // Spectator → dancer tip. The sender's own wallet pays; the memo tags it on-chain.
  app.post("/hype", async (req, res) => {
    const { from, to, sol, memo } = req.body ?? {};
    if (typeof from !== "string" || typeof to !== "string" || typeof memo !== "string") {
      throw new HttpError(400, "from, to and memo required");
    }
    if (typeof sol !== "number" || !(sol > 0) || sol > MAX_HYPE_SOL) throw new HttpError(400, "bad amount");
    const [fromWallet, toWallet] = await Promise.all([ensureWallet(from), ensureWallet(to)]);
    try {
      res.json({ signature: await sendHype(fromWallet.secretKey, toWallet.address, sol, memo.slice(0, 200)) });
    } catch (err) {
      const msg = (err as Error).message;
      log(`hype from ${from} failed:`, msg.split("\n")[0]);
      const broke = /insufficient|debit|no record/i.test(msg);
      throw new HttpError(broke ? 402 : 503, broke ? "out of hype SOL" : "Solana is slow, try again");
    }
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    console.error("[http]", (err as Error).message);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
