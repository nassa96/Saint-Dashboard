/* ============================================================
   ORDER FLOW IMBALANCE (OFI)
   ------------------------------------------------------------
   Classic microstructure signal (Cont, Kukanov & Stoikov, 2014):
   measures net aggressive buying vs. selling pressure implied by HOW
   the order book itself changes between two snapshots — not lagging
   price action, but the standing liquidity that price is about to
   react to.

   Level-1 rule, applied to the best bid/ask between snapshot t-1 and t:
     bid side: if bidPx rose    -> contributes +newBidSize (fresh demand at a better price)
               if bidPx fell    -> contributes -oldBidSize (demand pulled away)
               if bidPx same    -> contributes (newBidSize - oldBidSize)
     ask side: mirrored sign (rising ask price / pulled liquidity -> positive;
               ask size growing at the same price -> negative, i.e. more
               supply stacked = bearish for OFI)
     OFI = bidContribution - askContribution

   This module extends the rule to the top N levels (rank-aligned between
   snapshots) to approximate the spec's "multi-level OFI tensor."

   HONEST SCOPE NOTE: the real, continuous version of this needs every
   order-book delta event from a WebSocket feed, processed in real time.
   This app polls a REST L2 snapshot on a slow cadence (see
   MarketData.refreshOrderBooks()) — so what's computed here is OFI
   between two widely-spaced snapshots (seconds to a minute apart), not a
   continuous microsecond-resolution tensor. It is still real order-book
   data and a real, useful imbalance measure — just discretized far more
   coarsely than genuine L2 WebSocket infrastructure would give you. That
   infrastructure isn't built in this app (see docs/strategies/OFI_KALMAN.md).
   ============================================================ */

/** Level-aligned OFI contribution between two rank-matched book levels. */
function levelContribution(oldLevel, newLevel) {
  if (!oldLevel || !newLevel) return 0;
  const [oldPx, oldSize] = oldLevel;
  const [newPx, newSize] = newLevel;
  if (newPx > oldPx) return newSize; // price improved -> fresh size counts fully
  if (newPx < oldPx) return -oldSize; // price receded -> prior size pulled away
  return newSize - oldSize; // same price -> net change in resting size
}

/**
 * Compute multi-level OFI from two consecutive order-book snapshots.
 * @param {{bids:number[][], asks:number[][]}} prevSnap
 * @param {{bids:number[][], asks:number[][]}} nextSnap
 * @param {number} levels how many top levels per side to include
 */
function computeOFI(prevSnap, nextSnap, levels = 10) {
  if (!prevSnap || !nextSnap) return null;
  let bidOFI = 0;
  let askOFI = 0;
  const n = Math.min(levels, prevSnap.bids.length, nextSnap.bids.length, prevSnap.asks.length, nextSnap.asks.length);
  for (let i = 0; i < n; i++) {
    bidOFI += levelContribution(prevSnap.bids[i], nextSnap.bids[i]);
    askOFI += levelContribution(prevSnap.asks[i], nextSnap.asks[i]);
  }
  const ofi = bidOFI - askOFI;

  // Normalize by total resting size in the window so OFI is comparable
  // across symbols/venues with very different absolute liquidity.
  const totalDepth = nextSnap.bids.slice(0, n).reduce((a, b) => a + b[1], 0) + nextSnap.asks.slice(0, n).reduce((a, b) => a + b[1], 0);
  const normalizedOFI = totalDepth > 0 ? ofi / totalDepth : 0;

  return {
    levels: n,
    bidOFI: Number(bidOFI.toFixed(6)),
    askOFI: Number(askOFI.toFixed(6)),
    ofi: Number(ofi.toFixed(6)),
    normalizedOFI: Number(normalizedOFI.toFixed(6)), // roughly in [-1, 1] for typical books
    windowMs: nextSnap.ts - prevSnap.ts,
    bias: normalizedOFI > 0 ? "BUY_PRESSURE" : normalizedOFI < 0 ? "SELL_PRESSURE" : "NEUTRAL",
  };
}

/** Convenience: compute OFI directly from a MarketData instance's last 2
 *  snapshots for a symbol (see MarketData.refreshOrderBooks/getOrderBookSnapshots). */
function ofiFromMarket(market, symbol, levels = 10) {
  const snaps = market.getOrderBookSnapshots(symbol);
  if (snaps.length < 2) return null;
  return computeOFI(snaps[0], snaps[1], levels);
}

module.exports = { computeOFI, ofiFromMarket, levelContribution };
