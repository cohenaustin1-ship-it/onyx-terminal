;; ============================================================================
;; JPM Onyx Compliance Module
;;
;; Gatekeeper for every trade on the Chainweb. Enforces:
;;   - LEI whitelist (ISO 17442 Legal Entity Identifiers)
;;   - KYC / AML / OFAC sanctions screening status
;;   - Position limits (per-instrument, per-account, aggregate)
;;   - Notional limits (daily, weekly, monthly)
;;   - Trade surveillance rules (wash trading, spoofing, marking the close)
;;   - Regulatory report emission (CFTC, SEC, FCA, MiFID II)
;;   - Restricted party lists & concentration limits
;;
;; Deployed on CH-0 (the governance chain). Instrument-chain order books
;; call into this module via Kadena cross-chain SPV proofs before accepting
;; any order. The checks must be fast — the sequencer pre-caches LEI status
;; and notional counters, so on-chain calls verify against block-finalized
;; state rather than blocking the hot path.
;; ============================================================================

(namespace 'jpm-onyx)

(module compliance GOVERNANCE

  ;; -------------------------------------------------------------------------
  ;; Governance — 3-of-5 compliance officers required for whitelist changes
  ;; -------------------------------------------------------------------------
  (defcap GOVERNANCE ()
    (enforce-keyset 'jpm-onyx-compliance-admin))

  (defcap COMPLIANCE_OFFICER ()
    "Any single compliance officer can flag/freeze; removing flags needs GOVERNANCE"
    (enforce-keyset 'jpm-onyx-compliance-officers))

  (defcap SURVEILLANCE_ENGINE ()
    "Off-chain surveillance system writes detections here"
    (enforce-keyset 'jpm-onyx-surveillance))

  (defcap ORACLE_PRICE ()
    "Only the permissioned price oracle can post marks used for limit checks"
    (enforce-keyset 'jpm-onyx-oracle))

  ;; -------------------------------------------------------------------------
  ;; Schemas
  ;; -------------------------------------------------------------------------
  (defschema lei-record
    lei              : string     ;; ISO 17442, 20 chars
    legal-name       : string
    jurisdiction     : string     ;; "US", "GB", "SG", etc.
    entity-type      : string     ;; "bank", "hedge-fund", "corporate", "broker-dealer"
    kyc-status       : string     ;; "approved" | "pending" | "expired" | "rejected"
    kyc-expiry       : time
    aml-score        : integer    ;; 0-100, lower is better
    sanctions-clear  : bool       ;; OFAC + EU + UK sanctions screening result
    onboarded        : time
    risk-tier        : string     ;; "tier-1" | "tier-2" | "tier-3" | "restricted"
    allowed-products : [string]   ;; instrument classes entity can trade
    frozen           : bool
    freeze-reason    : string)

  (defschema position-limit
    lei              : string
    instrument       : string
    max-long         : decimal
    max-short        : decimal
    max-notional-usd : decimal
    current-long     : decimal
    current-short    : decimal
    current-notional : decimal)

  (defschema notional-window
    lei            : string
    window         : string       ;; "1d" | "7d" | "30d"
    limit-usd      : decimal
    used-usd       : decimal
    window-start   : time)

  (defschema surveillance-flag
    flag-id        : string
    lei            : string
    kind           : string       ;; "wash" | "spoof" | "marking" | "front-run" | "layering"
    severity       : string       ;; "info" | "warn" | "critical"
    detected-at    : time
    evidence       : string       ;; JSON blob
    reviewed       : bool
    resolution     : string)

  (defschema reg-report
    report-id      : string
    jurisdiction   : string       ;; "CFTC" | "SEC" | "FCA" | "ESMA"
    kind           : string       ;; "swap-data" | "position-report" | "MiFID-txn"
    lei            : string
    payload        : string       ;; canonical JSON per regulator schema
    emitted-at     : time
    ack-received   : bool
    ack-reference  : string)

  (defschema concentration-limit
    product-class  : string       ;; "crypto-perp" | "energy-fut"
    max-single-lei : decimal      ;; max % of OI any one LEI can hold
    current-top    : decimal)

  (deftable leis:{lei-record})
  (deftable position-limits:{position-limit})
  (deftable notional-windows:{notional-window})
  (deftable surveillance-flags:{surveillance-flag})
  (deftable reg-reports:{reg-report})
  (deftable concentration:{concentration-limit})

  ;; -------------------------------------------------------------------------
  ;; Constants — thresholds codified on chain so they're auditable
  ;; -------------------------------------------------------------------------
  (defconst AML_MAX_SCORE 60)
  (defconst KYC_GRACE_DAYS 14)
  (defconst CFTC_LARGE_TRADER_THRESHOLD 50000000.0)   ;; $50M notional
  (defconst MIFID_LEI_REQUIRED true)
  (defconst WASH_TRADE_WINDOW_SEC 60)
  (defconst MAX_CANCEL_REPLACE_RATE 10.0)             ;; per second, spoof detection

  ;; =========================================================================
  ;; ENTRY POINT — called from order-book.pact place-order on every instrument chain
  ;; =========================================================================
  (defun require-whitelisted (lei:string)
    @doc "Master gate. Every order-book.place-order call passes through here."
    (with-read leis lei {
      "kyc-status"      := kyc,
      "kyc-expiry"      := expiry,
      "aml-score"       := aml,
      "sanctions-clear" := clear,
      "frozen"          := frozen,
      "risk-tier"       := tier
    }
      (enforce (not frozen)              "ENT_FROZEN: account under compliance hold")
      (enforce clear                     "OFAC_FAIL: entity on sanctions list")
      (enforce (= kyc "approved")        "KYC_FAIL: KYC not approved")
      (enforce (< (diff-time expiry (at 'block-time (chain-data))) 0.0)
                                         "KYC_EXPIRED: re-onboarding required")
      (enforce (<= aml AML_MAX_SCORE)    "AML_THRESHOLD: score exceeds limit")
      (enforce (!= tier "restricted")    "TIER_RESTRICTED: entity cannot trade")
      true))

  (defun require-product-allowed (lei:string instrument:string)
    @doc "Check entity is allowed to trade this instrument class"
    (let ((product-class (product-class-of instrument)))
      (with-read leis lei { "allowed-products" := allowed }
        (enforce (contains product-class allowed)
          (format "PRODUCT_NOT_PERMITTED: {} not in allowed list for {}"
                  [product-class lei])))))

  ;; =========================================================================
  ;; Position limit enforcement
  ;; =========================================================================
  (defun check-position-limit
    (lei:string instrument:string side:string size:decimal price:decimal)
    (let* ((key          (pos-key lei instrument))
           (notional     (* size price))
           (is-buy       (= side "buy"))
           (curr         (get-or-default-limit lei instrument)))
      (bind curr {
        "max-long"         := ml,
        "max-short"        := ms,
        "max-notional-usd" := mn,
        "current-long"     := cl,
        "current-short"    := cs,
        "current-notional" := cn
      }
        (let ((new-long     (if is-buy  (+ cl size) cl))
              (new-short    (if is-buy  cs (+ cs size)))
              (new-notional (+ cn notional)))
          (enforce (<= new-long ml)
            (format "POS_LIMIT_LONG: would exceed long cap ({}>{})" [new-long ml]))
          (enforce (<= new-short ms)
            (format "POS_LIMIT_SHORT: would exceed short cap ({}>{})" [new-short ms]))
          (enforce (<= new-notional mn)
            (format "POS_LIMIT_NOTIONAL: would exceed notional cap"))
          (write position-limits key (+ curr {
            "current-long"     : new-long,
            "current-short"    : new-short,
            "current-notional" : new-notional
          }))
          true))))

  (defun get-or-default-limit:object (lei:string instrument:string)
    (let ((key (pos-key lei instrument)))
      (with-default-read position-limits key
        {"lei": lei, "instrument": instrument,
         "max-long": (default-max-long lei instrument),
         "max-short": (default-max-short lei instrument),
         "max-notional-usd": (default-max-notional lei instrument),
         "current-long": 0.0, "current-short": 0.0, "current-notional": 0.0}
        {"lei" := l, "instrument" := i, "max-long" := ml, "max-short" := ms,
         "max-notional-usd" := mn, "current-long" := cl, "current-short" := cs,
         "current-notional" := cn}
        {"lei": l, "instrument": i, "max-long": ml, "max-short": ms,
         "max-notional-usd": mn, "current-long": cl, "current-short": cs,
         "current-notional": cn})))

  ;; =========================================================================
  ;; Rolling notional window (Dodd-Frank large-trader reporting trigger)
  ;; =========================================================================
  (defun check-notional-window (lei:string window:string notional:decimal)
    (let ((key (format "{}::{}" [lei window])))
      (with-default-read notional-windows key
        {"lei": lei, "window": window,
         "limit-usd": (default-notional-limit lei window),
         "used-usd": 0.0,
         "window-start": (at 'block-time (chain-data))}
        {"limit-usd" := lim, "used-usd" := used, "window-start" := start}
        (let* ((now        (at 'block-time (chain-data)))
               (window-sec (window-seconds window))
               (expired    (> (diff-time now start) window-sec))
               (curr-used  (if expired 0.0 used))
               (new-used   (+ curr-used notional)))
          (enforce (<= new-used lim)
            (format "NOTIONAL_WINDOW_{}: cap ${} exceeded" [window lim]))
          (write notional-windows key {
            "lei":          lei,
            "window":       window,
            "limit-usd":    lim,
            "used-usd":     new-used,
            "window-start": (if expired now start)
          })
          ;; Emit CFTC large trader flag if threshold crossed
          (if (>= new-used CFTC_LARGE_TRADER_THRESHOLD)
              (queue-reg-report "CFTC" "large-trader" lei
                (format "{{lei:\"{}\",notional:{},window:\"{}\"}}" [lei new-used window]))
              "")
          true))))

  ;; =========================================================================
  ;; Surveillance — wash trading, spoofing, layering detection hooks
  ;; =========================================================================
  (defun flag-surveillance
    (lei:string kind:string severity:string evidence:string)
    @doc "Called by off-chain surveillance engine when patterns detected"
    (with-capability (SURVEILLANCE_ENGINE)
      (let ((fid (format "{}-{}-{}"
                  [lei kind (at 'block-height (chain-data))])))
        (insert surveillance-flags fid {
          "flag-id":     fid,
          "lei":         lei,
          "kind":        kind,
          "severity":    severity,
          "detected-at": (at 'block-time (chain-data)),
          "evidence":    evidence,
          "reviewed":    false,
          "resolution":  ""
        })
        (if (= severity "critical") (freeze-account lei kind) "")
        (emit-event (SURVEILLANCE_FLAG lei kind severity))
        fid)))

  (defun freeze-account (lei:string reason:string)
    @doc "Hard freeze — cancels all open orders on next sequencer tick"
    (with-capability (COMPLIANCE_OFFICER)
      (update leis lei {
        "frozen":        true,
        "freeze-reason": reason
      })
      (emit-event (ACCOUNT_FROZEN lei reason))))

  (defun unfreeze-account (lei:string)
    @doc "Governance-level action — requires 3-of-5 signers"
    (with-capability (GOVERNANCE)
      (update leis lei { "frozen": false, "freeze-reason": "" })
      (emit-event (ACCOUNT_UNFROZEN lei))))

  ;; =========================================================================
  ;; Regulatory reporting — CFTC Part 43/45, SEC Reg NMS, MiFID II RTS 22
  ;; =========================================================================
  (defun queue-reg-report
    (jurisdiction:string kind:string lei:string payload:string)
    @doc "Emits a report for the off-chain RegReg to forward to the DTCC/swap data repo"
    (let ((rid (format "{}-{}-{}-{}"
               [jurisdiction kind lei (at 'block-height (chain-data))])))
      (insert reg-reports rid {
        "report-id":     rid,
        "jurisdiction": jurisdiction,
        "kind":         kind,
        "lei":          lei,
        "payload":      payload,
        "emitted-at":   (at 'block-time (chain-data)),
        "ack-received": false,
        "ack-reference":""
      })
      (emit-event (REG_REPORT_QUEUED rid jurisdiction kind lei))
      rid))

  (defun record-reg-ack (report-id:string ack-ref:string)
    @doc "RegReg confirms DTCC / SDR accepted the report"
    (with-capability (COMPLIANCE_OFFICER)
      (update reg-reports report-id {
        "ack-received":  true,
        "ack-reference": ack-ref
      })))

  ;; =========================================================================
  ;; LEI lifecycle management
  ;; =========================================================================
  (defun onboard-entity
    (lei:string legal-name:string jurisdiction:string entity-type:string
     risk-tier:string allowed-products:[string])
    (with-capability (GOVERNANCE)
      (insert leis lei {
        "lei":              lei,
        "legal-name":       legal-name,
        "jurisdiction":     jurisdiction,
        "entity-type":      entity-type,
        "kyc-status":       "approved",
        "kyc-expiry":       (add-time (at 'block-time (chain-data))
                                      (days 365)),
        "aml-score":        20,
        "sanctions-clear":  true,
        "onboarded":        (at 'block-time (chain-data)),
        "risk-tier":        risk-tier,
        "allowed-products": allowed-products,
        "frozen":           false,
        "freeze-reason":    ""
      })
      (emit-event (ENTITY_ONBOARDED lei legal-name jurisdiction))))

  (defun refresh-kyc (lei:string new-expiry:time new-aml:integer)
    (with-capability (COMPLIANCE_OFFICER)
      (update leis lei {
        "kyc-status":      "approved",
        "kyc-expiry":      new-expiry,
        "aml-score":       new-aml,
        "sanctions-clear": true
      })))

  (defun mark-sanctions-hit (lei:string)
    (with-capability (COMPLIANCE_OFFICER)
      (update leis lei {
        "sanctions-clear": false,
        "frozen":          true,
        "freeze-reason":   "OFAC/sanctions screening failure"
      })
      (emit-event (SANCTIONS_HIT lei))))

  ;; =========================================================================
  ;; Helpers
  ;; =========================================================================
  (defun pos-key:string (lei:string instrument:string)
    (format "{}::{}" [lei instrument]))

  (defun product-class-of:string (instrument:string)
    (cond
      ((contains "PERP" instrument) "crypto-perp")
      ((contains "WTI"  instrument) "energy-fut")
      ((contains "BRENT" instrument) "energy-fut")
      ((contains "NG"   instrument) "energy-fut")
      ((contains "HO"   instrument) "energy-fut")
      "other"))

  (defun default-max-long:decimal (lei:string instrument:string)
    (with-read leis lei { "risk-tier" := tier }
      (cond
        ((= tier "tier-1") 100000.0)    ;; JPM-internal, ECM desk
        ((= tier "tier-2") 25000.0)     ;; investment-grade counterparty
        ((= tier "tier-3") 5000.0)      ;; smaller counterparty
        0.0)))

  (defun default-max-short:decimal (lei:string instrument:string)
    (default-max-long lei instrument))

  (defun default-max-notional:decimal (lei:string instrument:string)
    (with-read leis lei { "risk-tier" := tier }
      (cond
        ((= tier "tier-1") 500000000.0)  ;; $500M
        ((= tier "tier-2") 100000000.0)  ;; $100M
        ((= tier "tier-3") 25000000.0)   ;; $25M
        0.0)))

  (defun default-notional-limit:decimal (lei:string window:string)
    (with-read leis lei { "risk-tier" := tier }
      (let ((mult (cond ((= window "1d") 1.0)
                        ((= window "7d") 5.0)
                        ((= window "30d") 15.0)
                        1.0)))
        (* (default-max-notional lei "") mult))))

  (defun window-seconds:decimal (window:string)
    (cond ((= window "1d") 86400.0)
          ((= window "7d") 604800.0)
          ((= window "30d") 2592000.0)
          86400.0))

  ;; =========================================================================
  ;; Events (regulator read-node subscribes to these)
  ;; =========================================================================
  (defcap ENTITY_ONBOARDED   (lei:string name:string jurisdiction:string) @event true)
  (defcap ACCOUNT_FROZEN     (lei:string reason:string) @event true)
  (defcap ACCOUNT_UNFROZEN   (lei:string) @event true)
  (defcap SANCTIONS_HIT      (lei:string) @event true)
  (defcap SURVEILLANCE_FLAG  (lei:string kind:string severity:string) @event true)
  (defcap REG_REPORT_QUEUED  (rid:string juris:string kind:string lei:string) @event true)
)

(create-table leis)
(create-table position-limits)
(create-table notional-windows)
(create-table surveillance-flags)
(create-table reg-reports)
(create-table concentration)
