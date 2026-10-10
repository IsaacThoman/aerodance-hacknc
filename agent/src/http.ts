// HTTP API for teammates (game client/server).
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { battles } from "./store.ts";
import { BATTLE_BASE_URL, BattleError, battleUrl, createBattle, publicBattle, reportResult } from "./battles.ts";
import { RPC_URL, loadTreasury } from "./solana.ts";

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowedOrigins = new Set([new URL(BATTLE_BASE_URL).origin]);

export function createHttp() {
  const app = express();
  app.use(
    cors({ origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin) || allowedOrigins.has(origin)) }),
  );
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, cluster: "devnet", rpc: new URL(RPC_URL).host, treasury: loadTreasury()?.publicKey.toBase58() ?? null });
  });

  // Start a battle from the website (no phones involved).
  app.post("/battles", (req, res) => {
    const count = Math.min(Math.max(Number(req.body?.players) || 2, 1), 8);
    const battle = createBattle(Array(count).fill(undefined));
    const urls = battle.players.map((p) => battleUrl(battle.id, p.token));
    res.status(201).json({ battleId: battle.id, url: urls[0], players: battle.players.map((p, i) => ({ token: p.token, url: urls[i] })) });
  });

  app.get("/battles/:id", (req, res) => {
    const battle = battles.data[req.params.id];
    if (!battle) return void res.status(404).json({ error: "battle not found" });
    res.json(publicBattle(battle));
  });

  app.post("/battles/:id/result", (req, res) => {
    const { playerToken, score, pops = 0, sync = 0, flair = 0 } = req.body ?? {};
    const nums = { score, pops, sync, flair };
    if (typeof playerToken !== "string") return void res.status(400).json({ error: "playerToken required" });
    for (const [k, v] of Object.entries(nums)) {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return void res.status(400).json({ error: `${k} must be a non-negative number` });
      }
    }
    const battle = reportResult(req.params.id, playerToken, nums);
    res.json(publicBattle(battle));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BattleError) return void res.status(err.status).json({ error: err.message });
    console.error("[http]", (err as Error).message);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
