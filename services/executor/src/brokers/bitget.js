// ─── Bitget broker — STUB ────────────────────────────────────────────────
//
// Reference implementation: bot.js in claude-tradingview-mcp-trading.
// Real Bitget needs HMAC-SHA256 signing of every request body — see
// signBitGet() in bot.js. Not implementing here because:
//   1. It would commit me to testing against your real BitGet account
//   2. I can't safely place orders against your live keys from this session
//
// To enable: copy signBitGet() and placeBitGetOrder() from bot.js,
// adapt to the BrokerAdapter interface, and test on Bitget's testnet first.

export class BitgetBroker {
  constructor() {
    this.name = 'bitget';
    throw new Error('BitgetBroker is a stub. See src/brokers/bitget.js for implementation guide.');
  }

  async placeOrder() { throw new Error('not implemented'); }
  async cancelOrder() { throw new Error('not implemented'); }
  async getPositions() { throw new Error('not implemented'); }
  async getAccount() { throw new Error('not implemented'); }
}
