# JPM Onyx Sequencer

Sub-millisecond order sequencer sitting between the React terminal and the permissioned Chainweb.

## Architecture

```
WebSocket gateway (mTLS, X.509)
     │
     ▼
Pre-validator (risk.rs, compliance cache)
     │
     ▼
LMAX ring buffer (ring_buffer.rs, lock-free)
     │
     ├──► Matcher pool (matcher.rs, one thread per instrument, CPU-pinned)
     ├──► Pact submitter (pact_client.rs, batched every 50ms)
     ├──► HotStuff replicator (consensus.rs, 21 validators)
     └──► Market data hub (marketdata.rs, ICE/CME/EIA/simulated)
```

## Modules

| File | Purpose |
|---|---|
| `main.rs` | Process entry, spawns all subsystems |
| `config.rs` | TOML + env config loader |
| `schemas.rs` | All message types (mirror of `schemas/messages.ts`) |
| `ring_buffer.rs` | LMAX Disruptor — single-producer, multi-consumer, cache-line padded |
| `gateway.rs` | Tungstenite WebSocket server, auth, fan-out |
| `matcher.rs` | Per-instrument matching engine, BTreeMap bid/ask ladders, price-time priority |
| `risk.rs` | Sub-μs pre-trade checks against cached compliance state |
| `pact_client.rs` | Batches ring events into Pact RPC calls to Chainweb validators |
| `consensus.rs` | HotStuff BFT client stub (real impl would use BLS signatures) |
| `marketdata.rs` | ICE / CME / EIA / simulated adapters implementing `MarketDataAdapter` trait |

## Build & run

```bash
# From sequencer/ directory
cargo build --release

# Provide secrets via env
export JPM_ICE_API_KEY=...
export JPM_CME_API_TOKEN=...
export EIA_API_KEY=$(cat ~/.jpm/eia.key)

# Run
./target/release/sequencer --config config/sequencer.toml --log-level info
```

## Latency targets

| Stage | p50 | p99 | p99.9 |
|---|---|---|---|
| WS message parse | 2 μs | 5 μs | 15 μs |
| Risk pre-check | 1 μs | 3 μs | 10 μs |
| Ring publish | 200 ns | 500 ns | 2 μs |
| Optimistic ack round-trip | 400 μs | 800 μs | 2 ms |
| BFT finalization (NY4-NY4) | 3.5 ms | 5 ms | 8 ms |

Hot-path budget: **<1 ms p99** from TCP recv to optimistic ack emitted.

## Tuning checklist (production)

- Pin each matcher thread to its dedicated core via `core_affinity` crate
- Pin the WebSocket gateway to a separate NUMA node from matchers
- Disable Intel Turbo Boost and C-states on matcher cores (predictable latency > peak)
- Use huge pages for the ring buffer allocation (`MAP_HUGETLB`)
- Run with `RUSTFLAGS="-C target-cpu=native"` for AVX-512 on newer Xeons
- Consider FPGA offload for order parsing when order rate > 500k/s sustained
- Use DPDK or `io_uring` for the WebSocket listener at high connection counts

## ICE / CME credentials

ICE and CME data is licensed. To wire up real feeds:

1. **ICE** — JPM ICE Data Services contract. Endpoint is typically `https://webice.theice.com/`. Get an API key and username from the ICE relationship manager; set via `JPM_ICE_API_KEY` env var. `IceAdapter` uses REST snapshot polling (~500ms cadence); for true tick data, replace the REST poll with a FIX 4.4 session using `quickfix-rs`.

2. **CME** — CME Globex or CME DataMine entitlement. Endpoint is typically `https://datamine.cmegroup.com/` for historicals, `mdp3.cmegroup.com` for real-time MDP 3.0 (requires co-location / direct connection). The stub uses REST; a production build would decode their SBE (Simple Binary Encoding) multicast. Use `sbe-tool` to generate a Rust decoder from their XML schema.

3. **EIA** — Free, no contract needed. Register at https://www.eia.gov/opendata/register.php to get an API key. Daily cadence only — used as a sanity-check floor and for physically-settled futures expiry valuation.

For development, the `SimulatedAdapter` always runs as the final fallback.

## Failover

The `MarketDataHub` subscribes to multiple adapters per symbol. If the primary adapter's health check fails or its subscription errors, the hub falls through to the next adapter in the chain. For oil derivatives the typical chain is:

```
ICE (primary, tick)  →  CME (backup, tick)  →  EIA (sanity, daily)  →  Simulated (dev)
```

For crypto perpetuals:

```
CME CF reference rate  →  Chainlink on Chainweb  →  Simulated
```

Both primaries are cross-checked: if ICE and CME disagree by >50bp, the sequencer emits a `ChainEvent { kind: "oracle_divergence" }` and suspends new orders until operator review.
