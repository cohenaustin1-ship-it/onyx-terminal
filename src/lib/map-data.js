// @ts-check
// IMO Onyx Terminal — Map data fixtures
//
// Phase 3p.37: extracted from JPMOnyxTerminal.jsx (lines 50738-52103).
// 26 geographic and financial-event data fixtures used by map-page.jsx,
// scanner-page.jsx, and the monolith.
//
// All fixtures here are pure data (no functions). projectLatLng (the
// SVG projection helper that lived next to MAP_MARKETS in the monolith)
// stayed in the monolith because no extracted module currently uses it.

import { COLORS } from './constants.js';

// Mock flight/ship positions. Real data would come from OpenSky Network
// (flights, free) and AISHub (ships, free tier) — both REST endpoints.
// Positions are lat/lng pairs; we project to the SVG viewBox below.
export const MAP_FLIGHTS = [
  { id: 'UAL123', type: 'flight', from: 'SFO', to: 'JFK', lat: 39.8,  lng: -98.6, heading: 85,  alt: 36000, speed: 485 },
  { id: 'DAL456', type: 'flight', from: 'LAX', to: 'LHR', lat: 52.3,  lng: -15.7, heading: 72,  alt: 38000, speed: 510 },
  { id: 'AAL789', type: 'flight', from: 'MIA', to: 'GRU', lat: -5.2,  lng: -42.4, heading: 165, alt: 35000, speed: 470 },
  { id: 'BAW012', type: 'flight', from: 'LHR', to: 'HKG', lat: 48.1,  lng: 62.3,  heading: 95,  alt: 37000, speed: 495 },
  { id: 'SIA345', type: 'flight', from: 'SIN', to: 'FRA', lat: 25.4,  lng: 55.8,  heading: 298, alt: 39000, speed: 485 },
  { id: 'QFA678', type: 'flight', from: 'SYD', to: 'DFW', lat: 12.5,  lng: -142.6, heading: 52, alt: 38000, speed: 475 },
  { id: 'JAL901', type: 'flight', from: 'NRT', to: 'SFO', lat: 42.3,  lng: -162.8, heading: 88, alt: 36000, speed: 490 },
  { id: 'AFR234', type: 'flight', from: 'CDG', to: 'GRU', lat: 8.7,   lng: -22.4, heading: 195, alt: 37000, speed: 480 },
  { id: 'LH567',  type: 'flight', from: 'FRA', to: 'EZE', lat: -12.3, lng: -28.5, heading: 210, alt: 38000, speed: 475 },
  { id: 'EK890',  type: 'flight', from: 'DXB', to: 'JFK', lat: 51.2,  lng: 8.5,   heading: 305, alt: 39000, speed: 505 },
];

export const MAP_SHIPS = [
  { id: 'MAERSK-EVELYN',  type: 'ship', cargo: 'container',   flag: 'DK', lat: 34.2,  lng: -142.5, heading: 75,  speed: 22 },
  { id: 'MSC-OSCAR',      type: 'ship', cargo: 'container',   flag: 'PA', lat: 48.8,  lng: -32.4,  heading: 98,  speed: 21 },
  { id: 'COSCO-PACIFIC',  type: 'ship', cargo: 'container',   flag: 'CN', lat: 18.5,  lng: 115.2,  heading: 45,  speed: 19 },
  { id: 'ES-ARROW',       type: 'ship', cargo: 'tanker',      flag: 'LR', lat: 24.5,  lng: 56.3,   heading: 182, speed: 14 },
  { id: 'FRONTIER-EAGLE', type: 'ship', cargo: 'tanker',      flag: 'US', lat: 28.4,  lng: -88.1,  heading: 120, speed: 13 },
  { id: 'PACIFIC-BEAR',   type: 'ship', cargo: 'bulk',        flag: 'GR', lat: -32.1, lng: 122.4,  heading: 275, speed: 16 },
  { id: 'STAR-LEGEND',    type: 'ship', cargo: 'bulk',        flag: 'GR', lat: 14.3,  lng: -52.5,  heading: 310, speed: 15 },
  { id: 'NORDIC-ICE',     type: 'ship', cargo: 'lng',         flag: 'NO', lat: 58.2,  lng: -14.5,  heading: 255, speed: 17 },
  { id: 'GAS-PIONEER',    type: 'ship', cargo: 'lng',         flag: 'QA', lat: 22.5,  lng: 62.4,   heading: 95,  speed: 18 },
];

// Pre-declared exchange hubs — relevant when the 'markets' filter is active
export const MAP_MARKETS = [
  { id: 'NYSE',  type: 'market', name: 'New York Stock Exchange',    lat: 40.71, lng: -74.01 },
  { id: 'NASDAQ',type: 'market', name: 'Nasdaq',                     lat: 40.76, lng: -73.98 },
  { id: 'LSE',   type: 'market', name: 'London Stock Exchange',      lat: 51.51, lng: -0.10 },
  { id: 'TSE',   type: 'market', name: 'Tokyo Stock Exchange',       lat: 35.68, lng: 139.76 },
  { id: 'HKEX',  type: 'market', name: 'Hong Kong Exchange',         lat: 22.28, lng: 114.16 },
  { id: 'SSE',   type: 'market', name: 'Shanghai Stock Exchange',    lat: 31.23, lng: 121.48 },
  { id: 'SGX',   type: 'market', name: 'Singapore Exchange',         lat: 1.28,  lng: 103.85 },
  { id: 'BSE',   type: 'market', name: 'Bombay Stock Exchange',      lat: 18.93, lng: 72.83 },
  { id: 'FWB',   type: 'market', name: 'Frankfurt Stock Exchange',   lat: 50.11, lng: 8.68 },
  { id: 'ASX',   type: 'market', name: 'Australian Securities Exch.',lat: -33.86,lng: 151.21 },
  { id: 'B3',    type: 'market', name: 'B3 (São Paulo)',             lat: -23.55,lng: -46.63 },
  { id: 'DIFX',  type: 'market', name: 'Dubai Financial Market',     lat: 25.27, lng: 55.29 },
];


// Mapbox access token — MUST be set via VITE_MAPBOX_TOKEN in Vercel env vars.
// Sign up free at https://account.mapbox.com/access-tokens/ and create a
// default public token (starts with "pk."). If unset, the map shows an
// instructive error instead of silently failing.

// ────── Supply chain dataset ──────
// Real-world facility locations for major equity tickers. Each entry has:
//   ticker — owning company
//   name — facility name
//   type — 'hq' | 'factory' | 'warehouse' | 'datacenter' | 'mine' | 'distributor'
//   lat/lng — location
//   role — short description
// These coordinates are approximate (no claim of perfect accuracy) but
// represent real public knowledge about each company's physical footprint.
export const SUPPLY_CHAIN_FACILITIES = [
  // ─── Apple (AAPL) ───
  { ticker: 'AAPL', name: 'Apple Park (HQ)',         type: 'hq',          lat: 37.3349, lng: -122.0090, role: 'Global headquarters · Cupertino, CA' },
  { ticker: 'AAPL', name: 'Foxconn Zhengzhou',       type: 'factory',     lat: 34.7466, lng: 113.6253,  role: 'iPhone assembly · "iPhone City"' },
  { ticker: 'AAPL', name: 'Foxconn Chengdu',         type: 'factory',     lat: 30.5723, lng: 104.0665,  role: 'iPad assembly' },
  { ticker: 'AAPL', name: 'Pegatron Shanghai',       type: 'factory',     lat: 31.1843, lng: 121.5275,  role: 'iPhone assembly secondary' },
  { ticker: 'AAPL', name: 'Foxconn India (Tamil Nadu)', type: 'factory',  lat: 12.6797, lng: 77.4953,   role: 'iPhone 15/16 manufacturing' },
  { ticker: 'AAPL', name: 'Cork EU HQ',              type: 'hq',          lat: 51.8985, lng: -8.4756,   role: 'European HQ · Ireland' },
  { ticker: 'AAPL', name: 'Reno Datacenter',         type: 'datacenter',  lat: 39.5296, lng: -119.8138, role: 'iCloud datacenter · Nevada' },
  // ─── Nvidia (NVDA) ───
  { ticker: 'NVDA', name: 'Nvidia HQ (Santa Clara)', type: 'hq',          lat: 37.3711, lng: -121.9519, role: 'Global headquarters' },
  { ticker: 'NVDA', name: 'TSMC Fab 18 (Taiwan)',    type: 'factory',     lat: 22.9908, lng: 120.2767,  role: 'GPU wafer fabrication · 5nm/4nm' },
  { ticker: 'NVDA', name: 'TSMC Fab 21 (Arizona)',   type: 'factory',     lat: 33.6976, lng: -111.9974, role: 'GPU wafer fabrication · US' },
  { ticker: 'NVDA', name: 'Nvidia Tel Aviv',         type: 'hq',          lat: 32.1093, lng: 34.8555,   role: 'Mellanox networking R&D' },
  { ticker: 'NVDA', name: 'Nvidia Bangalore',        type: 'hq',          lat: 12.9716, lng: 77.5946,   role: 'Engineering hub' },
  // ─── Tesla (TSLA) ───
  { ticker: 'TSLA', name: 'Gigafactory Texas',       type: 'factory',     lat: 30.2230, lng: -97.6175,  role: 'Cybertruck, Model Y production' },
  { ticker: 'TSLA', name: 'Fremont Factory',         type: 'factory',     lat: 37.4937, lng: -121.9469, role: 'Model S/X/3/Y assembly' },
  { ticker: 'TSLA', name: 'Gigafactory Shanghai',    type: 'factory',     lat: 31.0921, lng: 121.7857,  role: 'Asia-Pacific Model 3/Y' },
  { ticker: 'TSLA', name: 'Gigafactory Berlin',      type: 'factory',     lat: 52.4036, lng: 13.7917,   role: 'European Model Y' },
  { ticker: 'TSLA', name: 'Gigafactory Nevada',      type: 'factory',     lat: 39.5380, lng: -119.4419, role: 'Battery + powertrain' },
  { ticker: 'TSLA', name: 'Lithium Mine (Nevada)',   type: 'mine',        lat: 41.6125, lng: -117.5550, role: 'Thacker Pass lithium · partnership' },
  // ─── Microsoft (MSFT) ───
  { ticker: 'MSFT', name: 'Redmond HQ',              type: 'hq',          lat: 47.6396, lng: -122.1283, role: 'Global headquarters · Washington' },
  { ticker: 'MSFT', name: 'Quincy Datacenter',       type: 'datacenter',  lat: 47.2333, lng: -119.8525, role: 'Azure region: West US 2' },
  { ticker: 'MSFT', name: 'San Antonio Datacenter',  type: 'datacenter',  lat: 29.4241, lng: -98.4936,  role: 'Azure region: South Central US' },
  { ticker: 'MSFT', name: 'Dublin Datacenter',       type: 'datacenter',  lat: 53.3498, lng: -6.2603,   role: 'Azure region: North Europe' },
  { ticker: 'MSFT', name: 'Singapore Datacenter',    type: 'datacenter',  lat: 1.3521,  lng: 103.8198,  role: 'Azure region: SE Asia' },
  // ─── Amazon (AMZN) ───
  { ticker: 'AMZN', name: 'Seattle HQ',              type: 'hq',          lat: 47.6235, lng: -122.3361, role: 'Global headquarters' },
  { ticker: 'AMZN', name: 'Arlington HQ2',           type: 'hq',          lat: 38.8783, lng: -77.0586,  role: 'Second headquarters · Virginia' },
  { ticker: 'AMZN', name: 'AWS US-East-1 (Ashburn)', type: 'datacenter',  lat: 39.0438, lng: -77.4874,  role: 'Largest AWS region' },
  { ticker: 'AMZN', name: 'AWS US-West-2 (Oregon)',  type: 'datacenter',  lat: 45.8729, lng: -119.6884, role: 'AWS Oregon region' },
  { ticker: 'AMZN', name: 'Fulfillment BFI4',        type: 'warehouse',   lat: 47.4502, lng: -122.3088, role: 'Major fulfillment center · Seattle' },
  { ticker: 'AMZN', name: 'Fulfillment LGB6',        type: 'warehouse',   lat: 33.8167, lng: -118.1917, role: 'Long Beach fulfillment' },
  { ticker: 'AMZN', name: 'Fulfillment FRA1',        type: 'warehouse',   lat: 50.0397, lng: 8.5694,    role: 'Frankfurt fulfillment · EU' },
  // ─── Google / Alphabet (GOOG) ───
  { ticker: 'GOOG', name: 'Googleplex (Mountain View)', type: 'hq',       lat: 37.4220, lng: -122.0841, role: 'Global headquarters' },
  { ticker: 'GOOG', name: 'The Dalles Datacenter',   type: 'datacenter',  lat: 45.6300, lng: -121.1900, role: 'GCP region: Oregon' },
  { ticker: 'GOOG', name: 'Council Bluffs',          type: 'datacenter',  lat: 41.2619, lng: -95.8608,  role: 'GCP region: Iowa' },
  { ticker: 'GOOG', name: 'Hamina Datacenter',       type: 'datacenter',  lat: 60.5685, lng: 27.1866,   role: 'GCP region: Finland' },
  // ─── Meta (META) ───
  { ticker: 'META', name: 'Menlo Park HQ',           type: 'hq',          lat: 37.4847, lng: -122.1477, role: 'Global headquarters' },
  { ticker: 'META', name: 'Prineville Datacenter',   type: 'datacenter',  lat: 44.2986, lng: -120.8347, role: 'First Meta datacenter · Oregon' },
  { ticker: 'META', name: 'Luleå Datacenter',        type: 'datacenter',  lat: 65.5848, lng: 22.1547,   role: 'Sweden · arctic cooling' },
  // ─── JP Morgan (JPM) ───
  { ticker: 'JPM',  name: '270 Park Ave HQ',         type: 'hq',          lat: 40.7558, lng: -73.9747,  role: 'Global headquarters · NYC' },
  { ticker: 'JPM',  name: 'London Canary Wharf',     type: 'hq',          lat: 51.5054, lng: -0.0235,   role: 'European HQ' },
  { ticker: 'JPM',  name: 'Hong Kong Office',        type: 'hq',          lat: 22.2832, lng: 114.1588,  role: 'Asia-Pacific HQ' },

  // ─── S&P 500 Expansion — Top weights with global supply-chain footprints ───

  // ─── Berkshire Hathaway (BRK.B) ───
  { ticker: 'BRK.B', name: 'Berkshire HQ',           type: 'hq',          lat: 41.2565, lng: -95.9345,  role: 'Omaha, Nebraska' },
  { ticker: 'BRK.B', name: 'BNSF Fort Worth HQ',     type: 'hq',          lat: 32.7555, lng: -97.3308,  role: 'Railroad subsidiary HQ' },
  { ticker: 'BRK.B', name: 'GEICO HQ',               type: 'hq',          lat: 38.9847, lng: -77.0911,  role: 'Insurance subsidiary' },

  // ─── Eli Lilly (LLY) ───
  { ticker: 'LLY',  name: 'Indianapolis HQ',         type: 'hq',          lat: 39.7691, lng: -86.1762,  role: 'Global headquarters · Indiana' },
  { ticker: 'LLY',  name: 'Concord Manufacturing',   type: 'factory',     lat: 35.4087, lng: -80.5793,  role: 'Mounjaro/Zepbound production · NC' },
  { ticker: 'LLY',  name: 'RTP Research Triangle',   type: 'hq',          lat: 35.9000, lng: -78.8500,  role: 'R&D campus · NC' },
  { ticker: 'LLY',  name: 'Limerick Plant',          type: 'factory',     lat: 52.6638, lng: -8.6267,   role: 'Insulin manufacturing · Ireland' },
  { ticker: 'LLY',  name: 'Kinsale Manufacturing',   type: 'factory',     lat: 51.7081, lng: -8.5235,   role: 'Biologics · Ireland' },

  // ─── UnitedHealth (UNH) ───
  { ticker: 'UNH',  name: 'Minnetonka HQ',           type: 'hq',          lat: 44.9211, lng: -93.4687,  role: 'Global HQ · Minnesota' },
  { ticker: 'UNH',  name: 'Optum Eden Prairie',      type: 'hq',          lat: 44.8547, lng: -93.4708,  role: 'Optum subsidiary HQ' },
  { ticker: 'UNH',  name: 'Hartford Office',         type: 'hq',          lat: 41.7637, lng: -72.6851,  role: 'Eastern operations · CT' },

  // ─── Visa (V) ───
  { ticker: 'V',    name: 'Foster City HQ',          type: 'hq',          lat: 37.5485, lng: -122.2728, role: 'Global headquarters · CA' },
  { ticker: 'V',    name: 'Singapore Tech Hub',      type: 'datacenter',  lat: 1.2966,  lng: 103.8520,  role: 'Asia processing center' },
  { ticker: 'V',    name: 'London Office',           type: 'hq',          lat: 51.5074, lng: -0.1278,   role: 'European HQ' },

  // ─── Mastercard (MA) ───
  { ticker: 'MA',   name: 'Purchase HQ',             type: 'hq',          lat: 41.0420, lng: -73.7165,  role: 'Global HQ · NY' },
  { ticker: 'MA',   name: 'Dublin EU HQ',            type: 'hq',          lat: 53.3498, lng: -6.2603,   role: 'European HQ' },

  // ─── Johnson & Johnson (JNJ) ───
  { ticker: 'JNJ',  name: 'New Brunswick HQ',        type: 'hq',          lat: 40.4862, lng: -74.4518,  role: 'Global HQ · NJ' },
  { ticker: 'JNJ',  name: 'Janssen Beerse',          type: 'factory',     lat: 51.3171, lng: 4.8211,    role: 'Pharma manufacturing · Belgium' },
  { ticker: 'JNJ',  name: 'Cilag Schaffhausen',      type: 'factory',     lat: 47.6976, lng: 8.6300,    role: 'API production · Switzerland' },

  // ─── Walmart (WMT) ───
  { ticker: 'WMT',  name: 'Bentonville HQ',          type: 'hq',          lat: 36.3729, lng: -94.2088,  role: 'Global HQ · Arkansas' },
  { ticker: 'WMT',  name: 'Texas DC #6094',          type: 'distributor', lat: 32.5500, lng: -97.1500,  role: 'Regional distribution · TX' },
  { ticker: 'WMT',  name: 'Atlanta DC',              type: 'distributor', lat: 33.7490, lng: -84.3880,  role: 'Southeast hub' },
  { ticker: 'WMT',  name: 'Joliet DC',               type: 'distributor', lat: 41.5250, lng: -88.0817,  role: 'Midwest hub · IL' },

  // ─── Procter & Gamble (PG) ───
  { ticker: 'PG',   name: 'Cincinnati HQ',           type: 'hq',          lat: 39.1031, lng: -84.5120,  role: 'Global HQ · OH' },
  { ticker: 'PG',   name: 'Mehoopany Plant',         type: 'factory',     lat: 41.6217, lng: -76.0644,  role: 'Pampers/Charmin · PA' },
  { ticker: 'PG',   name: 'Box Elder Plant',         type: 'factory',     lat: 41.5310, lng: -112.0648, role: 'Detergents · UT' },

  // ─── Exxon Mobil (XOM) ───
  { ticker: 'XOM',  name: 'Spring HQ',               type: 'hq',          lat: 30.0586, lng: -95.4172,  role: 'Global HQ · TX' },
  { ticker: 'XOM',  name: 'Baytown Refinery',        type: 'factory',     lat: 29.7355, lng: -94.9774,  role: 'Largest US refinery' },
  { ticker: 'XOM',  name: 'Beaumont Refinery',       type: 'factory',     lat: 30.0860, lng: -94.0926,  role: '370kbpd refinery · TX' },
  { ticker: 'XOM',  name: 'Permian Basin',           type: 'mine',        lat: 31.8457, lng: -102.3676, role: 'Major shale operation' },
  { ticker: 'XOM',  name: 'LaBarge Helium',          type: 'mine',        lat: 42.2638, lng: -110.1948, role: 'Helium production · WY' },

  // ─── Chevron (CVX) ───
  { ticker: 'CVX',  name: 'San Ramon HQ',            type: 'hq',          lat: 37.7799, lng: -121.9780, role: 'Global HQ · CA' },
  { ticker: 'CVX',  name: 'Pascagoula Refinery',     type: 'factory',     lat: 30.3568, lng: -88.5308,  role: '356kbpd · MS' },
  { ticker: 'CVX',  name: 'Richmond Refinery',       type: 'factory',     lat: 37.9357, lng: -122.3711, role: '245kbpd · CA' },
  { ticker: 'CVX',  name: 'Permian Operations',      type: 'mine',        lat: 31.9686, lng: -102.0779, role: 'Shale operations' },

  // ─── Home Depot (HD) ───
  { ticker: 'HD',   name: 'Atlanta HQ',              type: 'hq',          lat: 33.8716, lng: -84.4633,  role: 'Global HQ · GA' },
  { ticker: 'HD',   name: 'Dallas RDC',              type: 'distributor', lat: 32.7767, lng: -96.7970,  role: 'Rapid deployment · TX' },
  { ticker: 'HD',   name: 'Atlanta DC',              type: 'distributor', lat: 33.6772, lng: -84.4438,  role: 'Southeast hub' },

  // ─── Costco (COST) ───
  { ticker: 'COST', name: 'Issaquah HQ',             type: 'hq',          lat: 47.5301, lng: -122.0326, role: 'Global HQ · WA' },
  { ticker: 'COST', name: 'Mira Loma DC',            type: 'distributor', lat: 33.9970, lng: -117.5493, role: 'SoCal depot' },
  { ticker: 'COST', name: 'Tracy DC',                type: 'distributor', lat: 37.7397, lng: -121.4252, role: 'Northern CA depot' },

  // ─── Coca-Cola (KO) ───
  { ticker: 'KO',   name: 'Atlanta HQ',              type: 'hq',          lat: 33.7726, lng: -84.3924,  role: 'Global HQ · GA' },
  { ticker: 'KO',   name: 'Concentrate Plant Atlanta', type: 'factory',   lat: 33.7560, lng: -84.4030,  role: 'Concentrate production' },
  { ticker: 'KO',   name: 'Drogheda Plant',          type: 'factory',     lat: 53.7187, lng: -6.3498,   role: 'Concentrate · Ireland' },

  // ─── PepsiCo (PEP) ───
  { ticker: 'PEP',  name: 'Purchase HQ',             type: 'hq',          lat: 41.0410, lng: -73.7173,  role: 'Global HQ · NY' },
  { ticker: 'PEP',  name: 'Frito-Lay Plano',         type: 'hq',          lat: 33.0198, lng: -96.6989,  role: 'Snacks subsidiary · TX' },
  { ticker: 'PEP',  name: 'Quaker Cedar Rapids',     type: 'factory',     lat: 41.9779, lng: -91.6656,  role: 'Cereal/oat products' },

  // ─── Pfizer (PFE) ───
  { ticker: 'PFE',  name: 'NYC HQ',                  type: 'hq',          lat: 40.7505, lng: -73.9737,  role: 'Global HQ · 42nd St' },
  { ticker: 'PFE',  name: 'Kalamazoo Plant',         type: 'factory',     lat: 42.2917, lng: -85.5872,  role: 'Vaccine manufacturing · MI' },
  { ticker: 'PFE',  name: 'Sandwich UK',             type: 'factory',     lat: 51.2718, lng: 1.3398,    role: 'API + research · UK' },
  { ticker: 'PFE',  name: 'Puurs Belgium',           type: 'factory',     lat: 51.0750, lng: 4.2861,    role: 'COVID vaccine production' },

  // ─── Merck (MRK) ───
  { ticker: 'MRK',  name: 'Rahway HQ',               type: 'hq',          lat: 40.6082, lng: -74.2776,  role: 'Global HQ · NJ' },
  { ticker: 'MRK',  name: 'West Point Plant',        type: 'factory',     lat: 40.2070, lng: -75.3349,  role: 'Vaccines · PA' },
  { ticker: 'MRK',  name: 'Cork Manufacturing',      type: 'factory',     lat: 51.8985, lng: -8.4756,   role: 'API · Ireland' },

  // ─── AbbVie (ABBV) ───
  { ticker: 'ABBV', name: 'North Chicago HQ',        type: 'hq',          lat: 42.3253, lng: -87.8678,  role: 'Global HQ · IL' },
  { ticker: 'ABBV', name: 'Worcester Plant',         type: 'factory',     lat: 42.2626, lng: -71.8023,  role: 'Humira biologic · MA' },

  // ─── Bank of America (BAC) ───
  { ticker: 'BAC',  name: 'Charlotte HQ',            type: 'hq',          lat: 35.2271, lng: -80.8431,  role: 'Global HQ · NC' },
  { ticker: 'BAC',  name: 'NYC Bryant Park',         type: 'hq',          lat: 40.7546, lng: -73.9839,  role: 'Eastern HQ' },
  { ticker: 'BAC',  name: 'London Canary Wharf',     type: 'hq',          lat: 51.5054, lng: -0.0235,   role: 'European HQ' },

  // ─── Wells Fargo (WFC) ───
  { ticker: 'WFC',  name: 'San Francisco HQ',        type: 'hq',          lat: 37.7849, lng: -122.4022, role: 'Global HQ · CA' },
  { ticker: 'WFC',  name: 'Charlotte Office',        type: 'hq',          lat: 35.2271, lng: -80.8431,  role: 'Eastern hub · NC' },
  { ticker: 'WFC',  name: 'Minneapolis Office',      type: 'hq',          lat: 44.9778, lng: -93.2650,  role: 'Midwest hub' },

  // ─── Goldman Sachs (GS) ───
  { ticker: 'GS',   name: '200 West St HQ',          type: 'hq',          lat: 40.7144, lng: -74.0142,  role: 'Global HQ · NYC' },
  { ticker: 'GS',   name: 'London Plumtree Court',   type: 'hq',          lat: 51.5167, lng: -0.1057,   role: 'European HQ' },
  { ticker: 'GS',   name: 'Tokyo Roppongi',          type: 'hq',          lat: 35.6627, lng: 139.7314,  role: 'Japan office' },

  // ─── Morgan Stanley (MS) ───
  { ticker: 'MS',   name: '1585 Broadway HQ',        type: 'hq',          lat: 40.7589, lng: -73.9851,  role: 'Global HQ · NYC' },
  { ticker: 'MS',   name: 'London Canary Wharf',     type: 'hq',          lat: 51.5045, lng: -0.0177,   role: 'European HQ' },

  // ─── McDonalds (MCD) ───
  { ticker: 'MCD',  name: 'Chicago HQ',              type: 'hq',          lat: 41.8847, lng: -87.6479,  role: 'Global HQ · West Loop' },
  { ticker: 'MCD',  name: 'Hamburger University',    type: 'hq',          lat: 41.8425, lng: -88.0317,  role: 'Training campus · IL' },

  // ─── Disney (DIS) ───
  { ticker: 'DIS',  name: 'Burbank HQ',              type: 'hq',          lat: 34.1535, lng: -118.3247, role: 'Global HQ · CA' },
  { ticker: 'DIS',  name: 'Disneyland Anaheim',      type: 'distributor', lat: 33.8121, lng: -117.9190, role: 'Theme park flagship' },
  { ticker: 'DIS',  name: 'Walt Disney World',       type: 'distributor', lat: 28.3852, lng: -81.5639,  role: 'FL theme parks complex' },
  { ticker: 'DIS',  name: 'Disney Studios Paris',    type: 'distributor', lat: 48.8722, lng: 2.7799,    role: 'Disneyland Paris' },
  { ticker: 'DIS',  name: 'Tokyo Disney',            type: 'distributor', lat: 35.6329, lng: 139.8804,  role: 'Asia park' },

  // ─── Netflix (NFLX) ───
  { ticker: 'NFLX', name: 'Los Gatos HQ',            type: 'hq',          lat: 37.2576, lng: -121.9637, role: 'Global HQ · CA' },
  { ticker: 'NFLX', name: 'Hollywood Office',        type: 'hq',          lat: 34.0928, lng: -118.3287, role: 'Production HQ' },
  { ticker: 'NFLX', name: 'London Office',           type: 'hq',          lat: 51.5202, lng: -0.0855,   role: 'European HQ' },

  // ─── Boeing (BA) ───
  { ticker: 'BA',   name: 'Arlington HQ',            type: 'hq',          lat: 38.8807, lng: -77.1037,  role: 'Global HQ · VA' },
  { ticker: 'BA',   name: 'Everett Plant',           type: 'factory',     lat: 47.9229, lng: -122.2814, role: '777/767/747 assembly' },
  { ticker: 'BA',   name: 'Renton Plant',            type: 'factory',     lat: 47.4825, lng: -122.2148, role: '737 MAX assembly' },
  { ticker: 'BA',   name: 'Charleston Plant',        type: 'factory',     lat: 32.8987, lng: -80.0364,  role: '787 Dreamliner · SC' },

  // ─── Caterpillar (CAT) ───
  { ticker: 'CAT',  name: 'Deerfield HQ',            type: 'hq',          lat: 42.1714, lng: -87.8442,  role: 'Global HQ · IL' },
  { ticker: 'CAT',  name: 'East Peoria Plant',       type: 'factory',     lat: 40.6764, lng: -89.5707,  role: 'Bulldozers, dozers · IL' },
  { ticker: 'CAT',  name: 'Decatur Plant',           type: 'factory',     lat: 39.8403, lng: -88.9548,  role: 'Mining trucks · IL' },

  // ─── 3M (MMM) ───
  { ticker: 'MMM',  name: 'St Paul HQ',              type: 'hq',          lat: 44.9434, lng: -93.0084,  role: 'Global HQ · MN' },
  { ticker: 'MMM',  name: 'Brookings Plant',         type: 'factory',     lat: 44.3114, lng: -96.7984,  role: 'Tape, abrasives · SD' },

  // ─── Salesforce (CRM) ───
  { ticker: 'CRM',  name: 'Salesforce Tower SF',     type: 'hq',          lat: 37.7896, lng: -122.3970, role: 'Global HQ' },
  { ticker: 'CRM',  name: 'Indianapolis Office',     type: 'hq',          lat: 39.7684, lng: -86.1581,  role: 'Eastern hub' },

  // ─── Adobe (ADBE) ───
  { ticker: 'ADBE', name: 'San Jose HQ',             type: 'hq',          lat: 37.3303, lng: -121.8930, role: 'Global HQ · CA' },
  { ticker: 'ADBE', name: 'Lehi Office',             type: 'hq',          lat: 40.4380, lng: -111.8638, role: 'Utah campus' },

  // ─── Oracle (ORCL) ───
  { ticker: 'ORCL', name: 'Austin HQ',               type: 'hq',          lat: 30.2300, lng: -97.7375,  role: 'Global HQ · TX' },
  { ticker: 'ORCL', name: 'Redwood Shores',          type: 'datacenter',  lat: 37.5290, lng: -122.2604, role: 'Engineering campus · CA' },

  // ─── IBM (IBM) ───
  { ticker: 'IBM',  name: 'Armonk HQ',               type: 'hq',          lat: 41.1057, lng: -73.7186,  role: 'Global HQ · NY' },
  { ticker: 'IBM',  name: 'Almaden Research',        type: 'datacenter',  lat: 37.2110, lng: -121.8866, role: 'Research lab · CA' },
  { ticker: 'IBM',  name: 'Hursley Lab',             type: 'datacenter',  lat: 51.0264, lng: -1.3700,   role: 'UK research' },

  // ─── Intel (INTC) ───
  { ticker: 'INTC', name: 'Santa Clara HQ',          type: 'hq',          lat: 37.3877, lng: -121.9636, role: 'Global HQ · CA' },
  { ticker: 'INTC', name: 'Hillsboro Fab D1X',       type: 'factory',     lat: 45.5413, lng: -122.9637, role: 'Leading-edge fab · OR' },
  { ticker: 'INTC', name: 'Chandler Fab 42',         type: 'factory',     lat: 33.3000, lng: -111.8500, role: 'Process node fab · AZ' },
  { ticker: 'INTC', name: 'Leixlip Fab 24',          type: 'factory',     lat: 53.3650, lng: -6.4839,   role: 'European fab · Ireland' },
  { ticker: 'INTC', name: 'Magdeburg Fab',           type: 'factory',     lat: 52.1205, lng: 11.6276,   role: 'Future EU mega-fab · Germany' },

  // ─── Cisco (CSCO) ───
  { ticker: 'CSCO', name: 'San Jose HQ',             type: 'hq',          lat: 37.4099, lng: -121.9461, role: 'Global HQ · CA' },
  { ticker: 'CSCO', name: 'RTP Office',              type: 'hq',          lat: 35.9000, lng: -78.8500,  role: 'Eastern hub · NC' },

  // ─── Qualcomm (QCOM) ───
  { ticker: 'QCOM', name: 'San Diego HQ',            type: 'hq',          lat: 32.8936, lng: -117.2178, role: 'Global HQ · CA' },
  { ticker: 'QCOM', name: 'Cork R&D',                type: 'datacenter',  lat: 51.8985, lng: -8.4756,   role: 'European R&D · Ireland' },

  // ─── Broadcom (AVGO) ───
  { ticker: 'AVGO', name: 'Palo Alto HQ',            type: 'hq',          lat: 37.4419, lng: -122.1430, role: 'Global HQ · CA' },
  { ticker: 'AVGO', name: 'Fort Collins Office',     type: 'hq',          lat: 40.5853, lng: -105.0844, role: 'Engineering · CO' },

  // ─── AMD ───
  { ticker: 'AMD',  name: 'Santa Clara HQ',          type: 'hq',          lat: 37.3711, lng: -121.9519, role: 'Global HQ · CA' },
  { ticker: 'AMD',  name: 'Austin Office',           type: 'hq',          lat: 30.4040, lng: -97.7180,  role: 'Engineering hub · TX' },
  { ticker: 'AMD',  name: 'TSMC Fab 18',             type: 'factory',     lat: 22.9908, lng: 120.2767,  role: 'CPU/GPU fabrication' },

  // ─── ASML (US ADR via ASML) ───
  { ticker: 'ASML', name: 'Veldhoven HQ',            type: 'hq',          lat: 51.4178, lng: 5.4156,    role: 'Global HQ · Netherlands' },
  { ticker: 'ASML', name: 'Wilton Office',           type: 'hq',          lat: 41.1958, lng: -73.4376,  role: 'US HQ · CT' },
  { ticker: 'ASML', name: 'Linkou Office',           type: 'hq',          lat: 25.0760, lng: 121.3914,  role: 'Taiwan office' },

  // ─── Lockheed Martin (LMT) ───
  { ticker: 'LMT',  name: 'Bethesda HQ',             type: 'hq',          lat: 39.0011, lng: -77.1029,  role: 'Global HQ · MD' },
  { ticker: 'LMT',  name: 'Fort Worth F-35 Plant',   type: 'factory',     lat: 32.7691, lng: -97.4406,  role: 'F-35 production · TX' },
  { ticker: 'LMT',  name: 'Marietta Plant',          type: 'factory',     lat: 33.9099, lng: -84.5126,  role: 'C-130 production · GA' },

  // ─── Raytheon (RTX) ───
  { ticker: 'RTX',  name: 'Arlington HQ',            type: 'hq',          lat: 38.8809, lng: -77.1138,  role: 'Global HQ · VA' },
  { ticker: 'RTX',  name: 'Tucson Plant',            type: 'factory',     lat: 32.1542, lng: -110.8771, role: 'Missiles plant · AZ' },

  // ─── ConocoPhillips (COP) ───
  { ticker: 'COP',  name: 'Houston HQ',              type: 'hq',          lat: 29.7372, lng: -95.4543,  role: 'Global HQ · TX' },
  { ticker: 'COP',  name: 'Eagle Ford Operations',   type: 'mine',        lat: 28.4477, lng: -98.0875,  role: 'Shale operations · TX' },
  { ticker: 'COP',  name: 'Bakken Operations',       type: 'mine',        lat: 47.6736, lng: -103.0017, role: 'Shale operations · ND' },

  // ─── Schlumberger (SLB) ───
  { ticker: 'SLB',  name: 'Houston HQ',              type: 'hq',          lat: 29.7872, lng: -95.4180,  role: 'Global HQ · TX' },
  { ticker: 'SLB',  name: 'Paris Office',            type: 'hq',          lat: 48.8566, lng: 2.3522,    role: 'European HQ' },
  { ticker: 'SLB',  name: 'Aberdeen Office',         type: 'hq',          lat: 57.1497, lng: -2.0943,   role: 'North Sea operations · UK' },

  // ─── Nike (NKE) ───
  { ticker: 'NKE',  name: 'Beaverton HQ',            type: 'hq',          lat: 45.5074, lng: -122.8128, role: 'Global HQ · OR' },
  { ticker: 'NKE',  name: 'Memphis DC',              type: 'distributor', lat: 35.0421, lng: -89.9810,  role: 'North America hub' },
  { ticker: 'NKE',  name: 'Vietnam Production',      type: 'factory',     lat: 10.8231, lng: 106.6297,  role: 'Footwear contract mfg' },
  { ticker: 'NKE',  name: 'Indonesia Production',    type: 'factory',     lat: -6.2088, lng: 106.8456,  role: 'Footwear contract mfg' },

  // ─── Starbucks (SBUX) ───
  { ticker: 'SBUX', name: 'Seattle HQ',              type: 'hq',          lat: 47.5806, lng: -122.3357, role: 'Global HQ · WA' },
  { ticker: 'SBUX', name: 'Augusta Roastery',        type: 'factory',     lat: 33.4735, lng: -82.0105,  role: 'Coffee roasting · GA' },
  { ticker: 'SBUX', name: 'York Roastery',           type: 'factory',     lat: 39.9626, lng: -76.7277,  role: 'Coffee roasting · PA' },

  // ─── American Express (AXP) ───
  { ticker: 'AXP',  name: 'NYC HQ',                  type: 'hq',          lat: 40.7142, lng: -74.0144,  role: 'Global HQ · World Financial Center' },
  { ticker: 'AXP',  name: 'Phoenix Operations',      type: 'datacenter',  lat: 33.4484, lng: -112.0740, role: 'Servicing center · AZ' },

  // ─── Citigroup (C) ───
  { ticker: 'C',    name: 'NYC TriBeCa HQ',          type: 'hq',          lat: 40.7137, lng: -74.0130,  role: 'Global HQ · 388 Greenwich' },
  { ticker: 'C',    name: 'London Canary Wharf',     type: 'hq',          lat: 51.5054, lng: -0.0235,   role: 'European HQ' },

  // ─── BlackRock (BLK) ───
  { ticker: 'BLK',  name: 'NYC HQ',                  type: 'hq',          lat: 40.7660, lng: -73.9711,  role: 'Global HQ · 50 Hudson Yards' },
  { ticker: 'BLK',  name: 'San Francisco Office',    type: 'hq',          lat: 37.7900, lng: -122.4000, role: 'iShares operations' },

  // ─── United Parcel Service (UPS) ───
  { ticker: 'UPS',  name: 'Atlanta HQ',              type: 'hq',          lat: 33.8767, lng: -84.4691,  role: 'Global HQ · GA' },
  { ticker: 'UPS',  name: 'Worldport Louisville',    type: 'distributor', lat: 38.1815, lng: -85.7378,  role: 'Largest air hub · KY' },
  { ticker: 'UPS',  name: 'Cologne Hub',             type: 'distributor', lat: 50.8746, lng: 7.1389,    role: 'European air hub · Germany' },

  // ─── FedEx (FDX) ───
  { ticker: 'FDX',  name: 'Memphis HQ',              type: 'hq',          lat: 35.0421, lng: -89.9810,  role: 'Global HQ · TN' },
  { ticker: 'FDX',  name: 'Memphis SuperHub',        type: 'distributor', lat: 35.0421, lng: -89.9810,  role: 'Largest sortation hub' },
  { ticker: 'FDX',  name: 'Indianapolis Hub',        type: 'distributor', lat: 39.7173, lng: -86.2944,  role: 'National air hub · IN' },
  { ticker: 'FDX',  name: 'Guangzhou Hub',           type: 'distributor', lat: 23.3924, lng: 113.2988,  role: 'Asia-Pacific hub · China' },

  // ─── General Electric (GE) ───
  { ticker: 'GE',   name: 'Boston HQ',               type: 'hq',          lat: 42.3601, lng: -71.0589,  role: 'Global HQ · MA' },
  { ticker: 'GE',   name: 'Greenville Plant',        type: 'factory',     lat: 34.8526, lng: -82.3940,  role: 'Gas turbines · SC' },
  { ticker: 'GE',   name: 'Cincinnati Plant',        type: 'factory',     lat: 39.1031, lng: -84.5120,  role: 'Aviation engines · OH' },

  // ─── General Motors (GM) ───
  { ticker: 'GM',   name: 'Detroit HQ',              type: 'hq',          lat: 42.3293, lng: -83.0398,  role: 'Global HQ · Renaissance Center' },
  { ticker: 'GM',   name: 'Lansing Grand River',     type: 'factory',     lat: 42.7384, lng: -84.5530,  role: 'Camaro/CT4/CT5 · MI' },
  { ticker: 'GM',   name: 'Bowling Green Plant',     type: 'factory',     lat: 36.9685, lng: -86.4808,  role: 'Corvette · KY' },
  { ticker: 'GM',   name: 'Spring Hill Plant',       type: 'factory',     lat: 35.7512, lng: -86.9311,  role: 'EV production · TN' },

  // ─── Ford (F) ───
  { ticker: 'F',    name: 'Dearborn HQ',             type: 'hq',          lat: 42.3145, lng: -83.2127,  role: 'Global HQ · MI' },
  { ticker: 'F',    name: 'River Rouge Plant',       type: 'factory',     lat: 42.3033, lng: -83.1492,  role: 'F-150 production · MI' },
  { ticker: 'F',    name: 'BlueOval City',           type: 'factory',     lat: 35.6064, lng: -89.1153,  role: 'EV mega-campus · TN' },
  { ticker: 'F',    name: 'Cologne Plant',           type: 'factory',     lat: 50.9667, lng: 6.9667,    role: 'European EV plant' },

  // ─── ExxonMobil partner / DuPont (DD) ───
  { ticker: 'DD',   name: 'Wilmington HQ',           type: 'hq',          lat: 39.7491, lng: -75.5398,  role: 'Global HQ · DE' },

  // ─── Booking Holdings (BKNG) ───
  { ticker: 'BKNG', name: 'Norwalk HQ',              type: 'hq',          lat: 41.1175, lng: -73.4084,  role: 'Global HQ · CT' },
  { ticker: 'BKNG', name: 'Amsterdam HQ',            type: 'hq',          lat: 52.3589, lng: 4.9094,    role: 'Booking.com HQ · NL' },

  // ─── PayPal (PYPL) ───
  { ticker: 'PYPL', name: 'San Jose HQ',             type: 'hq',          lat: 37.4220, lng: -121.9758, role: 'Global HQ · CA' },
  { ticker: 'PYPL', name: 'Dublin Office',           type: 'hq',          lat: 53.3498, lng: -6.2603,   role: 'European HQ · Ireland' },

  // ─── Uber (UBER) — included as megacap tech adjacent ───
  { ticker: 'UBER', name: 'San Francisco HQ',        type: 'hq',          lat: 37.7754, lng: -122.4115, role: 'Global HQ · 1455 Market' },
  { ticker: 'UBER', name: 'Amsterdam EU HQ',         type: 'hq',          lat: 52.3676, lng: 4.9041,    role: 'European HQ · NL' },

  // ─── Stripe (private but tracked) — skip ───

  // ─── Shopify (SHOP) ───
  { ticker: 'SHOP', name: 'Ottawa HQ',               type: 'hq',          lat: 45.4214, lng: -75.6919,  role: 'Global HQ · Canada' },
  { ticker: 'SHOP', name: 'Toronto Office',          type: 'hq',          lat: 43.6532, lng: -79.3832,  role: 'Engineering · Canada' },

  // ─── Salesforce subsidiaries / Snowflake (SNOW) ───
  { ticker: 'SNOW', name: 'Bozeman HQ',              type: 'hq',          lat: 45.6770, lng: -111.0429, role: 'Global HQ · MT' },
  { ticker: 'SNOW', name: 'San Mateo Office',        type: 'hq',          lat: 37.5630, lng: -122.3255, role: 'Engineering · CA' },

  // ─── ServiceNow (NOW) ───
  { ticker: 'NOW',  name: 'Santa Clara HQ',          type: 'hq',          lat: 37.3541, lng: -121.9552, role: 'Global HQ · CA' },

  // ─── Palantir (PLTR) ───
  { ticker: 'PLTR', name: 'Denver HQ',               type: 'hq',          lat: 39.7392, lng: -104.9903, role: 'Global HQ · CO' },
  { ticker: 'PLTR', name: 'DC Office',               type: 'hq',          lat: 38.9072, lng: -77.0369,  role: 'Federal operations' },

  // ─── Berkshire / TSLA Lithium / Albemarle (ALB) ───
  { ticker: 'ALB',  name: 'Charlotte HQ',            type: 'hq',          lat: 35.2271, lng: -80.8431,  role: 'Global HQ · NC' },
  { ticker: 'ALB',  name: 'Silver Peak Lithium',     type: 'mine',        lat: 37.7589, lng: -117.6356, role: 'Lithium brine · NV' },
  { ticker: 'ALB',  name: 'Kemerton Plant',          type: 'factory',     lat: -33.2167, lng: 115.7167, role: 'Lithium hydroxide · Australia' },

  // ─── Newmont (NEM) ───
  { ticker: 'NEM',  name: 'Denver HQ',               type: 'hq',          lat: 39.7392, lng: -104.9903, role: 'Global HQ · CO' },
  { ticker: 'NEM',  name: 'Boddington Mine',         type: 'mine',        lat: -32.7833, lng: 116.3167, role: 'Gold mine · Australia' },
  { ticker: 'NEM',  name: 'Carlin Mine',             type: 'mine',        lat: 40.8743, lng: -116.1183, role: 'Gold mine · NV' },

  // ─── ExxonMobil / Halliburton (HAL) ───
  { ticker: 'HAL',  name: 'Houston HQ',              type: 'hq',          lat: 29.7604, lng: -95.3698,  role: 'Global HQ · TX' },

  // ─── Texas Instruments (TXN) ───
  { ticker: 'TXN',  name: 'Dallas HQ',               type: 'hq',          lat: 32.9067, lng: -96.7706,  role: 'Global HQ · TX' },
  { ticker: 'TXN',  name: 'Sherman Fab',             type: 'factory',     lat: 33.6357, lng: -96.6089,  role: '300mm semiconductor · TX' },

  // ─── Linde (LIN) ───
  { ticker: 'LIN',  name: 'Woking HQ',               type: 'hq',          lat: 51.3198, lng: -0.5594,   role: 'Global HQ · UK' },
  { ticker: 'LIN',  name: 'Danbury Office',          type: 'hq',          lat: 41.3948, lng: -73.4540,  role: 'Americas HQ · CT' },

  // ─── Honeywell (HON) ───
  { ticker: 'HON',  name: 'Charlotte HQ',            type: 'hq',          lat: 35.2271, lng: -80.8431,  role: 'Global HQ · NC' },
  { ticker: 'HON',  name: 'Phoenix Aerospace',       type: 'factory',     lat: 33.4484, lng: -112.0740, role: 'Aerospace · AZ' },

  // ─── United Health partner / Anthem-Elevance (ELV) ───
  { ticker: 'ELV',  name: 'Indianapolis HQ',         type: 'hq',          lat: 39.7691, lng: -86.1762,  role: 'Global HQ · IN' },

  // ─── McKesson (MCK) ───
  { ticker: 'MCK',  name: 'Irving HQ',               type: 'hq',          lat: 32.8540, lng: -96.9648,  role: 'Global HQ · TX' },

  // ─── CVS Health (CVS) ───
  { ticker: 'CVS',  name: 'Woonsocket HQ',           type: 'hq',          lat: 42.0057, lng: -71.5147,  role: 'Global HQ · RI' },

  // ─── Costco partner / Kroger (KR) ───
  { ticker: 'KR',   name: 'Cincinnati HQ',           type: 'hq',          lat: 39.1014, lng: -84.5117,  role: 'Global HQ · OH' },

  // ─── Lockheed competitor / Northrop (NOC) ───
  { ticker: 'NOC',  name: 'Falls Church HQ',         type: 'hq',          lat: 38.8823, lng: -77.1711,  role: 'Global HQ · VA' },
  { ticker: 'NOC',  name: 'Palmdale Plant',          type: 'factory',     lat: 34.5794, lng: -118.1165, role: 'B-2 / B-21 production · CA' },

  // ─── Abbott (ABT) ───
  { ticker: 'ABT',  name: 'Abbott Park HQ',          type: 'hq',          lat: 42.3253, lng: -87.8678,  role: 'Global HQ · IL' },

  // ─── Bristol Myers Squibb (BMY) ───
  { ticker: 'BMY',  name: 'Princeton HQ',            type: 'hq',          lat: 40.3573, lng: -74.6672,  role: 'Global HQ · NJ' },

  // ─── Comcast (CMCSA) ───
  { ticker: 'CMCSA', name: 'Philadelphia HQ',        type: 'hq',          lat: 39.9536, lng: -75.1685,  role: 'Global HQ · Comcast Center' },
  { ticker: 'CMCSA', name: 'Universal Orlando',      type: 'distributor', lat: 28.4748, lng: -81.4677,  role: 'Theme park · FL' },

  // ─── Verizon (VZ) ───
  { ticker: 'VZ',   name: 'NYC HQ',                  type: 'hq',          lat: 40.7588, lng: -73.9756,  role: 'Global HQ · 1095 Ave of Americas' },

  // ─── AT&T (T) ───
  { ticker: 'T',    name: 'Dallas HQ',               type: 'hq',          lat: 32.7767, lng: -96.7970,  role: 'Global HQ · TX' },

  // ─── American Tower (AMT) ───
  { ticker: 'AMT',  name: 'Boston HQ',               type: 'hq',          lat: 42.3601, lng: -71.0589,  role: 'Global HQ · MA' },

  // ─── NextEra Energy (NEE) ───
  { ticker: 'NEE',  name: 'Juno Beach HQ',           type: 'hq',          lat: 26.8754, lng: -80.0586,  role: 'Global HQ · FL' },

  // ─── Duke Energy (DUK) ───
  { ticker: 'DUK',  name: 'Charlotte HQ',            type: 'hq',          lat: 35.2271, lng: -80.8431,  role: 'Global HQ · NC' },

  // ─── Sherwin-Williams (SHW) ───
  { ticker: 'SHW',  name: 'Cleveland HQ',            type: 'hq',          lat: 41.4993, lng: -81.6944,  role: 'Global HQ · OH' },

  // ─── Caterpillar competitor / Deere (DE) ───
  { ticker: 'DE',   name: 'Moline HQ',               type: 'hq',          lat: 41.5067, lng: -90.5151,  role: 'Global HQ · IL' },
  { ticker: 'DE',   name: 'Waterloo Plant',          type: 'factory',     lat: 42.4928, lng: -92.3426,  role: 'Tractor production · IA' },

  // ─── Boeing partner / Airbus is non-US — skip ───

  // ─── Charter Communications (CHTR) ───
  { ticker: 'CHTR', name: 'Stamford HQ',             type: 'hq',          lat: 41.0534, lng: -73.5387,  role: 'Global HQ · CT' },

  // ─── Visa partner / Block (SQ) ───
  { ticker: 'SQ',   name: 'San Francisco HQ',        type: 'hq',          lat: 37.7838, lng: -122.4001, role: 'Global HQ · CA' },

  // ─── Marriott (MAR) ───
  { ticker: 'MAR',  name: 'Bethesda HQ',             type: 'hq',          lat: 39.0011, lng: -77.1029,  role: 'Global HQ · MD' },

  // ─── Hilton (HLT) ───
  { ticker: 'HLT',  name: 'McLean HQ',               type: 'hq',          lat: 38.9342, lng: -77.1773,  role: 'Global HQ · VA' },

  // ─── Pinterest (PINS) ───
  { ticker: 'PINS', name: 'San Francisco HQ',        type: 'hq',          lat: 37.7727, lng: -122.4099, role: 'Global HQ · CA' },

  // ─── Snap (SNAP) ───
  { ticker: 'SNAP', name: 'Santa Monica HQ',         type: 'hq',          lat: 34.0095, lng: -118.4972, role: 'Global HQ · CA' },

  // ─── Spotify (SPOT) ───
  { ticker: 'SPOT', name: 'Stockholm HQ',            type: 'hq',          lat: 59.3293, lng: 18.0686,   role: 'Global HQ · Sweden' },
  { ticker: 'SPOT', name: 'NYC Office',              type: 'hq',          lat: 40.7188, lng: -74.0152,  role: 'Americas HQ · 4 World Trade' },
];

// ──────────── Military Installations (publicly known sites) ────────────
// Major US bases, NATO sites, Russian, and Chinese installations. Used for
// the Terminal's geopolitical layer. All info is from public sources.
export const MILITARY_FACILITIES = [
  // ─── US bases ───
  { name: 'Pentagon',                      country: 'US',     branch: 'DoD HQ',    lat: 38.8719, lng: -77.0563, role: 'Department of Defense headquarters · Arlington, VA' },
  { name: 'Pearl Harbor / Hickam',         country: 'US',     branch: 'Navy/AF',   lat: 21.3535, lng: -157.9619, role: 'Joint base · Pacific Fleet HQ · Hawaii' },
  { name: 'Fort Bragg',                    country: 'US',     branch: 'Army',      lat: 35.1391, lng: -79.0067, role: 'Special Operations · Airborne · NC' },
  { name: 'Norfolk Naval Station',         country: 'US',     branch: 'Navy',      lat: 36.9486, lng: -76.3306, role: 'Largest naval base in the world · VA' },
  { name: 'San Diego Naval Base',          country: 'US',     branch: 'Navy',      lat: 32.6783, lng: -117.1233, role: 'Pacific Fleet · CA' },
  { name: 'Wright-Patterson AFB',          country: 'US',     branch: 'AF',        lat: 39.8275, lng: -84.0500, role: 'Air Force Materiel Command · OH' },
  { name: 'Cheyenne Mountain Complex',     country: 'US',     branch: 'Space/AF',  lat: 38.7440, lng: -104.8478, role: 'NORAD · CO' },
  { name: 'Edwards AFB',                   country: 'US',     branch: 'AF',        lat: 34.9054, lng: -117.8835, role: 'Flight test · CA' },
  { name: 'Fort Meade',                    country: 'US',     branch: 'Army/NSA',  lat: 39.1083, lng: -76.7444, role: 'NSA HQ · MD' },
  { name: 'Camp Pendleton',                country: 'US',     branch: 'USMC',      lat: 33.3884, lng: -117.4611, role: 'Marine Corps base · CA' },
  // ─── Overseas US bases ───
  { name: 'Ramstein AB',                   country: 'US/NATO',branch: 'AF',        lat: 49.4369, lng: 7.6003,    role: 'US Air Force base in Germany · main hub for European ops' },
  { name: 'Aviano AB',                     country: 'US/NATO',branch: 'AF',        lat: 46.0319, lng: 12.5965,   role: 'USAF base in Italy' },
  { name: 'Camp Humphreys',                country: 'US',     branch: 'Army',      lat: 36.9628, lng: 127.0172,  role: 'Largest US overseas base · South Korea' },
  { name: 'Yokosuka Naval Base',           country: 'US',     branch: 'Navy',      lat: 35.2906, lng: 139.6633,  role: '7th Fleet HQ · Japan' },
  { name: 'Kadena AB',                     country: 'US',     branch: 'AF',        lat: 26.3556, lng: 127.7681,  role: 'Largest US air base in Asia · Okinawa' },
  { name: 'Diego Garcia',                  country: 'US/UK',  branch: 'Navy/AF',   lat: -7.3133, lng: 72.4111,   role: 'Indian Ocean strategic outpost' },
  { name: 'Camp Lemonnier',                country: 'US',     branch: 'Joint',     lat: 11.5471, lng: 43.1597,   role: 'Africa Command base · Djibouti' },
  // ─── NATO partners ───
  { name: 'RAF Lakenheath',                country: 'UK',     branch: 'RAF',       lat: 52.4093, lng: 0.5610,    role: 'UK RAF · home of US 48th Fighter Wing' },
  { name: 'Geilenkirchen NATO Air Base',   country: 'NATO',   branch: 'NATO',      lat: 50.9603, lng: 6.0428,    role: 'NATO AWACS · Germany' },
  { name: 'Mihail Kogălniceanu AB',        country: 'NATO',   branch: 'Joint',     lat: 44.3624, lng: 28.4881,   role: 'NATO eastern flank · Romania' },
  { name: 'Powidz AB',                     country: 'NATO',   branch: 'Joint',     lat: 52.3829, lng: 17.8542,   role: 'US/NATO base in Poland' },
  // ─── Russian military ───
  { name: 'Plesetsk Cosmodrome',           country: 'Russia', branch: 'Aerospace', lat: 62.9266, lng: 40.5775,   role: 'Strategic missile/space launch facility' },
  { name: 'Severomorsk Naval Base',        country: 'Russia', branch: 'Navy',      lat: 69.0667, lng: 33.4167,   role: 'Northern Fleet HQ · Murmansk' },
  { name: 'Kaliningrad Naval Base',        country: 'Russia', branch: 'Navy',      lat: 54.6433, lng: 19.8919,   role: 'Baltic Fleet HQ · Russian exclave' },
  { name: 'Khmeimim Air Base',             country: 'Russia', branch: 'AF',        lat: 35.4011, lng: 35.9472,   role: 'Russian air base in Syria' },
  { name: 'Vladivostok Naval Base',        country: 'Russia', branch: 'Navy',      lat: 43.1056, lng: 131.8735,  role: 'Pacific Fleet HQ' },
  // ─── Chinese military ───
  { name: 'PLA Navy Yulin Base',           country: 'China',  branch: 'PLAN',      lat: 18.2333, lng: 109.6917,  role: 'Submarine base · Hainan Island' },
  { name: 'PLA Rocket Force HQ',           country: 'China',  branch: 'Strategic', lat: 39.9042, lng: 116.4074,  role: 'Strategic missile force · Beijing area' },
  { name: 'Djibouti PLA Support Base',     country: 'China',  branch: 'Joint',     lat: 11.5876, lng: 43.0522,   role: 'First overseas Chinese military base' },
  { name: 'Mischief Reef',                 country: 'China',  branch: 'PLAN',      lat: 9.9000, lng: 115.5333,   role: 'Disputed South China Sea outpost' },
  // ─── Other strategic ───
  { name: 'Israel: Tel Nof AB',            country: 'Israel', branch: 'IAF',       lat: 31.8389, lng: 34.8214,   role: 'Israeli Air Force base' },
  { name: 'Israel: Negev Nuclear Center',  country: 'Israel', branch: 'Strategic', lat: 31.0014, lng: 35.1467,   role: 'Dimona research center' },
  { name: 'India: INS Kadamba',            country: 'India',  branch: 'Navy',      lat: 14.8167, lng: 74.1500,   role: 'Karwar naval base' },
  { name: 'Pakistan: Sargodha AB',         country: 'Pakistan',branch: 'PAF',      lat: 32.0481, lng: 72.6692,   role: 'Pakistan AF central command' },
];

// ──────────── Geopolitical Risk Overlay ────────────
//
// Three datasets that compose the "geopolitics" view of the world:
//
// 1. CHOKEPOINTS — strategic maritime/aerial passages where ~20% of
//    global trade physically routes. Disruption at any of these
//    moves commodity prices within hours: Strait of Hormuz (oil),
//    Suez (LNG, container), Bab el-Mandeb (Red Sea / Suez approach),
//    Strait of Malacca (Asia trade), Panama Canal, Bosphorus.
//
//    Each entry: { id, name, lat, lng, traffic, importance, summary }
//    importance: 'critical' | 'high' | 'moderate' (drives marker
//    size/intensity). traffic is a short string like "20% of seaborne
//    oil" for the popup.
//
// 2. SANCTIONS_PROGRAMS — major active sanctions programs. Each
//    targets a country/entity and impacts specific sectors. Used
//    to generate a "what's blocked" sidebar when the user clicks
//    a country region. Keeps it factual — names the OFAC/EU/UN
//    program, the targeted country, the impact summary.
//
// 3. GEOPOLITICAL_RISK — country-level risk score (0-100) drawn
//    from a synthesis of: active conflicts, sanctions, election
//    cycles, currency crises. Synthesized values (not a live
//    feed) — represents a January 2026 baseline. Future drop can
//    plug in a live ICRG / Verisk Maplecroft feed.
//
// All three are static data. Rendering: chokepoints become
// clickable point markers when filters.geopolitics is on.
// Sanctions and risk scores are surfaced through the side panel
// when a chokepoint is selected. The map doesn't get a country-
// tint heatmap because Mapbox vector country boundaries aren't
// part of the public default style and would require a separate
// data source — future drop with a backend country-poly source.

export const CHOKEPOINTS = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    lat: 26.5667, lng: 56.25,
    traffic: '~20% of seaborne oil · ~30% of global LNG',
    importance: 'critical',
    summary: 'Narrow waterway between Iran and Oman/UAE. Closure threats from Iran during sanctions episodes have spiked Brent 5–15% intraday. Approx 17 million barrels of oil/day flow through.',
    risksTo: ['Brent crude (BZ=F)', 'WTI (CL=F)', 'LNG carriers (GLNG, FLNG)', 'Saudi/UAE sovereigns'],
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    lat: 30.5852, lng: 32.2654,
    traffic: '~12% of global trade · ~9% of seaborne oil',
    importance: 'critical',
    summary: 'Egypt-controlled canal connecting Mediterranean and Red Sea. The 2021 Ever Given grounding cost ~$10B and re-routed 422 vessels around Cape of Good Hope (10–14 day delay). Houthi attacks 2024–2026 have driven volumes down ~60% via the Red Sea approach.',
    risksTo: ['Container shipping (ZIM, MAERSK)', 'Brent', 'Asian-EU trade flows'],
  },
  {
    id: 'bab-el-mandeb',
    name: 'Bab el-Mandeb',
    lat: 12.5833, lng: 43.3333,
    traffic: '~10% of seaborne oil · gateway to Suez',
    importance: 'critical',
    summary: 'Strait between Yemen and Djibouti — the southern entrance to the Red Sea / Suez approach. Houthi missile and drone attacks since late 2023 have made it the most-disrupted modern chokepoint. Carriers re-route via Cape of Good Hope, adding 40% transit time.',
    risksTo: ['Tanker rates (FRO, EURN)', 'Container freight (FBX index)', 'Suez Canal Authority revenue'],
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    lat: 1.4333, lng: 103.0,
    traffic: '~30% of global trade · 80% of China oil imports',
    importance: 'critical',
    summary: 'Singapore-Indonesia-Malaysia tri-junction. The "Malacca dilemma" — Beijing\'s strategic anxiety about US/allied closure capacity in a Taiwan crisis. China\'s Belt-and-Road land alternatives are partly motivated by reducing this dependency.',
    risksTo: ['Asian energy importers', 'Singapore TFEX', 'China crude futures'],
  },
  {
    id: 'panama',
    name: 'Panama Canal',
    lat: 9.0817, lng: -79.6803,
    traffic: '~5% of global trade · 40% of US container traffic',
    importance: 'high',
    summary: 'The 2023–2024 drought reduced Gatun Lake levels and cut crossings ~36%, forcing tankers to bid for slots in auction (one slot sold for $4M in late 2023). Ongoing climate risk; capacity recovery uncertain.',
    risksTo: ['LNG (Cheniere)', 'US grain exports (ADM, BG)', 'Auto carriers'],
  },
  {
    id: 'bosphorus',
    name: 'Bosphorus / Turkish Straits',
    lat: 41.1, lng: 29.05,
    traffic: '~3% of seaborne oil · all Black Sea grain',
    importance: 'high',
    summary: 'Türkiye-controlled. Critical for Russian Urals crude and Ukrainian/Russian wheat/corn. The Black Sea Grain Initiative (2022–2023) flowed through here; its breakdown impacted global grain prices.',
    risksTo: ['Russian crude grades', 'Wheat (ZW)', 'Corn (ZC)'],
  },
  {
    id: 'taiwan-strait',
    name: 'Taiwan Strait',
    lat: 24.0, lng: 119.5,
    traffic: 'Half of global container traffic transits',
    importance: 'critical',
    summary: 'A blockade or kinetic incident here would dwarf prior chokepoint disruptions. TSMC produces ~90% of leading-edge logic chips; market estimates put global GDP impact of a sustained closure at 5–10%. PLAN exercises have steadily increased since 2022.',
    risksTo: ['Semis (TSM, NVDA, AAPL)', 'Asia container freight', 'Yen safe-haven'],
  },
  {
    id: 'arctic-ne-passage',
    name: 'Arctic Northeast Passage',
    lat: 75.0, lng: 110.0,
    traffic: 'Growing — ~1.5% of seaborne (rising from <0.1%)',
    importance: 'moderate',
    summary: 'Ice-free season expanding by ~5 days/decade. Russia-controlled approach. Saves 30-40% transit time China-Europe vs Suez. China-Russia Polar Silk Road investments. Largely closed during winter; ice-class fleet limited.',
    risksTo: ['LNG carriers (NOVATEK)', 'Container freight long-term', 'Russian Arctic LNG'],
  },
  {
    id: 'cape-good-hope',
    name: 'Cape of Good Hope',
    lat: -34.3568, lng: 18.4737,
    traffic: 'Suez alternative — 6,000 nm extra · +10–14 days',
    importance: 'moderate',
    summary: 'Default re-route when Suez/Bab-el-Mandeb disrupted. Adds ~$1M per round-trip in fuel + 10-14 days. The 2024–2026 Red Sea crisis shifted ~60% of EU-Asia container traffic here.',
    risksTo: ['Charter rates', 'Bunker fuel demand', 'Container schedules'],
  },
];

// Major active sanctions programs as of January 2026. Synthesized
// from public OFAC SDN List / EU restrictive measures pages — used
// to enrich the chokepoint side panel and country pop-ups. Future
// drop can wire this to a live OFAC feed.
//
// Each entry's `affectedCountries` is a list of ISO-A3 codes — used
// to drive both the country-tint heatmap (sanctioned countries
// rendered with a stronger red overlay) and precise chokepoint
// matching (replacing the previous 25° centroid heuristic).
export const SANCTIONS_PROGRAMS = [
  { id: 'russia',     country: 'Russia',         affectedCountries: ['RUS'],
    programs: ['OFAC Russian Harmful Foreign Activities', 'EU 14th Package', 'UK FCDO'],
    affects: ['Energy exports', 'Banking (SWIFT cutoff)', 'Tech imports', 'Oligarchs'], since: '2022-02-24' },
  { id: 'iran',       country: 'Iran',           affectedCountries: ['IRN'],
    programs: ['OFAC Iranian Transactions', 'JCPOA snapback', 'UN 1929 (lapsed 2025)'],
    affects: ['Oil exports', 'Banking', 'IRGC entities', 'Drone tech'], since: '1995-05-06' },
  { id: 'north-korea',country: 'North Korea',    affectedCountries: ['PRK'],
    programs: ['OFAC NK Sanctions', 'UN 1718 Committee'],
    affects: ['All financial transactions', 'Coal/iron exports', 'Luxury goods'], since: '2006-10-14' },
  { id: 'syria',      country: 'Syria',          affectedCountries: ['SYR'],
    programs: ['OFAC Caesar Act', 'EU CFSP'],
    affects: ['Reconstruction finance', 'Energy investment'], since: '2020-06-17' },
  { id: 'venezuela',  country: 'Venezuela',      affectedCountries: ['VEN'],
    programs: ['OFAC Venezuela Sanctions (modulated)'],
    affects: ['PDVSA oil', 'Sovereign debt', 'Gold'], since: '2017-08-25' },
  { id: 'cuba',       country: 'Cuba',           affectedCountries: ['CUB'],
    programs: ['OFAC Cuba Embargo'],
    affects: ['Trade & travel', 'Helms-Burton property claims'], since: '1962-02-07' },
  { id: 'china-tech', country: 'China (selective)', affectedCountries: ['CHN'],
    programs: ['BIS Entity List', 'OFAC NS-CMIC', 'UFLPA'],
    affects: ['Advanced semis (Huawei, SMIC)', 'AI chip exports', 'Xinjiang-sourced goods'], since: '2019-05-16' },
  { id: 'belarus',    country: 'Belarus',        affectedCountries: ['BLR'],
    programs: ['OFAC Belarus EO 14038', 'EU CFSP'],
    affects: ['Lukashenko regime', 'Potash exports (Belaruskali)'], since: '2021-08-09' },
  // Yemen — the proxy state for Houthi missile/drone activity that
  // affects Bab el-Mandeb. Targeted via Iran-related secondary sanctions.
  { id: 'yemen-houthi', country: 'Yemen (Houthis)', affectedCountries: ['YEM'],
    programs: ['OFAC Specially Designated Global Terrorists (SDGT)'],
    affects: ['Maritime attacks (Bab el-Mandeb)', 'Iran proxy financing'], since: '2024-01-17' },
];

// Country capital coordinates — used for relationship arcs and
// for mapping country names → ISO-A3 polygon ids on the heatmap
// layer. Subset focused on the 25 countries we track risk scores
// for, plus a few others used in relationship lines.
export const COUNTRY_GEO = {
  'Russia':        { iso: 'RUS', capital: 'Moscow',     lat: 55.7558, lng: 37.6176 },
  'Ukraine':       { iso: 'UKR', capital: 'Kyiv',       lat: 50.4501, lng: 30.5234 },
  'Iran':          { iso: 'IRN', capital: 'Tehran',     lat: 35.6892, lng: 51.3890 },
  'Israel':        { iso: 'ISR', capital: 'Jerusalem',  lat: 31.7683, lng: 35.2137 },
  'North Korea':   { iso: 'PRK', capital: 'Pyongyang',  lat: 39.0392, lng: 125.7625 },
  'South Korea':   { iso: 'KOR', capital: 'Seoul',      lat: 37.5665, lng: 126.9780 },
  'Syria':         { iso: 'SYR', capital: 'Damascus',   lat: 33.5138, lng: 36.2765 },
  'Venezuela':     { iso: 'VEN', capital: 'Caracas',    lat: 10.4806, lng: -66.9036 },
  'Cuba':          { iso: 'CUB', capital: 'Havana',     lat: 23.1136, lng: -82.3666 },
  'Lebanon':       { iso: 'LBN', capital: 'Beirut',     lat: 33.8938, lng: 35.5018 },
  'Sudan':         { iso: 'SDN', capital: 'Khartoum',   lat: 15.5007, lng: 32.5599 },
  'Myanmar':       { iso: 'MMR', capital: 'Naypyidaw',  lat: 19.7633, lng: 96.0785 },
  'Yemen':         { iso: 'YEM', capital: 'Sanaa',      lat: 15.3694, lng: 44.1910 },
  'China':         { iso: 'CHN', capital: 'Beijing',    lat: 39.9042, lng: 116.4074 },
  'Taiwan':        { iso: 'TWN', capital: 'Taipei',     lat: 25.0330, lng: 121.5654 },
  'Türkiye':       { iso: 'TUR', capital: 'Ankara',     lat: 39.9334, lng: 32.8597 },
  'Egypt':         { iso: 'EGY', capital: 'Cairo',      lat: 30.0444, lng: 31.2357 },
  'Pakistan':      { iso: 'PAK', capital: 'Islamabad',  lat: 33.6844, lng: 73.0479 },
  'Mexico':        { iso: 'MEX', capital: 'Mexico City',lat: 19.4326, lng: -99.1332 },
  'Brazil':        { iso: 'BRA', capital: 'Brasília',   lat: -15.7942, lng: -47.8825 },
  'India':         { iso: 'IND', capital: 'New Delhi',  lat: 28.6139, lng: 77.2090 },
  'Saudi Arabia':  { iso: 'SAU', capital: 'Riyadh',     lat: 24.7136, lng: 46.6753 },
  'United States': { iso: 'USA', capital: 'Washington', lat: 38.9072, lng: -77.0369 },
  'United Kingdom':{ iso: 'GBR', capital: 'London',     lat: 51.5074, lng: -0.1278 },
  'France':        { iso: 'FRA', capital: 'Paris',      lat: 48.8566, lng: 2.3522 },
  'Germany':       { iso: 'DEU', capital: 'Berlin',     lat: 52.5200, lng: 13.4050 },
  'European Union':{ iso: 'EUE', capital: 'Brussels',   lat: 50.8503, lng: 4.3517 },
  'Japan':         { iso: 'JPN', capital: 'Tokyo',      lat: 35.6762, lng: 139.6503 },
  'Switzerland':   { iso: 'CHE', capital: 'Bern',       lat: 46.9480, lng: 7.4474 },
  'Singapore':     { iso: 'SGP', capital: 'Singapore',  lat: 1.3521,  lng: 103.8198 },
  'Australia':     { iso: 'AUS', capital: 'Canberra',   lat: -35.2809, lng: 149.1300 },
  'Belarus':       { iso: 'BLR', capital: 'Minsk',      lat: 53.9006, lng: 27.5590 },
};

// Bilateral relationships rendered as great-circle arcs when the
// geopolitics overlay is on. `kind` drives line color/style:
//   'alliance'  → green solid (NATO, US-Japan, etc.)
//   'rivalry'   → red dashed (US-China, Russia-NATO, etc.)
//   'sanctions' → orange dashed (sanctioning country → target)
//   'trade'     → cyan dotted (major bilateral trade relationships)
export const COUNTRY_RELATIONSHIPS = [
  // Alliances
  { from: 'United States', to: 'United Kingdom', kind: 'alliance',  label: 'AUKUS / Five Eyes' },
  { from: 'United States', to: 'Japan',          kind: 'alliance',  label: 'US-Japan Treaty' },
  { from: 'United States', to: 'South Korea',    kind: 'alliance',  label: 'US-ROK Treaty' },
  { from: 'United States', to: 'Australia',      kind: 'alliance',  label: 'AUKUS' },
  { from: 'United States', to: 'Israel',         kind: 'alliance',  label: 'Strategic partnership' },
  { from: 'United States', to: 'Saudi Arabia',   kind: 'alliance',  label: 'Energy security' },
  { from: 'United States', to: 'Germany',        kind: 'alliance',  label: 'NATO' },
  { from: 'United States', to: 'France',         kind: 'alliance',  label: 'NATO' },
  { from: 'United Kingdom',to: 'Germany',        kind: 'alliance',  label: 'NATO' },
  { from: 'United Kingdom',to: 'France',         kind: 'alliance',  label: 'NATO' },
  { from: 'Russia',        to: 'China',          kind: 'alliance',  label: '"No-limits" partnership' },
  { from: 'Russia',        to: 'Belarus',        kind: 'alliance',  label: 'Union State' },
  { from: 'Russia',        to: 'North Korea',    kind: 'alliance',  label: 'Comprehensive partnership 2024' },
  { from: 'Iran',          to: 'Russia',         kind: 'alliance',  label: 'Strategic partnership' },
  { from: 'China',         to: 'Pakistan',       kind: 'alliance',  label: 'CPEC / All-weather' },
  // Rivalries
  { from: 'United States', to: 'China',          kind: 'rivalry',   label: 'Strategic competition' },
  { from: 'United States', to: 'Russia',         kind: 'rivalry',   label: 'Sanctions / proxy conflict' },
  { from: 'United States', to: 'Iran',           kind: 'rivalry',   label: 'Maximum pressure' },
  { from: 'United States', to: 'North Korea',    kind: 'rivalry',   label: 'Total embargo' },
  { from: 'India',         to: 'China',          kind: 'rivalry',   label: 'LAC border tension' },
  { from: 'India',         to: 'Pakistan',       kind: 'rivalry',   label: 'Kashmir dispute' },
  { from: 'China',         to: 'Taiwan',         kind: 'rivalry',   label: 'PLA exercise tempo' },
  { from: 'Israel',        to: 'Iran',           kind: 'rivalry',   label: 'Direct strikes (2024–2026)' },
  { from: 'Saudi Arabia',  to: 'Iran',           kind: 'rivalry',   label: 'Regional power competition' },
  // Trade
  { from: 'China',         to: 'Germany',        kind: 'trade',     label: 'Largest EU trade partner' },
  { from: 'China',         to: 'Australia',      kind: 'trade',     label: 'Iron ore / coal' },
  { from: 'United States', to: 'Mexico',         kind: 'trade',     label: 'USMCA — largest US partner' },
  { from: 'European Union',to: 'United Kingdom', kind: 'trade',     label: 'TCA' },
];

// Country-level geopolitical risk scores (0–100, higher = more risk).
// January 2026 baseline. Synthesized; not a live feed. The score is
// a synthesis of: active conflicts, sanctions exposure, currency
// stability, election uncertainty, governance quality. Used to color
// the country pill in the side panel — green <30, yellow 30–60,
// orange 60–80, red 80+.
export const GEOPOLITICAL_RISK = {
  'Russia':       { score: 92, drivers: ['Active war (Ukraine)', 'Heavy sanctions', 'Capital controls', 'Mobilization'] },
  'Ukraine':      { score: 88, drivers: ['Active war', 'Territorial uncertainty', 'Reconstruction debt'] },
  'Iran':         { score: 85, drivers: ['Direct conflict (Israel)', 'Currency collapse', 'Comprehensive sanctions'] },
  'Israel':       { score: 78, drivers: ['Multi-front conflict', 'Domestic political unrest', 'Reservist economy'] },
  'North Korea':  { score: 95, drivers: ['Total sanctions', 'No banking access', 'Nuclear posture'] },
  'Syria':        { score: 90, drivers: ['Post-Assad transition', 'Sanctions overhang', 'Reconstruction stalled'] },
  'Venezuela':    { score: 82, drivers: ['Hyperinflation', 'PDVSA sanctions', 'Disputed elections'] },
  'Lebanon':      { score: 80, drivers: ['Currency collapse', 'Hezbollah-Israel exchanges', 'Banking crisis'] },
  'Sudan':        { score: 88, drivers: ['Civil war (SAF/RSF)', '10M+ displaced', 'Famine conditions'] },
  'Myanmar':      { score: 84, drivers: ['Civil war', 'Junta sanctions', 'Refugee outflows'] },
  'China':        { score: 58, drivers: ['Taiwan Strait tension', 'Property crisis aftermath', 'BIS Entity List'] },
  'Taiwan':       { score: 55, drivers: ['PLA exercise tempo', 'Semi-supply concentration risk'] },
  'Türkiye':      { score: 52, drivers: ['Lira volatility', 'Bosphorus leverage', 'Election aftermath'] },
  'Egypt':        { score: 48, drivers: ['Suez Canal revenue down', 'Currency pressure', 'Subsidy reform'] },
  'Pakistan':     { score: 60, drivers: ['IMF program', 'Currency pressure', 'Internal terrorism'] },
  'Mexico':       { score: 35, drivers: ['Cartel violence', 'USMCA renegotiation', 'AMLO succession'] },
  'Brazil':       { score: 30, drivers: ['Fiscal slippage', 'Amazon deforestation pressure'] },
  'India':        { score: 25, drivers: ['China border tension', 'Election cycle quirks'] },
  'Saudi Arabia': { score: 38, drivers: ['Oil price exposure', 'Vision 2030 execution', 'Yemen war'] },
  'United States':{ score: 22, drivers: ['Political polarization', 'Debt ceiling cycles'] },
  'European Union':{ score: 28, drivers: ['Energy transition costs', 'Russia border', 'Far-right surge'] },
  'United Kingdom':{ score: 26, drivers: ['Brexit ongoing costs', 'Fiscal pressure'] },
  'Japan':        { score: 18, drivers: ['Demographic decline', 'JPY weakness'] },
  'Switzerland':  { score: 8,  drivers: ['Banking secrecy reforms'] },
  'Singapore':    { score: 12, drivers: ['Malacca dependency'] },
  'Australia':    { score: 14, drivers: ['China trade exposure'] },
};

// As-of date for the risk table — surfaced in the side panel so users
// know when the scores were last set rather than treating them as a
// live feed. Update this when the table is re-evaluated. Future drop
// can wire to a live ICRG / Verisk Maplecroft / GeoQuant feed via a
// backend proxy (the consumer keys on those services aren't free).
export const GEOPOLITICAL_RISK_AS_OF = '2026-01-15';

// ──────────── Active Conflict Zones (2025-2026) ────────────
// Centroid + approximate radius (km) for circular highlight overlays.
// `severity` drives the color intensity.
export const CONFLICT_ZONES = [
  {
    id: 'ukraine-russia',
    name: 'Russia–Ukraine War',
    summary: 'Active since Feb 2022 · front line through eastern/southern Ukraine',
    centerLat: 48.5, centerLng: 37.5,
    radiusKm: 600,
    severity: 'high',
    started: '2022-02-24',
  },
  {
    id: 'israel-iran',
    name: 'Israel–Iran Conflict',
    summary: 'Direct strikes since 2024 · proxy fighting across Lebanon/Syria/Iraq',
    centerLat: 32.0, centerLng: 39.0,
    radiusKm: 900,
    severity: 'high',
    started: '2024-04-13',
  },
  {
    id: 'gaza-israel',
    name: 'Gaza–Israel War',
    summary: 'Active conflict since Oct 2023',
    centerLat: 31.5, centerLng: 34.45,
    radiusKm: 80,
    severity: 'high',
    started: '2023-10-07',
  },
  {
    id: 'sudan-civil-war',
    name: 'Sudan Civil War',
    summary: 'SAF vs RSF since April 2023 · displacing 10M+',
    centerLat: 13.5, centerLng: 32.5,
    radiusKm: 700,
    severity: 'high',
    started: '2023-04-15',
  },
  {
    id: 'myanmar-civil-war',
    name: 'Myanmar Civil War',
    summary: 'Ongoing since 2021 coup · multiple armed groups',
    centerLat: 21.0, centerLng: 96.0,
    radiusKm: 600,
    severity: 'medium',
    started: '2021-02-01',
  },
  {
    id: 'south-china-sea',
    name: 'South China Sea Tensions',
    summary: 'Naval standoffs over disputed territory · low-intensity',
    centerLat: 14.0, centerLng: 117.0,
    radiusKm: 850,
    severity: 'low',
    started: '2012-04-01',
  },
  {
    id: 'taiwan-strait',
    name: 'Taiwan Strait Tensions',
    summary: 'Increased PLA exercises and incursions',
    centerLat: 24.0, centerLng: 121.0,
    radiusKm: 400,
    severity: 'medium',
    started: '2022-08-01',
  },
];

// LiveUAMaps-style frontline events — small incident markers placed along
// active conflict zones. Each marker has a category (strike, advance,
// statement, casualty) so the map can color-code them. These are rendered
// as small circles on top of the conflict polygons. Data is illustrative;
// in production this would come from a news/intelligence feed.
export const FRONTLINE_EVENTS = [
  // Russia-Ukraine
  { id: 'fl-uk-1', conflict: 'ukraine-russia', lat: 47.85,  lng: 37.68,  category: 'strike',     ts: '2h ago', text: 'Drone strikes reported in Pokrovsk' },
  { id: 'fl-uk-2', conflict: 'ukraine-russia', lat: 48.27,  lng: 37.99,  category: 'advance',    ts: '6h ago', text: 'Russian forces advance near Avdiivka' },
  { id: 'fl-uk-3', conflict: 'ukraine-russia', lat: 50.91,  lng: 34.80,  category: 'strike',     ts: '4h ago', text: 'Glide-bomb strikes in Sumy oblast' },
  { id: 'fl-uk-4', conflict: 'ukraine-russia', lat: 49.99,  lng: 36.23,  category: 'casualty',   ts: '12h ago',text: 'Civilian casualties reported in Kharkiv' },
  { id: 'fl-uk-5', conflict: 'ukraine-russia', lat: 46.64,  lng: 32.60,  category: 'statement',  ts: '1h ago', text: 'Ukrainian general staff brief: positions held in Kherson' },
  { id: 'fl-uk-6', conflict: 'ukraine-russia', lat: 47.95,  lng: 33.41,  category: 'strike',     ts: '8h ago', text: 'Energy infrastructure hit in Kryvyi Rih' },
  // Israel-Iran
  { id: 'fl-ir-1', conflict: 'israel-iran',    lat: 35.69,  lng: 51.42,  category: 'strike',     ts: '3h ago', text: 'Reports of explosions near Tehran' },
  { id: 'fl-ir-2', conflict: 'israel-iran',    lat: 33.50,  lng: 36.30,  category: 'strike',     ts: '5h ago', text: 'Damascus suburbs targeted' },
  { id: 'fl-ir-3', conflict: 'israel-iran',    lat: 32.96,  lng: 35.50,  category: 'casualty',   ts: '10h ago',text: 'Northern Israel hit by rockets from Lebanon' },
  // Gaza
  { id: 'fl-gz-1', conflict: 'gaza-israel',    lat: 31.38,  lng: 34.30,  category: 'strike',     ts: '1h ago', text: 'IDF airstrikes in southern Gaza' },
  { id: 'fl-gz-2', conflict: 'gaza-israel',    lat: 31.52,  lng: 34.45,  category: 'advance',    ts: '6h ago', text: 'Ground operations expand' },
  { id: 'fl-gz-3', conflict: 'gaza-israel',    lat: 31.32,  lng: 34.25,  category: 'casualty',   ts: '2h ago', text: 'Aid convoy strike reported' },
  // Sudan
  { id: 'fl-sd-1', conflict: 'sudan-civil-war',lat: 15.59,  lng: 32.53,  category: 'strike',     ts: '4h ago', text: 'Khartoum: drone attacks on RSF positions' },
  { id: 'fl-sd-2', conflict: 'sudan-civil-war',lat: 13.45,  lng: 24.30,  category: 'advance',    ts: '1d ago', text: 'RSF advances near El-Fasher' },
];


// These cover the four "stacks" from the spec:
//   1. Risk Assessment & Insurance (Protecting Capital)
//   2. Supply Chain & Logistics (Connectivity)
//   3. Natural Resources & Commodities (Value Extraction)
//   4. Market Intelligence (Growth & Labor)
//
// Each pin is a real-world reference location so the map looks plausible.
// Coordinates are approximate to public reference data (port indexes,
// USGS mineral databases, public cable landing maps, World Bank G-Econ).

// GAR15 — Global Assessment of Risk: capital invested at 5km res. We pick
// a representative set of major industrial / financial concentrations that
// represent high "capital at risk" cells.
export const GAR15_POINTS = [
  { id: 'gar-tokyo',     type: 'gar15', lat: 35.6895, lng: 139.6917, name: 'Tokyo metro',         capital: '$8.4T',  desc: 'Highest-density GAR15 cell — financial + industrial assets' },
  { id: 'gar-shanghai',  type: 'gar15', lat: 31.2304, lng: 121.4737, name: 'Shanghai metro',      capital: '$5.1T',  desc: 'Manufacturing + finance — typhoon + flood exposure' },
  { id: 'gar-newyork',   type: 'gar15', lat: 40.7128, lng: -74.0060, name: 'New York metro',      capital: '$6.2T',  desc: 'Financial assets + coastal hurricane exposure' },
  { id: 'gar-london',    type: 'gar15', lat: 51.5074, lng: -0.1278,  name: 'London',              capital: '$3.8T',  desc: 'Financial center + Thames flood risk' },
  { id: 'gar-osaka',     type: 'gar15', lat: 34.6937, lng: 135.5023, name: 'Osaka',               capital: '$2.4T',  desc: 'Industrial cluster · seismic zone' },
  { id: 'gar-mumbai',    type: 'gar15', lat: 19.0760, lng: 72.8777,  name: 'Mumbai',              capital: '$1.9T',  desc: 'Indian financial center · monsoon exposure' },
  { id: 'gar-frankfurt', type: 'gar15', lat: 50.1109, lng: 8.6821,   name: 'Frankfurt',           capital: '$1.6T',  desc: 'EU financial hub · low natural disaster risk' },
  { id: 'gar-singapore', type: 'gar15', lat: 1.3521,  lng: 103.8198, name: 'Singapore',           capital: '$2.1T',  desc: 'Asia-Pacific finance · low geophysical risk' },
  { id: 'gar-shenzhen',  type: 'gar15', lat: 22.5431, lng: 114.0579, name: 'Shenzhen',            capital: '$1.8T',  desc: 'Tech manufacturing · typhoon exposure' },
  { id: 'gar-houston',   type: 'gar15', lat: 29.7604, lng: -95.3698, name: 'Houston',             capital: '$1.3T',  desc: 'Energy infrastructure · Gulf hurricane zone' },
];

// Natural disaster hotspots — areas where economic loss frequency is high
export const DISASTER_HOTSPOTS = [
  { id: 'dh-philippines', type: 'disaster', lat: 13.41,   lng: 122.56,  name: 'Philippines typhoon belt', risk: 'High',   desc: 'Avg 20 typhoons/yr · supply chain disruption' },
  { id: 'dh-bangladesh',  type: 'disaster', lat: 23.81,   lng: 90.41,   name: 'Bangladesh delta',         risk: 'Very High', desc: 'Cyclones + flooding · garment supply chain' },
  { id: 'dh-japan',       type: 'disaster', lat: 35.0,    lng: 139.0,   name: 'Japan seismic zone',       risk: 'High',   desc: 'Subduction zone · semis + auto plants' },
  { id: 'dh-haiti',       type: 'disaster', lat: 18.97,   lng: -72.28,  name: 'Hispaniola',                risk: 'High',   desc: 'Earthquakes + hurricanes' },
  { id: 'dh-himalaya',    type: 'disaster', lat: 28.0,    lng: 84.0,    name: 'Himalayan front',           risk: 'High',   desc: 'Earthquakes + glacial lake outbursts' },
  { id: 'dh-indonesia',   type: 'disaster', lat: -2.5,    lng: 117.0,   name: 'Indonesian arc',            risk: 'Very High', desc: 'Volcanic + tsunami + seismic' },
  { id: 'dh-cariibean',   type: 'disaster', lat: 18.2,    lng: -66.5,   name: 'Caribbean hurricane belt',  risk: 'High',   desc: 'Annual hurricane season' },
  { id: 'dh-newzealand',  type: 'disaster', lat: -41.27,  lng: 174.78,  name: 'Wellington fault',          risk: 'Medium', desc: 'Major earthquake every 250yr' },
];

// ETOPO1 / GSHHS — bathymetry markers (offshore wind farms, oil rigs)
export const BATHYMETRY_POINTS = [
  { id: 'bath-northsea',  type: 'bathymetry', lat: 56.0,   lng: 3.0,    name: 'North Sea',           depth: '94m avg',  desc: 'Shallow shelf · offshore wind + oil' },
  { id: 'bath-doggerbank',type: 'bathymetry', lat: 55.0,   lng: 2.5,    name: 'Dogger Bank',         depth: '20-30m',   desc: 'World\'s largest offshore wind farm' },
  { id: 'bath-gulfmexico',type: 'bathymetry', lat: 27.0,   lng: -90.0,  name: 'Gulf of Mexico shelf',depth: '0-200m',    desc: 'Deepwater oil + ethanol export' },
  { id: 'bath-baltic',    type: 'bathymetry', lat: 58.0,   lng: 20.0,   name: 'Baltic Sea',          depth: '55m avg',  desc: 'Offshore wind · low salinity' },
  { id: 'bath-japan',     type: 'bathymetry', lat: 36.5,   lng: 142.0,  name: 'Japan trench',        depth: '8,000m',   desc: 'Seismically active' },
  { id: 'bath-mariana',   type: 'bathymetry', lat: 11.35,  lng: 142.2,  name: 'Mariana Trench',      depth: '11,000m',  desc: 'Deepest point on Earth' },
];

// Undersea telecom cable landing stations
export const UNDERSEA_CABLE_POINTS = [
  { id: 'uc-marseille',   type: 'cable', lat: 43.2965,  lng: 5.3698,   name: 'Marseille',         cables: 14, desc: 'Major Med crossroads · MENA + Asia routes' },
  { id: 'uc-singapore',   type: 'cable', lat: 1.3521,   lng: 103.8198, name: 'Singapore',         cables: 26, desc: 'Asia-Pacific cable hub' },
  { id: 'uc-luanda',      type: 'cable', lat: -8.8383,  lng: 13.2344,  name: 'Luanda',            cables: 8,  desc: 'West Africa landing — Equiano (Google)' },
  { id: 'uc-virginia',    type: 'cable', lat: 36.85,    lng: -75.98,   name: 'Virginia Beach',    cables: 17, desc: 'East Coast US cable cluster · MAREA, BRUSA' },
  { id: 'uc-hongkong',    type: 'cable', lat: 22.3193,  lng: 114.1694, name: 'Hong Kong',         cables: 22, desc: 'Asia financial connectivity' },
  { id: 'uc-fortaleza',   type: 'cable', lat: -3.7172,  lng: -38.5433, name: 'Fortaleza',         cables: 16, desc: 'South America hub · Atlantic cables' },
  { id: 'uc-mumbai',      type: 'cable', lat: 19.076,   lng: 72.8777,  name: 'Mumbai',            cables: 15, desc: 'India landing · MENA-Europe routes' },
  { id: 'uc-tokyo',       type: 'cable', lat: 35.32,    lng: 139.83,   name: 'Maruyama (Chiba)',  cables: 12, desc: 'Japan landing for trans-Pacific' },
  { id: 'uc-cornwall',    type: 'cable', lat: 50.32,    lng: -5.13,    name: 'Bude (Cornwall)',   cables: 9,  desc: 'UK landing · trans-Atlantic' },
  { id: 'uc-djibouti',    type: 'cable', lat: 11.5886,  lng: 43.1457,  name: 'Djibouti',          cables: 11, desc: 'Critical chokepoint · Asia-Africa-Europe' },
];

// World Port Index — major global ports (subset of 3,700)
export const PORT_INDEX_POINTS = [
  { id: 'port-shanghai',   type: 'port', lat: 31.2304, lng: 121.4737, name: 'Shanghai',           teu: '47.3M', desc: 'World\'s largest container port' },
  { id: 'port-singapore',  type: 'port', lat: 1.2649,  lng: 103.8222, name: 'Singapore',          teu: '37.5M', desc: 'Asia-Pacific transshipment hub' },
  { id: 'port-rotterdam',  type: 'port', lat: 51.9244, lng: 4.4777,   name: 'Rotterdam',          teu: '15.3M', desc: 'EU\'s largest port · ARA hub' },
  { id: 'port-antwerp',    type: 'port', lat: 51.2194, lng: 4.4025,   name: 'Antwerp-Bruges',     teu: '13.5M', desc: 'Chemicals + container · 2nd EU' },
  { id: 'port-busan',      type: 'port', lat: 35.1796, lng: 129.0756, name: 'Busan',              teu: '22.7M', desc: 'Korea\'s largest · trans-shipment' },
  { id: 'port-laxlong',    type: 'port', lat: 33.7361, lng: -118.2639, name: 'LA / Long Beach',   teu: '17.3M', desc: 'US West Coast gateway' },
  { id: 'port-hamburg',    type: 'port', lat: 53.5436, lng: 9.9784,   name: 'Hamburg',            teu: '8.3M',  desc: 'Major German port · rail-connected' },
  { id: 'port-dubai',      type: 'port', lat: 25.0192, lng: 55.0608,  name: 'Jebel Ali (Dubai)',  teu: '14.5M', desc: 'MENA hub · DP World HQ' },
  { id: 'port-savannah',   type: 'port', lat: 32.0809, lng: -81.0912, name: 'Savannah',           teu: '5.9M',  desc: 'US East Coast · Asia routes' },
  { id: 'port-felixstowe', type: 'port', lat: 51.9542, lng: 1.3464,   name: 'Felixstowe',         teu: '4.0M',  desc: 'UK\'s largest container port' },
  { id: 'port-hochiminh',  type: 'port', lat: 10.7626, lng: 106.7045, name: 'Ho Chi Minh',        teu: '8.4M',  desc: 'Vietnam manufacturing exports' },
  { id: 'port-santos',     type: 'port', lat: -23.9543, lng: -46.3289, name: 'Santos',            teu: '4.7M',  desc: 'Largest in Latin America' },
];

// gROADS — major regional road network hubs (key freight corridors)
export const ROAD_HUB_POINTS = [
  { id: 'road-chicago',    type: 'road', lat: 41.8781,  lng: -87.6298,  name: 'Chicago',          desc: 'US interstate intersection · I-90/94/55/57/65/80' },
  { id: 'road-frankfurt',  type: 'road', lat: 50.1109,  lng: 8.6821,    name: 'Frankfurt',        desc: 'EU road network nexus · A3/A5/A66' },
  { id: 'road-newdelhi',   type: 'road', lat: 28.6139,  lng: 77.2090,   name: 'New Delhi',        desc: 'Golden Quadrilateral · NH1/NH2' },
  { id: 'road-saopaulo',   type: 'road', lat: -23.5505, lng: -46.6333,  name: 'São Paulo',        desc: 'BR-116 · S. America key freight corridor' },
  { id: 'road-johannesburg',type: 'road',lat: -26.2041, lng: 28.0473,   name: 'Johannesburg',     desc: 'Sub-Saharan freight hub' },
  { id: 'road-istanbul',   type: 'road', lat: 41.0082,  lng: 28.9784,   name: 'Istanbul',         desc: 'Europe-Asia freight crossing' },
  { id: 'road-jakarta',    type: 'road', lat: -6.2088,  lng: 106.8456,  name: 'Jakarta',          desc: 'SE Asia trans-Java toll network' },
  { id: 'road-lagos',      type: 'road', lat: 6.5244,   lng: 3.3792,    name: 'Lagos',            desc: 'West Africa port-hinterland link' },
];

// Mineral Resources Data System — major lithium/copper/gold/rare earth zones
export const MINERAL_POINTS = [
  { id: 'min-salar',         type: 'mineral', lat: -23.5,   lng: -68.0,   name: 'Salar de Atacama',     mineral: 'Lithium',     desc: 'Chile lithium triangle · 30% global brine' },
  { id: 'min-uyuni',         type: 'mineral', lat: -20.13,  lng: -67.49,  name: 'Salar de Uyuni',       mineral: 'Lithium',     desc: 'Bolivia · world\'s largest reserves' },
  { id: 'min-greenbushes',   type: 'mineral', lat: -33.85,  lng: 116.07,  name: 'Greenbushes WA',       mineral: 'Lithium',     desc: 'Australia · largest hard-rock Li mine' },
  { id: 'min-escondida',     type: 'mineral', lat: -24.27,  lng: -69.07,  name: 'Escondida',            mineral: 'Copper',      desc: 'Chile · world\'s largest copper mine' },
  { id: 'min-grasberg',      type: 'mineral', lat: -4.06,   lng: 137.11,  name: 'Grasberg',             mineral: 'Copper/Gold', desc: 'Indonesia · 2nd largest copper, largest gold' },
  { id: 'min-bayan-obo',     type: 'mineral', lat: 41.78,   lng: 109.97,  name: 'Bayan Obo',            mineral: 'Rare Earths', desc: 'China · 70%+ global REE supply' },
  { id: 'min-mountain-pass', type: 'mineral', lat: 35.49,   lng: -115.53, name: 'Mountain Pass',        mineral: 'Rare Earths', desc: 'California · only US REE mine' },
  { id: 'min-witwater',      type: 'mineral', lat: -26.20,  lng: 28.04,   name: 'Witwatersrand',        mineral: 'Gold',        desc: 'South Africa · 40% of all gold ever mined' },
  { id: 'min-kolwezi',       type: 'mineral', lat: -10.71,  lng: 25.46,   name: 'Kolwezi',              mineral: 'Cobalt/Copper', desc: 'DRC · ~70% global cobalt' },
  { id: 'min-pilbara',       type: 'mineral', lat: -22.5,   lng: 119.0,   name: 'Pilbara',              mineral: 'Iron Ore',    desc: 'Australia · BHP/Rio Tinto/Fortescue' },
];

// CROPGRIDS — top global crop production zones (subset of 173 crops)
export const CROPGRID_POINTS = [
  { id: 'cg-cornbelt',     type: 'cropgrid', lat: 41.5,    lng: -91.5,   name: 'US Corn Belt',       crop: 'Corn',     desc: '~33% of global corn · IA/IL/IN/NE' },
  { id: 'cg-pampas',       type: 'cropgrid', lat: -34.5,   lng: -62.0,   name: 'Argentine Pampas',   crop: 'Soybean',  desc: '3rd largest soybean exporter' },
  { id: 'cg-cerrado',      type: 'cropgrid', lat: -15.0,   lng: -47.0,   name: 'Brazil Cerrado',     crop: 'Soybean',  desc: 'Largest soybean producer' },
  { id: 'cg-prairies',     type: 'cropgrid', lat: 51.5,    lng: -106.0,  name: 'Canadian Prairies',  crop: 'Wheat',    desc: '#3 global wheat exporter' },
  { id: 'cg-blackearth',   type: 'cropgrid', lat: 51.0,    lng: 38.0,    name: 'Russian Black Earth', crop: 'Wheat',   desc: 'Largest wheat exporter' },
  { id: 'cg-ukraine',      type: 'cropgrid', lat: 49.5,    lng: 32.0,    name: 'Ukraine breadbasket', crop: 'Grain',   desc: 'Major sunflower oil + corn + wheat' },
  { id: 'cg-deltapunjab',  type: 'cropgrid', lat: 30.7,    lng: 75.0,    name: 'Punjab',             crop: 'Rice/Wheat',desc: 'India breadbasket · groundwater stress' },
  { id: 'cg-mekong',       type: 'cropgrid', lat: 10.0,    lng: 105.5,   name: 'Mekong Delta',       crop: 'Rice',     desc: 'Vietnam #2 rice exporter' },
  { id: 'cg-ivorycoast',   type: 'cropgrid', lat: 7.5,     lng: -5.5,    name: 'Côte d\'Ivoire',     crop: 'Cocoa',    desc: '~40% global cocoa' },
  { id: 'cg-brazcoffee',   type: 'cropgrid', lat: -20.0,   lng: -45.0,   name: 'Minas Gerais',       crop: 'Coffee',   desc: '~37% global coffee' },
];

// North Sea oil offshore licensing
export const OIL_OFFSHORE_POINTS = [
  { id: 'oil-johansverdrup', type: 'oil', lat: 58.85,   lng: 2.5,    name: 'Johan Sverdrup',     country: 'Norway', desc: 'Norway\'s largest field · 2.7B bbl' },
  { id: 'oil-ekofisk',       type: 'oil', lat: 56.5,    lng: 3.21,   name: 'Ekofisk',            country: 'Norway', desc: 'Original North Sea giant · 1969' },
  { id: 'oil-statfjord',     type: 'oil', lat: 61.2,    lng: 1.83,   name: 'Statfjord',          country: 'Norway/UK', desc: 'Cross-border · 4B bbl recovered' },
  { id: 'oil-buzzard',       type: 'oil', lat: 57.96,   lng: 0.89,   name: 'Buzzard',            country: 'UK',     desc: 'Largest UK find post-2000' },
  { id: 'oil-clair',         type: 'oil', lat: 60.83,   lng: -1.99,  name: 'Clair',              country: 'UK',     desc: 'Largest UK reserves · BP-operated' },
  { id: 'oil-troll',         type: 'oil', lat: 60.65,   lng: 3.7,    name: 'Troll',              country: 'Norway', desc: 'Major gas + oil · 60% of Norway gas' },
];

// G-Econ — sub-national high-productivity economic islands
export const GECON_POINTS = [
  { id: 'ge-pearlriver',  type: 'gecon', lat: 22.7,   lng: 113.5,  name: 'Pearl River Delta',     gcp: '$1.9T',  desc: 'Shenzhen+Guangzhou+HK manufacturing megacluster' },
  { id: 'ge-yangtzedelta',type: 'gecon', lat: 31.2,   lng: 121.5,  name: 'Yangtze River Delta',   gcp: '$2.4T',  desc: 'Shanghai+Suzhou+Hangzhou — China\'s top GDP' },
  { id: 'ge-bayarea',     type: 'gecon', lat: 37.7749, lng: -122.4194, name: 'SF Bay Area',       gcp: '$1.0T',  desc: 'Tech + finance · highest GDP per capita US' },
  { id: 'ge-tristate',    type: 'gecon', lat: 40.7128, lng: -74.0060, name: 'NY Tri-State',       gcp: '$2.0T',  desc: 'Largest metro economy in US' },
  { id: 'ge-rhineruhr',   type: 'gecon', lat: 51.45,  lng: 7.0,     name: 'Rhine-Ruhr',          gcp: '$0.7T',  desc: 'EU\'s largest metro economy' },
  { id: 'ge-keihin',      type: 'gecon', lat: 35.5,   lng: 139.7,   name: 'Greater Tokyo',       gcp: '$2.0T',  desc: 'World\'s largest metro economy' },
  { id: 'ge-ileducae',    type: 'gecon', lat: 48.8566, lng: 2.3522, name: 'Île-de-France',       gcp: '$0.85T', desc: 'France economic core · 31% of GDP' },
  { id: 'ge-southeast',   type: 'gecon', lat: 51.5074, lng: -0.1278, name: 'SE England',         gcp: '$1.1T',  desc: 'London + South East — UK economic engine' },
];

// Population — high-density labor force concentrations (GPW-style)
export const POPULATION_POINTS = [
  { id: 'pop-tokyo',        type: 'pop', lat: 35.69,   lng: 139.69,  name: 'Greater Tokyo',         pop: '37.4M' },
  { id: 'pop-delhi',        type: 'pop', lat: 28.61,   lng: 77.21,   name: 'Delhi',                 pop: '32.9M' },
  { id: 'pop-shanghai',     type: 'pop', lat: 31.23,   lng: 121.47,  name: 'Shanghai',              pop: '28.5M' },
  { id: 'pop-saopaulo',     type: 'pop', lat: -23.55,  lng: -46.63,  name: 'São Paulo',             pop: '22.8M' },
  { id: 'pop-mexicocity',   type: 'pop', lat: 19.43,   lng: -99.13,  name: 'Mexico City',           pop: '22.5M' },
  { id: 'pop-cairo',        type: 'pop', lat: 30.04,   lng: 31.24,   name: 'Cairo',                 pop: '22.0M' },
  { id: 'pop-mumbai',       type: 'pop', lat: 19.08,   lng: 72.88,   name: 'Mumbai',                pop: '21.7M' },
  { id: 'pop-beijing',      type: 'pop', lat: 39.90,   lng: 116.41,  name: 'Beijing',               pop: '21.5M' },
  { id: 'pop-dhaka',        type: 'pop', lat: 23.81,   lng: 90.41,   name: 'Dhaka',                 pop: '23.2M' },
  { id: 'pop-lagos',        type: 'pop', lat: 6.52,    lng: 3.38,    name: 'Lagos',                 pop: '15.5M' },
  { id: 'pop-jakarta',      type: 'pop', lat: -6.21,   lng: 106.85,  name: 'Jakarta',               pop: '11.2M (city) · 33M metro' },
  { id: 'pop-karachi',      type: 'pop', lat: 24.86,   lng: 67.01,   name: 'Karachi',               pop: '17.2M' },
];

/* ════════════════════════════════════════════════════════════════════════════
   PREDICTION MARKETS PAGE — Kalshi-style YES/NO event contracts
   ════════════════════════════════════════════════════════════════════════════ */

// Each market has a question, category, expiration, and current YES/NO prices
// in cents (0-100). YES + NO should ≈ 100 (minus the market's spread/fee).
// Volume/open interest are illustrative. In a real Kalshi clone these would
// come from a matching engine.
// Kalshi-style prediction markets — grouped by category with sport/topic
// icons, event context, and two competing outcomes per card. Each market
// represents a specific question; outcomes are the possible answers.
export const PREDICTION_EVENTS = [
  // ─── Insurance / Personal Liability Hedges ───
  {
    id: 'flood-damage-zip-10001',
    category: 'Insurance',
    event: 'Flood Damage Hedge',
    question: 'Significant flood damage in NYC ZIP 10001 by Dec 2026',
    live: 'Open',
    volume: 412_580,
    markets: 1,
    outcomes: [
      { name: 'Yes — flood event occurs', line: '12¢', pct: 12, color: '#7AC8FF' },
      { name: 'No flood event',           line: '88¢', pct: 88, color: COLORS.textDim },
    ],
  },
  {
    id: 'wildfire-ca-2026',
    category: 'Insurance',
    event: 'California Wildfire Season',
    question: 'Major wildfire (>10K acres) in California by Oct 2026',
    live: 'Open',
    volume: 882_140,
    markets: 1,
    outcomes: [
      { name: 'Yes — major wildfire',  line: '64¢', pct: 64, color: COLORS.red },
      { name: 'No major wildfire',     line: '36¢', pct: 36, color: COLORS.textDim },
    ],
  },
  {
    id: 'hurricane-fl-2026',
    category: 'Insurance',
    event: 'Florida Hurricane Season',
    question: 'Cat 3+ hurricane makes Florida landfall in 2026',
    live: 'Open',
    volume: 1_240_900,
    markets: 1,
    outcomes: [
      { name: 'Yes — Cat 3+ landfall', line: '38¢', pct: 38, color: COLORS.red },
      { name: 'No Cat 3+ landfall',    line: '62¢', pct: 62, color: COLORS.textDim },
    ],
  },
  {
    id: 'cyber-major-bank',
    category: 'Insurance',
    event: 'Major Bank Cyberattack',
    question: 'Top-10 US bank suffers material cyberattack by Dec 2026',
    live: 'Open',
    volume: 528_400,
    markets: 1,
    outcomes: [
      { name: 'Yes — material breach', line: '22¢', pct: 22, color: '#FF7AB6' },
      { name: 'No material breach',    line: '78¢', pct: 78, color: COLORS.textDim },
    ],
  },
  {
    id: 'data-breach-fortune-500',
    category: 'Insurance',
    event: 'Fortune 500 Data Breach',
    question: '5+ Fortune 500 firms suffer customer data breach in 2026',
    live: 'Open',
    volume: 314_220,
    markets: 1,
    outcomes: [
      { name: 'Yes — 5+ breaches', line: '71¢', pct: 71, color: '#E07AFC' },
      { name: 'Fewer than 5',      line: '29¢', pct: 29, color: COLORS.textDim },
    ],
  },
  {
    id: 'earthquake-ca-2026',
    category: 'Insurance',
    event: 'California Earthquake',
    question: 'Magnitude 6.0+ earthquake in California in 2026',
    live: 'Open',
    volume: 192_770,
    markets: 1,
    outcomes: [
      { name: 'Yes — M6.0+ event', line: '18¢', pct: 18, color: '#FFB84D' },
      { name: 'No M6.0+ event',    line: '82¢', pct: 82, color: COLORS.textDim },
    ],
  },

  // ─── Sports: Golf ───
  {
    id: 'zurich-winner',
    category: 'Golf',
    event: 'Zurich Classic of New Orleans',
    question: 'Zurich Classic of New Orleans Winner',
    live: 'Round 1',
    volume: 8_307_778,
    markets: 74,
    outcomes: [
      { name: 'A. Smalley / H. Springer',    line: '-14', lineSub: '18', pct: 42, color: COLORS.green },
      { name: 'A. Eckroat / D. Thompson',    line: '-13', lineSub: '18', pct: 35, color: '#7AC8FF' },
      { name: 'Field (all others)',          line: '+600',               pct: 23, color: COLORS.textDim },
    ],
  },
  {
    id: 'zurich-r1-leader',
    category: 'Golf',
    event: 'Zurich Classic of New Orleans',
    question: 'Zurich Classic End of Round 1 Leader',
    live: 'Round 1',
    volume: 1_302_246,
    markets: 74,
    outcomes: [
      { name: 'A. Smalley / H. Springer', line: '-14', lineSub: '18', pct: 91, color: COLORS.green },
      { name: 'Field (all others)',       line: '+900',               pct: 9,  color: COLORS.textDim },
    ],
  },
  {
    id: 'pga-winner',
    category: 'Golf',
    event: 'PGA Championship',
    question: 'PGA Championship Winner',
    starts: 'May 14 @ 12:00AM',
    volume: 3_621_506,
    markets: 67,
    outcomes: [
      { name: 'Scottie Scheffler',  line: '5.00x',  pct: 25, color: COLORS.green, flag: '🇺🇸' },
      { name: 'Rory McIlroy',       line: '10.0x',  pct: 15, color: '#7AC8FF',     flag: '🇬🇧' },
      { name: 'Field (all others)', line: '+200',   pct: 60, color: COLORS.textDim },
    ],
  },
  {
    id: 'volvo-china-winner',
    category: 'Golf',
    event: 'Volvo China Open',
    question: 'Volvo China Open Winner',
    live: 'Round 1',
    volume: 553_290,
    markets: 156,
    outcomes: [
      { name: 'Alejandro Del Rey',  line: '-10', lineSub: '18', pct: 38, color: COLORS.green, flag: '🇪🇸' },
      { name: 'Yanhan Zhou',        line: '-9',  lineSub: '18', pct: 27, color: '#7AC8FF',     flag: '🇨🇳' },
      { name: 'Field (all others)', line: '+300',                pct: 35, color: COLORS.textDim },
    ],
  },

  // ─── Pro Baseball ───
  {
    id: 'mlb-yankees-redsox',
    category: 'Pro Baseball',
    event: 'Yankees @ Red Sox',
    question: 'Yankees @ Red Sox Winner',
    live: 'Bot 7th',
    volume: 1_820_440,
    markets: 12,
    outcomes: [
      { name: 'New York Yankees', line: '-1.5', pct: 58, color: COLORS.green, flag: '⚾' },
      { name: 'Boston Red Sox',   line: '+1.5', pct: 42, color: '#7AC8FF',     flag: '⚾' },
    ],
  },
  {
    id: 'mlb-dodgers-sf',
    category: 'Pro Baseball',
    event: 'Dodgers @ Giants',
    question: 'Dodgers @ Giants Winner',
    starts: 'Tonight 7:15PM PT',
    volume: 942_300,
    markets: 8,
    outcomes: [
      { name: 'Los Angeles Dodgers', line: '-150', pct: 61, color: COLORS.green, flag: '⚾' },
      { name: 'San Francisco Giants', line: '+130', pct: 39, color: '#7AC8FF',    flag: '⚾' },
    ],
  },

  // ─── Macro ───
  {
    id: 'fed-jun-cut',
    category: 'Macro',
    event: 'Fed June FOMC',
    question: 'Will the Fed cut rates at June 2026 FOMC?',
    starts: 'Jun 18, 2026',
    volume: 8_400_000,
    markets: 4,
    outcomes: [
      { name: 'Yes, cut',        line: '74¢',  pct: 74, color: COLORS.green },
      { name: 'No, hold steady', line: '26¢',  pct: 26, color: COLORS.red },
    ],
  },
  {
    id: 'cpi-may',
    category: 'Macro',
    event: 'May 2026 CPI',
    question: 'Will May 2026 CPI come in below 3.0% YoY?',
    starts: 'Jun 12, 2026',
    volume: 3_200_000,
    markets: 6,
    outcomes: [
      { name: 'Yes, below 3.0%', line: '52¢', pct: 52, color: COLORS.green },
      { name: 'No, at or above', line: '48¢', pct: 48, color: COLORS.red },
    ],
  },

  // ─── Crypto ───
  {
    id: 'btc-100k-jun',
    category: 'Crypto',
    event: 'BTC Price Targets',
    question: 'Will BTC close above $100K by June 30?',
    starts: 'Jun 30, 2026',
    volume: 2_840_000,
    markets: 5,
    outcomes: [
      { name: 'Yes, above $100K', line: '32¢', pct: 32, color: COLORS.green },
      { name: 'No, below $100K',  line: '68¢', pct: 68, color: COLORS.red },
    ],
  },
  {
    id: 'eth-4k-may',
    category: 'Crypto',
    event: 'ETH Price Targets',
    question: 'Will ETH close above $4K by May 31?',
    starts: 'May 31, 2026',
    volume: 1_920_000,
    markets: 3,
    outcomes: [
      { name: 'Yes, above $4K', line: '58¢', pct: 58, color: COLORS.green },
      { name: 'No, below $4K',  line: '42¢', pct: 42, color: COLORS.red },
    ],
  },

  // ─── Equities ───
  {
    id: 'spy-650-ye',
    category: 'Equities',
    event: 'SPY Year-End Targets',
    question: 'Will SPY close above 650 by year-end?',
    starts: 'Dec 31, 2026',
    volume: 5_620_000,
    markets: 8,
    outcomes: [
      { name: 'Yes, above 650', line: '41¢', pct: 41, color: COLORS.green },
      { name: 'No, at or below',line: '59¢', pct: 59, color: COLORS.red },
    ],
  },
  {
    id: 'nvda-earn-beat',
    category: 'Equities',
    event: 'NVDA Q1 Earnings',
    question: 'Will NVDA beat EPS consensus this quarter?',
    starts: 'Next week',
    volume: 4_120_000,
    markets: 4,
    outcomes: [
      { name: 'Yes, beat', line: '71¢', pct: 71, color: COLORS.green },
      { name: 'No, miss',  line: '29¢', pct: 29, color: COLORS.red },
    ],
  },

  // ─── Politics ───
  {
    id: 'midterm-house',
    category: 'Politics',
    event: '2026 Midterms',
    question: 'Will the incumbent party win the House majority?',
    starts: 'Nov 3, 2026',
    volume: 12_400_000,
    markets: 3,
    outcomes: [
      { name: 'Incumbent party', line: '45¢', pct: 45, color: COLORS.green },
      { name: 'Opposition party', line: '55¢', pct: 55, color: COLORS.red },
    ],
  },
];
