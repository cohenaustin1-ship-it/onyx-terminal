# JPM Onyx Terminal

A Hyperliquid-style institutional derivatives trading platform built on JP Morgan's permissioned Kadena Chainweb. Supports crypto perpetuals and oil/energy futures with sub-millisecond perceived latency, cryptographic BFT finality, and T+0 cash settlement via JPM Coin.

## Full architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     React Terminal (src/, JPMOnyxTerminal.jsx)          │
│   TopBar · Instrument list · Chart · Book · Entry · Positions · Risk    │
│                    sequencerClient.js  +  marketDataAdapter.js          │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  WebSocket (mTLS, X.509)
                               │  Protocol: schemas/messages.ts
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 Rust Sequencer (sequencer/, <1ms p99)                    │
│   Gateway → Risk pre-check → LMAX ring → Matcher pool                   │
│   Adapters: ICE / CME / EIA / simulated                                 │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │  Pipelined HotStuff BFT (~4ms)
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│              Permissioned Chainweb (20 chains, pact/ modules)            │
│   CH-0   clearinghouse, compliance, settlement                          │
│   CH-3-5 crypto perpetuals (BTC, ETH, SOL)                              │
│   CH-10-12  energy futures (WTI, Brent, NG, HO)                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Project layout

```
jpm-platform/
├── JPMOnyxTerminal.jsx           Main React trading UI
├── index.html                    Vite entry
├── package.json, vite.config.js, tailwind.config.js, postcss.config.js
│
├── pact/                         On-chain smart contracts
│   ├── order-book.pact           CLOB with price-time priority matching
│   ├── clearinghouse.pact        Cross-chain margin + MtM + liquidation
│   └── compliance.pact           LEI whitelist + limits + surveillance + reg reports
│
├── sequencer/                    Rust sub-ms sequencer
│   ├── Cargo.toml
│   ├── config/sequencer.toml     Production config sample
│   ├── README.md                 Build + tuning guide
│   └── src/
│       ├── main.rs               Process entry, spawns all subsystems
│       ├── config.rs             TOML + env config loader
│       ├── schemas.rs            Message types (mirror of schemas/messages.ts)
│       ├── ring_buffer.rs        LMAX Disruptor — lock-free, cache-padded
│       ├── gateway.rs            WebSocket server, auth, fan-out
│       ├── matcher.rs            Per-instrument matching engine
│       ├── risk.rs               Sub-μs pre-trade checks
│       ├── pact_client.rs        Batched Chainweb submission
│       ├── consensus.rs          HotStuff BFT client
│       └── marketdata.rs         ICE/CME/EIA/simulated adapters
│
├── schemas/                      WebSocket protocol (source of truth)
│   ├── messages.ts               TypeScript definitions + type guards
│   └── messages.json             JSON Schema with conditional validation
│
└── src/
    ├── main.jsx, index.css       Vite entry
    └── lib/
        ├── sequencerClient.js    WebSocket client + React hooks
        └── marketDataAdapter.js  Client-side ICE/CME/EIA hub with failover
```

## Latency budget

| Stage | p50 | p99 |
|---|---|---|
| Network ingress (DPDK) | 2 μs | 5 μs |
| Order parse + risk check | 3 μs | 8 μs |
| Ring publish | 200 ns | 500 ns |
| Optimistic ack → UI | **0.6 ms** | **0.9 ms** |
| Pipelined HotStuff BFT | 3.5 ms | 5 ms |
| Cross-chain SPV settlement | 10 ms | 15 ms |

## Instruments

**Crypto perpetuals** (chains 3–5, up to 20×):
`BTC-PERP`, `ETH-PERP`, `SOL-PERP`

**Energy futures** (chains 10–12, up to 50×):
`WTI-F26`, `BRENT-F26`, `NG-G26`, `HO-F26`

## Getting started

### UI only (simulated data)
```bash
npm install
npm run dev
```
Opens `http://localhost:5173` against the in-browser simulated feed.

### Full stack (sequencer + UI)
```bash
# Terminal 1 — sequencer
cd sequencer
cargo build --release
export EIA_API_KEY=$(cat ~/.jpm/eia.key)
./target/release/sequencer --config config/sequencer.toml

# Terminal 2 — UI
npm run dev
```

Then in `JPMOnyxTerminal.jsx`, replace the simulated hooks with:
```js
import { useSequencer, useOrderBook, useTicker } from './src/lib/sequencerClient.js';
const { client } = useSequencer({
  endpoints: { wsFast: 'wss://localhost:9443/ws/fast' },
  lei: '8L5TE3JPMLEIXXX00',
  desk: 'ECM-147',
});
const book = useOrderBook(client, activeInstrument.id);
```

### ICE / CME real data (licensed)
Set credentials via env vars and flip `marketdata.fallback` to `"none"`:
```bash
export JPM_ICE_API_KEY=...
export JPM_CME_API_TOKEN=...
```
The market data hub will fall through ICE → CME → EIA → simulated per symbol. EIA is free (register at https://www.eia.gov/opendata/register.php).

## Compliance enforcement

Every order flows through `compliance.require-whitelisted` on-chain:
1. LEI frozen check
2. OFAC / sanctions screening result
3. KYC approved + not expired
4. AML score ≤ 60
5. Risk tier not "restricted"
6. Product class in allowed list
7. Position limits (long, short, notional)
8. Rolling notional window (1d / 7d / 30d)

Surveillance flags (wash, spoof, layering, marking-the-close) come from an off-chain engine that writes back to `compliance.pact` via the `SURVEILLANCE_ENGINE` keyset. Critical flags auto-freeze the account.

Reg reports (CFTC Part 43/45, SEC Reg NMS, MiFID II RTS 22) queue on-chain for an off-chain `RegReg` forwarder to push to DTCC / SDR / APA.

## Vs. public Hyperliquid

| Dimension | Hyperliquid | JPM Onyx |
|---|---|---|
| Consensus | HyperBFT (permissionless) | HotStuff (21 validators) |
| Identity | Wallet | LEI + X.509 + keyset |
| Settlement | USDC | JPM Coin, T+0 |
| Assets | Crypto | Crypto + physical energy |
| Regulator access | None | Read-only validator node |
| Liquidation | On-chain auction | ISDA close-out netting |
| Compliance | None | Full Pact module (LEI, KYC, limits, surveillance, reg reports) |
| Listing | Community | JPM ECM + compliance review |

## Security

- mTLS + X.509 client certs on every WebSocket connection
- Keysets backed by JPM HSMs (AWS CloudHSM or on-prem SafeNet)
- JPM Coin bridge uses 3-of-5 officer threshold multi-sig
- Validator nodes in JPM NY4/LD4/TY3 with InfiniBand RDMA
- Sequencer uses kernel-bypass DPDK, no TCP/IP stack in hot path
- Regulators see every event but cannot submit transactions
- All Pact modules use capability-based access control (`defcap`)
- 3-of-5 compliance officer signatures required for LEI unfreeze

## License

Internal — JP Morgan Chase & Co. Not for external distribution.
