// Client for the app's internal API: the bot creates profiles and battles through it,
// so battle rules live in one place (server/battles.js).
const appUrl = new URL(process.env.APP_URL || "http://app:3001");
if (appUrl.hostname === "app" && process.env.SERVICE_NAME_APP) appUrl.hostname = process.env.SERVICE_NAME_APP;

export type AppProfile = { id: string; name: string; phone: string | null };
export type Stats = { battles: number; wins: number; bestScore: number; pops: number; hypeCount: number; hypeSol: number };
export type Hyped = { battleId: string; name: string; sol: number; url: string; signature: string; explorer: string };
export type NewBattle = { id: string; players: { seat: number; token: string; url: string }[] };

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(new URL(path, appUrl), {
    method,
    headers: {
      "content-type": "application/json",
      ...(process.env.INTERNAL_SECRET ? { "x-internal-secret": process.env.INTERNAL_SECRET } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `app returned ${res.status}`);
  return data as T;
}

export const app = {
  profileForPhone: (phone: string) =>
    call<{ profile: AppProfile; isNew: boolean; justOptedIn: boolean }>("POST", "/internal/phone-profile", { phone }),
  profile: (id: string) => call<AppProfile & { stats: Stats }>("GET", `/internal/profiles/${encodeURIComponent(id)}`),
  rename: (id: string, name: string) => call<AppProfile>("POST", `/internal/profiles/${encodeURIComponent(id)}/name`, { name }),
  createBattle: (seats: (string | null)[]) => call<NewBattle>("POST", "/internal/battles", { seats }),
  claimSeat: (battleId: string, seat: number, profileId: string) =>
    call<{ ok: true }>("POST", `/internal/battles/${encodeURIComponent(battleId)}/claim`, { seat, profileId }),
  // Waits for the SOL transfer to confirm (the app gives Solana 30s).
  hype: (fromProfileId: string, name: string) =>
    call<Hyped>("POST", "/internal/hype", { from: fromProfileId, name }, 45_000),
};
