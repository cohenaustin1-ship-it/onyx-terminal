;; ============================================================================
;; JPM Onyx Order Book — Pact module deployed on JPM's permissioned Chainweb
;; One module instance per instrument chain (CH-3: BTC, CH-4: ETH, CH-10: WTI, ...)
;; ============================================================================
;;
;; Flow:
;;   1. Pre-trade compliance checked off-chain (KYC, limits, margin)
;;   2. Sequencer submits batched orders to this module each BFT slot (~4ms)
;;   3. place-order runs the matching engine against the resting book
;;   4. Fills emit settlement events consumed by the JPM Coin bridge (T+0 cash)
;;   5. Cross-chain margin via Kadena SPV proofs (clearinghouse on CH-0)

(namespace 'jpm-onyx)

(module order-book GOVERNANCE

  (defcap GOVERNANCE ()
    "Module governance — JPM ECM desk admin keyset + 3 compliance signers"
    (enforce-keyset 'jpm-onyx-admin))

  ;; -------------------------------------------------------------------------
  ;; Schemas
  ;; -------------------------------------------------------------------------
  (defschema order
    order-id    : string
    trader-lei  : string           ;; Legal Entity Identifier (ISO 17442)
    account     : string           ;; internal JPM desk/book
    instrument  : string           ;; e.g. "BTC-PERP", "WTI-F26"
    side        : string           ;; "buy" | "sell"
    type        : string           ;; "limit" | "market" | "stop" | "stop-limit"
    price       : decimal
    stop-price  : decimal
    size        : decimal
    filled      : decimal
    leverage    : integer
    tif         : string           ;; "GTC" | "IOC" | "FOK"
    reduce-only : bool
    post-only   : bool
    status      : string           ;; "resting" | "partial" | "filled" | "cancelled"
    seq         : integer          ;; sequencer global ordering
    submitted   : time
    finalized   : time)

  (defschema fill
    fill-id      : string
    buy-order    : string
    sell-order   : string
    price        : decimal
    size         : decimal
    taker-side   : string
    fee-taker    : decimal
    fee-maker    : decimal
    buy-lei      : string
    sell-lei     : string
    timestamp    : time
    settled      : bool)

  (deftable orders:{order})
  (deftable fills:{fill})

  ;; -------------------------------------------------------------------------
  ;; Capabilities
  ;; -------------------------------------------------------------------------
  (defcap PLACE_ORDER (account:string lei:string)
    @doc "Trader must hold the account keyset AND LEI must be on compliance whitelist"
    (enforce-keyset (read-keyset account))
    (compliance.require-whitelisted lei))

  (defcap CANCEL_ORDER (order-id:string)
    (with-read orders order-id { "account" := acct }
      (enforce-keyset (read-keyset acct))))

  (defcap MATCH () true)  ;; internal, raised by place-order
  (defcap SETTLE () true) ;; internal, triggers Onyx cash leg

  ;; -------------------------------------------------------------------------
  ;; Place an order — called by the sequencer each batch
  ;; -------------------------------------------------------------------------
  (defun place-order:string
    ( order-id:string
      trader-lei:string
      account:string
      instrument:string
      side:string
      type:string
      price:decimal
      stop-price:decimal
      size:decimal
      leverage:integer
      tif:string
      reduce-only:bool
      post-only:bool
      seq:integer )

    (with-capability (PLACE_ORDER account trader-lei)

      ;; 1. Risk check via cross-chain SPV to clearinghouse on CH-0
      (clearinghouse.check-margin account instrument side size price leverage)

      ;; 2. Insert as resting order
      (insert orders order-id {
        "order-id"    : order-id,
        "trader-lei"  : trader-lei,
        "account"     : account,
        "instrument"  : instrument,
        "side"        : side,
        "type"        : type,
        "price"       : price,
        "stop-price"  : stop-price,
        "size"        : size,
        "filled"      : 0.0,
        "leverage"    : leverage,
        "tif"         : tif,
        "reduce-only" : reduce-only,
        "post-only"   : post-only,
        "status"      : "resting",
        "seq"         : seq,
        "submitted"   : (at 'block-time (chain-data)),
        "finalized"   : (time "1970-01-01T00:00:00Z")
      })

      ;; 3. Run the matching engine
      (with-capability (MATCH)
        (match-against-book order-id instrument side price size post-only))

      ;; 4. Handle IOC / FOK time-in-force
      (if (= tif "IOC") (cancel-remaining order-id) "")
      (if (= tif "FOK") (enforce-full-fill order-id size) "")

      ;; 5. Emit event for regulators / surveillance pipeline
      (emit-event (ORDER_PLACED order-id trader-lei instrument side size price))

      (format "Order {} placed on chain {}" [order-id (at 'chain-id (chain-data))])))

  ;; -------------------------------------------------------------------------
  ;; Price-time priority matching engine
  ;; -------------------------------------------------------------------------
  (defun match-against-book:string
    (order-id:string instrument:string side:string limit-price:decimal
     size:decimal post-only:bool)

    (require-capability (MATCH))
    (if post-only "post-only skipped matching"
      (let* ((opposite   (if (= side "buy") "sell" "buy"))
             (candidates (select orders
               (and? (where 'instrument (= instrument))
                     (and? (where 'side (= opposite))
                           (and? (where 'status (!= "cancelled"))
                                 (where 'status (!= "filled"))))))))
        (fold (try-fill order-id limit-price side) size candidates)
        "matched")))

  (defun try-fill:decimal
    (taker-id:string limit:decimal taker-side:string remaining:decimal maker:object)
    (if (<= remaining 0.0) 0.0
      (let* ((maker-id    (at 'order-id maker))
             (maker-price (at 'price    maker))
             (crosses (if (= taker-side "buy")
                          (<= maker-price limit)
                          (>= maker-price limit))))
        (if (not crosses) remaining
          (let* ((maker-open (- (at 'size maker) (at 'filled maker)))
                 (qty        (if (< remaining maker-open) remaining maker-open))
                 (fee-taker  (* qty maker-price 0.00025))  ;; 2.5bps
                 (fee-maker  (* qty maker-price 0.00010))) ;; 1.0bps (rebate)
            (write-fill taker-id maker-id maker-price qty taker-side fee-taker fee-maker)
            (update-filled taker-id qty)
            (update-filled maker-id qty)
            (with-capability (SETTLE)
              (settlement.queue-cash-leg taker-id maker-id (* qty maker-price)))
            (- remaining qty))))))

  ;; -------------------------------------------------------------------------
  ;; Helpers
  ;; -------------------------------------------------------------------------
  (defun write-fill
    (taker:string maker:string price:decimal qty:decimal taker-side:string
     fee-t:decimal fee-m:decimal)
    (let ((buy  (if (= taker-side "buy")  taker maker))
          (sell (if (= taker-side "buy")  maker taker))
          (fid  (format "{}-{}-{}" [taker maker (at 'block-height (chain-data))])))
      (insert fills fid {
        "fill-id"    : fid,
        "buy-order"  : buy,
        "sell-order" : sell,
        "price"      : price,
        "size"       : qty,
        "taker-side" : taker-side,
        "fee-taker"  : fee-t,
        "fee-maker"  : fee-m,
        "buy-lei"    : (at 'trader-lei (read orders buy)),
        "sell-lei"   : (at 'trader-lei (read orders sell)),
        "timestamp"  : (at 'block-time (chain-data)),
        "settled"    : false
      })))

  (defun update-filled (oid:string qty:decimal)
    (with-read orders oid { "filled" := f, "size" := s }
      (let ((new-filled (+ f qty)))
        (update orders oid {
          "filled" : new-filled,
          "status" : (if (>= new-filled s) "filled" "partial")
        }))))

  (defun cancel-order (order-id:string)
    (with-capability (CANCEL_ORDER order-id)
      (update orders order-id { "status": "cancelled" })))

  (defun cancel-remaining (order-id:string)
    (with-read orders order-id { "filled" := f, "size" := s }
      (if (< f s) (update orders order-id { "status": "cancelled" }) "")))

  (defun enforce-full-fill (order-id:string size:decimal)
    (with-read orders order-id { "filled" := f }
      (enforce (>= f size) "FOK: full fill required")))

  ;; -------------------------------------------------------------------------
  ;; Events (regulators subscribe to these via read-only validator node)
  ;; -------------------------------------------------------------------------
  (defcap ORDER_PLACED (oid:string lei:string inst:string side:string sz:decimal px:decimal)
    @event true)

  (defcap TRADE_EXECUTED (fid:string buy-lei:string sell-lei:string inst:string px:decimal sz:decimal)
    @event true)
)

(create-table orders)
(create-table fills)
