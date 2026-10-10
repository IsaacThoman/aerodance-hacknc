// Where phones (and NFT metadata readers) reach this server.
import { networkInterfaces } from "node:os";

export const PORT = Number(process.env.PORT) || 4000;

// Phones can't use localhost, so default to the LAN IP.
export function publicUrl(port = PORT): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === "IPv4" && !i.internal);
  return `http://${lan?.address ?? "localhost"}:${port}`;
}
