// HTTP API for teammates (game client/server).
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import QRCode from "qrcode";
import { join } from "node:path";
import { battles } from "./store.ts";
import { publicUrl } from "./urls.ts";
import { BATTLE_BASE_URL, BattleError, battleUrl, createBattle, hypeDancer, joinBattle, publicBattle, reportResult, trophyMetadata } from "./battles.ts";
import { RPC_URL, loadTreasury } from "./solana.ts";
import { cleanName, normalizePhone, profileByDevice, selfView, upsertProfile } from "./players.ts";

const PUBLIC_DIR = join(import.meta.dirname, "..", "public");

export { publicUrl } from "./urls.ts";

const deviceToken = (req: Request) => req.get("x-device-token") || undefined;
function requireProfile(req: Request) {
  const token = deviceToken(req);
  const profile = token && profileByDevice(token);
  if (!profile) throw new BattleError(401, "join first");
  return profile;
}

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const allowedOrigins = new Set([new URL(BATTLE_BASE_URL).origin]);

export function createHttp(port: number) {
  const joinBase = publicUrl(port);
  const app = express();
  app.use(
    cors({ origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin) || allowedOrigins.has(origin)) }),
  );
  app.use(express.json({ limit: "16kb" }));
  app.use("/app", express.static(PUBLIC_DIR));

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

  // ---------- phone join flow ----------

  // The QR code for the display: <img src="http://localhost:4000/battles/<id>/qr.svg">
  app.get("/battles/:id/qr.svg", async (req, res) => {
    if (!battles.data[req.params.id]) return void res.status(404).end();
    const svg = await QRCode.toString(`${joinBase}/join/${req.params.id}`, { type: "svg", margin: 1, color: { dark: "#0b3d6b", light: "#ffffff" } });
    res.type("image/svg+xml").send(svg);
  });
  app.get("/battles/:id/join-url", (req, res) => {
    res.json({ url: `${joinBase}/join/${req.params.id}` });
  });

  app.get(["/join", "/join/:id"], (_req, res) => res.sendFile(join(PUBLIC_DIR, "join.html")));

  // Metadata for a battle's trophy NFT (the asset's on-chain uri points here).
  app.get("/nft/:id.json", (req, res) => {
    const battle = battles.data[req.params.id];
    const meta = battle && trophyMetadata(battle);
    if (!meta) return void res.status(404).json({ error: "no trophy for that battle" });
    res.json(meta);
  });
  // Battle host console: stands in for the game (QR display + fake results).
  app.get("/host", (_req, res) => res.sendFile(join(PUBLIC_DIR, "host.html")));

  app.get("/me", async (req, res) => {
    res.json(await selfView(requireProfile(req)));
  });

  // Create or update your profile. Name defaults to a Frutiger Aero name; phone is optional.
  app.post("/me", async (req, res) => {
    const name = cleanName(req.body?.name);
    const rawPhone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const phone = rawPhone ? normalizePhone(rawPhone) : undefined;
    if (rawPhone && !phone) return void res.status(400).json({ error: "that phone number doesn't look right" });
    const { profile, deviceToken: token } = upsertProfile(deviceToken(req), { name, phone });
    res.json({ deviceToken: token, me: await selfView(profile) });
  });

  app.post("/battles/:id/join", (req, res) => {
    res.json(joinBattle(req.params.id, requireProfile(req)));
  });

  app.post("/battles/:id/hype", async (req, res) => {
    const seat = Number(req.body?.seat);
    if (!Number.isInteger(seat) || seat < 0) return void res.status(400).json({ error: "seat required" });
    res.json(await hypeDancer(req.params.id, requireProfile(req), seat));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof BattleError) return void res.status(err.status).json({ error: err.message });
    console.error("[http]", (err as Error).message);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
