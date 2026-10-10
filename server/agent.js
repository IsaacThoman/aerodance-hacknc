// Client for the agent's internal API (Solana wallets and hype). Never exposed publicly.
const agentUrl = new URL(process.env.AGENT_URL || 'http://agent:4000');
// Coolify renames Compose services in PR previews; see db.js.
if (agentUrl.hostname === 'agent' && process.env.SERVICE_NAME_AGENT) {
  agentUrl.hostname = process.env.SERVICE_NAME_AGENT;
}

export class AgentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function agentCall(method, path, body, timeoutMs = 10_000) {
  let res;
  try {
    res = await fetch(new URL(path, agentUrl), {
      method,
      headers: {
        'content-type': 'application/json',
        ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new AgentError(503, `agent unreachable (${err.message})`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AgentError(res.status, data.error || `agent returned ${res.status}`);
  return data;
}
