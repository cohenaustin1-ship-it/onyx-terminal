// IMO Onyx Terminal — Map page
//
// Phase 3p.24 file-splitting / extracted from JPMOnyxTerminal.jsx
// (originally lines 72183-74705 plus 71066-71094 for the Mapbox
// helpers, ~2,550 lines total).
//
// Geographic data viz over a Mapbox globe. Layers include company
// HQ markers, USGS earthquakes, NOAA weather alerts, NASA fire
// snapshots, USDA crop regions. Click on a company → financial
// report modal with Polygon-fed live financials + AI summary.
//
// Public export:
//   MapPage({ initialCompanyFilter })
//
// Internal companions:
//   FinancialReportModal — slide-out modal for any ticker
//   FinReportCell        — single key/value cell inside the modal
//   useUsgsEarthquakes   — last-7-days quake feed
//   useNoaaAlerts        — active US weather alert feed
//   useNasaFires         — global active-fire snapshot (FIRMS)
//   useUsdaCrops         — crop region data (NASS)
//
// Internal fixtures / data:
//   FINANCIAL_REPORTS    — curated company report mocks (fallback)
//   FACILITY_STYLES      — per-asset-class marker styling
//   NASA_FIRES_SNAPSHOT  — fixture for the no-key fallback
//   CROP_REGIONS         — fixture for the no-key fallback
//   MAPBOX_TOKEN         — VITE_MAPBOX_TOKEN env var
//   loadMapboxGL         — CDN-loader (unpkg) for mapbox-gl JS
//
// Honest scope:
//   - Mapbox token is REQUIRED for the live map. Without one, the
//     page renders an in-banner notice and the underlying canvas
//     stays blank.
//   - NASA_FIRES_SNAPSHOT and CROP_REGIONS are static fallback data.
//     If the live feeds are configured, the hooks override these.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from 'recharts';
import { Search, Sparkles, X } from 'lucide-react';
import { COLORS } from '../lib/constants.js';
import { TICKER_SECTORS } from '../lib/constants.js';
import { INSTRUMENTS } from '../lib/instruments.js';
import { callAI, exaSearch } from '../lib/ai-calls.js';
import {
  fetchPolygonFinancials, fetchPolygonTickerDetails,
  SECTOR_CONSTITUENTS,
} from '../lib/polygon-api.js';
import {
  MAP_FLIGHTS, MAP_SHIPS, MAP_MARKETS,
  SUPPLY_CHAIN_FACILITIES, MILITARY_FACILITIES, DISASTER_HOTSPOTS,
  COUNTRY_RELATIONSHIPS, FRONTLINE_EVENTS, CHOKEPOINTS,
  COUNTRY_GEO, GEOPOLITICAL_RISK, GEOPOLITICAL_RISK_AS_OF,
  SANCTIONS_PROGRAMS, CONFLICT_ZONES,
  BATHYMETRY_POINTS, UNDERSEA_CABLE_POINTS, PORT_INDEX_POINTS,
  ROAD_HUB_POINTS, MINERAL_POINTS, CROPGRID_POINTS,
  OIL_OFFSHORE_POINTS, GECON_POINTS, POPULATION_POINTS, GAR15_POINTS,
} from '../lib/map-data.js';
import { DetailRow, EQUITY_TILE_COLORS } from './leaf-ui.jsx';

// Env-var keys (duplicated from monolith — same source, separate read).
const MASSIVE_API_KEY  = (() => { try { return import.meta.env?.VITE_MASSIVE_API_KEY  ?? ''; } catch { return ''; } })();
const ANTHROPIC_API_KEY= (() => { try { return import.meta.env?.VITE_ANTHROPIC_API_KEY?? ''; } catch { return ''; } })();
const EXA_API_KEY      = (() => { try { return import.meta.env?.VITE_EXA_API_KEY      ?? ''; } catch { return ''; } })();

// Mapbox token + dynamic loader (inlined from monolith — only MapPage
// uses these). MAPBOX_TOKEN env var is read at module load. The
// loader pulls mapbox-gl 3.8.0 from unpkg CDN since we don't bundle
// it (single-file app pattern, no bundler config to edit).
const MAPBOX_TOKEN = (() => { try { return import.meta.env?.VITE_MAPBOX_TOKEN ?? ''; } catch { return ''; } })();

// useCpuUsage — rough CPU-load proxy via rAF frame timing. 16.67ms
// = 60fps = 0% load. Inlined from monolith — only MapPage uses it
// (drives the perf-warning indicator on the map).
const useCpuUsage = () => {
  const [cpu, setCpu] = useState(0);
  useEffect(() => {
    let rafId = null;
    let last = performance.now();
    const samples = [];
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      samples.push(dt);
      if (samples.length > 60) samples.shift();
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const load = Math.min(100, Math.max(0, ((avg - 16.67) / 16.67) * 100));
      setCpu(+load.toFixed(0));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
  return cpu;
};
const loadMapboxGL = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.__mapboxLoading) return window.__mapboxLoading;
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  window.__mapboxLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/mapbox-gl@3.8.0/dist/mapbox-gl.css';
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/mapbox-gl@3.8.0/dist/mapbox-gl.js';
    s.async = true;
    s.onload = () => {
      if (window.mapboxgl) resolve(window.mapboxgl);
      else reject(new Error('mapbox-gl loaded but not on window'));
    };
    s.onerror = () => reject(new Error('failed to load mapbox-gl.js'));
    document.head.appendChild(s);
  });
  return window.__mapboxLoading;
};

// Map fixture data (inlined from monolith — only MapPage uses these).
// SOCIAL_CONN_POINTS    — Facebook Social Connectedness signal pins
// NEWS_PINS             — geo-tagged recent news for the map overlay
// GROWTH_REGIONS        — bubble overlays showing capital flow areas
//
// Facebook Social Connectedness Index — strong cross-border social ties
const SOCIAL_CONN_POINTS = [
  { id: 'sc-mexico-us',   type: 'social', lat: 25.7,    lng: -100.3,  name: 'Mexico ↔ Texas',         strength: 'Very High', desc: 'Migration + remittances · trade signal' },
  { id: 'sc-india-uk',    type: 'social', lat: 28.6,    lng: 77.2,    name: 'India ↔ UK',             strength: 'High',      desc: 'Diaspora · brand spread channel' },
  { id: 'sc-philip-us',   type: 'social', lat: 14.6,    lng: 121.0,   name: 'Philippines ↔ US/CA',    strength: 'High',      desc: 'Strong migration + trade ties' },
  { id: 'sc-poland-uk',   type: 'social', lat: 52.0,    lng: 19.0,    name: 'Poland ↔ UK',            strength: 'High',      desc: 'Post-EU accession workforce' },
  { id: 'sc-china-us',    type: 'social', lat: 31.23,   lng: 121.47,  name: 'China ↔ US',             strength: 'Med-High',  desc: 'Tech talent + cross-border M&A' },
  { id: 'sc-turkey-de',   type: 'social', lat: 41.0,    lng: 29.0,    name: 'Turkey ↔ Germany',       strength: 'High',      desc: 'Multi-generation diaspora' },
  { id: 'sc-vietnam-us',  type: 'social', lat: 10.76,   lng: 106.7,   name: 'Vietnam ↔ US',           strength: 'Med',       desc: 'Diaspora + supply chain shift' },
];

// News pins — recent geo-tagged news the user can press on. In production
// these would come from a real-time news feed; here we curate plausible
// recent stories so the map shows something on first load.
const NEWS_PINS = [
  { id: 'news-1', type: 'news', lat: 35.69,   lng: 139.69,  name: 'BOJ holds rates',                    desc: 'Yen weakens against USD; markets price in October hike chance' },
  { id: 'news-2', type: 'news', lat: 50.11,   lng: 8.68,    name: 'ECB signals October cut',           desc: 'EUR-denominated bonds rally on dovish guidance' },
  { id: 'news-3', type: 'news', lat: 24.81,   lng: 120.97,  name: 'TSMC raises guidance',              desc: 'AI demand drives Q3 revenue beat; capex revised up' },
  { id: 'news-4', type: 'news', lat: -23.5,   lng: -68.0,   name: 'Chile lithium royalty deal',        desc: 'SQM, Codelco partnership clears regulatory hurdle' },
  { id: 'news-5', type: 'news', lat: 31.5,    lng: 34.45,   name: 'Gaza ceasefire talks',              desc: 'Energy markets watch Middle East risk premium' },
  { id: 'news-6', type: 'news', lat: 48.5,    lng: 37.5,    name: 'Ukraine front update',              desc: 'Wheat futures move on supply route re-routing' },
  { id: 'news-7', type: 'news', lat: 1.35,    lng: 103.82,  name: 'Singapore MAS keeps policy band',   desc: 'SGD strengthens; ASEAN trade flows in focus' },
  { id: 'news-8', type: 'news', lat: 40.71,   lng: -74.01,  name: 'Fed Beige Book — modest growth',    desc: 'Labor cooling, services strong; CPI Tuesday' },
  { id: 'news-9', type: 'news', lat: 22.32,   lng: 114.17,  name: 'Hong Kong IPO pipeline rebuilds',   desc: 'Bytedance, AI startups eye HKEX listing' },
  { id: 'news-10',type: 'news', lat: -33.87,  lng: 151.21,  name: 'RBA on hold, dovish',                desc: 'AUD weak as services PMI disappoints' },
  { id: 'news-11',type: 'news', lat: 52.52,   lng: 13.4,    name: 'Germany IFO survey rebound',         desc: 'Confidence rises; DAX exporters relief' },
  { id: 'news-12',type: 'news', lat: -34.6,   lng: -58.4,   name: 'Argentina FX peg pressure',         desc: 'IMF talks ongoing; soybean export tax cut floated' },
];

// ──────────── Growth Regions (sector-tagged) ────────────
// Bubble overlays on the map showing where capital is flowing to. Sourced
// from rough VC/industrial-investment patterns.
const GROWTH_REGIONS = [
  // Tech / AI
  { name: 'Silicon Valley',         sector: 'tech-ai',     lat: 37.4419, lng: -122.1430, intensity: 95, blurb: 'AI capital · top VCs · talent density' },
  { name: 'Austin TX',              sector: 'tech-ai',     lat: 30.2672, lng: -97.7431,  intensity: 78, blurb: 'Tech hub · low-tax migration · semis' },
  { name: 'Bengaluru',              sector: 'tech-ai',     lat: 12.9716, lng: 77.5946,   intensity: 82, blurb: 'India tech · global services hub' },
  { name: 'Tel Aviv',               sector: 'tech-ai',     lat: 32.0853, lng: 34.7818,   intensity: 88, blurb: 'Cybersecurity · AI startups · per-capita VC leader' },
  // Semiconductors
  { name: 'Phoenix AZ',             sector: 'semis',       lat: 33.4484, lng: -112.0740, intensity: 90, blurb: 'TSMC fab · Intel expansion · CHIPS Act' },
  { name: 'Hsinchu',                sector: 'semis',       lat: 24.8138, lng: 120.9675,  intensity: 95, blurb: 'TSMC HQ · global semi center' },
  { name: 'Pyeongtaek',             sector: 'semis',       lat: 36.9921, lng: 127.1129,  intensity: 88, blurb: 'Samsung fabs · Korean semi cluster' },
  // Clean energy / EV
  { name: 'Texas Permian Basin',    sector: 'energy',      lat: 31.8457, lng: -102.3676, intensity: 85, blurb: 'Oil + emerging solar/storage · grid expansion' },
  { name: 'Reno NV',                sector: 'energy',      lat: 39.5296, lng: -119.8138, intensity: 70, blurb: 'Lithium · battery factories · Tesla Gigafactory' },
  { name: 'Chongqing',              sector: 'energy',      lat: 29.4316, lng: 106.9123,  intensity: 88, blurb: 'EV manufacturing · battery supply chain' },
  // Healthcare / biotech
  { name: 'Boston/Cambridge',       sector: 'biotech',     lat: 42.3736, lng: -71.1097,  intensity: 92, blurb: 'Biotech capital · top hospitals + MIT/Harvard' },
  { name: 'Research Triangle NC',   sector: 'biotech',     lat: 35.9101, lng: -79.0469,  intensity: 75, blurb: 'Pharma R&D · 3 major universities' },
  { name: 'Basel',                  sector: 'biotech',     lat: 47.5596, lng: 7.5886,    intensity: 80, blurb: 'Roche + Novartis · pharma giant cluster' },
  // Finance / fintech
  { name: 'Singapore',              sector: 'fintech',     lat: 1.3521,  lng: 103.8198,  intensity: 88, blurb: 'Asia financial hub · crypto/fintech friendly' },
  { name: 'NYC Hudson Yards',       sector: 'fintech',     lat: 40.7544, lng: -74.0010,  intensity: 90, blurb: 'Finance HQs · Wall St + tech crossover' },
  { name: 'London',                 sector: 'fintech',     lat: 51.5074, lng: -0.1278,   intensity: 82, blurb: 'European fintech · Open Banking leader' },
  // Manufacturing reshoring
  { name: 'Mexico Bajío',           sector: 'manufacturing',lat: 21.1619, lng: -100.9333, intensity: 85, blurb: 'Nearshoring boom · auto + aerospace' },
  { name: 'Vietnam Hanoi-Hai Phong',sector: 'manufacturing',lat: 21.0285, lng: 105.8542,  intensity: 80, blurb: 'China+1 strategy · electronics + textiles' },
  { name: 'Polish Industrial Belt', sector: 'manufacturing',lat: 50.0647, lng: 19.9450,   intensity: 72, blurb: 'EU manufacturing growth · auto supply chain' },
];

const FINANCIAL_REPORTS = {
  AAPL: {
    name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics',
    marketCap: '3.62T', employees: '161,000', founded: 1976,
    revenue: '391.0B', grossMargin: '46.2%', netIncome: '93.7B',
    eps: '6.13', pe: '32.4', dividend: '0.96', divYield: '0.41%',
    cashPosition: '65.0B', debt: '101.7B',
    summary: 'Apple Inc. designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories worldwide. The company operates through Americas, Europe, Greater China, Japan and Rest of Asia Pacific segments. Services revenue (App Store, iCloud, Apple Music) crossed $96B annually in FY24, becoming a strategic margin driver as iPhone unit growth plateaus.',
    risks: ['China manufacturing concentration', 'Regulatory pressure on App Store', 'iPhone replacement cycle lengthening'],
  },
  NVDA: {
    name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors',
    marketCap: '2.93T', employees: '29,600', founded: 1993,
    revenue: '60.9B', grossMargin: '72.7%', netIncome: '29.8B',
    eps: '11.93', pe: '78.2', dividend: '0.04', divYield: '0.02%',
    cashPosition: '26.0B', debt: '11.0B',
    summary: 'NVIDIA Corporation operates as a computing infrastructure company. Its Compute & Networking segment includes data center accelerated computing platforms which now contribute over 80% of revenue, driven by H100/H200 GPU demand from hyperscalers and AI labs. Gaming, Automotive and Professional Visualization segments are smaller but stable contributors.',
    risks: ['TSMC manufacturing concentration', 'US export controls on China', 'Hyperscaler capex normalization'],
  },
  TSLA: {
    name: 'Tesla, Inc.', sector: 'Consumer Cyclical', industry: 'Automobile Manufacturers',
    marketCap: '789.4B', employees: '140,473', founded: 2003,
    revenue: '96.8B', grossMargin: '17.9%', netIncome: '7.1B',
    eps: '2.04', pe: '122.0', dividend: '—', divYield: '—',
    cashPosition: '29.1B', debt: '7.4B',
    summary: 'Tesla designs, develops, manufactures and sells fully electric vehicles, energy storage systems and solar products. The company also offers vehicle service centers, supercharger networks and autonomous driving software (FSD). 2024 deliveries of ~1.79M units fell short of the 2M target as the Model Y aged into late lifecycle and Cybertruck ramp lagged.',
    risks: ['Slowing EV demand growth', 'China BYD competition', 'FSD regulatory approval timeline'],
  },
  MSFT: {
    name: 'Microsoft Corporation', sector: 'Technology', industry: 'Software',
    marketCap: '3.10T', employees: '228,000', founded: 1975,
    revenue: '245.1B', grossMargin: '69.8%', netIncome: '88.1B',
    eps: '11.80', pe: '35.4', dividend: '3.32', divYield: '0.79%',
    cashPosition: '78.4B', debt: '52.4B',
    summary: 'Microsoft operates through Productivity & Business Processes, Intelligent Cloud, and More Personal Computing segments. Azure has become the second-largest public cloud globally; OpenAI partnership (49% economic interest) drives Copilot integration across Office, GitHub, and Windows. AI capex announced at $80B for FY25.',
    risks: ['AI infrastructure capex magnitude', 'Activision integration execution', 'OpenAI relationship complexity'],
  },
  AMZN: {
    name: 'Amazon.com, Inc.', sector: 'Consumer Cyclical', industry: 'Internet Retail',
    marketCap: '2.04T', employees: '1.55M', founded: 1994,
    revenue: '637.9B', grossMargin: '48.9%', netIncome: '49.9B',
    eps: '4.68', pe: '41.6', dividend: '—', divYield: '—',
    cashPosition: '78.8B', debt: '54.9B',
    summary: 'Amazon operates retail (online stores, physical stores, third-party seller services) plus AWS cloud. AWS generated ~$108B revenue in 2024 with operating margin of 36-39%. Advertising revenue crossed $50B run-rate. Project Kuiper (low-earth-orbit satellite broadband) is in early deployment.',
    risks: ['Retail margin pressure from logistics', 'AWS growth re-acceleration vs Azure/GCP', 'Antitrust scrutiny in US/EU'],
  },
  GOOG: {
    name: 'Alphabet Inc.', sector: 'Communication Services', industry: 'Internet Content',
    marketCap: '2.10T', employees: '180,895', founded: 1998,
    revenue: '350.0B', grossMargin: '57.6%', netIncome: '100.1B',
    eps: '8.04', pe: '21.2', dividend: '0.80', divYield: '0.47%',
    cashPosition: '110.9B', debt: '13.2B',
    summary: 'Alphabet operates Google Services (Search, YouTube, Android, Chrome), Google Cloud (GCP, Workspace), and Other Bets (Waymo, Verily). Search remains 57% of revenue but Cloud is the fastest-growing segment at 35% YoY. Gemini AI integration into Search and Workspace launched in 2024.',
    risks: ['DOJ search antitrust ruling outcome', 'Generative AI cannibalizing search clicks', 'YouTube competitive pressure from TikTok'],
  },
  META: {
    name: 'Meta Platforms, Inc.', sector: 'Communication Services', industry: 'Internet Content',
    marketCap: '1.40T', employees: '74,067', founded: 2004,
    revenue: '164.5B', grossMargin: '81.6%', netIncome: '62.4B',
    eps: '23.86', pe: '23.4', dividend: '2.00', divYield: '0.36%',
    cashPosition: '70.9B', debt: '28.8B',
    summary: 'Meta operates Family of Apps (Facebook, Instagram, WhatsApp, Threads) and Reality Labs (Quest VR, Ray-Ban Meta). Family of Apps generates ~$165B at 50%+ operating margins; Reality Labs has lost ~$60B cumulatively building toward AR/VR. Llama 3/4 open-source LLM strategy drives developer ecosystem.',
    risks: ['Reality Labs sustained losses', 'Apple ATT impact on ad targeting', 'Younger demo retention vs TikTok'],
  },
  JPM: {
    name: 'JPMorgan Chase & Co.', sector: 'Financial Services', industry: 'Banks - Diversified',
    marketCap: '688.4B', employees: '316,043', founded: 1799,
    revenue: '177.4B', grossMargin: '—', netIncome: '58.5B',
    eps: '20.55', pe: '11.8', dividend: '5.00', divYield: '2.09%',
    cashPosition: '29.5B', debt: '758.0B',
    summary: 'JPMorgan Chase operates Consumer & Community Banking, Corporate & Investment Banking, Commercial Banking, and Asset & Wealth Management. Largest US bank by assets ($4.0T) and deposits. Onyx digital assets unit launched JPM Coin (2019) for institutional payment settlement.',
    risks: ['Net interest margin sensitivity to Fed cuts', 'Investment banking deal flow cyclical', 'Credit normalization in cards/auto'],
  },
};

// Marker style per facility type
const FACILITY_STYLES = {
  hq:          { color: '#3D7BFF', icon: '◆', label: 'HQ' },
  factory:     { color: '#FF7AB6', icon: '⚙', label: 'Factory' },
  warehouse:   { color: '#FFB84D', icon: '▢', label: 'Warehouse' },
  datacenter:  { color: '#7AC8FF', icon: '◫', label: 'Datacenter' },
  mine:        { color: '#E07AFC', icon: '⛏', label: 'Mine' },
  distributor: { color: '#A0C476', icon: '⊟', label: 'Distributor' },
};

// ──────────── Geospatial data hooks (open data) ────────────
// USGS earthquakes (last 24h, M2.5+) — public GeoJSON, no key required
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson
const useUsgsEarthquakes = (enabled) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let aborted = false;
    setLoading(true);
    fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson')
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => {
        if (aborted) return;
        const features = (j?.features ?? []).map(f => ({
          id: `eq-${f.id}`,
          type: 'earthquake',
          name: f.properties?.place ?? 'Earthquake',
          subtitle: `M${(f.properties?.mag ?? 0).toFixed(1)} · ${new Date(f.properties?.time ?? 0).toLocaleString()}`,
          lat: f.geometry?.coordinates?.[1],
          lng: f.geometry?.coordinates?.[0],
          mag: f.properties?.mag ?? 0,
          color: '#FF8855',
          size: 16 + Math.min(28, (f.properties?.mag ?? 0) * 3),
          source: 'USGS',
          url: f.properties?.url,
        })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        setData(features);
        setLoading(false);
      })
      .catch(() => {
        if (aborted) return;
        // Static fallback so the layer still has visible points if CORS or network fails
        setData([
          { id: 'eq-fallback-1', type: 'earthquake', name: 'Demo · Pacific Ring of Fire', subtitle: 'M5.2 · USGS feed unavailable', lat: 34.0, lng: -118.25, mag: 5.2, color: '#FF8855', size: 22, source: 'USGS (offline)' },
          { id: 'eq-fallback-2', type: 'earthquake', name: 'Demo · Northern Japan',         subtitle: 'M4.8 · USGS feed unavailable', lat: 38.5, lng: 141.5, mag: 4.8, color: '#FF8855', size: 20, source: 'USGS (offline)' },
          { id: 'eq-fallback-3', type: 'earthquake', name: 'Demo · Chile',                   subtitle: 'M5.5 · USGS feed unavailable', lat: -33.5, lng: -70.7, mag: 5.5, color: '#FF8855', size: 24, source: 'USGS (offline)' },
        ]);
        setLoading(false);
      });
    return () => { aborted = true; };
  }, [enabled]);
  return { data, loading };
};

// NOAA active weather alerts — public, no key
// https://api.weather.gov/alerts/active
const useNoaaAlerts = (enabled) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let aborted = false;
    setLoading(true);
    fetch('https://api.weather.gov/alerts/active?status=actual&severity=Severe,Extreme', {
      headers: { 'Accept': 'application/geo+json' }
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => {
        if (aborted) return;
        const features = (j?.features ?? []).slice(0, 80).map(f => {
          // Best-effort centroid extraction
          const geom = f.geometry;
          let lat, lng;
          if (geom?.type === 'Point') { [lng, lat] = geom.coordinates; }
          else if (geom?.type === 'Polygon' && geom.coordinates?.[0]?.length) {
            const ring = geom.coordinates[0];
            const sum = ring.reduce((s, [x, y]) => [s[0] + x, s[1] + y], [0, 0]);
            lng = sum[0] / ring.length; lat = sum[1] / ring.length;
          }
          return {
            id: `noaa-${f.id ?? Math.random()}`,
            type: 'storm',
            name: f.properties?.event ?? 'Weather alert',
            subtitle: f.properties?.headline ?? '',
            severity: f.properties?.severity,
            lat, lng,
            color: '#5599FF',
            size: 14,
            source: 'NOAA',
          };
        }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        setData(features);
        setLoading(false);
      })
      .catch(() => {
        if (aborted) return;
        setData([
          { id: 'noaa-fallback-1', type: 'storm', name: 'Demo · Severe Thunderstorm', subtitle: 'TX panhandle · NOAA feed unavailable', lat: 35.2, lng: -101.9, color: '#5599FF', size: 16, source: 'NOAA (offline)' },
          { id: 'noaa-fallback-2', type: 'storm', name: 'Demo · Tropical Storm Watch', subtitle: 'Gulf coast', lat: 29.7, lng: -90.0, color: '#5599FF', size: 18, source: 'NOAA (offline)' },
          { id: 'noaa-fallback-3', type: 'storm', name: 'Demo · Winter Storm Warning', subtitle: 'Upper Midwest', lat: 44.9, lng: -93.3, color: '#5599FF', size: 16, source: 'NOAA (offline)' },
        ]);
        setLoading(false);
      });
    return () => { aborted = true; };
  }, [enabled]);
  return { data, loading };
};

// NASA FIRMS active fires — full feed requires a MAP_KEY; we use a curated
// static snapshot of the past month's notable wildfire clusters that traders
// would care about (insurance exposure, agricultural impact, supply chains).
const NASA_FIRES_SNAPSHOT = [
  { id: 'fire-ca-1', type: 'fire', name: 'California wildfire cluster', subtitle: 'Northern CA · 12 active fires', lat: 39.5, lng: -121.6, color: '#FF6633', size: 22, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-ca-2', type: 'fire', name: 'Southern CA wildfire',          subtitle: 'San Bernardino county',         lat: 34.1, lng: -116.9, color: '#FF6633', size: 18, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-or-1', type: 'fire', name: 'Oregon wildfire complex',       subtitle: 'Cascade range',                  lat: 44.0, lng: -121.5, color: '#FF6633', size: 20, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-au-1', type: 'fire', name: 'NSW bushfire',                  subtitle: 'New South Wales, Australia',     lat: -33.5, lng: 150.0, color: '#FF6633', size: 22, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-au-2', type: 'fire', name: 'Victoria bushfire',             subtitle: 'East Gippsland',                 lat: -37.5, lng: 148.0, color: '#FF6633', size: 16, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-br-1', type: 'fire', name: 'Amazon rainforest hotspots',    subtitle: 'Mato Grosso · 30+ fires',        lat: -12.5, lng: -55.0, color: '#FF6633', size: 26, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-br-2', type: 'fire', name: 'Pantanal wetland fires',        subtitle: 'Mato Grosso do Sul',             lat: -19.0, lng: -57.0, color: '#FF6633', size: 18, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-ru-1', type: 'fire', name: 'Siberian taiga fires',          subtitle: 'Sakha Republic',                 lat: 62.0, lng: 130.0, color: '#FF6633', size: 24, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-id-1', type: 'fire', name: 'Sumatra peat fires',            subtitle: 'Riau province · haze risk',      lat: 0.5, lng: 102.0, color: '#FF6633', size: 22, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-id-2', type: 'fire', name: 'Borneo / Kalimantan fires',     subtitle: 'Central Kalimantan',             lat: -2.5, lng: 113.5, color: '#FF6633', size: 20, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-cd-1', type: 'fire', name: 'British Columbia wildfires',    subtitle: 'Lytton region',                  lat: 50.2, lng: -121.6, color: '#FF6633', size: 18, source: 'NASA FIRMS (snapshot)' },
  { id: 'fire-cd-2', type: 'fire', name: 'Alberta tar sands fires',       subtitle: 'Fort McMurray',                  lat: 56.7, lng: -111.4, color: '#FF6633', size: 20, source: 'NASA FIRMS (snapshot)' },
];

// USDA-style crop coverage snapshot — major commodity crop regions a trader
// would watch for weather, drought, and yield signals (corn, wheat, soy).
const CROP_REGIONS = [
  { id: 'crop-iowa',     type: 'crop', name: 'Iowa corn belt',         subtitle: 'Corn · 13M acres',          lat: 42.0, lng: -93.5,  color: '#A0D67D', size: 24, source: 'USDA NASS' },
  { id: 'crop-illinois', type: 'crop', name: 'Illinois soybean / corn',subtitle: 'Mixed grain · 22M acres',  lat: 40.0, lng: -89.0,  color: '#A0D67D', size: 22, source: 'USDA NASS' },
  { id: 'crop-kansas',   type: 'crop', name: 'Kansas wheat',           subtitle: 'Hard red winter wheat',     lat: 38.5, lng: -98.5,  color: '#A0D67D', size: 20, source: 'USDA NASS' },
  { id: 'crop-nebraska', type: 'crop', name: 'Nebraska corn',          subtitle: 'Irrigated corn · 9M acres', lat: 41.5, lng: -99.5,  color: '#A0D67D', size: 20, source: 'USDA NASS' },
  { id: 'crop-ndakota',  type: 'crop', name: 'N. Dakota spring wheat', subtitle: 'Spring wheat',              lat: 47.5, lng: -100.5, color: '#A0D67D', size: 18, source: 'USDA NASS' },
  { id: 'crop-tx-cotton',type: 'crop', name: 'Texas cotton belt',      subtitle: 'High plains cotton',         lat: 33.5, lng: -101.8, color: '#A0D67D', size: 20, source: 'USDA NASS' },
  { id: 'crop-flo-orange',type: 'crop', name: 'Florida citrus',         subtitle: 'Orange production',         lat: 28.5, lng: -81.5,  color: '#A0D67D', size: 16, source: 'USDA NASS' },
  { id: 'crop-ca-almond',type: 'crop', name: 'California almonds',      subtitle: 'Central Valley',            lat: 36.8, lng: -120.0, color: '#A0D67D', size: 18, source: 'USDA NASS' },
  { id: 'crop-br-soy',   type: 'crop', name: 'Brazil soybean (Mato Grosso)', subtitle: 'World\'s top exporter', lat: -12.5, lng: -55.5, color: '#A0D67D', size: 24, source: 'CONAB' },
  { id: 'crop-ar-soy',   type: 'crop', name: 'Argentina soy / corn',   subtitle: 'Pampas region',             lat: -34.0, lng: -62.0, color: '#A0D67D', size: 22, source: 'INTA' },
  { id: 'crop-ua-wheat', type: 'crop', name: 'Ukraine grain belt',     subtitle: 'Wheat / sunflower',         lat: 49.0, lng: 32.0,   color: '#A0D67D', size: 20, source: 'FAO' },
  { id: 'crop-ru-wheat', type: 'crop', name: 'Russia wheat',           subtitle: 'Krasnodar / Stavropol',      lat: 45.0, lng: 41.0,   color: '#A0D67D', size: 20, source: 'FAO' },
  { id: 'crop-fr-wheat', type: 'crop', name: 'France wheat',           subtitle: 'EU top producer',           lat: 48.5, lng: 2.5,    color: '#A0D67D', size: 16, source: 'FAO' },
  { id: 'crop-au-wheat', type: 'crop', name: 'Australia wheat belt',   subtitle: 'WA wheat',                  lat: -31.5, lng: 117.0, color: '#A0D67D', size: 18, source: 'ABS' },
  { id: 'crop-in-rice',  type: 'crop', name: 'India rice (Punjab)',    subtitle: 'Punjab rice basin',          lat: 30.7, lng: 75.5,   color: '#A0D67D', size: 20, source: 'FAO' },
  { id: 'crop-th-rice',  type: 'crop', name: 'Thailand rice',          subtitle: 'Central plains',            lat: 15.0, lng: 100.5,  color: '#A0D67D', size: 18, source: 'FAO' },
  { id: 'crop-vn-rice',  type: 'crop', name: 'Vietnam Mekong delta',   subtitle: 'Rice export hub',           lat: 10.0, lng: 105.5,  color: '#A0D67D', size: 18, source: 'FAO' },
  { id: 'crop-id-palm',  type: 'crop', name: 'Indonesia palm oil',     subtitle: 'Sumatra plantations',        lat: 1.0, lng: 102.0,   color: '#A0D67D', size: 22, source: 'FAO' },
  { id: 'crop-co-coffee',type: 'crop', name: 'Colombia coffee',        subtitle: 'Coffee axis',               lat: 4.5, lng: -75.5,   color: '#A0D67D', size: 18, source: 'FAO' },
  { id: 'crop-ci-cocoa', type: 'crop', name: "Côte d'Ivoire cocoa",    subtitle: 'World\'s largest producer',  lat: 7.5, lng: -5.5,    color: '#A0D67D', size: 18, source: 'FAO' },
];

// NASA FIRMS live integration. Requires a free MAP_KEY from
// https://firms.modaps.eosdis.nasa.gov/api/area/. We expose this via
// VITE_NASA_FIRMS_KEY. Without a key, returns the curated snapshot above.
// FIRMS endpoint returns CSV — we parse it inline.
const useNasaFires = (enabled) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) { setData([]); return; }
    const key = (typeof import.meta !== 'undefined' && import.meta.env)
      ? import.meta.env.VITE_NASA_FIRMS_KEY : undefined;
    // No key — use the static snapshot, no network call needed
    if (!key) { setData(NASA_FIRES_SNAPSHOT); return; }
    let aborted = false;
    setLoading(true);
    // VIIRS_SNPP_NRT for past 1 day, world bounds. Limit results in the parser.
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/world/1`;
    fetch(url)
      .then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(csv => {
        if (aborted) return;
        const lines = csv.trim().split('\n');
        if (lines.length < 2) { setData(NASA_FIRES_SNAPSHOT); setLoading(false); return; }
        const header = lines[0].split(',');
        const latIdx  = header.indexOf('latitude');
        const lngIdx  = header.indexOf('longitude');
        const briIdx  = header.indexOf('bright_ti4');
        const confIdx = header.indexOf('confidence');
        const dateIdx = header.indexOf('acq_date');
        // Sample every Nth row to avoid drowning the map (FIRMS returns 100K+ pts)
        const stride = Math.max(1, Math.floor((lines.length - 1) / 200));
        const features = [];
        for (let i = 1; i < lines.length; i += stride) {
          const cols = lines[i].split(',');
          const lat = parseFloat(cols[latIdx]);
          const lng = parseFloat(cols[lngIdx]);
          const bri = parseFloat(cols[briIdx]) || 0;
          const conf = cols[confIdx] || '';
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          features.push({
            id: `firms-${i}`,
            type: 'fire',
            name: 'Active fire (VIIRS)',
            subtitle: `Brightness ${bri.toFixed(0)}K · ${cols[dateIdx] ?? ''} · conf ${conf}`,
            lat, lng,
            color: '#FF6633',
            size: 12 + Math.min(16, Math.max(0, (bri - 290) / 6)),
            source: 'NASA FIRMS (live)',
          });
        }
        setData(features.length ? features : NASA_FIRES_SNAPSHOT);
        setLoading(false);
      })
      .catch(() => {
        if (aborted) return;
        setData(NASA_FIRES_SNAPSHOT);
        setLoading(false);
      });
    return () => { aborted = true; };
  }, [enabled]);
  return { data, loading };
};

// USDA NASS Quick Stats — requires a free key from
// https://quickstats.nass.usda.gov/api. Pulls the latest county-level acreage
// for our top commodities. Without a key, we return the curated CROP_REGIONS
// snapshot. The NASS API serves JSON over HTTPS.
const useUsdaCrops = (enabled) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) { setData([]); return; }
    const key = (typeof import.meta !== 'undefined' && import.meta.env)
      ? import.meta.env.VITE_USDA_NASS_KEY : undefined;
    if (!key) { setData(CROP_REGIONS); return; }
    let aborted = false;
    setLoading(true);
    // Latest year, total planted acres for major crops at the state level.
    // NASS doesn't return lat/lng, so we map state abbreviations to centroids.
    const STATE_CENTROIDS = {
      IA:[42.07,-93.50], IL:[40.04,-89.20], KS:[38.48,-98.38], NE:[41.49,-99.90],
      ND:[47.55,-100.30], TX:[31.97,-99.90], FL:[28.63,-82.45], CA:[36.78,-119.42],
      MN:[46.73,-94.69], IN:[39.90,-86.28], OH:[40.42,-82.91], MO:[38.46,-92.29],
      WI:[44.27,-89.62], SD:[44.44,-100.30], OK:[35.59,-97.50], CO:[39.06,-105.31],
      WA:[47.40,-121.49], MT:[46.92,-110.45], MS:[32.74,-89.68], AR:[34.97,-92.37],
      LA:[31.17,-91.87], GA:[32.65,-83.43], AL:[32.81,-86.79], NC:[35.63,-79.81],
    };
    // Pull corn planted acres as the headline series (still useful even alone).
    const url = `https://quickstats.nass.usda.gov/api/api_GET/?key=${key}` +
      `&commodity_desc=CORN&statisticcat_desc=AREA%20PLANTED&agg_level_desc=STATE` +
      `&unit_desc=ACRES&year__GE=2023&format=JSON`;
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => {
        if (aborted) return;
        const rows = (j?.data ?? []);
        const byState = {};
        rows.forEach(r => {
          const st = r.state_alpha;
          const yr = parseInt(r.year, 10);
          if (!st || !STATE_CENTROIDS[st]) return;
          if (!byState[st] || yr > byState[st].year) {
            byState[st] = { year: yr, value: r.Value, state: r.state_name };
          }
        });
        const features = Object.entries(byState).map(([st, info]) => ({
          id: `nass-corn-${st}`,
          type: 'crop',
          name: `${info.state} corn (${info.year})`,
          subtitle: `Planted: ${info.value} acres · USDA NASS Quick Stats`,
          lat: STATE_CENTROIDS[st][0],
          lng: STATE_CENTROIDS[st][1],
          color: '#A0D67D',
          size: 18,
          source: 'USDA NASS (live)',
        }));
        // Combine live state corn data with the world-wide curated snapshot
        // for non-US commodities (Brazil soy, India rice, etc.)
        setData([
          ...features,
          ...CROP_REGIONS.filter(c => !c.id.startsWith('crop-iowa') && !c.id.startsWith('crop-illinois')
            && !c.id.startsWith('crop-kansas') && !c.id.startsWith('crop-nebraska')
            && !c.id.startsWith('crop-ndakota') && !c.id.startsWith('crop-tx-cotton')),
        ]);
        setLoading(false);
      })
      .catch(() => {
        if (aborted) return;
        setData(CROP_REGIONS);
        setLoading(false);
      });
    return () => { aborted = true; };
  }, [enabled]);
  return { data, loading };
};

export const MapPage = ({ initialCompanyFilter }) => {
  const [filters, setFilters] = useState({
    // Default to clean map showing only recent news points the user can click.
    flights: false, ships: false, markets: false, supplyChain: false,
    military: false, conflicts: false, growth: false, news: true,
    // Geopolitics overlay — chokepoints (Hormuz, Suez, Malacca,
    // etc.) as clickable point markers. Click a chokepoint to
    // see active sanctions affecting that route, country-level
    // geopolitical risk scores, and the financial instruments
    // most exposed to disruption.
    geopolitics: false,
    // Geospatial overlays from free open data sources — useful for traders
    earthquakes: false,  // USGS — affects mining, semi fabs, oil
    fires: false,        // NASA FIRMS — wildfires impact insurance, agriculture
    storms: false,       // NOAA — alerts impact energy, retail, supply chains
    crops: false,        // synthesized USDA — crop coverage signals for ags
    // Risk Assessment & Insurance (the "Protecting Capital" stack)
    gar15: false,        // GAR15 — capital invested at 5km resolution
    disasterHotspots: false,  // Natural Disaster Hotspots — economic loss risk
    bathymetry: false,   // ETOPO1 / GSHHS — for offshore investments
    // Supply Chain & Logistics (the "Connectivity" stack)
    underseaCables: false,    // Undersea telecom cables — financial backbone
    portIndex: false,         // World Port Index — 3,700 ports
    roads: false,             // gROADS — road networks for last-mile logistics
    // Natural Resources & Commodities (the "Value Extraction" stack)
    minerals: false,          // Mineral Resources Data System — gold/lithium/copper
    cropGrids: false,         // CROPGRIDS — 173 crops, agricultural intensity
    oilOffshore: false,       // North Sea Oil — government licensing boundaries
    // Market Intelligence (the "Growth & Labor" stack)
    gEcon: false,             // G-Econ — sub-national GDP grid
    population: false,        // GPW / WorldPop — high-res population
    socialConn: false,        // Facebook Social Connectedness Index
  });
  // Searchable dataset list — users type to filter the catalog instead of
  // navigating dozens of toggles. Each entry has id, label, group, desc.
  const [datasetSearch, setDatasetSearch] = useState('');
  // Whether the dataset dropdown is open (chevron toggle).
  const [datasetSearchOpen, setDatasetSearchOpen] = useState(false);
  const [growthSector, setGrowthSector] = useState('all'); // 'all' or specific sector
  const [companyFilter, setCompanyFilter] = useState(initialCompanyFilter ?? null);
  const [companySearch, setCompanySearch] = useState('');
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false);
  const [selected, setSelected] = useState(null);
  const [showFinancialReport, setShowFinancialReport] = useState(null); // ticker
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  // AI Full Report — extended structured report for the selected facility.
  // Triggered by an explicit "Generate full report" button (the brief AI
  // summary above runs automatically on selection; the full report is
  // opt-in because it costs more tokens and takes ~10s to generate).
  // Schema: { thesis, segments[], catalysts[], risks[], revenue_trend[],
  //           sentiment, peer_comparison, dataset[] } — all visualized via
  //           Recharts components below.
  const [fullReport, setFullReport] = useState(null);
  const [fullReportLoading, setFullReportLoading] = useState(false);
  const [fullReportError, setFullReportError] = useState(null);
  const fullReportCache = useRef({});

  // Generate (or fetch from cache) a full company AI report. Uses the same
  // callAI helper as everything else; falls back gracefully if no key.
  const generateFullReport = async (ticker) => {
    if (!ticker) return;
    if (fullReportCache.current[ticker]) {
      setFullReport(fullReportCache.current[ticker]);
      return;
    }
    setFullReportLoading(true);
    setFullReportError(null);
    setFullReport(null);
    try {
      const inst = INSTRUMENTS.find(i => i.id === ticker);
      const sector = TICKER_SECTORS?.[ticker] ?? 'Other';
      const peers = (SECTOR_CONSTITUENTS?.[sector] ?? []).filter(p => p.ticker !== ticker).slice(0, 5);
      const system = 'You are a senior equity analyst. Generate a structured company report. Return ONLY JSON (no fences, no prose) with this exact shape: {"thesis":"2-3 sentence investment thesis","segments":[{"name":"Segment name","share":35,"trend":"growing|stable|declining"}],"catalysts":["catalyst 1","catalyst 2"],"risks":["risk 1","risk 2"],"revenue_trend":[{"year":"FY22","value":100},{"year":"FY23","value":120},{"year":"FY24","value":135},{"year":"FY25E","value":150}],"sentiment":{"bull":60,"bear":25,"neutral":15},"peer_comparison":[{"ticker":"AAPL","value":3850,"metric":"mkt_cap_b"}],"summary":"one paragraph"}. Numbers should be realistic. Segments should sum to ~100. Sentiment must sum to 100. If RECENT NEWS is provided, factor it into thesis/catalysts/risks.';
      // Exa-grounded: pull recent news on the ticker for current context.
      let newsCtx = '';
      if (EXA_API_KEY) {
        const news = await exaSearch(`${ticker} earnings outlook recent news`, {
          numResults: 5, type: 'fast', maxAgeHours: 168, highlights: true,
        });
        if (news?.results?.length) {
          newsCtx = '\n\nRECENT NEWS:\n' + news.results
            .map((n, i) => `[${i + 1}] ${n.title}\n${n.text || ''}`)
            .join('\n\n');
        }
      }
      const prompt = `COMPANY: ${ticker}${inst ? ' (' + inst.name + ')' : ''}\nSECTOR: ${sector}\nPEERS: ${peers.map(p => p.ticker).join(', ')}${newsCtx}\n\nGenerate the structured report.`;
      const response = await callAI(prompt, { maxTokens: 2000 });
      if (!response) {
        setFullReportError('AI service unavailable. Set VITE_ANTHROPIC_API_KEY in your environment.');
        setFullReportLoading(false);
        return;
      }
      let parsed = null;
      try {
        const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        const m = response.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
      }
      if (!parsed) {
        setFullReportError('Could not parse AI response.');
        setFullReportLoading(false);
        return;
      }
      fullReportCache.current[ticker] = parsed;
      setFullReport(parsed);
      setFullReportLoading(false);
    } catch (e) {
      setFullReportError(`Report failed: ${e.message}`);
      setFullReportLoading(false);
    }
  };
  // Reset full report when selection changes
  useEffect(() => {
    setFullReport(null);
    setFullReportError(null);
  }, [selected?.ticker, selected?.type]);

  // Map style toggle: dark / streets / satellite
  const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/satellite-streets-v12');
  // Optional 3D pitch
  const [pitch3D, setPitch3D] = useState(false);
  const cpu = useCpuUsage();

  // Live geospatial feeds — fired only when their respective filters are on.
  // Each hook gracefully falls back to a curated snapshot if the upstream
  // feed is unreachable (CORS, network, or missing API key).
  const { data: usgsQuakes,  loading: quakesLoading } = useUsgsEarthquakes(filters.earthquakes);
  const { data: noaaAlerts,  loading: alertsLoading } = useNoaaAlerts(filters.storms);
  const { data: nasaFires,   loading: firesLoading  } = useNasaFires(filters.fires);
  const { data: usdaCrops,   loading: cropsLoading  } = useUsdaCrops(filters.crops);

  // Apply initialCompanyFilter when it changes
  useEffect(() => {
    if (initialCompanyFilter) setCompanyFilter(initialCompanyFilter);
  }, [initialCompanyFilter]);

  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

  // Build the visible point set based on active filters
  const points = useMemo(() => {
    const list = [];
    if (filters.flights) list.push(...MAP_FLIGHTS);
    if (filters.ships)   list.push(...MAP_SHIPS);
    if (filters.markets) list.push(...MAP_MARKETS);
    if (filters.supplyChain) {
      // Per UX feedback: don't auto-load all 200+ facility points the moment
      // the "Companies" filter is enabled — that floods the map and the user
      // has to scroll/search anyway. Instead require a specific company to
      // be selected before any points render. The search input is shown
      // unconditionally so the user can pick one.
      if (companyFilter) {
        const facilities = SUPPLY_CHAIN_FACILITIES
          .filter(f => f.ticker === companyFilter)
          .map(f => ({
            ...f,
            id: `${f.ticker}-${f.name}`,
            type: 'facility',
            facilityType: f.type,
          }));
        list.push(...facilities);
      }
    }
    if (filters.military) {
      list.push(...MILITARY_FACILITIES.map(f => ({
        ...f,
        id: `mil-${f.name}`,
        type: 'military',
      })));
    }
    if (filters.growth) {
      const filtered = growthSector === 'all'
        ? GROWTH_REGIONS
        : GROWTH_REGIONS.filter(g => g.sector === growthSector);
      list.push(...filtered.map(g => ({
        ...g,
        id: `growth-${g.name}`,
        type: 'growth',
      })));
    }
    // Geospatial overlays — hook data falls back to snapshot if API unavailable
    if (filters.earthquakes) list.push(...usgsQuakes);
    if (filters.storms)      list.push(...noaaAlerts);
    if (filters.fires)       list.push(...nasaFires);
    if (filters.crops)       list.push(...usdaCrops);

    // ── Newly added datasets — curated snapshots covering each "stack" from
    //    the spec. Each pin includes a `category` so AI summaries can be
    //    tailored, and `desc` shows in the side-panel detail view. Coords
    //    are real-world reference locations (ports, mines, cable landings,
    //    etc.) so the map remains plausible. ──
    if (filters.gar15)            list.push(...GAR15_POINTS);
    if (filters.disasterHotspots) list.push(...DISASTER_HOTSPOTS);
    if (filters.bathymetry)       list.push(...BATHYMETRY_POINTS);
    if (filters.underseaCables)   list.push(...UNDERSEA_CABLE_POINTS);
    if (filters.portIndex)        list.push(...PORT_INDEX_POINTS);
    if (filters.roads)            list.push(...ROAD_HUB_POINTS);
    if (filters.minerals)         list.push(...MINERAL_POINTS);
    if (filters.cropGrids)        list.push(...CROPGRID_POINTS);
    if (filters.oilOffshore)      list.push(...OIL_OFFSHORE_POINTS);
    if (filters.gEcon)            list.push(...GECON_POINTS);
    if (filters.population)       list.push(...POPULATION_POINTS);
    if (filters.socialConn)       list.push(...SOCIAL_CONN_POINTS);
    if (filters.news)             list.push(...NEWS_PINS);
    // Geopolitics chokepoints — render as point markers with type
    // 'chokepoint' so the side panel can show the strategic
    // summary, exposed instruments, and active sanctions along
    // that route. Importance drives marker size in the renderer.
    if (filters.geopolitics) {
      list.push(...CHOKEPOINTS.map(c => ({
        type: 'chokepoint',
        id: c.id,
        name: c.name,
        lat: c.lat, lng: c.lng,
        importance: c.importance,
        traffic: c.traffic,
        summary: c.summary,
        risksTo: c.risksTo,
      })));
    }
    // LiveUAMaps-style: when conflicts overlay is on, also drop incident
    // markers along the front lines so the user sees real events rather
    // than just colored zones. Each event becomes a clickable point.
    if (filters.conflicts) {
      list.push(...FRONTLINE_EVENTS.map(e => ({ ...e, type: 'frontline' })));
    }
    return list;
  }, [filters, companyFilter, growthSector, usgsQuakes, noaaAlerts, nasaFires, usdaCrops]);

  const colorFor = (point) => {
    if (point.type === 'flight') return '#7AC8FF';
    if (point.type === 'ship')   return '#FFB84D';
    if (point.type === 'facility') {
      return FACILITY_STYLES[point.facilityType]?.color ?? COLORS.mint;
    }
    if (point.type === 'military') return '#FF7AB6';
    if (point.type === 'growth')   return '#7BFFB5';
    if (point.type === 'earthquake') return '#FF8855';
    if (point.type === 'fire')       return '#FF6633';
    if (point.type === 'storm')      return '#5599FF';
    if (point.type === 'crop')       return '#A0D67D';
    // New dataset categories
    if (point.type === 'news')       return '#7AC8FF';
    if (point.type === 'gar15')      return '#FF8855';
    if (point.type === 'disaster')   return '#FF5577';
    if (point.type === 'bathymetry') return '#5599FF';
    if (point.type === 'cable')      return '#7AC8FF';
    if (point.type === 'port')       return '#FFB84D';
    if (point.type === 'road')       return '#A2A2A2';
    if (point.type === 'mineral')    return '#FFD050';
    if (point.type === 'cropgrid')   return '#7BFFB5';
    if (point.type === 'oil')        return '#FF8855';
    if (point.type === 'gecon')      return '#9F88FF';
    if (point.type === 'pop')        return '#FF9CDB';
    if (point.type === 'social')     return '#FFC7A2';
    if (point.type === 'chokepoint') {
      // Critical chokepoints get a deeper amber-red; high get
      // amber; moderate get a softer yellow. Visually they should
      // read as "high attention" without screaming "emergency"
      // (that's reserved for the frontline category).
      return point.importance === 'critical' ? '#FF7A33' :
             point.importance === 'high'     ? '#FFB84D' :
                                               '#FFD050';
    }
    // LiveUAMaps-style frontline incident markers — color by category
    if (point.type === 'frontline') {
      return point.category === 'strike'    ? '#FF4444' :
             point.category === 'advance'   ? '#FF8855' :
             point.category === 'casualty'  ? '#CC0033' :
             point.category === 'statement' ? '#FFD050' :
                                              '#FF5577';
    }
    return COLORS.mint;
  };

  // Conflict zone overlays — managed as a separate mapbox GeoJSON source
  // since they're polygons (circles approximated to polygons), not markers.
  // Re-render whenever the conflicts filter toggles.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const sourceId = 'conflicts-source';
    const layerId  = 'conflicts-fill';
    const strokeId = 'conflicts-stroke';

    const cleanup = () => {
      try { if (map.getLayer(strokeId)) map.removeLayer(strokeId); } catch {}
      try { if (map.getLayer(layerId))  map.removeLayer(layerId); } catch {}
      try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch {}
    };

    if (!filters.conflicts) {
      cleanup();
      return;
    }

    // Build a circular polygon approximation for each conflict zone.
    const featuresPolys = CONFLICT_ZONES.map(z => {
      const points = 64;
      const earthR = 6371;       // km
      const ringRad = z.radiusKm / earthR;
      const lat = z.centerLat * Math.PI / 180;
      const lng = z.centerLng * Math.PI / 180;
      const coords = [];
      for (let i = 0; i <= points; i++) {
        const brng = (i / points) * 2 * Math.PI;
        const lat2 = Math.asin(Math.sin(lat) * Math.cos(ringRad) + Math.cos(lat) * Math.sin(ringRad) * Math.cos(brng));
        const lng2 = lng + Math.atan2(
          Math.sin(brng) * Math.sin(ringRad) * Math.cos(lat),
          Math.cos(ringRad) - Math.sin(lat) * Math.sin(lat2)
        );
        coords.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
      }
      return {
        type: 'Feature',
        properties: {
          id: z.id,
          name: z.name,
          summary: z.summary,
          severity: z.severity,
          color: z.severity === 'high' ? '#FF5577' : z.severity === 'medium' ? '#FFB84D' : '#FFD56B',
        },
        geometry: { type: 'Polygon', coordinates: [coords] },
      };
    });

    cleanup();

    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: featuresPolys },
    });
    map.addLayer({
      id: layerId,
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': 0.18,
      },
    });
    map.addLayer({
      id: strokeId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 2,
        'line-dasharray': [2, 2],
      },
    });

    // Click handler — show conflict info in side panel
    const handleClick = (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties;
      const zone = CONFLICT_ZONES.find(z => z.id === props.id);
      if (zone) setSelected({ ...zone, type: 'conflict' });
    };
    map.on('click', layerId, handleClick);
    map.getCanvas().style.cursor = '';

    return () => {
      try { map.off('click', layerId, handleClick); } catch {}
      cleanup();
    };
  }, [filters.conflicts, mapReady]);

  // ── Country risk heatmap layer ──
  // When the geopolitics overlay is on, fetch Natural Earth Admin 0
  // country polygons (free, public, ~1.2MB GeoJSON cached by the
  // browser between visits) and render them tinted by the country's
  // GEOPOLITICAL_RISK score. Layered below the regular point markers
  // (using `before` arg) so chokepoint pins stay clickable.
  //
  // The fetched GeoJSON is cached on window so revisiting the page
  // doesn't re-download. ISO_A3 codes drive the score lookup;
  // missing countries get a neutral very-low-opacity fill so the
  // user can still see the polygon outline without implying a
  // score. Click a country to see its risk pill in the side panel.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const sourceId = 'risk-countries-src';
    const fillId   = 'risk-countries-fill';
    const lineId   = 'risk-countries-line';
    const cleanup = () => {
      try { if (map.getLayer(lineId)) map.removeLayer(lineId); } catch {}
      try { if (map.getLayer(fillId)) map.removeLayer(fillId); } catch {}
      try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch {}
    };
    if (!filters.geopolitics) { cleanup(); return; }

    let cancelled = false;
    const ensurePolys = async () => {
      // window cache so we don't re-fetch on every toggle
      if (!window.__neCountryGeoJson) {
        // Primary: jsDelivr CDN — mirrors GitHub repos through a
        // globally distributed edge network with proper cache
        // headers (and unlike raw.githubusercontent.com, doesn't
        // ratelimit anonymous requests). Pinned to a tag rather
        // than @master so the data we render is reproducible
        // and a future repo rewrite can't break us silently.
        // Fallback: raw.githubusercontent.com if the CDN is
        // blocked by the user's network (rare but possible on
        // corporate networks that whitelist by domain).
        const PRIMARY = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson';
        const FALLBACK = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
        let lastErr = null;
        for (const url of [PRIMARY, FALLBACK]) {
          try {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            window.__neCountryGeoJson = await r.json();
            break;
          } catch (e) {
            lastErr = e;
            // Try the next URL
          }
        }
        if (!window.__neCountryGeoJson) {
          console.warn('[country-tint] all sources failed', lastErr?.message);
          return null;
        }
      }
      return window.__neCountryGeoJson;
    };

    (async () => {
      const geo = await ensurePolys();
      if (cancelled || !geo || !map.getStyle) return;
      // Map ISO_A3 → score for the tint match expression. Build a
      // mapbox `match` expression: ['match', ['get', 'ISO_A3_EH'],
      // 'USA', '#color', ..., '#fallback'].
      const sanctioned = new Set(SANCTIONS_PROGRAMS.flatMap(s => s.affectedCountries || []));
      const matchPairs = [];
      Object.entries(GEOPOLITICAL_RISK).forEach(([country, info]) => {
        const meta = COUNTRY_GEO[country];
        if (!meta) return;
        // Pick a tint color by score band. Sanctions get a slightly
        // deeper red blend on top of whatever the score band gave.
        const baseColor = info.score >= 80 ? '#FF5577'
                       : info.score >= 60 ? '#FF7A33'
                       : info.score >= 30 ? '#FFB84D'
                                          : '#4BB478';
        const c = sanctioned.has(meta.iso) ? '#D63347' : baseColor;
        matchPairs.push(meta.iso, c);
      });
      const fillColorExpr = ['match', ['get', 'ISO_A3_EH'], ...matchPairs, 'rgba(255,255,255,0.04)'];

      cleanup(); // remove any prior incarnation before adding fresh
      try {
        map.addSource(sourceId, { type: 'geojson', data: geo });
        // Try to position below the conflict polygons / point markers
        // by inserting before the first symbol layer if present.
        const layers = map.getStyle()?.layers ?? [];
        const beforeId = layers.find(l => l.type === 'symbol')?.id;
        map.addLayer({
          id: fillId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color':   fillColorExpr,
            'fill-opacity': 0.28,
          },
        }, beforeId);
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color':   'rgba(255,255,255,0.15)',
            'line-width':   0.5,
          },
        }, beforeId);
        // Click handler — surface the country into the side panel
        // by synthesizing a "country" pseudo-pin.
        const handleClick = (e) => {
          const feature = e.features?.[0];
          if (!feature) return;
          const iso = feature.properties?.ISO_A3_EH;
          const name = feature.properties?.ADMIN ?? feature.properties?.NAME;
          if (!iso || !name) return;
          // Resolve to our internal country name (some Natural Earth
          // ADMIN names differ slightly — "Czechia" vs "Czech Rep.")
          const ourName = Object.keys(GEOPOLITICAL_RISK).find(n =>
            COUNTRY_GEO[n]?.iso === iso || n === name);
          if (!ourName) return;
          const meta = COUNTRY_GEO[ourName];
          const risk = GEOPOLITICAL_RISK[ourName];
          setSelected({
            type: 'country-risk',
            id: `country-${iso}`,
            name: ourName,
            iso,
            lat: meta?.lat ?? e.lngLat.lat,
            lng: meta?.lng ?? e.lngLat.lng,
            risk,
          });
        };
        map.on('click', fillId, handleClick);
        // Track for cleanup
        if (!map.__countryClickHandlers) map.__countryClickHandlers = [];
        map.__countryClickHandlers.push({ fillId, handler: handleClick });
      } catch (e) {
        console.warn('[country-tint] addLayer failed', e.message);
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (map.__countryClickHandlers) {
          map.__countryClickHandlers.forEach(({ fillId: fid, handler }) => {
            try { map.off('click', fid, handler); } catch {}
          });
          map.__countryClickHandlers = [];
        }
      } catch {}
      cleanup();
    };
  }, [filters.geopolitics, mapReady]);

  // ── Bilateral relationship arcs ──
  // Great-circle line strings between capital coordinates. Renders
  // as a separate GeoJSON source above the country tint but below
  // point markers. Different `kind` values get different paint
  // properties — alliance solid green, rivalry red dashed, etc.
  // Computes great-circle interpolation in 32 segments for a
  // visually smooth arc rather than a straight rhumb line.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const sourceId = 'relationships-src';
    const lineAlliance  = 'relationships-alliance';
    const lineRivalry   = 'relationships-rivalry';
    const lineSanctions = 'relationships-sanctions';
    const lineTrade     = 'relationships-trade';
    const cleanup = () => {
      [lineAlliance, lineRivalry, lineSanctions, lineTrade].forEach(id => {
        try { if (map.getLayer(id)) map.removeLayer(id); } catch {}
      });
      try { if (map.getSource(sourceId)) map.removeSource(sourceId); } catch {}
    };
    if (!filters.geopolitics) { cleanup(); return; }
    cleanup();
    // Great-circle interpolation between two lat/lng points.
    // Returns N+1 points along the shortest-path arc on the sphere.
    const greatCircle = (a, b, n = 32) => {
      const toRad = (d) => d * Math.PI / 180;
      const toDeg = (r) => r * 180 / Math.PI;
      const φ1 = toRad(a.lat), λ1 = toRad(a.lng);
      const φ2 = toRad(b.lat), λ2 = toRad(b.lng);
      const dφ = φ2 - φ1, dλ = λ2 - λ1;
      const aHav = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
      const δ = 2 * Math.asin(Math.min(1, Math.sqrt(aHav)));
      if (δ === 0) return [[a.lng, a.lat]];
      const out = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const A = Math.sin((1 - f) * δ) / Math.sin(δ);
        const B = Math.sin(f * δ) / Math.sin(δ);
        const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
        const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
        const z = A * Math.sin(φ1) + B * Math.sin(φ2);
        const φ = Math.atan2(z, Math.sqrt(x * x + y * y));
        const λ = Math.atan2(y, x);
        out.push([toDeg(λ), toDeg(φ)]);
      }
      return out;
    };
    const features = [];
    COUNTRY_RELATIONSHIPS.forEach(rel => {
      const a = COUNTRY_GEO[rel.from];
      const b = COUNTRY_GEO[rel.to];
      if (!a || !b) return;
      features.push({
        type: 'Feature',
        properties: { kind: rel.kind, label: rel.label, from: rel.from, to: rel.to },
        geometry: { type: 'LineString', coordinates: greatCircle(a, b, 48) },
      });
    });
    try {
      map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features } });
      const addLine = (id, kind, paint) => {
        map.addLayer({
          id,
          type: 'line',
          source: sourceId,
          filter: ['==', ['get', 'kind'], kind],
          paint,
        });
      };
      addLine(lineAlliance,  'alliance',  { 'line-color': '#4BB478', 'line-width': 1.2, 'line-opacity': 0.6 });
      addLine(lineRivalry,   'rivalry',   { 'line-color': '#FF5577', 'line-width': 1.4, 'line-opacity': 0.7, 'line-dasharray': [2, 2] });
      addLine(lineSanctions, 'sanctions', { 'line-color': '#FF7A33', 'line-width': 1.2, 'line-opacity': 0.6, 'line-dasharray': [3, 2] });
      addLine(lineTrade,     'trade',     { 'line-color': '#7AC8FF', 'line-width': 1.0, 'line-opacity': 0.45, 'line-dasharray': [1, 2] });
    } catch (e) {
      console.warn('[relationship-arcs] addLayer failed', e.message);
    }
    return cleanup;
  }, [filters.geopolitics, mapReady]);

  // Fetch AI summary when ANY pin is selected — not just facilities.
  // Companies get a richer 200-word brief (business + news + risk).
  // All other types (port, mineral, cable, conflict, news pin, etc.) get
  // a 2-3 sentence brief explaining what the point is and why it matters
  // to traders. Cache by selection key so re-clicking is instant.
  const aiCache = useRef({});
  useEffect(() => {
    if (!selected) {
      setAiSummary(null);
      return;
    }
    const isCompany = selected.type === 'facility';
    const key = isCompany
      ? `co-${selected.ticker}`
      : `${selected.type}-${selected.id ?? selected.name}`;
    if (aiCache.current[key]) {
      setAiSummary(aiCache.current[key]);
      return;
    }
    // Build the brief for this category. Each type gets a tailored prompt
    // so the AI knows what to focus on.
    const buildPrompt = () => {
      if (isCompany) {
        return {
          system: 'You are Onyx Research, a factual market data summarizer. When asked about a company, give: (1) a 2-sentence business overview, (2) recent news or developments (last 30 days if you have web access), (3) one notable risk factor. Keep total under 200 words. NEVER recommend trading actions.',
          user: `Give me a brief factual summary of ${selected.ticker} (${selected.name ?? ''}). Focus on what they do, recent news, and one risk to watch.`,
          maxTokens: 600,
        };
      }
      const briefSystem = 'You are Onyx Research. Give a brief 2-3 sentence factual summary explaining what this geographic point is and why it matters to global traders/investors. Stay under 80 words. Plain prose, no bullets, no headers.';
      const map = {
        port:       `${selected.name} (port). TEU throughput: ${selected.teu ?? 'major'}. Why does this matter for global supply chains and trade flows?`,
        cable:      `${selected.name} (undersea cable landing station). ${selected.cables ? `${selected.cables} cables land here. ` : ''}Why is this strategic infrastructure for global finance and tech?`,
        mineral:    `${selected.name} (${selected.mineral} mining region). What does this region produce and what trading implications follow (commodities, EV/battery supply chain, etc.)?`,
        cropgrid:   `${selected.name} (${selected.crop} production region). What's grown here and how does it affect commodity prices?`,
        oil:        `${selected.name} (offshore oil field, ${selected.country ?? ''}). Production scale, operator if known, and supply implications.`,
        gar15:      `${selected.name} (GAR15 capital-at-risk cell, ${selected.capital ?? ''}). What capital is concentrated here and what natural hazard exposure exists?`,
        disaster:   `${selected.name} (natural disaster hotspot, risk: ${selected.risk}). Briefly: what disasters strike here and which industries get disrupted?`,
        bathymetry: `${selected.name} (offshore zone, depth ${selected.depth}). What offshore industries operate here?`,
        gecon:      `${selected.name} (G-Econ economic cluster, GCP ${selected.gcp ?? ''}). What makes this a high-productivity zone and which sectors dominate?`,
        pop:        `${selected.name} (population hub, ${selected.pop ?? ''} people). Brief on this metro's role as a labor market and consumer base.`,
        social:     `${selected.name} (Facebook Social Connectedness corridor, strength: ${selected.strength ?? ''}). What does this connection imply for trade, migration, or brand spread?`,
        road:       `${selected.name} (major regional road hub). Briefly explain the freight network significance.`,
        conflict:   `${selected.name} (active conflict zone, ${selected.severity} severity). Brief: what's happening and which markets/commodities are affected?`,
        news:       `News: ${selected.name}. ${selected.desc}. Briefly explain the market relevance — which sectors or assets are most affected?`,
        military:   `${selected.name} (military facility). Strategic significance for regional stability and defense industry suppliers.`,
        chokepoint: `${selected.name} — strategic geopolitical chokepoint. Traffic: ${selected.traffic}. Importance: ${selected.importance}. Brief: current state of disruption risk, what would happen to commodity prices and freight rates if this were closed for 30 days, and which financial instruments are most exposed.`,
        frontline:  `Conflict event: ${selected.text}. Category: ${selected.category}. Brief: market relevance — energy, defense, ag, or rates impact?`,
        growth:     `${selected.name} (${selected.sector ?? 'growth zone'}). Brief: why is capital flowing here and what investments cluster nearby?`,
        earthquake: `Earthquake at ${selected.name ?? 'this location'}. Magnitude ${selected.magnitude ?? '?'}. Brief: which industries (semis, mining, real estate) are exposed?`,
        fire:       `Wildfire near ${selected.name ?? 'this location'}. Brief: which crops/insurers/industries are exposed?`,
        storm:      `Weather alert: ${selected.name ?? selected.title ?? 'this region'}. Brief: which industries (energy, retail, ag) are exposed?`,
        crop:       `Crop coverage in ${selected.name ?? 'this region'}. Brief: what's grown here and the export importance.`,
        flight:     `Aircraft ${selected.name ?? selected.callsign ?? 'in transit'}. Brief: what trade route/cargo significance does this represent?`,
        ship:       `Ship ${selected.name ?? 'in transit'}. Brief: what trade route significance does this represent?`,
      };
      const prompt = map[selected.type] ?? `${selected.name ?? 'This point'}. Briefly explain what it is and why traders care.`;
      return { system: briefSystem, user: prompt, maxTokens: 250 };
    };

    if (!ANTHROPIC_API_KEY) {
      // Canned fallback per category — no AI key needed
      const fb = isCompany
        ? `${selected.ticker} is a publicly-traded company with global operations. The selected facility (${FACILITY_STYLES[selected.facilityType]?.label ?? selected.facilityType}) is part of their supply-chain network.\n\nFor real-time AI summaries with current news, configure VITE_ANTHROPIC_API_KEY.`
        : (selected.desc ?? `${selected.name ?? 'This location'} — open this point on the map for full context. Configure VITE_ANTHROPIC_API_KEY for AI-generated briefs on every map point.`);
      aiCache.current[key] = fb;
      setAiSummary(fb);
      return;
    }
    let cancelled = false;
    setAiLoading(true);
    setAiSummary(null);
    const { system, user, maxTokens } = buildPrompt();
    (async () => {
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens,
            system,
            // Only use web_search for company queries — for static datasets
            // (ports, minerals, etc.) the model already knows the facts.
            ...(isCompany ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] } : {}),
            messages: [{ role: 'user', content: user }],
          }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        const textBlocks = (body?.content ?? [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .filter(Boolean);
        const summary = textBlocks.length > 0 ? textBlocks.join('\n\n') : 'No summary available.';
        if (cancelled) return;
        aiCache.current[key] = summary;
        setAiSummary(summary);
      } catch (err) {
        if (cancelled) return;
        const fb = selected.desc ?? `Could not fetch AI summary: ${err.message}.`;
        aiCache.current[key] = fb;
        setAiSummary(fb);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.id, selected?.ticker, selected?.type]);

  // ─── Initialize Mapbox ───
  useEffect(() => {
    if (!MAPBOX_TOKEN) {
      setMapError('No Mapbox token configured. Add VITE_MAPBOX_TOKEN to your Vercel env vars (free at mapbox.com).');
      return;
    }
    let cancelled = false;
    let ro = null;   // ResizeObserver reference for cleanup
    loadMapboxGL().then(mapboxgl => {
      if (cancelled || !mapContainer.current) return;
      mapboxgl.accessToken = MAPBOX_TOKEN;
      try {
        const map = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/satellite-streets-v12',
          center: [0, 25],
          zoom: 1.5,
          attributionControl: false,
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          if (!cancelled) {
            mapRef.current = map;
            setMapReady(true);
            // Force a resize after the DOM settles. Critical for flex layouts
            // where Mapbox may have been initialized before the container had
            // final pixel dimensions. Without this, the canvas renders at the
            // wrong size (or 0×0) and appears blank.
            setTimeout(() => { try { map.resize(); } catch {} }, 80);
            setTimeout(() => { try { map.resize(); } catch {} }, 300);
          }
        });
        map.on('error', (e) => {
          console.warn('[mapbox]', e?.error?.message || e);
        });
        // ResizeObserver — redraws the map whenever the container's size
        // changes. Handles: window resize, nav sidebar collapsing, detail
        // panel opening/closing, responsive breakpoint changes.
        if (typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => {
            try { map.resize(); } catch {}
          });
          ro.observe(mapContainer.current);
        }
      } catch (err) {
        console.warn('[mapbox] init failed', err);
        setMapError(err.message || 'Failed to init map');
      }
    }).catch(err => {
      console.warn('[mapbox] load failed', err);
      setMapError(err.message || 'Failed to load map library');
    });
    return () => {
      cancelled = true;
      if (ro) { try { ro.disconnect(); } catch {} }
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
  }, []);

  // ─── Update markers when points change ───
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.mapboxgl) return;
    const mapboxgl = window.mapboxgl;
    const map = mapRef.current;

    // Remove old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Add fresh markers for the current filter. Facilities use a styled
    // square tile with the facility-type icon; flights/ships/markets keep
    // the original glowing-dot style.
    points.forEach(p => {
      const el = document.createElement('div');
      const c = colorFor(p);
      if (p.type === 'facility') {
        const style = FACILITY_STYLES[p.facilityType] ?? { icon: '●' };
        // Smaller markers when showing all 247 S&P 500 facilities — keeps the
        // map readable without clutter. Bigger when a single company is
        // filtered (so its sites stand out).
        const size = companyFilter ? 22 : 16;
        const fontSize = companyFilter ? 13 : 9;
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 4px;
          background: ${c};
          border: 1.5px solid rgba(0,0,0,0.45);
          color: #16191E;
          font-size: ${fontSize}px;
          font-weight: 600;
          line-height: ${size}px;
          text-align: center;
          box-shadow: 0 0 ${companyFilter ? 10 : 6}px ${c}60;
          cursor: pointer;
          opacity: ${companyFilter ? 1 : 0.85};
        `;
        el.textContent = style.icon;
      } else if (p.type === 'military') {
        // Diamond shape with military icon
        el.style.cssText = `
          width: 18px; height: 18px;
          background: ${c};
          border: 1.5px solid rgba(0,0,0,0.6);
          transform: rotate(45deg);
          box-shadow: 0 0 8px ${c}80;
          cursor: pointer;
        `;
      } else if (p.type === 'growth') {
        // Pulsing bubble — size scales with intensity
        const size = 14 + (p.intensity ?? 50) / 5;
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 50%;
          background: ${c}66;
          border: 2px solid ${c};
          box-shadow: 0 0 ${size}px ${c}40;
          cursor: pointer;
        `;
      } else if (p.type === 'earthquake') {
        // Pulsing ring — radius scales with magnitude
        const size = p.size ?? 18;
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 50%;
          background: ${c}33;
          border: 2px solid ${c};
          box-shadow: 0 0 ${size}px ${c}80, inset 0 0 6px ${c}99;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: ${c}; font-size: 10px; font-weight: 700;
        `;
        el.textContent = '⊕';
      } else if (p.type === 'fire') {
        // Flame-style marker
        const size = p.size ?? 18;
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 50%;
          background: radial-gradient(circle, ${c} 30%, ${c}66 70%, transparent 100%);
          border: 1.5px solid ${c};
          box-shadow: 0 0 ${size + 4}px ${c}AA;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: ${size * 0.55}px;
        `;
        el.textContent = '🔥';
      } else if (p.type === 'storm') {
        // Storm marker — diamond with arrow
        const size = p.size ?? 16;
        el.style.cssText = `
          width: ${size}px; height: ${size}px;
          background: ${c}66;
          border: 2px solid ${c};
          transform: rotate(45deg);
          box-shadow: 0 0 ${size}px ${c}80;
          cursor: pointer;
        `;
      } else if (p.type === 'crop') {
        // Soft circle with leaf indicator
        const size = p.size ?? 18;
        el.style.cssText = `
          width: ${size}px; height: ${size}px; border-radius: 50%;
          background: ${c}55;
          border: 2px solid ${c};
          box-shadow: 0 0 ${size * 0.6}px ${c}55;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: ${size * 0.5}px;
        `;
        el.textContent = '🌾';
      } else {
        el.style.cssText = `
          width: 12px; height: 12px; border-radius: 50%;
          background: ${c};
          border: 2px solid rgba(0,0,0,0.4);
          box-shadow: 0 0 8px ${c}80;
          cursor: pointer;
        `;
      }
      el.onclick = (e) => {
        e.stopPropagation();
        setSelected(p);
      };
      const marker = new mapboxgl.Marker(el)
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });
  }, [points, mapReady, companyFilter]);

  return (
    <div className="flex-1 min-h-0 flex flex-col" style={{ background: COLORS.bg }}>
      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 py-3 border-b shrink-0 flex-wrap"
           style={{ borderColor: COLORS.border }}>
        <div>
          <h1 className="text-[18px] font-medium" style={{ color: COLORS.text }}>Global Terminal</h1>
          <div className="text-[11px]" style={{ color: COLORS.textMute }}>
            Trade flows · supply chain · {points.length} points shown
          </div>
        </div>

        {/* Searchable dataset list — replaces the long row of filter
            buttons. User types to filter the catalog of layers, then
            clicks a layer to toggle it. Each layer is grouped by its
            "stack" (Risk, Logistics, Resources, Market Intel, Live).
            Active layers show as small pills below the search box. */}
        <div className="ml-4 flex-1 min-w-[280px] relative">
          {(() => {
            const DATASETS = [
              // Live live ─────────────────────────
              { id: 'news',         label: 'News pins',        c: '#7AC8FF', group: 'Live',     desc: 'Recent news points the user can press on' },
              { id: 'flights',      label: 'Flights',          c: '#7AC8FF', group: 'Live',     desc: 'Live flight tracks (mock)' },
              { id: 'ships',        label: 'Ships',            c: '#FFB84D', group: 'Live',     desc: 'Maritime AIS positions (mock)' },
              { id: 'markets',      label: 'Markets',          c: '#E07AFC', group: 'Live',     desc: 'Open exchanges around the world' },
              { id: 'earthquakes',  label: 'Earthquakes',   c: '#FF8855', group: 'Live',     desc: 'USGS — affects mining, semi fabs, oil' },
              { id: 'fires',        label: 'Wildfires',     c: '#FF6633', group: 'Live',     desc: 'NASA FIRMS — wildfires impact insurance, agriculture' },
              { id: 'storms',       label: 'Storms',         c: '#5599FF', group: 'Live',     desc: 'NOAA — alerts impact energy, retail, supply chains' },
              { id: 'crops',        label: 'Crop coverage', c: '#A0D67D', group: 'Live',     desc: 'USDA NASS — crop coverage signals for ags' },
              // Risk Assessment & Insurance ─────────────
              { id: 'gar15',            label: 'GAR15 capital at risk',     c: '#FF8855', group: 'Risk',     desc: 'Capital invested in infrastructure at 5km res. Site-selection.' },
              { id: 'disasterHotspots', label: 'Disaster hotspots',         c: '#FF5577', group: 'Risk',     desc: 'Gridded economic loss risk along trade routes.' },
              { id: 'bathymetry',       label: 'ETOPO1 bathymetry',         c: '#5599FF', group: 'Risk',     desc: 'Underwater topography — offshore wind, oil rigs, coastal RE.' },
              // Supply Chain & Logistics ────────────────
              { id: 'underseaCables', label: 'Undersea telecom cables',     c: '#7AC8FF', group: 'Logistics', desc: 'The financial / tech digital backbone.' },
              { id: 'portIndex',      label: 'World Port Index',            c: '#FFB84D', group: 'Logistics', desc: '3,700 global ports — trade bottlenecks & throughput.' },
              { id: 'roads',          label: 'gROADS road network',         c: '#A2A2A2', group: 'Logistics', desc: 'Last-mile logistics in emerging markets.' },
              { id: 'supplyChain',    label: 'Companies',                   c: COLORS.mint, group: 'Logistics', desc: 'Search and explore companies — HQ, factories, suppliers, distributors. Click a company to load its footprint.' },
              // Natural Resources & Commodities ─────────
              { id: 'minerals',     label: 'Mineral resources',             c: '#FFD050', group: 'Resources', desc: 'Gold, lithium, copper — EV batteries, semis.' },
              { id: 'cropGrids',    label: 'CROPGRIDS (173 crops)',         c: '#7BFFB5', group: 'Resources', desc: 'Agricultural intensity by crop — for commodity traders.' },
              { id: 'oilOffshore',  label: 'North Sea Oil offshore',        c: '#FF8855', group: 'Resources', desc: 'Government licensing & ownership boundaries.' },
              // Market Intelligence ─────────────────────
              { id: 'gEcon',        label: 'G-Econ (Gross Cell Product)',   c: '#9F88FF', group: 'Market',    desc: 'Sub-national GDP grid — find economic islands.' },
              { id: 'population',   label: 'Population (GPW / WorldPop)',   c: '#FF9CDB', group: 'Market',    desc: 'High-res labor force concentration.' },
              { id: 'socialConn',   label: 'Social Connectedness Index',    c: '#FFC7A2', group: 'Market',    desc: 'FB Connectedness — migration, trade likelihood, brand spread.' },
              // Geopolitics ─────────────────────────────
              { id: 'geopolitics',  label: 'Geopolitical chokepoints', c: '#FF7A33', group: 'Geopolitics', desc: 'Strategic maritime/aerial passages — Hormuz, Suez, Malacca, Bosphorus, Taiwan Strait. Click for exposed instruments + active sanctions.' },
              { id: 'military',     label: 'Military bases',             c: '#FF7AB6', group: 'Geopolitics', desc: 'Strategic military installations.' },
              { id: 'conflicts',    label: '⚔ Active conflicts',            c: '#FF5577', group: 'Geopolitics', desc: 'Live front lines & combat (LiveUAMaps-style).' },
              { id: 'growth',       label: 'Growth zones',               c: '#7BFFB5', group: 'Geopolitics', desc: 'Sub-national growth corridors by sector.' },
            ];
            const q = datasetSearch.trim().toLowerCase();
            const matches = q
              ? DATASETS.filter(d =>
                  d.label.toLowerCase().includes(q) ||
                  d.group.toLowerCase().includes(q) ||
                  d.desc.toLowerCase().includes(q))
              : DATASETS;
            const activeIds = DATASETS.filter(d => filters[d.id]).map(d => d.id);
            const isOpen = datasetSearchOpen || q;
            return (
              <>
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] pointer-events-none" style={{ color: COLORS.textMute }} />
                  <input
                    value={datasetSearch}
                    onChange={e => { setDatasetSearch(e.target.value); setDatasetSearchOpen(true); }}
                    onFocus={() => setDatasetSearchOpen(true)}
                    placeholder="Search datasets — GAR15, ports, cables, minerals…"
                    className="w-full pl-8 pr-9 py-1.5 rounded-md text-[12px] outline-none"
                    style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${isOpen ? COLORS.mint : COLORS.border}` }}
                  />
                  {/* Chevron toggle — opens the full dataset list even
                      without typing. Click to expand/collapse. */}
                  <button
                    onClick={() => setDatasetSearchOpen(s => !s)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 rounded flex items-center justify-center hover:bg-white/[0.06] transition-colors"
                    style={{ color: COLORS.textDim }}
                    title={isOpen ? 'Collapse list' : 'Browse all datasets'}>
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                      <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                {/* Active layer pills */}
                {activeIds.length > 0 && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {activeIds.map(id => {
                      const d = DATASETS.find(x => x.id === id);
                      if (!d) return null;
                      return (
                        <button key={id}
                                onClick={() => setFilters(f => ({ ...f, [id]: false }))}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]"
                                style={{ background: `${d.c}22`, color: d.c, border: `1px solid ${d.c}55` }}
                                title="Click to disable">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: d.c }} />
                          {d.label}
                          <span style={{ opacity: 0.6 }}>×</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Dropdown — opens via chevron OR typing. Click outside closes. */}
                {isOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => { setDatasetSearchOpen(false); }} />
                    <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-[420px] overflow-y-auto rounded-md border"
                         style={{ background: COLORS.surface, borderColor: COLORS.borderHi, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
                    {matches.length === 0 ? (
                      <div className="px-3 py-3 text-[11px] text-center" style={{ color: COLORS.textMute }}>
                        No datasets match "{datasetSearch}"
                      </div>
                    ) : (
                      ['Live', 'Risk', 'Logistics', 'Resources', 'Market', 'Geopolitics']
                        .map(grp => {
                          const inGroup = matches.filter(d => d.group === grp);
                          if (inGroup.length === 0) return null;
                          return (
                            <div key={grp}>
                              <div className="px-3 py-1 text-[9px] uppercase tracking-wider sticky top-0"
                                   style={{ color: COLORS.textMute, background: COLORS.surface2 }}>
                                {grp === 'Live' ? 'Live data' :
                                 grp === 'Risk' ? 'Risk Assessment' :
                                 grp === 'Logistics' ? 'Supply Chain & Logistics' :
                                 grp === 'Resources' ? 'Natural Resources' :
                                 grp === 'Market' ? 'Market Intelligence' :
                                 'Geopolitics'}
                              </div>
                              {inGroup.map(d => (
                                <button key={d.id}
                                        onClick={() => {
                                          setFilters(f => ({ ...f, [d.id]: !f[d.id] }));
                                        }}
                                        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-white/[0.04]"
                                        style={{ borderTop: `1px solid ${COLORS.border}` }}>
                                  <span className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                                        style={{ background: filters[d.id] ? d.c : 'transparent', border: `1px solid ${d.c}` }} />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[12px]"
                                         style={{ color: filters[d.id] ? d.c : COLORS.text }}>
                                      {d.label}
                                    </div>
                                    <div className="text-[10px] truncate" style={{ color: COLORS.textMute }}>{d.desc}</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          );
                        })
                    )}
                  </div>
                  </>
                )}
              </>
            );
          })()}
          {/* Growth sector selector — only visible when growth filter is on */}
          {filters.growth && (
            <select value={growthSector} onChange={e => setGrowthSector(e.target.value)}
                    className="mt-1.5 px-2 py-1 rounded text-[11px] outline-none"
                    style={{ background: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`, colorScheme: 'dark' }}>
              <option value="all">All sectors</option>
              <option value="tech-ai">Tech / AI</option>
              <option value="semis">Semiconductors</option>
              <option value="energy">Energy</option>
              <option value="biotech">Biotech / Health</option>
              <option value="fintech">Fintech</option>
              <option value="manufacturing">Manufacturing</option>
            </select>
          )}
          {(quakesLoading || alertsLoading || firesLoading || cropsLoading) && (
            <span className="text-[10px] ml-1 px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(61,123,255,0.1)', color: COLORS.mint }}>
              ⟳ Loading geo data…
            </span>
          )}
        </div>

        {/* Map style + view tools */}
        <div className="flex items-center gap-1 ml-2 pl-2 border-l" style={{ borderColor: COLORS.border }}>
          {[
            { id: 'mapbox://styles/mapbox/dark-v11',      icon: '🌑', label: 'Dark' },
            { id: 'mapbox://styles/mapbox/streets-v12',   icon: '🗺',  label: 'Streets' },
            { id: 'mapbox://styles/mapbox/satellite-streets-v12', icon: '🛰', label: 'Satellite' },
            { id: 'mapbox://styles/mapbox/light-v11',     icon: '☀',  label: 'Light' },
          ].map(s => (
            <button key={s.id}
                    onClick={() => {
                      setMapStyle(s.id);
                      mapRef.current?.setStyle(s.id);
                    }}
                    title={`${s.label} basemap`}
                    className="px-2 py-1.5 rounded-md text-[12px] transition-colors"
                    style={{
                      color: mapStyle === s.id ? COLORS.mint : COLORS.textDim,
                      background: mapStyle === s.id ? 'rgba(61,123,255,0.08)' : 'transparent',
                      border: `1px solid ${mapStyle === s.id ? COLORS.mint : COLORS.border}`,
                    }}>
              {s.icon}
            </button>
          ))}
          <button onClick={() => {
                    const nextPitch = pitch3D ? 0 : 50;
                    setPitch3D(!pitch3D);
                    mapRef.current?.easeTo({ pitch: nextPitch, duration: 800 });
                  }}
                  title="Toggle 3D tilt"
                  className="px-2 py-1.5 rounded-md text-[11px] transition-colors"
                  style={{
                    color: pitch3D ? COLORS.mint : COLORS.textDim,
                    background: pitch3D ? 'rgba(61,123,255,0.08)' : 'transparent',
                    border: `1px solid ${pitch3D ? COLORS.mint : COLORS.border}`,
                  }}>
            3D
          </button>
          <button onClick={() => {
                    mapRef.current?.flyTo({
                      center: [0, 20], zoom: 1.5, pitch: 0, bearing: 0, speed: 1.4,
                    });
                    setPitch3D(false);
                  }}
                  title="Reset view to global"
                  className="px-2 py-1.5 rounded-md text-[11px] transition-colors hover:bg-white/[0.04]"
                  style={{ color: COLORS.textDim, border: `1px solid ${COLORS.border}` }}>
            ⌂
          </button>
        </div>

        {/* Company search — ALWAYS shown on the Terminal so users can find
            a company at any time, regardless of which layers are active.
            Selecting a company auto-enables the Companies layer so its
            facilities populate. */}
        {(
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: COLORS.textMute }} />
            <input
              value={companyFilter
                ? `${companyFilter} · ${FINANCIAL_REPORTS[companyFilter]?.name?.split(' ')[0] ?? ''}`
                : companySearch}
              onChange={e => {
                if (companyFilter) {
                  setCompanyFilter(null);
                  setCompanySearch('');
                } else {
                  setCompanySearch(e.target.value);
                }
                setShowCompanyDropdown(true);
              }}
              onFocus={() => setShowCompanyDropdown(true)}
              placeholder="Search company…"
              className="pl-7 pr-7 py-1.5 rounded-md text-[12px] outline-none w-52"
              style={{
                background: COLORS.surface,
                color: companyFilter ? COLORS.mint : COLORS.text,
                border: `1px solid ${companyFilter ? COLORS.mint : COLORS.border}`,
              }}
            />
            {(companyFilter || companySearch) && (
              <button
                onClick={() => { setCompanyFilter(null); setCompanySearch(''); setShowCompanyDropdown(false); }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/[0.06]"
              >
                <X size={11} style={{ color: COLORS.textDim }} />
              </button>
            )}
            {showCompanyDropdown && !companyFilter && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowCompanyDropdown(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 rounded-md border z-40 overflow-hidden max-h-96 overflow-y-auto"
                     style={{ background: COLORS.surface, borderColor: COLORS.borderHi }}>
                  {(() => {
                    // Build a unified ticker dataset from BOTH FINANCIAL_REPORTS
                    // AND every company that has facilities. This way ALL S&P 500
                    // tickers seen on the map are also searchable here.
                    const all = new Map();
                    Object.entries(FINANCIAL_REPORTS).forEach(([t, r]) => {
                      all.set(t, { ticker: t, name: r.name, sector: r.sector });
                    });
                    SUPPLY_CHAIN_FACILITIES.forEach(f => {
                      if (!all.has(f.ticker)) {
                        all.set(f.ticker, { ticker: f.ticker, name: f.ticker, sector: '—' });
                      }
                    });
                    const items = Array.from(all.values())
                      .filter(it =>
                        !companySearch ||
                        it.ticker.toLowerCase().includes(companySearch.toLowerCase()) ||
                        it.name.toLowerCase().includes(companySearch.toLowerCase())
                      )
                      .sort((a, b) => a.ticker.localeCompare(b.ticker));

                    if (items.length === 0) {
                      return (
                        <div className="px-3 py-3 text-[11px] text-center" style={{ color: COLORS.textMute }}>
                          No matching companies
                        </div>
                      );
                    }
                    return items.map(it => {
                      const facCount = SUPPLY_CHAIN_FACILITIES.filter(f => f.ticker === it.ticker).length;
                      return (
                        <button key={it.ticker}
                          onClick={() => {
                            setCompanyFilter(it.ticker);
                            setCompanySearch('');
                            setShowCompanyDropdown(false);
                            // Auto-enable the Companies layer so the chosen
                            // company's facilities are visible on the map.
                            // (Layer is off by default per UX feedback —
                            // selecting a company is the trigger to load.)
                            setFilters(f => ({ ...f, supplyChain: true }));
                            const facs = SUPPLY_CHAIN_FACILITIES.filter(f => f.ticker === it.ticker);
                            if (mapRef.current && facs.length > 0 && window.mapboxgl) {
                              const lats = facs.map(f => f.lat);
                              const lngs = facs.map(f => f.lng);
                              const bounds = new window.mapboxgl.LngLatBounds(
                                [Math.min(...lngs), Math.min(...lats)],
                                [Math.max(...lngs), Math.max(...lats)]
                              );
                              try { mapRef.current.fitBounds(bounds, { padding: 80, maxZoom: 6, duration: 1500 }); } catch {}
                            }
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12px] hover:bg-white/[0.04]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate" style={{ color: COLORS.text }}>{it.name}</div>
                            <div className="text-[10px] truncate" style={{ color: COLORS.textMute }}>
                              {it.ticker} · {it.sector}
                            </div>
                          </div>
                          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                                style={{ background: COLORS.surface2, color: COLORS.textDim }}>
                            {facCount}
                          </span>
                        </button>
                      );
                    });
                  })()}
                </div>
              </>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3 text-[11px]" style={{ color: COLORS.textMute }}>
          <span>CPU</span>
          <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
            <div className="h-full transition-all"
                 style={{
                   width: `${cpu}%`,
                   background: cpu > 75 ? COLORS.red : cpu > 40 ? '#FFB84D' : COLORS.mint,
                 }} />
          </div>
          <span className="tabular-nums"
                style={{ color: cpu > 75 ? COLORS.red : COLORS.text }}>
            {cpu}%
          </span>
        </div>
      </div>

      {/* Map + detail panel */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 relative" style={{ background: '#0E1116', minHeight: 0 }}>
          <div
            ref={mapContainer}
            style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              width: '100%', height: '100%',
            }}
          />
          {!mapReady && !mapError && (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] pointer-events-none"
                 style={{ color: COLORS.textMute }}>
              Loading Mapbox GL…
            </div>
          )}
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="max-w-lg text-center rounded-md border p-8"
                   style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                     style={{ background: 'rgba(237,112,136,0.1)' }}>
                  <X size={22} style={{ color: COLORS.red }} />
                </div>
                <div className="text-[15px] mb-2" style={{ color: COLORS.text }}>Map not available</div>
                <div className="text-[12px] mb-5 leading-relaxed" style={{ color: COLORS.textMute }}>
                  {mapError}
                </div>
                <div className="rounded-md border p-3 text-left text-[11px] leading-relaxed"
                     style={{ background: COLORS.bg, borderColor: COLORS.border, color: COLORS.textDim }}>
                  <div className="mb-2" style={{ color: COLORS.text }}>Setup (2 minutes):</div>
                  1. Sign up free at <span style={{ color: COLORS.mint }}>mapbox.com/signup</span><br/>
                  2. Copy your "Default public token" (starts with <code>pk.</code>)<br/>
                  3. In Vercel → Settings → Environment Variables, add:<br/>
                  <code style={{ color: COLORS.mint }}>VITE_MAPBOX_TOKEN</code> = your token<br/>
                  4. Redeploy. 50,000 map loads/month free tier.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Side panel: details */}
        <div className="w-80 border-l shrink-0 overflow-y-auto"
             style={{ borderColor: COLORS.border, background: COLORS.surface }}>
          {selected ? (
            <div className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-[15px] font-medium" style={{ color: COLORS.text }}>
                    {selected.type === 'facility' ? selected.name : selected.id}
                  </div>
                  <div className="text-[11px] uppercase tracking-wider mt-0.5"
                       style={{ color: colorFor(selected) }}>
                    {selected.type === 'facility'
                      ? `${selected.ticker} · ${FACILITY_STYLES[selected.facilityType]?.label ?? selected.facilityType}`
                      : selected.type}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-white/[0.05]">
                  <X size={14} style={{ color: COLORS.textDim }} />
                </button>
              </div>

              {selected.type === 'facility' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Ticker" v={selected.ticker} />
                    <DetailRow k="Type"   v={FACILITY_STYLES[selected.facilityType]?.label ?? selected.facilityType} />
                    <DetailRow k="Role"   v={selected.role} />
                    <DetailRow k="Position" v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                  </div>
                  {FINANCIAL_REPORTS[selected.ticker] && (
                    <button
                      onClick={() => setShowFinancialReport(selected.ticker)}
                      className="w-full mt-4 py-2 rounded-md text-[12px] font-medium transition-colors"
                      style={{ background: COLORS.mint, color: COLORS.bg }}
                    >View financial report</button>
                  )}
                  <button
                    onClick={() => mapRef.current?.flyTo({
                      center: [selected.lng, selected.lat],
                      zoom: 7,
                      speed: 1.5,
                    })}
                    className="w-full mt-2 py-2 rounded-md text-[12px] transition-colors"
                    style={{ background: COLORS.surface2, color: COLORS.text }}
                  >Fly to location</button>

                  {/* AI summary — fetched on facility selection */}
                  <div className="mt-4 pt-4 border-t" style={{ borderColor: COLORS.border }}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles size={12} style={{ color: COLORS.mint }} />
                      <div className="text-[10px] uppercase tracking-wider" style={{ color: COLORS.mint }}>
                        AI Research
                      </div>
                    </div>
                    {aiLoading ? (
                      <div className="flex items-center gap-2 py-3">
                        <div className="w-3 h-3 rounded-full" style={{ background: COLORS.mint }} />
                        <span className="text-[11px]" style={{ color: COLORS.textMute }}>
                          Researching {selected.ticker}…
                        </span>
                      </div>
                    ) : aiSummary ? (
                      <div className="text-[11.5px] leading-relaxed whitespace-pre-wrap"
                           style={{ color: COLORS.textDim }}>
                        {aiSummary}
                      </div>
                    ) : null}
                  </div>
                  {/* Full Report — extended structured AI report with charts.
                      Opt-in: user clicks the button to spend the tokens. */}
                  <div className="mt-3 pt-3 border-t" style={{ borderColor: COLORS.border }}>
                    {!fullReport && !fullReportLoading && !fullReportError && (
                      <button onClick={() => generateFullReport(selected.ticker)}
                              className="w-full py-2 rounded-md text-[11.5px] font-medium transition-opacity hover:opacity-90 flex items-center justify-center gap-1.5"
                              style={{ background: COLORS.surface2, color: COLORS.text, border: `1px solid ${COLORS.mint}` }}>
                        <Sparkles size={11} style={{ color: COLORS.mint }} />
                        Generate full report
                      </button>
                    )}
                    {fullReportLoading && (
                      <div className="text-[11px] py-3 text-center" style={{ color: COLORS.textMute }}>
                        Generating full report for {selected.ticker}…
                      </div>
                    )}
                    {fullReportError && (
                      <div className="px-2 py-2 rounded text-[10.5px]"
                           style={{ background: 'rgba(237,112,136,0.08)', color: COLORS.red, border: `1px solid ${COLORS.red}55` }}>
                        {fullReportError}
                      </div>
                    )}
                    {fullReport && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider" style={{ color: COLORS.mint }}>
                          <Sparkles size={10} />
                          Full report · {selected.ticker}
                        </div>
                        {fullReport.thesis && (
                          <div className="p-2.5 rounded-md text-[11.5px] leading-relaxed"
                               style={{ background: 'rgba(61,123,255,0.06)', color: COLORS.text, border: `1px solid ${COLORS.mint}33` }}>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.mint }}>Investment thesis</div>
                            {fullReport.thesis}
                          </div>
                        )}
                        {/* Revenue trend chart */}
                        {Array.isArray(fullReport.revenue_trend) && fullReport.revenue_trend.length > 0 && (
                          <div>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Revenue trend</div>
                            <div style={{ width: '100%', height: 80 }}>
                              <ResponsiveContainer>
                                <LineChart data={fullReport.revenue_trend} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                                  <Line type="monotone" dataKey="value" stroke={COLORS.mint} strokeWidth={1.5} dot={{ fill: COLORS.mint, r: 2 }} isAnimationActive={false} />
                                  <XAxis dataKey="year" tick={{ fill: COLORS.textMute, fontSize: 9 }} axisLine={false} tickLine={false} />
                                  <YAxis hide />
                                  <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, fontSize: 10 }} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        )}
                        {/* Segment breakdown */}
                        {Array.isArray(fullReport.segments) && fullReport.segments.length > 0 && (
                          <div>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Segments</div>
                            <div className="space-y-1">
                              {fullReport.segments.map((seg, i) => (
                                <div key={i} className="flex items-center gap-2 text-[10.5px]">
                                  <div className="flex-1 truncate" style={{ color: COLORS.text }}>{seg.name}</div>
                                  <div className="tabular-nums w-10 text-right" style={{ color: COLORS.textDim }}>{seg.share}%</div>
                                  <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
                                    <div className="h-full" style={{
                                      width: `${seg.share}%`,
                                      background: seg.trend === 'growing' ? COLORS.green : seg.trend === 'declining' ? COLORS.red : COLORS.mint,
                                    }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Sentiment bar */}
                        {fullReport.sentiment && (
                          <div>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>Sentiment</div>
                            <div className="flex h-2 rounded-full overflow-hidden">
                              <div style={{ width: `${fullReport.sentiment.bull ?? 0}%`, background: COLORS.green }} />
                              <div style={{ width: `${fullReport.sentiment.neutral ?? 0}%`, background: COLORS.textMute }} />
                              <div style={{ width: `${fullReport.sentiment.bear ?? 0}%`, background: COLORS.red }} />
                            </div>
                            <div className="flex justify-between text-[9px] mt-0.5 tabular-nums">
                              <span style={{ color: COLORS.green }}>Bull {fullReport.sentiment.bull ?? 0}%</span>
                              <span style={{ color: COLORS.textMute }}>Neutral {fullReport.sentiment.neutral ?? 0}%</span>
                              <span style={{ color: COLORS.red }}>Bear {fullReport.sentiment.bear ?? 0}%</span>
                            </div>
                          </div>
                        )}
                        {/* Catalysts and Risks */}
                        {Array.isArray(fullReport.catalysts) && fullReport.catalysts.length > 0 && (
                          <div>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.green }}>Catalysts</div>
                            <ul className="space-y-1">
                              {fullReport.catalysts.map((c, i) => (
                                <li key={i} className="text-[10.5px] flex gap-1.5" style={{ color: COLORS.textDim }}>
                                  <span style={{ color: COLORS.green }}>+</span>
                                  <span>{c}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {Array.isArray(fullReport.risks) && fullReport.risks.length > 0 && (
                          <div>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.red }}>Risks</div>
                            <ul className="space-y-1">
                              {fullReport.risks.map((r, i) => (
                                <li key={i} className="text-[10.5px] flex gap-1.5" style={{ color: COLORS.textDim }}>
                                  <span style={{ color: COLORS.red }}>−</span>
                                  <span>{r}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* Peer comparison bars */}
                        {Array.isArray(fullReport.peer_comparison) && fullReport.peer_comparison.length > 0 && (
                          <div>
                            <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
                              Peer comparison · {fullReport.peer_comparison[0]?.metric ?? 'metric'}
                            </div>
                            <div className="space-y-0.5">
                              {fullReport.peer_comparison.map((p, i) => {
                                const max = Math.max(...fullReport.peer_comparison.map(x => x.value || 0));
                                const isMe = p.ticker === selected.ticker;
                                return (
                                  <div key={i} className="flex items-center gap-2 text-[10.5px]">
                                    <div className="w-10 tabular-nums" style={{ color: isMe ? COLORS.mint : COLORS.text, fontWeight: isMe ? 600 : 400 }}>{p.ticker}</div>
                                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: COLORS.surface2 }}>
                                      <div className="h-full" style={{ width: `${(p.value / max) * 100}%`, background: isMe ? COLORS.mint : COLORS.textDim }} />
                                    </div>
                                    <div className="tabular-nums w-12 text-right" style={{ color: COLORS.textDim }}>{p.value}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {fullReport.summary && (
                          <div className="text-[10.5px] leading-relaxed pt-2 border-t whitespace-pre-wrap"
                               style={{ borderColor: COLORS.border, color: COLORS.textDim }}>
                            {fullReport.summary}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : selected.type === 'military' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Country"  v={selected.country} />
                    <DetailRow k="Branch"   v={selected.branch} />
                    <DetailRow k="Role"     v={selected.role} />
                    <DetailRow k="Position" v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[10.5px]"
                       style={{ background: 'rgba(255,122,182,0.08)', color: '#FF7AB6', border: '1px solid rgba(255,122,182,0.2)' }}>
                    Public information only. Source: open-source intelligence.
                  </div>
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 8, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to location
                  </button>
                </>
              ) : selected.type === 'growth' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Region"   v={selected.name} />
                    <DetailRow k="Sector"   v={selected.sector} />
                    <DetailRow k="Intensity" v={`${selected.intensity}/100`} />
                    <DetailRow k="Position" v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(31,178,107,0.08)', color: '#7BFFB5', border: '1px solid rgba(31,178,107,0.2)' }}>
                    {selected.blurb}
                  </div>
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 7, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to region
                  </button>
                </>
              ) : selected.type === 'earthquake' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Magnitude" v={`M${(selected.mag ?? 0).toFixed(1)}`} />
                    <DetailRow k="Location"  v={selected.name} />
                    <DetailRow k="Time"      v={selected.subtitle?.split(' · ').slice(-1)[0]} />
                    <DetailRow k="Position"  v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(255,136,85,0.08)', color: '#FF8855', border: '1px solid rgba(255,136,85,0.2)' }}>
                    Live data from {selected.source}. Larger magnitudes can disrupt nearby semiconductor fabs (TW, JP, KR), oil refineries, and shipping lanes — relevant signals for SOX, energy, and shipping equities.
                  </div>
                  {selected.url && (
                    <a href={selected.url} target="_blank" rel="noreferrer"
                       className="block w-full mt-2 py-2 rounded-md text-[12px] text-center transition-colors"
                       style={{ background: COLORS.surface2, color: COLORS.mint }}>
                      View on USGS →
                    </a>
                  )}
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 6, speed: 1.5 })}
                          className="w-full mt-2 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to epicenter
                  </button>
                </>
              ) : selected.type === 'fire' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Fire cluster" v={selected.name} />
                    <DetailRow k="Region"       v={selected.subtitle} />
                    <DetailRow k="Position"     v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                    <DetailRow k="Source"       v={selected.source} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(255,102,51,0.08)', color: '#FF6633', border: '1px solid rgba(255,102,51,0.2)' }}>
                    Major wildfire activity. Trader signals: insurance underwriting losses (RE, ALL, TRV), agricultural impact (DBA, weat, corn), timber, and air-quality plays.
                  </div>
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 6, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to fire
                  </button>
                </>
              ) : selected.type === 'storm' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Alert"     v={selected.name} />
                    <DetailRow k="Headline"  v={selected.subtitle} />
                    {selected.severity && <DetailRow k="Severity" v={selected.severity} />}
                    <DetailRow k="Position"  v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                    <DetailRow k="Source"    v={selected.source} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(85,153,255,0.08)', color: '#5599FF', border: '1px solid rgba(85,153,255,0.2)' }}>
                    Active weather alert. Trader signals: nat-gas / heating-oil demand spikes, retail foot-traffic disruption, airline cancellations, and disaster-recovery names.
                  </div>
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 6, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to alert
                  </button>
                </>
              ) : selected.type === 'crop' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Region"   v={selected.name} />
                    <DetailRow k="Crop"     v={selected.subtitle} />
                    <DetailRow k="Position" v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                    <DetailRow k="Source"   v={selected.source} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(160,214,125,0.08)', color: '#A0D67D', border: '1px solid rgba(160,214,125,0.2)' }}>
                    Major crop region. Trader signals: weather/drought impacts on commodity futures (corn, wheat, soy, cotton), agricultural input names (FMC, MOS, NTR), and food-processor margins.
                  </div>
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 6, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to region
                  </button>
                </>
              ) : selected.type === 'conflict' ? (
                <>
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Conflict"  v={selected.name} />
                    <DetailRow k="Started"   v={selected.started} />
                    <DetailRow k="Severity"  v={selected.severity?.toUpperCase()} />
                    <DetailRow k="Radius"    v={`~${selected.radiusKm} km`} />
                  </div>
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(255,85,119,0.08)', color: '#FF5577', border: '1px solid rgba(255,85,119,0.2)' }}>
                    {selected.summary}
                  </div>
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.centerLng, selected.centerLat], zoom: 5, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to zone
                  </button>
                </>
              ) : selected.type === 'chokepoint' ? (
                <>
                  {/* Chokepoint detail card — strategic summary,
                      exposed instruments, active sanctions affecting
                      this trade route, and a fly-to button. */}
                  <div className="space-y-2 text-[12px]">
                    <DetailRow k="Chokepoint" v={selected.name} />
                    <DetailRow k="Traffic"    v={selected.traffic} />
                    <DetailRow k="Importance" v={
                      <span style={{
                        color: selected.importance === 'critical' ? '#FF7A33'
                             : selected.importance === 'high'     ? '#FFB84D'
                             : '#FFD050',
                        fontWeight: 600,
                      }}>
                        {selected.importance?.toUpperCase()}
                      </span>
                    } />
                    <DetailRow k="Position"   v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                  </div>
                  {/* Strategic summary box */}
                  <div className="mt-4 px-3 py-2 rounded text-[11.5px] leading-relaxed"
                       style={{ background: 'rgba(255,122,51,0.08)', color: '#FFB084', border: '1px solid rgba(255,122,51,0.25)' }}>
                    {selected.summary}
                  </div>
                  {/* Exposed instruments — what would move if this
                      chokepoint disrupted. Renders as a small list
                      below the strategic summary. */}
                  {Array.isArray(selected.risksTo) && selected.risksTo.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase tracking-wider mb-1.5"
                           style={{ color: COLORS.textMute }}>
                        Most exposed instruments
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {selected.risksTo.map((r, i) => (
                          <span key={i}
                                className="px-2 py-0.5 rounded text-[10.5px]"
                                style={{ background: 'rgba(255,122,51,0.10)', color: '#FFB084', border: '1px solid rgba(255,122,51,0.25)' }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Sanctions exposure — list active sanctions programs
                      affecting countries directly linked to this
                      chokepoint. Replaces the previous 25° centroid
                      heuristic (which misfired at edge cases) with
                      an explicit chokepoint → ISO-code mapping. */}
                  {(() => {
                    // Each chokepoint lists the ISO-A3 codes of countries
                    // whose sanctions exposure is most relevant to its
                    // operation. Empty list → no sanctions panel shown.
                    const CHOKEPOINT_SANCTIONS = {
                      'hormuz':            ['IRN'],          // Iran controls north shore
                      'suez':              [],               // Egypt isn't sanctioned
                      'bab-el-mandeb':     ['YEM', 'IRN'],   // Houthi attacks, Iran proxy
                      'malacca':           [],               // Tri-state (SG/MY/ID), no sanctions
                      'panama':            [],               // No regional sanctions
                      'bosphorus':         ['RUS'],          // Russian crude transits here
                      'taiwan-strait':     ['CHN'],          // China selective
                      'arctic-ne-passage': ['RUS'],          // Russia's Northern Sea Route
                      'cape-good-hope':    [],               // No regional sanctions
                    };
                    const relevantIsos = new Set(CHOKEPOINT_SANCTIONS[selected.id] || []);
                    if (relevantIsos.size === 0) return null;
                    const nearby = SANCTIONS_PROGRAMS.filter(s =>
                      (s.affectedCountries || []).some(iso => relevantIsos.has(iso))
                    );
                    if (nearby.length === 0) return null;
                    return (
                      <div className="mt-3">
                        <div className="text-[10px] uppercase tracking-wider mb-1.5"
                             style={{ color: COLORS.textMute }}>
                          Active sanctions affecting this route
                        </div>
                        <div className="space-y-1.5">
                          {nearby.map(s => (
                            <div key={s.id} className="px-2.5 py-1.5 rounded"
                                 style={{ background: 'rgba(255,85,119,0.06)', border: '1px solid rgba(255,85,119,0.2)' }}>
                              <div className="text-[11px] font-medium" style={{ color: '#FF8FA1' }}>
                                {s.country} <span className="font-normal" style={{ color: COLORS.textMute }}>· since {s.since}</span>
                              </div>
                              <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textDim }}>
                                {s.programs.slice(0, 2).join(' · ')}
                              </div>
                              <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>
                                Affects: {s.affects.slice(0, 3).join(', ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Country risk score for the closest country to
                      this chokepoint — surfaces the broader
                      geopolitical context. */}
                  {(() => {
                    // Coarse mapping from chokepoint to most-relevant
                    // country (the one whose decisions most influence
                    // disruption risk).
                    const CONTROLLER = {
                      'hormuz':         'Iran',
                      'suez':           'Egypt',
                      'bab-el-mandeb':  'Iran',  // Yemen via proxy
                      'malacca':        'Singapore',
                      'panama':         'United States',
                      'bosphorus':      'Türkiye',
                      'taiwan-strait':  'Taiwan',
                      'arctic-ne-passage': 'Russia',
                      'cape-good-hope': 'United States',
                    };
                    const country = CONTROLLER[selected.id];
                    const risk = country && GEOPOLITICAL_RISK[country];
                    if (!risk) return null;
                    const palette = risk.score >= 80 ? { bg: 'rgba(255,85,119,0.08)', border: 'rgba(255,85,119,0.3)', fg: '#FF6F8D' }
                                  : risk.score >= 60 ? { bg: 'rgba(255,122,51,0.08)', border: 'rgba(255,122,51,0.3)', fg: '#FFB084' }
                                  : risk.score >= 30 ? { bg: 'rgba(255,184,77,0.08)', border: 'rgba(255,184,77,0.3)', fg: '#FFD699' }
                                                     : { bg: 'rgba(75,180,120,0.08)', border: 'rgba(75,180,120,0.3)', fg: COLORS.green };
                    return (
                      <div className="mt-3 px-2.5 py-2 rounded"
                           style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10.5px] uppercase tracking-wider"
                                style={{ color: COLORS.textMute }}>Country risk · {country}</span>
                          <span className="text-[14px] font-semibold tabular-nums"
                                style={{ color: palette.fg }}>{risk.score}/100</span>
                        </div>
                        <div className="text-[10.5px]" style={{ color: COLORS.textDim }}>
                          {risk.drivers.slice(0, 2).join(' · ')}
                        </div>
                        <div className="text-[9px] mt-1" style={{ color: COLORS.textMute }}>
                          Synthesized · last reviewed {GEOPOLITICAL_RISK_AS_OF}
                        </div>
                      </div>
                    );
                  })()}
                  <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 5, speed: 1.5 })}
                          className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                          style={{ background: COLORS.surface2, color: COLORS.text }}>
                    Fly to chokepoint
                  </button>
                </>
              ) : selected.type === 'country-risk' ? (
                <>
                  {/* Country-risk detail panel — fired by clicking a
                      country polygon on the heatmap. Shows the same
                      score breakdown as the chokepoint-embedded
                      version, plus active sanctions + an arrow to
                      view related chokepoints. */}
                  {(() => {
                    const risk = selected.risk;
                    if (!risk) return null;
                    const palette = risk.score >= 80 ? { bg: 'rgba(255,85,119,0.08)', border: 'rgba(255,85,119,0.3)', fg: '#FF6F8D' }
                                  : risk.score >= 60 ? { bg: 'rgba(255,122,51,0.08)', border: 'rgba(255,122,51,0.3)', fg: '#FFB084' }
                                  : risk.score >= 30 ? { bg: 'rgba(255,184,77,0.08)', border: 'rgba(255,184,77,0.3)', fg: '#FFD699' }
                                                     : { bg: 'rgba(75,180,120,0.08)', border: 'rgba(75,180,120,0.3)', fg: COLORS.green };
                    const sanctions = SANCTIONS_PROGRAMS.filter(s =>
                      (s.affectedCountries || []).includes(selected.iso)
                    );
                    return (
                      <>
                        <div className="space-y-2 text-[12px]">
                          <DetailRow k="Country" v={selected.name} />
                          <DetailRow k="ISO"     v={selected.iso} />
                        </div>
                        <div className="mt-4 px-3 py-3 rounded"
                             style={{ background: palette.bg, border: `1px solid ${palette.border}` }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10.5px] uppercase tracking-wider"
                                  style={{ color: COLORS.textMute }}>Geopolitical risk score</span>
                            <span className="text-[20px] font-semibold tabular-nums"
                                  style={{ color: palette.fg }}>{risk.score}/100</span>
                          </div>
                          <div className="text-[11px] mb-2" style={{ color: COLORS.textDim }}>
                            Drivers:
                          </div>
                          <ul className="text-[11px] space-y-0.5 ml-3" style={{ color: COLORS.textDim, listStyle: 'disc' }}>
                            {risk.drivers.map((d, i) => <li key={i}>{d}</li>)}
                          </ul>
                          <div className="text-[9.5px] mt-2 pt-2 border-t"
                               style={{ color: COLORS.textMute, borderColor: palette.border }}>
                            Synthesized score · last reviewed {GEOPOLITICAL_RISK_AS_OF} · not a live feed
                          </div>
                        </div>
                        {sanctions.length > 0 && (
                          <div className="mt-3">
                            <div className="text-[10px] uppercase tracking-wider mb-1.5"
                                 style={{ color: COLORS.textMute }}>
                              Active sanctions
                            </div>
                            <div className="space-y-1.5">
                              {sanctions.map(s => (
                                <div key={s.id} className="px-2.5 py-1.5 rounded"
                                     style={{ background: 'rgba(255,85,119,0.06)', border: '1px solid rgba(255,85,119,0.2)' }}>
                                  <div className="text-[11px] font-medium" style={{ color: '#FF8FA1' }}>
                                    {s.country} <span className="font-normal" style={{ color: COLORS.textMute }}>· since {s.since}</span>
                                  </div>
                                  <div className="text-[10.5px] mt-0.5" style={{ color: COLORS.textDim }}>
                                    {s.programs.join(' · ')}
                                  </div>
                                  <div className="text-[10px] mt-0.5" style={{ color: COLORS.textMute }}>
                                    Affects: {s.affects.join(', ')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <button onClick={() => mapRef.current?.flyTo({ center: [selected.lng, selected.lat], zoom: 4, speed: 1.5 })}
                                className="w-full mt-3 py-2 rounded-md text-[12px] transition-colors"
                                style={{ background: COLORS.surface2, color: COLORS.text }}>
                          Fly to {selected.name}
                        </button>
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  <div className="space-y-2 text-[12px]">
                    {selected.name    && <DetailRow k="Name"    v={selected.name} />}
                    {selected.from    && <DetailRow k="Route"   v={`${selected.from} → ${selected.to}`} />}
                    {selected.cargo   && <DetailRow k="Cargo"   v={selected.cargo} />}
                    {selected.flag    && <DetailRow k="Flag"    v={selected.flag} />}
                    {selected.alt     && <DetailRow k="Altitude" v={`${selected.alt.toLocaleString()} ft`} />}
                    {selected.speed   && <DetailRow k="Speed"   v={`${selected.speed} kt`} />}
                    {selected.heading != null && <DetailRow k="Heading" v={`${selected.heading}°`} />}
                    <DetailRow k="Position" v={`${selected.lat.toFixed(2)}°, ${selected.lng.toFixed(2)}°`} />
                  </div>
                  <button
                    onClick={() => mapRef.current?.flyTo({
                      center: [selected.lng, selected.lat],
                      zoom: 5,
                      speed: 1.5,
                    })}
                    className="w-full mt-4 py-2 rounded-md text-[12px] transition-colors"
                    style={{ background: COLORS.surface2, color: COLORS.text }}
                  >Fly to location</button>
                </>
              )}
            </div>
          ) : (
            <div className="p-6 flex flex-col items-center justify-center min-h-full">
              {/* AI overview placeholder — large hero icon, instruction text.
                  When the user clicks any point on the map, this panel
                  swaps to show the AI-generated brief for that point. */}
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
                   style={{ background: `${COLORS.mint}14`, border: `1px solid ${COLORS.mint}55` }}>
                <Sparkles size={28} style={{ color: COLORS.mint }} />
              </div>
              <div className="text-[14px] font-medium mb-2 text-center" style={{ color: COLORS.text }}>
                AI Overview
              </div>
              <div className="text-[11.5px] leading-relaxed text-center max-w-[220px] mb-6"
                   style={{ color: COLORS.textMute }}>
                Press any point on the map to see an AI-generated brief — what it is, why it matters, and the market signal.
              </div>
              <div className="w-full pt-4 border-t" style={{ borderColor: COLORS.border }}>
                <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
                  Currently shown
                </div>
                <div className="space-y-1.5">
                  <DetailRow k="Total points" v={points.length} />
                  <DetailRow k="Layers active" v={Object.values(filters).filter(Boolean).length} />
                </div>
              </div>
              <div className="w-full mt-auto pt-6 text-[9.5px] leading-relaxed text-center"
                   style={{ color: COLORS.textMute }}>
                © Mapbox © OpenStreetMap · Scroll zoom · Drag pan · Right-drag tilt
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Financial report modal — opens from the side panel */}
      {showFinancialReport && (
        <FinancialReportModal
          ticker={showFinancialReport}
          onClose={() => setShowFinancialReport(null)}
        />
      )}
    </div>
  );
};

const FinancialReportModal = ({ ticker, onClose }) => {
  const mockReport = FINANCIAL_REPORTS[ticker];
  // Fetch real Polygon data — financials + ticker details — and use them
  // when available. Falls back to the curated mock report if Polygon
  // doesn't return anything (no key, rate-limited, or not covered).
  const [livefin, setLivefin] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [fin, dt] = await Promise.all([
        fetchPolygonFinancials(ticker),
        fetchPolygonTickerDetails(ticker),
      ]);
      if (cancelled) return;
      setLivefin(fin);
      setDetails(dt);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ticker]);

  // Helper to format big USD values from Polygon (raw dollars) into our
  // shorthand. mock report stores pre-formatted strings ("3.62T") so we
  // detect that case and just prepend "$".
  const fmtBig = (n) => {
    if (n == null) return '—';
    const abs = Math.abs(n);
    if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
    if (abs >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
    if (abs >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  };

  // Build a unified "r" object — prefer live data, then fall back to mock.
  const latest = livefin?.[0];
  const r = latest ? {
    name:        details?.name ?? mockReport?.name ?? ticker,
    sector:      details?.sicDescription ?? mockReport?.sector ?? '—',
    industry:    details?.sicDescription ?? mockReport?.industry ?? '—',
    founded:     details?.listedDate ? details.listedDate.slice(0, 4) : (mockReport?.founded ?? '—'),
    employees:   details?.employees != null ? details.employees.toLocaleString() : (mockReport?.employees ?? '—'),
    marketCap:   details?.marketCap != null ? fmtBig(details.marketCap).replace('$', '') : (mockReport?.marketCap ?? '—'),
    revenue:     fmtBig(latest.revenue).replace('$', ''),
    grossMargin: latest.revenue && latest.grossProfit
                   ? `${((latest.grossProfit / latest.revenue) * 100).toFixed(1)}%`
                   : (mockReport?.grossMargin ?? '—'),
    netIncome:   fmtBig(latest.netIncome).replace('$', ''),
    eps:         latest.epsDiluted ?? latest.eps ?? mockReport?.eps ?? '—',
    pe:          mockReport?.pe ?? '—', // P/E needs price + EPS, leave as-is for now
    dividend:    mockReport?.dividend ?? '—',
    divYield:    mockReport?.divYield ?? '—',
    cashPosition: fmtBig(latest.cashAndEquivalents).replace('$', ''),
    debt:        fmtBig((latest.totalLiabilities ?? 0) - (latest.totalEquity ?? 0)).replace('$', ''),
    summary:     details?.description ?? mockReport?.summary ?? `${ticker} financial overview from SEC filings.`,
    risks:       mockReport?.risks ?? [],
    period:      latest.period,
    filingDate:  latest.filingDate,
    isLive:      true,
  } : mockReport;
  if (!r) {
    // Nothing to show — neither Polygon nor mock has this ticker
    return (
      <>
        <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose} />
        <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] rounded-md border p-6 text-center"
             style={{ background: COLORS.surface, borderColor: COLORS.borderHi }}>
          <div className="text-[14px] mb-2" style={{ color: COLORS.text }}>
            No financial report for {ticker}
          </div>
          <div className="text-[11px] mb-4" style={{ color: COLORS.textMute }}>
            {loading ? 'Loading from Polygon…' :
             !MASSIVE_API_KEY ? 'Set VITE_MASSIVE_API_KEY to fetch real reports.' :
             'No data returned — this ticker may not be covered.'}
          </div>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-[12px]"
                  style={{ background: COLORS.surface2, color: COLORS.text }}>Close</button>
        </div>
      </>
    );
  }
  const facCount = SUPPLY_CHAIN_FACILITIES.filter(f => f.ticker === ticker).length;
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[640px] max-h-[85vh] rounded-md border overflow-hidden flex flex-col"
           style={{ background: COLORS.surface, borderColor: COLORS.borderHi }}>

        <div className="flex items-start justify-between p-5 border-b shrink-0"
             style={{ borderColor: COLORS.border }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md flex items-center justify-center text-[14px] font-semibold shrink-0"
                 style={{ background: EQUITY_TILE_COLORS[ticker] ?? COLORS.surface2, color: '#FFFFFF' }}>
              {ticker.slice(0, 2)}
            </div>
            <div>
              <div className="text-[16px] font-medium" style={{ color: COLORS.text }}>
                {r.name} <span className="ml-1.5 text-[12px]" style={{ color: COLORS.mint }}>{ticker}</span>
                {r.isLive && (
                  <span className="ml-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(31,178,107,0.14)', color: COLORS.green, border: '1px solid rgba(31,178,107,0.4)' }}
                        title={`Sourced from Polygon /vX/reference/financials, latest period: ${r.period}, filed ${r.filingDate ?? 'unknown'}`}>
                    LIVE · {r.period}
                  </span>
                )}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: COLORS.textMute }}>
                {r.sector} · {r.industry} · Founded {r.founded}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-white/[0.05]">
            <X size={16} style={{ color: COLORS.textDim }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Top metrics */}
          <div className="grid grid-cols-3 gap-3">
            <FinReportCell label="Market cap"  value={`$${r.marketCap}`} />
            <FinReportCell label="Revenue (TTM)" value={`$${r.revenue}`} />
            <FinReportCell label="Net income"  value={`$${r.netIncome}`} mint />
            <FinReportCell label="EPS (TTM)"   value={`$${r.eps}`} />
            <FinReportCell label="P/E ratio"   value={r.pe} />
            <FinReportCell label="Gross margin" value={r.grossMargin} mint />
            <FinReportCell label="Cash position" value={`$${r.cashPosition}`} />
            <FinReportCell label="Total debt"  value={`$${r.debt}`} />
            <FinReportCell label="Employees"   value={r.employees} />
          </div>

          {/* Dividend row if present */}
          {r.dividend !== '—' && (
            <div className="rounded-md border px-4 py-3 text-[12px] flex items-center justify-between"
                 style={{ borderColor: COLORS.border, background: COLORS.bg }}>
              <span style={{ color: COLORS.textMute }}>Dividend</span>
              <span style={{ color: COLORS.text }}>
                ${r.dividend} <span style={{ color: COLORS.mint }}>· {r.divYield} yield</span>
              </span>
            </div>
          )}

          {/* Business summary */}
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
              Business summary
            </div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: COLORS.textDim }}>
              {r.summary}
            </p>
          </div>

          {/* Key risks */}
          <div>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: COLORS.textMute }}>
              Key risks
            </div>
            <ul className="space-y-1.5 text-[12px]">
              {r.risks.map((risk, i) => (
                <li key={i} className="flex items-start gap-2" style={{ color: COLORS.textDim }}>
                  <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: COLORS.red }} />
                  {risk}
                </li>
              ))}
            </ul>
          </div>

          {/* Supply chain summary */}
          <div className="rounded-md border px-4 py-3"
               style={{ borderColor: COLORS.border, background: COLORS.bg }}>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: COLORS.textMute }}>
              Tracked facilities
            </div>
            <div className="text-[12px]" style={{ color: COLORS.text }}>
              {facCount} {facCount === 1 ? 'location' : 'locations'} mapped — HQs, factories, datacenters, warehouses
            </div>
          </div>

          <div className="pt-3 border-t text-[10px] leading-relaxed"
               style={{ borderColor: COLORS.border, color: COLORS.textMute }}>
            Data shown is illustrative. A production version would source from a fundamentals provider (Refinitiv, FactSet, S&P Global) and update on each 10-K/10-Q filing.
          </div>
        </div>
      </div>
    </>
  );
};

const FinReportCell = ({ label, value, mint }) => (
  <div className="rounded-md border px-3 py-2.5"
       style={{ borderColor: COLORS.border, background: COLORS.bg }}>
    <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: COLORS.textMute }}>
      {label}
    </div>
    <div className="text-[14px] tabular-nums" style={{ color: mint ? COLORS.mint : COLORS.text }}>
      {value}
    </div>
  </div>
);
