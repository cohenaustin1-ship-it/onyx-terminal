"""
Coinbase Advanced Trade WebSocket producer.

Connects to wss://ws-feed.exchange.coinbase.com, subscribes to the matches
channel (= every executed trade), buffers, batches into DuckDB.

This is a REAL implementation against Coinbase's public WS — no auth needed
for matches channel. Reconnects with exponential backoff on disconnect.
"""
import asyncio
import json
import time
import logging
import os

import websockets

from app import db


log = logging.getLogger("coinbase")

WS_URL = "wss://ws-feed.exchange.coinbase.com"


class CoinbaseProducer:
    def __init__(self, symbols: list[str], batch_size: int = 50, flush_seconds: float = 2.0):
        self.symbols = symbols
        self.batch_size = batch_size
        self.flush_seconds = flush_seconds
        self.buffer = []
        self.last_flush = time.time()
        self._stop = False
        self.subscribers = set()  # WebSocket clients that want live fan-out
        self.last_prices = {}     # symbol → last price (for fan-out + /latest endpoint)

    def stop(self):
        self._stop = True

    def add_subscriber(self, queue: asyncio.Queue):
        self.subscribers.add(queue)

    def remove_subscriber(self, queue: asyncio.Queue):
        self.subscribers.discard(queue)

    async def _broadcast_tick(self, tick: dict):
        """Fan-out a tick to all SPA WebSocket subscribers."""
        dead = set()
        for q in self.subscribers:
            try:
                q.put_nowait(tick)
            except asyncio.QueueFull:
                dead.add(q)
        for q in dead:
            self.subscribers.discard(q)

    async def _flush(self):
        if not self.buffer:
            return
        rows = list(self.buffer)
        self.buffer.clear()
        # DB write is sync; offload to thread pool so we don't block the event loop
        await asyncio.to_thread(db.insert_ticks, rows)
        # Heartbeat — last tick timestamp from this batch
        last_ts = max(r[1] for r in rows)
        await asyncio.to_thread(
            db.update_heartbeat, "coinbase", last_ts, len(rows), True
        )
        log.info(f"flushed {len(rows)} ticks to DuckDB (last_ts={last_ts})")
        self.last_flush = time.time()

    async def _flusher_loop(self):
        """Background task that flushes the buffer at most every flush_seconds
        even if the batch_size threshold isn't reached."""
        while not self._stop:
            await asyncio.sleep(self.flush_seconds)
            if (time.time() - self.last_flush) >= self.flush_seconds:
                await self._flush()

    async def run(self):
        backoff = 1.0
        flusher = asyncio.create_task(self._flusher_loop())
        try:
            while not self._stop:
                try:
                    log.info(f"connecting to {WS_URL}...")
                    async with websockets.connect(
                        WS_URL,
                        ping_interval=15,
                        ping_timeout=10,
                        close_timeout=5,
                    ) as ws:
                        backoff = 1.0  # reset on successful connect
                        await ws.send(json.dumps({
                            "type": "subscribe",
                            "channels": [{"name": "matches", "product_ids": self.symbols}],
                        }))
                        log.info(f"subscribed to {self.symbols}")
                        await asyncio.to_thread(
                            db.update_heartbeat, "coinbase", int(time.time() * 1000), 0, True
                        )
                        async for msg in ws:
                            if self._stop:
                                break
                            await self._handle_message(msg)
                except (websockets.WebSocketException, OSError) as e:
                    log.warning(f"WS error: {e}; reconnecting in {backoff}s")
                    await asyncio.to_thread(
                        db.update_heartbeat, "coinbase", int(time.time() * 1000), 0, False
                    )
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 60)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    log.exception(f"unexpected error: {e}")
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, 60)
        finally:
            flusher.cancel()
            await self._flush()

    async def _handle_message(self, msg):
        try:
            data = json.loads(msg)
        except json.JSONDecodeError:
            return
        # Coinbase sends 'subscriptions' confirmation, 'last_match' (snapshot),
        # then 'match' events for each trade. We accept both 'match' and 'last_match'.
        msg_type = data.get("type")
        if msg_type not in ("match", "last_match"):
            return
        symbol = data.get("product_id")
        if not symbol:
            return
        try:
            price = float(data["price"])
            size = float(data["size"])
        except (KeyError, ValueError, TypeError):
            return
        # parse 'time' as ISO 8601 → ms epoch
        try:
            from datetime import datetime
            ts = int(datetime.fromisoformat(data["time"].rstrip("Z")).timestamp() * 1000)
        except (KeyError, ValueError):
            ts = int(time.time() * 1000)
        side = data.get("side")  # 'buy' or 'sell'
        # Translate Coinbase product IDs (BTC-USD) to canonical symbols (BTC).
        # The terminal uses bare ticker; we keep the upstream form too for de-dup.
        canonical = symbol.split("-")[0].upper()
        self.last_prices[canonical] = {"price": price, "ts": ts}
        self.buffer.append((canonical, ts, price, size, side, "coinbase"))
        # Fan out to live SPA subscribers
        await self._broadcast_tick({
            "symbol": canonical,
            "ts": ts,
            "price": price,
            "size": size,
            "side": side,
            "source": "coinbase",
        })
        if len(self.buffer) >= self.batch_size:
            await self._flush()
