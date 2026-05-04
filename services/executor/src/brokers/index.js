import { PaperBroker } from './paper.js';
import { AlpacaBroker } from './alpaca.js';
import { BitgetBroker } from './bitget.js';

export function createBroker(name = process.env.BROKER_ADAPTER || 'paper') {
  switch (name) {
    case 'paper':  return new PaperBroker();
    case 'alpaca': return new AlpacaBroker();
    case 'bitget': return new BitgetBroker();
    default:
      console.warn(`[broker] unknown adapter "${name}", falling back to paper`);
      return new PaperBroker();
  }
}
