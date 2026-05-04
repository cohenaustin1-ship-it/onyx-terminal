;; ============================================================================
;; JPM Onyx Clearinghouse — cross-chain margin & liquidation engine
;; Deployed on CH-0 (the "clearing chain"), accessed from instrument chains
;; via Kadena's native SPV cross-chain proofs.
;; ============================================================================

(namespace 'jpm-onyx)

(module clearinghouse GOVERNANCE

  (defcap GOVERNANCE ()
    (enforce-keyset 'jpm-onyx-admin))

  (defschema position
    account     : string
    instrument  : string
    size        : decimal          ;; positive = long, negative = short
    avg-entry   : decimal
    margin      : decimal          ;; initial margin locked
    leverage    : integer
    unrealized  : decimal
    last-update : time)

  (defschema account-balance
    account     : string
    lei         : string
    equity      : decimal          ;; JPM Coin balance
    locked      : decimal          ;; margin locked across all positions
    available   : decimal
    cross-ratio : decimal)

  (deftable positions:{position})
  (deftable balances:{account-balance})

  (defconst MAINT_MARGIN_RATIO 0.025)   ;; 2.5% maintenance
  (defconst LIQ_PENALTY        0.01)    ;; 1% liquidation penalty → insurance fund

  ;; -------------------------------------------------------------------------
  ;; Pre-trade margin check — called from order-book.place-order via SPV
  ;; -------------------------------------------------------------------------
  (defun check-margin
    (account:string instrument:string side:string size:decimal
     price:decimal leverage:integer)
    (let* ((notional     (* size price))
           (initial-req  (/ notional leverage))
           (bal          (read balances account))
           (avail        (at 'available bal)))
      (enforce (>= avail initial-req)
        (format "Insufficient margin: need {} have {}" [initial-req avail]))
      (enforce (<= leverage (instrument-max-leverage instrument))
        "Leverage exceeds instrument max")
      true))

  ;; -------------------------------------------------------------------------
  ;; Mark-to-market — called every oracle update, every N blocks
  ;; -------------------------------------------------------------------------
  (defun mark-to-market (account:string instrument:string mark-price:decimal)
    (with-read positions (compound-key account instrument)
      { "size" := sz, "avg-entry" := entry, "margin" := m, "leverage" := lev }
      (let* ((pnl        (* sz (- mark-price entry)))
             (equity-val (+ m pnl))
             (maint-req  (* (abs sz) mark-price MAINT_MARGIN_RATIO)))
        (update positions (compound-key account instrument)
          { "unrealized"  : pnl,
            "last-update" : (at 'block-time (chain-data)) })
        (if (< equity-val maint-req)
            (liquidate account instrument mark-price)
            "healthy"))))

  ;; -------------------------------------------------------------------------
  ;; Liquidation — Dutch auction via insurance fund
  ;; -------------------------------------------------------------------------
  (defun liquidate (account:string instrument:string mark-price:decimal)
    (with-read positions (compound-key account instrument)
      { "size" := sz, "margin" := m }
      (let* ((penalty   (* (abs sz) mark-price LIQ_PENALTY))
             (recovered (- m penalty)))
        ;; Transfer remaining margin to insurance fund
        (insurance-fund.deposit penalty)
        ;; Force-close at mark price by inserting taker order on instrument chain
        (instrument-chain.emit-liquidation account instrument sz mark-price)
        ;; Close out position
        (update positions (compound-key account instrument)
          { "size"        : 0.0,
            "margin"      : 0.0,
            "unrealized"  : 0.0,
            "last-update" : (at 'block-time (chain-data)) })
        (emit-event (LIQUIDATION account instrument sz mark-price penalty))
        (format "Liquidated {} @ {}" [account mark-price]))))

  ;; -------------------------------------------------------------------------
  ;; Instrument configuration
  ;; -------------------------------------------------------------------------
  (defun instrument-max-leverage:integer (inst:string)
    (cond
      ((= inst "BTC-PERP")  20)
      ((= inst "ETH-PERP")  20)
      ((= inst "SOL-PERP")  10)
      ((= inst "WTI-F26")   50)
      ((= inst "BRENT-F26") 50)
      ((= inst "NG-G26")    25)
      ((= inst "HO-F26")    25)
      10))

  (defun compound-key:string (a:string b:string)
    (format "{}::{}" [a b]))

  (defcap LIQUIDATION (acct:string inst:string sz:decimal px:decimal penalty:decimal)
    @event true)
)

(create-table positions)
(create-table balances)
