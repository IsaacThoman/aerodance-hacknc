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
| `PUBLIC_URL` | `http://<LAN IP>:PORT` | Where phones reach the agent. The QR code points here. |
| `PHOTON_TOKEN` | | Dashboard token so the join page can add numbers to Photon's allowlist (see below) |

Local state lives in `agent/data/` (gitignored): `profiles.json`, `wallets.json`, `battles.json`, `seen.json`, `treasury.json`.
**Never commit it:** it holds devnet private keys and phone numbers.

## Phone join flow (QR → PWA)

1. The display shows a battle's QR code: `<img src="http://localhost:4000/battles/<id>/qr.svg">`.
2. Scanning it opens `PUBLIC_URL/join/<id>`. First-timers enter a name (blank → a Frutiger Aero name like "Glassy Orca") and an optional iPhone number. No verification and no password.
3. The first two people to join take the dancer seats. Everyone after that is a spectator who can **Hype** a dancer, which sends 0.005 devnet SOL from their wallet to the dancer's, on-chain with a memo.
4. Returning players are recognized by a device token in `localStorage`, so the form comes prefilled and they can still edit it. Entering a number that already has a profile switches the device to that profile. That's how stats follow you to a new browser or the Home Screen app.
5. Adding a phone registers it as a Photon user and the bot texts a welcome. After that, results, hype totals and receipts arrive over iMessage.

Every profile gets a devnet wallet funded with 0.05 SOL, with or without a phone. Stats (battles, wins, best score, bubbles popped, hype received) live on the profile.

**Photon registration** uses the same endpoint as `photon spectrum users add`, which needs a dashboard token rather than the project secret:

```sh
npx @photon-ai/cli login          # device login in the browser
# copy accessToken from the credentials file it prints/creates, then in .env:
PHOTON_TOKEN=...
```

Without `PHOTON_TOKEN`, profiles still work, but the bot can only text numbers you've added in the dashboard. The token expires after 7 days.

**Phones must be able to reach `PUBLIC_URL`.** Campus Wi-Fi often blocks device-to-device traffic, so for the demo use a tunnel (`cloudflared tunnel --url http://localhost:4000`) or the deployed domain, and set `PUBLIC_URL` to it.

## Texting the bot

On Photon's Pro plan the bot can only text numbers registered as Users in the Photon dashboard, and only in 1:1 DMs.

| Text | What happens |
|---|---|
| *(your first message, anything)* | Welcome with your Frutiger Aero name. A profile and funded devnet wallet are created, and you get a battle link. |
| `battle` | A new solo battle link |
| `challenge <phone>` | A 2-player battle. You get your link and the bot texts the opponent theirs ("Glassy Orca challenged you!"). If they aren't a registered Photon user, you get their link to send yourself. |
| `wallet` | Your devnet address, balance and Solana Explorer link |
| `stats` | Battles, wins, best score, bubbles popped, crowd hype |
| `name <new name>` | Change your display name |
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

Public: it's what phones poll. It has names and seats only, never player tokens or phone numbers.

```sh
curl localhost:4000/battles/8j3knh
# {"id":"8j3knh","status":"open|finalizing|finished","spectators":3,
#  "players":[{"seat":0,"name":"Glassy Orca","wallet":"<devnet address>|null","result":{...}|null,"hype":{"count":2,"sol":0.01}}, ...],
#  "winnerSeat":0,            // null while playing, or null + finished = tie
#  "receipt":{"status":"pending|confirmed","signature":"...","explorer":"https://explorer.solana.com/tx/...?cluster=devnet"}}
```

### `GET /battles/:id/qr.svg` and `GET /battles/:id/join-url`

The QR image for the display, and the URL it encodes (`{ "url": "http://<PUBLIC_URL>/join/8j3knh" }`).

```sh
curl localhost:4000/battles/8j3knh/qr.svg -o qr.svg
```

### Phone endpoints

These are used by the join page. Identity comes from the `x-device-token` header returned by `POST /me`.

```sh
# create or update a profile (both fields optional)
curl -X POST localhost:4000/me -H 'content-type: application/json' -d '{"name":"Glassy Orca","phone":"(919) 555-0123"}'
# → {"deviceToken":"...","me":{"name":"Glassy Orca","phone":"+19195550123","imessage":"registered|pending|failed|none","stats":{...},"wallet":{...}}}

curl localhost:4000/me -H 'x-device-token: <token>'
curl -X POST localhost:4000/battles/8j3knh/join -H 'x-device-token: <token>'      # → {"role":"dancer","seat":0} or {"role":"spectator","seat":null}
curl -X POST localhost:4000/battles/8j3knh/hype -H 'x-device-token: <token>' \
  -H 'content-type: application/json' -d '{"seat":0}'                            # → {"signature":"...","explorer":"..."}
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
   Seated players are labelled with their devnet wallet address. Empty seats are labelled `p1`, `p2`, …. Names and phones never go on-chain.
3. Every dancer with a linked phone gets a text with the result, their score, crowd hype and the Explorer link. Profile stats update.

If Solana is slow or down, players still get their result right away, with a note that the receipt is pending. The agent keeps retrying in the background every 30 s and texts the link once it lands. Retries resend the same signed transaction until its blockhash expires, so a battle never gets two memos.

## Code map

- `src/index.ts`: wiring (bot + HTTP + background sweeper)
- `src/bot.ts`: Spectrum iMessage loop and commands
- `src/http.ts`: Express API
- `src/battles.ts`: battle lifecycle, seats, hype, results and receipts
- `src/players.ts`: profiles, Frutiger Aero names, wallets, iMessage notifier
- `src/photon.ts`: adds phone numbers to the Photon allowlist
- `public/`: the phone join page (PWA), manifest and icon
- `src/solana.ts`: devnet guard, treasury, funding, memo receipts
- `src/store.ts`: atomic JSON-file storage under `data/`
- `src/treasury.ts`: the `npm run treasury` script

## Credits

Built with help from [Claude Code](https://claude.com/claude-code) (AI coding assistant).
