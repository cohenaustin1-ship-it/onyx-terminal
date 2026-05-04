// ─── Alpaca broker adapter — real paper-trading REST integration ──────────
//
// Talks to Alpaca's paper-trading API (https://paper-api.alpaca.markets).
// Uses your existing ALPACA_KEY_ID / ALPACA_SECRET_KEY env vars.
//
// Note: this is the MARKETS API (orders, positions). Alpaca also has a
// separate DATA API for tick/bar data — not used here since we have the
// tick-ingestion service.

import axios from 'axios';

export class AlpacaBroker {
  constructor() {
    this.name = 'alpaca';
    this.keyId = process.env.ALPACA_KEY_ID;
    this.secret = process.env.ALPACA_SECRET_KEY;
    this.baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    if (!this.keyId || !this.secret) {
      throw new Error('AlpacaBroker requires ALPACA_KEY_ID and ALPACA_SECRET_KEY');
    }
    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'APCA-API-KEY-ID':     this.keyId,
        'APCA-API-SECRET-KEY': this.secret,
      },
      timeout: 5000,
    });
  }

  async placeOrder({ symbol, side, qty, price, orderType = 'market' }) {
    // Alpaca side is 'buy' or 'sell', which matches our convention.
    const payload = {
      symbol,
      qty: String(qty),
      side,
      type: orderType,
      time_in_force: 'day',
    };
    if (orderType === 'limit') payload.limit_price = String(price);
    try {
      const { data } = await this.http.post('/v2/orders', payload);
      return {
        id: data.id,
        symbol: data.symbol,
        side: data.side,
        qty: parseFloat(data.qty),
        filled_qty: parseFloat(data.filled_qty || 0),
        filled_price: parseFloat(data.filled_avg_price || price),
        fees: 0,                          // Alpaca paper has no commission
        status: data.status,
      };
    } catch (e) {
      const detail = e.response?.data || e.message;
      throw new Error(`Alpaca order rejected: ${JSON.stringify(detail)}`);
    }
  }

  async cancelOrder(orderId) {
    await this.http.delete(`/v2/orders/${orderId}`);
    return { id: orderId, status: 'canceled' };
  }

  async getPositions() {
    const { data } = await this.http.get('/v2/positions');
    return data.map(p => ({
      symbol: p.symbol,
      qty: parseFloat(p.qty),
      avg_entry_price: parseFloat(p.avg_entry_price),
      current_price: parseFloat(p.current_price),
      market_value: parseFloat(p.market_value),
      unrealized_pl: parseFloat(p.unrealized_pl),
    }));
  }

  async getAccount() {
    const { data } = await this.http.get('/v2/account');
    return {
      cash: parseFloat(data.cash),
      buying_power: parseFloat(data.buying_power),
      portfolio_value: parseFloat(data.portfolio_value),
      currency: data.currency,
    };
  }
}
