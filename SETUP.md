# JPM Onyx Terminal — Local Setup Guide

Run the terminal on your computer with real live crypto prices from Coinbase and real oil prices from EIA.

## What you'll see when it's running

| Instrument | Data source | Cadence | Badge |
|---|---|---|---|
| BTC-PERP | Coinbase WebSocket (real) | Every trade | 🟢 LIVE |
| ETH-PERP | Coinbase WebSocket (real) | Every trade | 🟢 LIVE |
| SOL-PERP | Coinbase WebSocket (real) | Every trade | 🟢 LIVE |
| WTI-F26 | EIA REST (real settlements) | Daily | 🟡 EIA · DAILY |
| BRENT-F26 | EIA REST (real settlements) | Daily | 🟡 EIA · DAILY |
| NG-G26 | EIA REST (real settlements) | Daily | 🟡 EIA · DAILY |
| HO-F26 | EIA REST (real settlements) | Daily | 🟡 EIA · DAILY |

If any data source fails or your EIA key is missing, that instrument falls back to simulated data and the badge turns gray (`DEMO`).

---

## Step-by-step setup

### 1. Install Node.js

Download the LTS version from <https://nodejs.org/> and install. Verify in your terminal:

```bash
node -v    # should print v18.x or higher
npm -v     # should print 9.x or higher
```

### 2. Download the project

Unzip `jpm-onyx-terminal.zip` somewhere convenient (e.g. `~/code/jpm-onyx-terminal`). You should end up with a folder containing `package.json`, `JPMOnyxTerminal.jsx`, `index.html`, etc.

### 3. Register for a free EIA API key

Go to <https://www.eia.gov/opendata/register.php>. Enter your email, hit submit, and your key arrives in the inbox within seconds. The key looks like a 40-character hex string. Copy it.

> ⚠️ Skipping this step is fine — crypto will still work via Coinbase (no key needed). Oil instruments will just show `DEMO` data instead of real settlement prices.

### 4. Create your environment file

In the project root, copy the example file:

**macOS / Linux:**
```bash
cd ~/code/jpm-onyx-terminal/jpm-platform
cp .env.example .env.local
```

**Windows (PowerShell):**
```powershell
cd C:\code\jpm-onyx-terminal\jpm-platform
Copy-Item .env.example .env.local
```

Open `.env.local` in a text editor and paste your EIA key after `=`:

```bash
VITE_EIA_API_KEY=YOUR_40_CHARACTER_KEY_HERE
```

Save the file. Do not commit `.env.local` to git (it's already git-ignored).

### 5. Install dependencies

From the project root:

```bash
npm install
```

This downloads React, Vite, Tailwind, Recharts, lucide-react, and their transitive dependencies into `node_modules/`. First install takes 30–60 seconds.

### 6. Start the dev server

```bash
npm run dev
```

You should see output like:

```
  VITE v5.3.1  ready in 412 ms
  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### 7. Open in your browser

Navigate to <http://localhost:5173>. On first load you'll see the account-creation modal — enter any username, desk code, and legal name, accept the disclaimer, and you're in.

### 8. Verify real data is flowing

Click `BTC-PERP` in the instrument picker. Within a second or two, the badge next to the big price should change from `DEMO` (gray) to `LIVE` (green pulsing). The price will start updating every trade on Coinbase. Open Coinbase in another tab and confirm the prices match.

Click `WTI-F26`. The badge should change to `EIA · DAILY` (amber) within a second, and the price will update to the last settlement value from the US EIA. The history curve reflects the last ~90 days of real WTI prices.

---

## Troubleshooting

### "Command not found: npm"

Node.js isn't installed or isn't on your PATH. Re-run the Node installer and reopen your terminal.

### Installation fails with "EACCES" on macOS/Linux

Don't use `sudo`. Install Node via [`nvm`](https://github.com/nvm-sh/nvm) instead:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# restart terminal, then:
nvm install --lts
```

### Coinbase WebSocket never connects

Some corporate VPNs and firewalls block `wss://ws-feed.exchange.coinbase.com`. Try:
- Disabling your VPN
- Running from a non-corporate network
- Opening the browser's devtools Network tab, filtering to WS, and checking the connection error

### EIA badge stays gray (`DEMO`)

- Did you put the key in `.env.local`, not `.env`?
- Is the variable name exactly `VITE_EIA_API_KEY`?
- Did you restart `npm run dev` after creating `.env.local`? Vite only reads env files at startup.
- Test your key directly: paste this URL in a browser (replace `YOUR_KEY`):
  ```
  https://api.eia.gov/v2/seriesid/PET.RWTC.D?api_key=YOUR_KEY&length=1
  ```
  If it returns JSON with a price, the key works.

### Port 5173 is already in use

```bash
npm run dev -- --port 3000
```

### Want to build for production?

```bash
npm run build     # outputs to dist/
npm run preview   # serves dist/ locally on port 4173
```

You can also deploy the `dist/` folder to any static host (Vercel, Netlify, S3, Cloudflare Pages, etc.). Remember to set `VITE_EIA_API_KEY` in the host's env vars — the key is baked into the bundle at build time.

---

## What's real vs. what's simulated

Even with real prices connected, **the rest of the terminal remains simulated** — the JPM Onyx Chainweb, the order book matching, positions, fills, vaults, and the leaderboard are all demo data. This is intentional: there's no real JPM Onyx derivatives venue you can actually trade on. The real-world data layer just makes the chart and price display feel alive.

| What's real | What's simulated |
|---|---|
| Price ticks (crypto) | Order book depth |
| Historical prices (oil/gas) | Trade tape / counterparties |
| Chart axes and values | Positions and PnL |
| Live/Delayed/Demo badges | Chain events and BFT latency |
| Environment setup | JPM Coin settlement |

If you want to connect to a real exchange for order placement (not just data), you'd need exchange entitlement + API keys + signed agreements — that's outside the scope of this demo.
