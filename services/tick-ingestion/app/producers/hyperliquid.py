"""
Hyperliquid producer — STUB.

I'm leaving this as a stub on purpose. Hyperliquid's WS protocol involves
HIP-3 specifics (asset universe, oracle prices vs mark prices, mid vs trade
events) that need real domain understanding to map correctly. Faking that
would create silently-wrong data — worse than no data.

To implement: read https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket
and follow the Coinbase producer's shape. The patterns transfer; only the
upstream protocol differs.
"""
import asyncio
import logging

log = logging.getLogger("hyperliquid")


class HyperliquidProducer:
    def __init__(self, symbols=None, **kwargs):
        self.symbols = symbols or []
        self._stop = False

    def stop(self):
        self._stop = True

    def add_subscriber(self, queue):
        pass

    def remove_subscriber(self, queue):
        pass

    async def run(self):
        log.warning("Hyperliquid producer is a stub. Set HYPERLIQUID_ENABLED=false to silence.")
        # Don't crash — just sleep forever so the supervisor stays happy
        while not self._stop:
            await asyncio.sleep(60)
