// Registers phone numbers as Spectrum users so the shared-pool line may text them.
// Same endpoint the `photon spectrum users add` CLI uses. Needs a dashboard
// token (PHOTON_TOKEN, from `photon login`), not the project secret.
const API_HOST = (process.env.PHOTON_API_HOST || "https://app.photon.codes").replace(/\/$/, "");

export const photonEnabled = () => !!process.env.PHOTON_TOKEN;

export type PhotonUser = { line?: string; optedIn: boolean };

const usersUrl = () => `${API_HOST}/api/projects/${process.env.PROJECT_ID}/spectrum/users`;
const authHeaders = () => ({ "content-type": "application/json", authorization: `Bearer ${process.env.PHOTON_TOKEN}` });

function toPhotonUser(u: any): PhotonUser {
  return { line: typeof u?.assignedPhoneNumber === "string" ? u.assignedPhoneNumber : undefined, optedIn: u?.meta?.opt_in === true };
}

// Look up an existing Spectrum user by number (for numbers that were already on the allowlist).
async function findPhotonUser(phone: string): Promise<PhotonUser | undefined> {
  const res = await fetch(usersUrl(), { headers: authHeaders(), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return undefined;
  const body: any = await res.json().catch(() => undefined);
  const users: any[] = Array.isArray(body) ? body : body?.users ?? body?.data ?? [];
  const user = users.find((u) => u?.phoneNumber === phone);
  return user ? toPhotonUser(user) : undefined;
}

// The Photon number assigned to text this player, if they're a Spectrum user.
export async function photonLine(phone: string): Promise<string | undefined> {
  return photonEnabled() ? (await findPhotonUser(phone))?.line : undefined;
}

// Returns the line Photon assigned to this number, so the player can text it to opt in.
export async function registerPhotonUser(phone: string, name: string): Promise<PhotonUser | undefined> {
  if (!photonEnabled()) throw new Error("PHOTON_TOKEN not set");
  const res = await fetch(usersUrl(), {
    method: "POST",
    headers: authHeaders(),
    // email is required by the API; sendInvite is false so nothing is ever sent to it.
    body: JSON.stringify({
      firstName: name,
      lastName: "aerodance",
      email: `player+${phone.replace(/\D/g, "")}@aerodance.tech`,
      phoneNumber: phone,
      sendInvite: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.text();
  if (res.status === 401) throw new Error("PHOTON_TOKEN expired or invalid; run `npx @photon-ai/cli login` again");
  // Already on the allowlist is fine.
  if (!res.ok && !/already|exists|duplicate/i.test(body)) {
    throw new Error(`Photon user registration failed (${res.status}): ${body.slice(0, 200)}`);
  }
  if (res.ok && /"error"/.test(body) && !/already|exists/i.test(body)) {
    throw new Error(`Photon user registration failed: ${body.slice(0, 200)}`);
  }
  try {
    const user = JSON.parse(body)?.user;
    if (user?.assignedPhoneNumber) return toPhotonUser(user);
  } catch {}
  return findPhotonUser(phone).catch(() => undefined);
}
