// Phase 3p.34 — Vite env types for TypeScript JSDoc checking.
// These tell TS that import.meta.env exists with VITE_* string keys.

interface ImportMetaEnv {
  readonly VITE_MASSIVE_API_KEY: string;
  readonly VITE_ANTHROPIC_API_KEY: string;
  readonly VITE_EXA_API_KEY: string;
  readonly VITE_POLYGON_API_KEY: string;
  readonly VITE_NEWSDATA_KEY: string;
  readonly VITE_CURRENTS_KEY: string;
  readonly VITE_NYT_KEY: string;
  readonly VITE_EXCHANGERATE_KEY: string;
  readonly VITE_WEATHERSTACK_KEY: string;
  readonly VITE_IQAIR_KEY: string;
  readonly VITE_COINLAYER_KEY: string;
  readonly VITE_PORTFOLIO_OPT_KEY: string;
  readonly VITE_ALPACA_KEY: string;
  readonly VITE_ALPACA_SECRET: string;
  readonly VITE_MAPBOX_TOKEN: string;
  readonly VITE_EIA_API_KEY: string;
  // Permissive fallback so we don't break when new VITE_ keys are added
  readonly [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Internal monolith globals used by trade-feeds and other modules.
// These are set from various places in the app and read elsewhere
// — typing them centrally avoids ad-hoc casts. Kept loose because
// the shape varies across writers; tighten as modules opt in.
interface Window {
  __imoBackend?: any;
  __imoQuotes?: Record<string, any>;
  __pendingAIQuery?: string;
  __pendingSingleWidgetName?: string;
  __mapboxLoading?: Promise<any>;
  mapboxgl?: any;
  imoToast?: (message: string, kind?: 'info' | 'success' | 'warning' | 'error') => void;
}

// Node.js `global` (used in Vitest test setup for ResizeObserver polyfill)
declare const global: any;
