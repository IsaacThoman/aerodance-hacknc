// Phone-as-Wii-remote for the game's menu screen. The screen hosts a code and shows a QR
// to /join?remote=<code>; the first player to claim it holds the remote, and only their
// pointer and button input is relayed to that screen.
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { profileByDevice } from "./players.ts";
import { publicUrl } from "./urls.ts";

type Session = { display: string; holder?: { socket: string; profileId: string; name: string } };

const sessions = new Map<string, Session>(); // code -> session
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const clamp = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-max, Math.min(max, v)) : 0);
const log = (...args: unknown[]) => console.log("[remote]", ...args);

export function attachRemote(server: HttpServer, allowOrigin: (origin: string | undefined) => boolean): Server {
  const io = new Server(server, {
    cors: { origin: (origin, cb) => cb(null, allowOrigin(origin)) },
  });

  const holderOf = (socket: Socket) => {
    const code = socket.data.remoteCode as string | undefined;
    const session = code ? sessions.get(code) : undefined;
    return session?.holder?.socket === socket.id ? session : undefined;
  };

  io.on("connection", (socket) => {
    // A screen reconnecting asks for its old code back so its QR stays valid.
    socket.on("display:host", (wanted: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      let code = typeof wanted === "string" && /^[A-Z]{4}$/.test(wanted) && !sessions.has(wanted) ? wanted : newCode();
      while (sessions.has(code)) code = newCode();
      sessions.set(code, { display: socket.id });
      socket.data.hostCode = code;
      ack({ code, joinUrl: `${publicUrl()}/join?remote=${code}` });
    });

    // First claimer wins; the same player can take it back (e.g. after a reload).
    socket.on("remote:claim", (msg: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      const { code: raw, deviceToken } = (msg ?? {}) as { code?: unknown; deviceToken?: unknown };
      const code = String(raw ?? "").trim().toUpperCase();
      const session = sessions.get(code);
      if (!session) return ack({ ok: false, reason: "gone", error: "That screen isn't on anymore" });
      const profile = typeof deviceToken === "string" ? profileByDevice(deviceToken) : undefined;
      if (!profile) return ack({ ok: false, reason: "profile", error: "join first" });

      const holder = session.holder;
      if (holder && holder.profileId !== profile.id && io.sockets.sockets.has(holder.socket)) {
        return ack({ ok: false, reason: "taken", holder: holder.name });
      }
      if (holder && holder.socket !== socket.id) io.to(holder.socket).emit("remote:ended", { reason: "moved" });
      session.holder = { socket: socket.id, profileId: profile.id, name: profile.name };
      socket.data.remoteCode = code;
      io.to(session.display).emit("remote:joined", { name: profile.name });
      log(`${code} held by ${profile.id}`);
      ack({ ok: true });
    });

    socket.on("remote:move", (m: { dx?: unknown; dy?: unknown } | undefined) => {
      const session = holderOf(socket);
      if (session) io.to(session.display).volatile.emit("remote:move", { dx: clamp(m?.dx, 400), dy: clamp(m?.dy, 400) });
    });

    socket.on("remote:button", (b: { button?: unknown; pressed?: unknown } | undefined) => {
      const session = holderOf(socket);
      if (session && typeof b?.button === "string" && ["a", "b", "center"].includes(b.button)) {
        io.to(session.display).emit("remote:button", { button: b.button, pressed: !!b.pressed });
      }
    });

    // Let the holder hand the remote back without closing the page.
    socket.on("remote:release", () => {
      const session = holderOf(socket);
      if (!session) return;
      delete session.holder;
      io.to(session.display).emit("remote:left");
    });

    socket.on("disconnect", () => {
      const hosted = socket.data.hostCode as string | undefined;
      const session = hosted ? sessions.get(hosted) : undefined;
      if (session && session.display === socket.id) {
        if (session.holder) io.to(session.holder.socket).emit("remote:ended", { reason: "gone" });
        sessions.delete(hosted!);
      }
      const held = holderOf(socket);
      if (held) {
        delete held.holder;
        io.to(held.display).emit("remote:left");
      }
    });
  });

  return io;
}
