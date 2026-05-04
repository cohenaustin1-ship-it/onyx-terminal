"""
Detector library — Python port of the SPA's SETUP_RULES.

Each detect_X function takes a list of bars (dicts with open/high/low/close/volume)
and an index `i`, and returns either None or a dict with score + levels + notes.

Port conventions:
  - All detectors take optional `params` dict matching DETECTOR_DEFAULTS in JS
  - Bar shape: {"t": int, "open": float, "high": float, "low": float, "close": float, "volume": float}
  - Returns: {"score": int, "levels": dict, "notes": str, "side": str (optional)}
  - None = "no setup at this bar"
"""

import math
from typing import Optional


# ─────────────────────────────────────────────────────────────────
# Indicator primitives — equivalents to QUANT_PRIMITIVES in the SPA
# ─────────────────────────────────────────────────────────────────
def sma(bars: list, i: int, period: int) -> Optional[float]:
    if i < period - 1:
        return None
    s = 0.0
    for k in range(i - period + 1, i + 1):
        s += bars[k]["close"]
    return s / period


def ema(bars: list, i: int, period: int) -> Optional[float]:
    if i < period - 1:
        return None
    k = 2.0 / (period + 1)
    e = bars[i - period + 1]["close"]
    for j in range(i - period + 2, i + 1):
        e = bars[j]["close"] * k + e * (1 - k)
    return e


def rsi(bars: list, i: int, period: int = 14) -> Optional[float]:
    if i < period:
        return None
    gains, losses = 0.0, 0.0
    for k in range(i - period + 1, i + 1):
        diff = bars[k]["close"] - bars[k - 1]["close"]
        if diff > 0:
            gains += diff
        else:
            losses -= diff
    avg_g = gains / period
    avg_l = losses / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100.0 - 100.0 / (1.0 + rs)


def volz(bars: list, i: int, period: int = 20) -> Optional[float]:
    """Volume z-score: how many σ above 20-period mean is current volume."""
    if i < period:
        return None
    vols = [bars[k].get("volume", 0) or 0 for k in range(i - period + 1, i + 1)]
    if not vols:
        return None
    mean = sum(vols) / len(vols)
    var = sum((v - mean) ** 2 for v in vols) / len(vols)
    sd = math.sqrt(var) if var > 0 else 0
    cur = bars[i].get("volume", 0) or 0
    return (cur - mean) / sd if sd > 0 else 0


def bb(bars: list, i: int, period: int = 20, k: float = 2.0):
    """Bollinger Bands: returns dict with upper, middle, lower, width."""
    if i < period - 1:
        return None
    closes = [bars[j]["close"] for j in range(i - period + 1, i + 1)]
    mean = sum(closes) / period
    var = sum((c - mean) ** 2 for c in closes) / period
    sd = math.sqrt(var)
    return {
        "middle": mean,
        "upper": mean + k * sd,
        "lower": mean - k * sd,
        "width": (k * sd * 2) / mean if mean > 0 else 0,
    }


def macd(bars: list, i: int, fast: int = 12, slow: int = 26, sig: int = 9):
    if i < slow + sig:
        return None
    ef = ema(bars, i, fast)
    es = ema(bars, i, slow)
    if ef is None or es is None:
        return None
    macd_val = ef - es
    # signal line = ema of macd over `sig` periods
    macds = []
    for j in range(i - sig + 1, i + 1):
        ej_f = ema(bars, j, fast)
        ej_s = ema(bars, j, slow)
        if ej_f is None or ej_s is None:
            return None
        macds.append(ej_f - ej_s)
    sig_val = sum(macds) / len(macds)
    return {"macd": macd_val, "signal": sig_val, "hist": macd_val - sig_val}


# ─────────────────────────────────────────────────────────────────
# DETECTOR_DEFAULTS — must match the SPA's table exactly so the
# server and client produce identical results when given identical
# params.
# ─────────────────────────────────────────────────────────────────
DETECTOR_DEFAULTS = {
    "bull-breakout":    {"window": 20, "minVolZ": 0.5},
    "bear-breakdown":   {"window": 20, "minVolZ": 0.5},
    "oversold-bounce":  {"rsiWindow": 14, "rsiThreshold": 30},
    "overbought-fade":  {"rsiWindow": 14, "rsiThreshold": 70},
    "bb-squeeze":       {"window": 20, "k": 2, "decilePct": 0.10},
    "macd-bull-cross":  {},
    "macd-bear-cross":  {},
    "golden-cross":     {"fast": 50, "slow": 200},
    "death-cross":      {"fast": 50, "slow": 200},
    "volume-thrust":    {"multiplier": 3, "closeRangePct": 0.65},
    "higher-low-stack": {"lookback": 28},
    "lower-high-stack": {"lookback": 28},
    "bull-flag":        {"impulseStart": 15, "impulseEnd": 7,
                         "minImpulsePct": 0.08, "maxFlagRangePct": 0.06},
}


def _merged(rule_id: str, opts: dict) -> dict:
    return {**DETECTOR_DEFAULTS.get(rule_id, {}), **(opts or {})}


# ─────────────────────────────────────────────────────────────────
# Detectors
# ─────────────────────────────────────────────────────────────────
def detect_bull_breakout(bars, i, opts=None):
    p = _merged("bull-breakout", opts)
    w = p["window"]
    if i < w:
        return None
    hi = max(bars[k]["high"] for k in range(i - w, i))
    cur = bars[i]
    vz = volz(bars, i, 20)
    if cur["close"] <= hi:
        return None
    if vz is None or vz < p["minVolZ"]:
        return None
    score = min(100, 50 + (cur["close"] / hi - 1) * 500 + min(30, vz * 12))
    return {
        "score": int(round(score)),
        "side": "long",
        "levels": {"entry": cur["close"], "breakout": hi,
                   "stop": hi * 0.97,
                   "target": hi * (1 + (cur["close"] / hi - 1) * 3)},
        "notes": f"Closed above {hi:.2f} ({w}-day high) on {vz:.1f}σ volume",
    }


def detect_bear_breakdown(bars, i, opts=None):
    p = _merged("bear-breakdown", opts)
    w = p["window"]
    if i < w:
        return None
    lo = min(bars[k]["low"] for k in range(i - w, i))
    cur = bars[i]
    vz = volz(bars, i, 20)
    if cur["close"] >= lo:
        return None
    if vz is None or vz < p["minVolZ"]:
        return None
    score = min(100, 50 + (1 - cur["close"] / lo) * 500 + min(30, vz * 12))
    return {
        "score": int(round(score)),
        "side": "short",
        "levels": {"entry": cur["close"], "breakdown": lo,
                   "stop": lo * 1.03,
                   "target": lo * (1 - (1 - cur["close"] / lo) * 3)},
        "notes": f"Closed below {lo:.2f} ({w}-day low) on {vz:.1f}σ volume",
    }


def detect_oversold_bounce(bars, i, opts=None):
    p = _merged("oversold-bounce", opts)
    if i < 20:
        return None
    rsi_now = rsi(bars, i, p["rsiWindow"])
    rsi_prev = rsi(bars, i - 1, p["rsiWindow"])
    if rsi_now is None or rsi_prev is None:
        return None
    th = p["rsiThreshold"]
    if rsi_prev > th or rsi_now < th:
        return None
    cur, prev = bars[i], bars[i - 1]
    if cur["close"] <= cur["open"]:
        return None
    if cur["close"] <= prev["high"]:
        return None
    sma20 = sma(bars, i, 20)
    dist = (sma20 - cur["close"]) / sma20 if sma20 else 0
    score = min(95, 50 + (th - rsi_prev) * 2 + min(20, dist * 200))
    return {
        "score": int(round(score)),
        "side": "long",
        "levels": {"entry": cur["close"], "stop": prev["low"] * 0.99,
                   "target": sma20 if sma20 else cur["close"] * 1.05},
        "notes": f"RSI crossed up from {rsi_prev:.1f} (oversold) with bullish candle",
    }


def detect_overbought_fade(bars, i, opts=None):
    p = _merged("overbought-fade", opts)
    if i < 20:
        return None
    rsi_now = rsi(bars, i, p["rsiWindow"])
    rsi_prev = rsi(bars, i - 1, p["rsiWindow"])
    if rsi_now is None or rsi_prev is None:
        return None
    th = p["rsiThreshold"]
    if rsi_prev < th or rsi_now > th:
        return None
    cur, prev = bars[i], bars[i - 1]
    if cur["close"] >= cur["open"]:
        return None
    if cur["close"] >= prev["low"]:
        return None
    sma20 = sma(bars, i, 20)
    dist = (cur["close"] - sma20) / sma20 if sma20 else 0
    score = min(95, 50 + (rsi_prev - th) * 2 + min(20, dist * 200))
    return {
        "score": int(round(score)),
        "side": "short",
        "levels": {"entry": cur["close"], "stop": prev["high"] * 1.01,
                   "target": sma20 if sma20 else cur["close"] * 0.95},
        "notes": f"RSI crossed down from {rsi_prev:.1f} (overbought) with bearish candle",
    }


def detect_bb_squeeze(bars, i, opts=None):
    p = _merged("bb-squeeze", opts)
    win = p["window"]
    k = p["k"]
    if i < win + 10:
        return None
    bb_now = bb(bars, i, win, k)
    bb_prev = bb(bars, i - win, win, k)
    if not bb_now or not bb_prev:
        return None
    widths = []
    for j in range(i - (win + 10), i + 1):
        b = bb(bars, j, win, k)
        if b:
            widths.append(b["width"])
    if not widths:
        return None
    widths.sort()
    decile_idx = int(len(widths) * p["decilePct"])
    decile = widths[decile_idx]
    if bb_now["width"] > decile * 1.05:
        return None
    cur = bars[i]
    direction = "long" if cur["close"] > bb_now["middle"] else "short"
    score = min(90, 40 + (1 - bb_now["width"] / bb_prev["width"]) * 80)
    return {
        "score": int(round(score)),
        "side": direction,
        "levels": {"entry": cur["close"], "upperBand": bb_now["upper"],
                   "lowerBand": bb_now["lower"], "mid": bb_now["middle"]},
        "notes": f"BB width compressed to {bb_now['width']*100:.2f}% — primed for expansion. Bias {direction}.",
    }


def detect_macd_bull_cross(bars, i, opts=None):
    if i < 35:
        return None
    m = macd(bars, i)
    mp = macd(bars, i - 1)
    if not m or not mp:
        return None
    if not (mp["macd"] <= mp["signal"] and m["macd"] > m["signal"]):
        return None
    oversold_boost = 20 if m["macd"] < 0 else 0
    hist_strength = min(20, abs(m["hist"]) * 100)
    score = 50 + oversold_boost + hist_strength
    cur = bars[i]
    return {
        "score": int(round(min(95, score))),
        "side": "long",
        "levels": {"entry": cur["close"],
                   "stop": cur["close"] * 0.96,
                   "target": cur["close"] * 1.06},
        "notes": "MACD bull cross from below zero — strong setup" if m["macd"] < 0 else f"MACD line crossed above signal (hist {m['hist']:.3f})",
    }


def detect_macd_bear_cross(bars, i, opts=None):
    if i < 35:
        return None
    m = macd(bars, i)
    mp = macd(bars, i - 1)
    if not m or not mp:
        return None
    if not (mp["macd"] >= mp["signal"] and m["macd"] < m["signal"]):
        return None
    overbought_boost = 20 if m["macd"] > 0 else 0
    hist_strength = min(20, abs(m["hist"]) * 100)
    score = 50 + overbought_boost + hist_strength
    cur = bars[i]
    return {
        "score": int(round(min(95, score))),
        "side": "short",
        "levels": {"entry": cur["close"],
                   "stop": cur["close"] * 1.04,
                   "target": cur["close"] * 0.94},
        "notes": "MACD bear cross from above zero — strong fade" if m["macd"] > 0 else f"MACD line crossed below signal (hist {m['hist']:.3f})",
    }


def detect_golden_cross(bars, i, opts=None):
    p = _merged("golden-cross", opts)
    if i < p["slow"]:
        return None
    sf = sma(bars, i, p["fast"])
    sfp = sma(bars, i - 1, p["fast"])
    ss = sma(bars, i, p["slow"])
    ssp = sma(bars, i - 1, p["slow"])
    if not sf or not sfp or not ss or not ssp:
        return None
    if not (sfp <= ssp and sf > ss):
        return None
    cur = bars[i]
    return {
        "score": 65,
        "side": "long",
        "levels": {"entry": cur["close"], "smaFast": sf, "smaSlow": ss,
                   "stop": ss * 0.98, "target": cur["close"] * 1.15},
        "notes": f"{p['fast']}-day SMA crossed above {p['slow']}-day SMA — long-term trend turning bullish",
    }


def detect_death_cross(bars, i, opts=None):
    p = _merged("death-cross", opts)
    if i < p["slow"]:
        return None
    sf = sma(bars, i, p["fast"])
    sfp = sma(bars, i - 1, p["fast"])
    ss = sma(bars, i, p["slow"])
    ssp = sma(bars, i - 1, p["slow"])
    if not sf or not sfp or not ss or not ssp:
        return None
    if not (sfp >= ssp and sf < ss):
        return None
    cur = bars[i]
    return {
        "score": 65,
        "side": "short",
        "levels": {"entry": cur["close"], "smaFast": sf, "smaSlow": ss,
                   "stop": ss * 1.02, "target": cur["close"] * 0.85},
        "notes": f"{p['fast']}-day SMA crossed below {p['slow']}-day SMA — long-term trend turning bearish",
    }


def detect_volume_thrust(bars, i, opts=None):
    p = _merged("volume-thrust", opts)
    if i < 20:
        return None
    vols = [bars[k].get("volume", 0) or 0 for k in range(i - 20, i)]
    avg_vol = sum(vols) / 20 if vols else 0
    cur = bars[i]
    if not cur.get("volume") or cur["volume"] < avg_vol * p["multiplier"]:
        return None
    rng = (cur.get("high") or cur["close"]) - (cur.get("low") or cur["close"])
    if rng <= 0:
        return None
    cir = (cur["close"] - (cur.get("low") or cur["close"])) / rng
    if cir < p["closeRangePct"]:
        return None
    vol_ratio = cur["volume"] / avg_vol if avg_vol else 0
    score = min(95, 40 + min(35, vol_ratio * 8) + cir * 20)
    return {
        "score": int(round(score)),
        "side": "long",
        "levels": {"entry": cur["close"],
                   "stop": cur["low"] * 0.99 if cur.get("low") else cur["close"] * 0.97,
                   "target": cur["close"] + rng * 2},
        "notes": f"{vol_ratio:.1f}x average volume, closed in top {cir*100:.0f}% of bar",
    }


def detect_higher_low_stack(bars, i, opts=None):
    p = _merged("higher-low-stack", opts)
    lookback = p["lookback"]
    if i < lookback + 2:
        return None
    # Find swing lows in last `lookback` bars (a swing low = bar where
    # low is lower than 2 bars before AND 2 bars after)
    lows = []
    for k in range(i - (lookback - 2), i - 1):
        if (bars[k]["low"] < bars[k-1]["low"] and bars[k]["low"] < bars[k-2]["low"] and
            bars[k]["low"] < bars[k+1]["low"] and bars[k]["low"] < bars[k+2]["low"]):
            lows.append({"idx": k, "low": bars[k]["low"]})
    if len(lows) < 3:
        return None
    recent3 = lows[-3:]
    if not (recent3[0]["low"] < recent3[1]["low"] < recent3[2]["low"]):
        return None
    cur = bars[i]
    slope = (recent3[2]["low"] - recent3[0]["low"]) / (recent3[2]["idx"] - recent3[0]["idx"])
    lows_str = " → ".join(f"{l['low']:.2f}" for l in recent3)
    return {
        "score": 60,
        "side": "long",
        "levels": {"entry": cur["close"],
                   "stop": recent3[2]["low"] * 0.99,
                   "target": cur["close"] + slope * 30},
        "notes": f"Three consecutive higher lows: {lows_str}",
    }


def detect_lower_high_stack(bars, i, opts=None):
    p = _merged("lower-high-stack", opts)
    lookback = p["lookback"]
    if i < lookback + 2:
        return None
    highs = []
    for k in range(i - (lookback - 2), i - 1):
        if (bars[k]["high"] > bars[k-1]["high"] and bars[k]["high"] > bars[k-2]["high"] and
            bars[k]["high"] > bars[k+1]["high"] and bars[k]["high"] > bars[k+2]["high"]):
            highs.append({"idx": k, "high": bars[k]["high"]})
    if len(highs) < 3:
        return None
    recent3 = highs[-3:]
    if not (recent3[0]["high"] > recent3[1]["high"] > recent3[2]["high"]):
        return None
    cur = bars[i]
    slope = (recent3[0]["high"] - recent3[2]["high"]) / (recent3[2]["idx"] - recent3[0]["idx"])
    highs_str = " → ".join(f"{h['high']:.2f}" for h in recent3)
    return {
        "score": 60,
        "side": "short",
        "levels": {"entry": cur["close"],
                   "stop": recent3[2]["high"] * 1.01,
                   "target": cur["close"] - slope * 30},
        "notes": f"Three consecutive lower highs: {highs_str}",
    }


def detect_bull_flag(bars, i, opts=None):
    p = _merged("bull-flag", opts)
    if i < p["impulseStart"] + 10:
        return None
    impulse_start_px = bars[i - p["impulseStart"]]["close"]
    impulse_end_px = bars[i - p["impulseEnd"]]["close"]
    if not impulse_start_px or not impulse_end_px:
        return None
    impulse_ret = (impulse_end_px - impulse_start_px) / impulse_start_px
    if impulse_ret < p["minImpulsePct"]:
        return None
    # Tight pullback: high-low over last impulseEnd bars stays within maxFlagRangePct
    phi = -float("inf")
    plo = float("inf")
    for k in range(i - (p["impulseEnd"] - 1), i + 1):
        if bars[k]["high"] > phi:
            phi = bars[k]["high"]
        if bars[k]["low"] < plo:
            plo = bars[k]["low"]
    flag_range = (phi - plo) / impulse_end_px
    if flag_range > p["maxFlagRangePct"]:
        return None
    # Pullback should hold above the 20EMA
    e20 = ema(bars, i, 20)
    if e20 is None or bars[i]["close"] < e20:
        return None
    score = min(90, round(55 + impulse_ret * 200))
    return {
        "score": int(score),
        "side": "long",
        "levels": {"entry": phi, "flagHigh": phi, "flagLow": plo,
                   "stop": plo * 0.99,
                   "target": phi + (impulse_end_px - impulse_start_px)},
        "notes": f"{impulse_ret*100:.1f}% impulse + tight {flag_range*100:.1f}% pullback holding above 20EMA",
    }


# Detector registry — id → function
ALL_DETECTORS = {
    "bull-breakout":    detect_bull_breakout,
    "bear-breakdown":   detect_bear_breakdown,
    "oversold-bounce":  detect_oversold_bounce,
    "overbought-fade": detect_overbought_fade,
    "bb-squeeze":       detect_bb_squeeze,
    "macd-bull-cross":  detect_macd_bull_cross,
    "macd-bear-cross":  detect_macd_bear_cross,
    "golden-cross":     detect_golden_cross,
    "death-cross":      detect_death_cross,
    "volume-thrust":    detect_volume_thrust,
    "higher-low-stack": detect_higher_low_stack,
    "lower-high-stack": detect_lower_high_stack,
    "bull-flag":        detect_bull_flag,
}
# All 13 SETUP_RULES detectors are now ported. The Python implementations
# match the SPA's JS detectors when given identical parameters.


def run_all_detectors(bars: list, ticker: str, rule_ids: list, params_by_rule: dict = None):
    """Run a list of detectors against the latest bar of `bars`. Returns
    the matching setups sorted by score descending."""
    if not bars or len(bars) < 30:
        return []
    i = len(bars) - 1
    out = []
    params_by_rule = params_by_rule or {}
    for rule_id in rule_ids:
        fn = ALL_DETECTORS.get(rule_id)
        if not fn:
            continue
        try:
            result = fn(bars, i, params_by_rule.get(rule_id))
            if result and result.get("score", 0) >= 30:
                result["ticker"] = ticker
                result["rule_id"] = rule_id
                out.append(result)
        except Exception:
            continue
    out.sort(key=lambda r: r["score"], reverse=True)
    return out
