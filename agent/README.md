# aerodance agent 🫧🐠

The iMessage side of aerodance: a [Photon Spectrum](https://photon.codes/docs/spectrum-ts) bot plus everything Solana.
Your phone number is your identity and your Solana devnet wallet. There's no signup and no login: you text the bot and you're dancing.

One Node process runs both:
- the Spectrum iMessage message loop, and
- a small HTTP API (default port 4000) that the game client/server call.

## Setup

```sh
cd agent
npm install
cp .env.example .env      # then fill in PROJECT_ID / PROJECT_SECRET from app.photon.codes
npm run treasury          # creates data/treasury.json and tries a devnet airdrop
npm run dev               # or: npm run start
```

If the airdrop is rate-limited, `npm run treasury` prints the treasury address. Paste it into
<https://faucet.solana.com> (devnet), then run `npm run treasury` again to see the balance.
The treasury pays for new-player funding (0.05 SOL each) and for the on-chain result receipts.

| Env var | Default | |
|---|---|---|
| `PROJECT_ID`, `PROJECT_SECRET` | | Photon dashboard → project settings |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | **Devnet or localhost only.** The agent refuses to start otherwise. |
| `BATTLE_BASE_URL` | `http://localhost:5173` | Where the game is served. Battle links are `${BATTLE_BASE_URL}/battle/<battleId>?p=<playerToken>` |
| `PORT` | `4000` | HTTP API port |

Local state lives in `agent/data/` (gitignored): `wallets.json`, `battles.json`, `seen.json`, `treasury.json`.
**Never commit it:** it holds devnet private keys and phone numbers.

## Texting the bot

On Photon's Pro plan the bot can only text numbers registered as Users in the Photon dashboard, and only in 1:1 DMs.

| Text | What happens |
|---|---|
| *(your first message, anything)* | Welcome, a devnet wallet is created and funded, and you get a battle link |
| `battle` | A new solo battle link |
| `challenge <phone>` | A 2-player battle. You get your link and the bot texts the opponent theirs. If they aren't a registered Photon user, you get their link to send yourself. |
| `wallet` | Your devnet address, balance and Solana Explorer link |
| `help` | The command list |

Commands are case-insensitive.

## HTTP API

CORS is open to `localhost` / `127.0.0.1` on any port, plus the `BATTLE_BASE_URL` origin.
Phone numbers are never returned and never put in URLs. Players are identified by an opaque `playerToken`.

### `GET /health`

```sh
curl localhost:4000/health
# {"ok":true,"cluster":"devnet","rpc":"api.devnet.solana.com","treasury":"<address>"}
```

### `POST /battles`

Start a battle from the website. `players` is optional (default 2, max 8).

```sh
curl -X POST localhost:4000/battles -H 'content-type: application/json' -d '{"players":2}'
# {"battleId":"8j3knh","url":"http://localhost:5173/battle/8j3knh?p=<token1>",
#  "players":[{"token":"<token1>","url":"..."},{"token":"<token2>","url":"..."}]}
```

### `GET /battles/:id`

```sh
curl localhost:4000/battles/8j3knh
# {"id":"8j3knh","status":"open|finalizing|finished","players":[{"token":"...","wallet":"<devnet address>|null","result":{...}|null}],
#  "winnerToken":"<token>|null (tie)","receipt":{"status":"pending|confirmed","signature":"...","explorer":"https://explorer.solana.com/tx/...?cluster=devnet"}}
```

### `POST /battles/:id/result`

Each player reports once. `score` is required. `pops`, `sync` and `flair` default to 0. All must be non-negative numbers.

```sh
curl -X POST localhost:4000/battles/8j3knh/result -H 'content-type: application/json' \
  -d '{"playerToken":"<token1>","score":8200,"pops":41,"sync":87,"flair":12}'
```

Errors: `400` bad body, `403` unknown token, `404` unknown battle, `409` already reported or battle finished.

When every player has reported (or 90 s after the first report), the battle is settled:
1. Highest `score` wins (an equal top score is a tie).
2. A memo is written on-chain with the SPL Memo program, signed by the treasury:
   `{"app":"aerodance","battleId":"8j3knh","scores":{"<wallet address or p2>":8200,...}}`.
   Players who joined by text are labelled with their devnet wallet address. Website-only players are labelled `p1`, `p2`, ….
3. Every player who joined by text gets a message with the result, their score and the Explorer link.

If Solana is slow or down, players still get their result right away, with a note that the receipt is pending. The agent keeps retrying in the background every 30 s and texts the link once it lands. Retries resend the same signed transaction until its blockhash expires, so a battle never gets two memos.

## Code map

- `src/index.ts`: wiring (bot + HTTP + background sweeper)
- `src/bot.ts`: Spectrum iMessage loop and commands
- `src/http.ts`: Express API
- `src/battles.ts`: battle lifecycle and phone-as-wallet
- `src/solana.ts`: devnet guard, treasury, funding, memo receipts
- `src/store.ts`: atomic JSON-file storage under `data/`
- `src/treasury.ts`: the `npm run treasury` script

## Credits

Built with help from [Claude Code](https://claude.com/claude-code) (AI coding assistant).
