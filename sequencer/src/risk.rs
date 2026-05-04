//! Pre-trade risk checks — run against an in-memory snapshot of compliance
//! state refreshed from the chain every N seconds. This lets us reject
//! obviously-bad orders in <1μs without a chain round-trip, while chain-side
//! re-verification catches any stale-cache races.

use crate::schemas::{PlaceOrderPayload, error_codes};

pub struct RiskError {
    pub code:    u16,
    pub message: String,
}

pub async fn pretrade_check(lei: &str, desk: &str, order: &PlaceOrderPayload) -> Result<(), RiskError> {
    // 1. Basic sanity
    if order.size <= 0.0 {
        return Err(RiskError {
            code: error_codes::INVALID_MESSAGE,
            message: "size must be positive".into(),
        });
    }

    // 2. Leverage cap (cached per-instrument)
    let max_lev = instrument_max_leverage(&order.symbol);
    if order.leverage > max_lev {
        return Err(RiskError {
            code: error_codes::LEVERAGE_TOO_HIGH,
            message: format!("max leverage for {} is {}×", order.symbol, max_lev),
        });
    }

    // 3. LEI freeze status (lookup in ARC<RwLock<HashMap>> compliance cache)
    if is_lei_frozen(lei).await {
        return Err(RiskError {
            code: error_codes::COMPLIANCE_LEI_FROZEN,
            message: format!("LEI {} is frozen", lei),
        });
    }

    // 4. Desk-level notional throttle (protects against runaway algos)
    if exceeds_desk_throttle(desk, &order.symbol, order.size).await {
        return Err(RiskError {
            code: error_codes::RATE_LIMITED,
            message: "desk-level notional throttle".into(),
        });
    }

    Ok(())
}

fn instrument_max_leverage(symbol: &str) -> u8 {
    match symbol {
        s if s.contains("BTC")   => 20,
        s if s.contains("ETH")   => 20,
        s if s.contains("SOL")   => 10,
        s if s.starts_with("WTI")   => 50,
        s if s.starts_with("BRENT") => 50,
        s if s.starts_with("NG")    => 25,
        s if s.starts_with("HO")    => 25,
        _ => 10,
    }
}

async fn is_lei_frozen(_lei: &str) -> bool {
    // TODO: ARC<RwLock<HashSet<String>>> — refreshed from compliance.pact every 2s
    false
}

async fn exceeds_desk_throttle(_desk: &str, _symbol: &str, _size: f64) -> bool {
    // TODO: token bucket per desk, per instrument class
    false
}
