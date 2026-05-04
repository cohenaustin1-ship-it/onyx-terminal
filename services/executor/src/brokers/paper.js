// ─── Paper broker — simulated execution ─────────────────────────────────
// Used as the default + fallback. Mirrors the SPA's existing paper-trading
// behavior: every order "fills" instantly at market price.

export class PaperBroker {
  constructor() {
    this.name = 'paper';
  }

  async placeOrder({ symbol, side, qty, price }) {
    // Simulate ~50ms exchange latency
    await new Promise(r => setTimeout(r, 50));
    const orderId = `paper_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    return {
      id: orderId,
      symbol,
      side,
      qty,
      filled_qty: qty,
      filled_price: price,
      fees: price * qty * 0.0005,    // 5 bps
      status: 'filled',
    };
  }

  async cancelOrder(orderId) {
    return { id: orderId, status: 'canceled' };
  }

  async getPositions() {
    // Paper broker doesn't track its own positions — the executor's
    // Postgres is the source of truth.
    return [];
  }

  async getAccount() {
    return {
      cash: 100_000,
      buying_power: 100_000,
      portfolio_value: 100_000,
    };
  }
}
