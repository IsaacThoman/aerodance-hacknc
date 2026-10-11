# aerodance agent 🫧🐠

The Solana and iMessage side of aerodance: a [Photon Spectrum](https://photon.codes/docs/spectrum-ts) bot plus everything that touches Solana devnet.
Your phone number is your identity and your Solana devnet wallet. There's no signup and no login: you text the bot and you're dancing.

Battles, profiles, seats and results live in the app (`server/`), which owns the database schema.
The agent is a worker beside it in Compose, and it holds every Solana key:

- **Jobs:** the app adds rows to the `jobs` table and `NOTIFY`s `jobs`. The agent creates and funds wallets, links phones to Photon, writes the on-chain result receipt, texts the players and mints the winner's trophy NFT. Failed jobs retry with backoff, so a restart or a slow RPC never loses a receipt or a text.
- **Internal HTTP API** (port 4000, Compose network only), for things the app needs an answer to right away: `GET /wallets/:profileId` (address and balance), `POST /hype` (spectator → dancer transfer) and `POST /stickers` (a sticker NFT minted from the spectator's wallet into the dancer's).
- **The iMessage bot**, when `PROJECT_ID` and `PROJECT_SECRET` are set. Bot commands that create battles or profiles call the app's internal API (`app:3001`), so battle rules stay in one place. Without credentials (PR previews, local dev), texts are only logged.
- When a receipt lands or a phone gets linked, the agent `NOTIFY`s `changes` and the app pushes the update to displays and phones over Socket.IO.

## Setup

Usually you run it with the rest of the stack: `docker compose -f compose.yaml -f compose.local.yaml up --build` from the repository root.
To run it on its own against the local database:

```sh
cd agent
npm install
npm run treasury          # prints a new SOLANA_TREASURY_SECRET for ../.env and tries a devnet airdrop
npm run dev               # reads ../.env, then agent/.env if present
```

If the airdrop is rate-limited, `npm run treasury` prints the treasury address. Paste it into
<https://faucet.solana.com> (devnet), then run `npm run treasury` again to see the balance.
The treasury pays for new-player funding (0.05 SOL each) and for the on-chain result receipts.

| Env var | Default | |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/aerodance` | The app's TimescaleDB. The app creates the tables; the agent waits for them. |
| `APP_URL` | `http://app:3001` | The app's internal API |
| `INTERNAL_SECRET` | | Shared with the app. Both sides check it when set. |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | **Devnet or localhost only.** The agent refuses to start otherwise. |
| `SOLANA_TREASURY_SECRET` | | Base58 secret key, or a solana-keygen JSON byte array |
| `PROJECT_ID`, `PROJECT_SECRET` | | Photon dashboard → project settings. Unset = bot off. |
| `PHOTON_TOKEN` | | Dashboard token so the phone view can add numbers to Photon's allowlist (see below) |
| `PUBLIC_URL` | `http://localhost:3000` | The app's public address. Trophy NFTs point their metadata at `${PUBLIC_URL}/nft/<battleId>.json`. |
| `TROPHY_RENDERER_URL` | `http://renderer:4001` | Internal 3D trophy rendering service. In local development use `http://localhost:4001`; Compose sets this automatically. |
| `AGENT_PORT` | `4000` | Internal HTTP port |

Player wallets (devnet keys) and phone numbers live in the database. Don't point a preview at the production database.

**Photon registration** uses the same endpoint as `photon spectrum users add`, which needs a dashboard token rather than the project secret:

```sh
npx @photon-ai/cli login          # device login in the browser
# copy accessToken from the credentials file it prints/creates, then in .env:
PHOTON_TOKEN=...
```

Without `PHOTON_TOKEN`, profiles still work, but the bot can only text numbers you've added in the dashboard. The token expires after 7 days.

Only one deployment should run the bot for a Photon project, so set the Photon variables in production only.

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

Commands are case-insensitive. Battle links are `${PUBLIC_URL}/battle/<id>?p=<playerToken>` (`PUBLIC_URL` is set on the app).

## Receipts

When the app settles a battle it queues a `battle_finished` job:

1. A memo is written on-chain with the SPL Memo program, signed by the treasury:
   `{"app":"aerodance","battleId":"8j3knh","scores":{"<wallet address or p2>":8200,...}}`.
   Seated players are labelled with their devnet wallet address. Empty seats are labelled `p1`, `p2`, …. Names and phones never go on-chain.
2. Every dancer with a linked phone gets a text with the result, their score, crowd hype and the Explorer link.

3. The winner gets a trophy NFT ([Metaplex Core](https://developers.metaplex.com/core)) minted by the treasury into their devnet wallet, and a text when it lands. Ties and unclaimed seats get no trophy. Before minting, the agent asks the internal renderer for the battle's 3D trophy and stores the PNG in the database; a render failure retries without minting. The asset key is generated once and kept until the mint lands, so a retry finds the existing asset instead of minting a second one and reuses its saved artwork. The app serves the metadata at `/nft/<battleId>.json` and the art at `/nft/<battleId>.png`. See [Trophy renders](../temp/trophy-renders/README.md) for the rendering pipeline and existing NFT backfill.

If Solana is slow or down, players still get their result right away, with a note that the receipt is pending. A `receipt` job retries every 30 s and texts the link once it lands; a `trophy` job does the same for the NFT. Wallets that missed their starting SOL (say, while the treasury was empty) are retried every minute. Retries resend the same signed transaction until its blockhash expires, so a battle never gets two memos.

## Code map

- `src/index.ts`: wiring (jobs + HTTP + bot)
- `src/jobs.ts`: the jobs worker (claim, retry with backoff)
- `src/battles.ts`: receipts, result texts and trophies
- `src/nft.ts`: trophy and sticker minting (Metaplex Core via Umi)
- `src/players.ts`: wallets, Photon linking, iMessage notifier
- `src/bot.ts`: Spectrum iMessage loop and commands
- `src/app.ts`: client for the app's internal API
- `src/http.ts`: internal API for the app
- `src/db.ts`: database pool, LISTEN/NOTIFY
- `src/photon.ts`: adds phone numbers to the Photon allowlist
- `src/solana.ts`: devnet guard, treasury, funding, memo receipts
- `src/treasury.ts`: the `npm run treasury` script

## Credits

Built with help from [Claude Code](https://claude.com/claude-code) (AI coding assistant).
