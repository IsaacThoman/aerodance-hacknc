// Registers phone numbers as Spectrum users so the shared-pool line may text them.
// Same endpoint the `photon spectrum users add` CLI uses. Needs a dashboard
// token (PHOTON_TOKEN, from `photon login`), not the project secret.
const API_HOST = (process.env.PHOTON_API_HOST || "https://app.photon.codes").replace(/\/$/, "");

export const photonEnabled = () => !!process.env.PHOTON_TOKEN;

export async function registerPhotonUser(phone: string, name: string): Promise<void> {
  if (!photonEnabled()) throw new Error("PHOTON_TOKEN not set");
  const res = await fetch(`${API_HOST}/api/projects/${process.env.PROJECT_ID}/spectrum/users`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.PHOTON_TOKEN}` },
    body: JSON.stringify({ firstName: name, lastName: "aerodance", phoneNumber: phone, sendInvite: false }),
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
}
