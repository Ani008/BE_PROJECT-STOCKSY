/**
 * src/hooks/usePortfolio.js
 *
 * Fetches portfolio summary + positions from the Node backend,
 * then merges with live LTP prices from the useMarketData WebSocket hook.
 * Live P&L recalculates every WebSocket tick (1 second) — no re-fetch needed.
 *
 * FIX: `rawPositions.length` inside refresh() was a stale closure because
 * refresh was memoized with [] deps. Now uses a ref to track whether we
 * already have data, so the loading spinner only shows on the very first load.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fetchPortfolio } from "../../services/orderService";

// ── Sector colour palette ─────────────────────────────────────────────────────
export const SECTOR_COLORS = {
  Banking: "#1A56DB",
  IT: "#7C3AED",
  Energy: "#F59E0B",
  Auto: "#EF4444",
  Pharma: "#10B981",
  FMCG: "#F97316",
  Metal: "#6B7280",
  Infra: "#0891B2",
  Telecom: "#EC4899",
  Index: "#94A3B8",
  // Was "#FFFFFF" — literally invisible against the white card/bar
  // background, which is why VDL (Vedanta, mapped below) showed no
  // color at all. Bronze/copper reads well for a mining sector and
  // doesn't collide with anything else in this palette.
  "Mining & Metals": "#B45309",
  // Was "#10B981" — identical to Pharma, so any portfolio holding both
  // sectors would render as one indistinguishable green blob in the bar.
  Defense: "#65A30D",
  // Was "#F59E0B" — identical to Energy, same collision issue.
  "Financial Services": "#4F46E5",
  // Was "#10B981" — identical to Pharma *and* the old Defense value.
  "Renewable Energy": "#0D9488",
  Other: "#A78BFA",

};

const INSTRUMENT_SECTOR = {
  "NSE_EQ|INE040A01034": "Banking",
  "NSE_EQ|INE090A01021": "Banking",
  "NSE_EQ|INE062A01020": "Banking",
  "NSE_EQ|INE238A01034": "Banking",
  "NSE_EQ|INE237A01036": "Banking",
  "NSE_EQ|INE296A01032": "Banking",
  "NSE_EQ|INE795G01014": "Banking",
  "NSE_EQ|INE918I01026": "Banking",
  "NSE_EQ|INE467B01029": "IT",
  "NSE_EQ|INE009A01021": "IT",
  "NSE_EQ|INE075A01022": "IT",
  "NSE_EQ|INE860A01027": "IT",
  "NSE_EQ|INE669C01036": "IT",
  "NSE_EQ|INE214T01019": "IT",
  "NSE_EQ|INE002A01018": "Energy",
  "NSE_EQ|INE213A01029": "Energy",
  "NSE_EQ|INE029A01011": "Energy",
  "NSE_EQ|INE752E01010": "Energy",
  "NSE_EQ|INE733E01010": "Energy",
  "NSE_EQ|INE364U01010": "Energy",
  "NSE_EQ|INE585B01010": "Auto",
  "NSE_EQ|INE1TAE01010": "Auto",
  "NSE_EQ|INE917I01010": "Auto",
  "NSE_EQ|INE066A01021": "Auto",
  "NSE_EQ|INE158A01026": "Auto",
  "NSE_EQ|INE030A01027": "FMCG",
  "NSE_EQ|INE154A01025": "FMCG",
  "NSE_EQ|INE239A01024": "FMCG",
  "NSE_EQ|INE016A01026": "FMCG",
  "NSE_EQ|INE216A01030": "FMCG",
  "NSE_EQ|INE044A01036": "Pharma",
  "NSE_EQ|INE089A01031": "Pharma",
  "NSE_EQ|INE059A01026": "Pharma",
  "NSE_EQ|INE361B01024": "Pharma",
  "NSE_EQ|INE081A01020": "Metal",
  "NSE_EQ|INE038A01020": "Metal",
  "NSE_EQ|INE019A01038": "Metal",
  "NSE_EQ|INE522F01014": "Metal",
  "NSE_EQ|INE397D01024": "Telecom",
  "NSE_EQ|INE742F01042": "Infrastructure",
  "NSE_EQ|INE481G01011": "Cement",
  "NSE_EQ|INE018A01030": "Infrastructure",
  "NSE_EQ|INE047A01021": "Chemicals",
  "NSE_EQ|INE423A01024": "Conglomerate",
  "NSE_EQ|INE1NPP01017": "Infrastructure",

  "NSE_EQ|INE205A01025": "Mining & Metals",
  "NSE_EQ|INE263A01024": "Defense",
  "NSE_EQ|INE053F01010": "Financial Services",
  "NSE_EQ|INE040H01021": "Renewable Energy",
};

export function getSector(k) {
  return INSTRUMENT_SECTOR[k] ?? "Other";
}

// ── Pure derivation helpers ───────────────────────────────────────────────────
// Extracted out of the hook body so the same math can be run twice — once for
// the combined book (back-compat for Dashboard etc.) and once each for the
// CNC-only ("Holdings") and MIS-only ("Positions"/intraday) slices that the
// Portfolio screen's Holdings/Positions toggle needs.

function summarizeTotals(positions, wallets = []) {
  const totalInvested = positions.reduce((a, p) => a + p.invested, 0);
  const totalCurrent = positions.reduce((a, p) => a + p.currentValue, 0);
  const totalUnrealised = positions.reduce((a, p) => a + p.unrealisedPnl, 0);
  const totalRealised = positions.reduce((a, p) => a + p.realisedPnl, 0);
  const totalToday = positions.reduce((a, p) => a + p.todayPnl, 0);
  const cashBalance = wallets.reduce((a, w) => a + parseFloat(w.balance), 0);
  const totalLifetime = totalUnrealised + totalRealised;
  return {
    totalInvested,
    totalCurrent,
    totalUnrealised,
    totalRealised,
    totalLifetime,
    totalToday,
    cashBalance,
    portfolioValue: totalCurrent,
    todayPct: totalInvested > 0 ? (totalToday / totalInvested) * 100 : 0,
    lifetimePct: totalInvested > 0 ? (totalLifetime / totalInvested) * 100 : 0,
    unrealisedPct: totalInvested > 0 ? (totalUnrealised / totalInvested) * 100 : 0,
    positionCount: positions.length,
  };
}

function summarizeSectorAllocation(positions) {
  const total = positions.reduce((a, p) => a + p.currentValue, 0);
  if (total === 0) return [];
  const map = {};
  for (const p of positions) {
    const s = p.sector ?? "Other";
    map[s] = (map[s] ?? 0) + p.currentValue;
  }
  return Object.entries(map)
    .map(([sector, value]) => ({
      sector,
      value,
      pct: parseFloat(((value / total) * 100).toFixed(1)),
      color: SECTOR_COLORS[sector] ?? SECTOR_COLORS.Other,
    }))
    .sort((a, b) => b.value - a.value);
}

function summarizeBestWorst(positions) {
  if (positions.length === 0) return {};
  const sorted = [...positions].sort(
    (a, b) => b.unrealisedPct - a.unrealisedPct,
  );
  return {
    bestPerformer: sorted[0],
    worstPerformer: sorted[sorted.length - 1],
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePortfolio(prices = {}) {
  const [rawPositions, setRawPositions] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const mountedRef = useRef(true);
  // Track whether we've received data at least once — avoids stale closure
  // inside refresh() which is memoized with [] deps.
  const hasDataRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    // Only show full-screen spinner on first load; subsequent refreshes are silent
    if (!hasDataRef.current) setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolio();
      if (!mountedRef.current) return;
      setRawPositions(data.positions ?? []);
      setWallets(data.wallets ?? []);
      hasDataRef.current = true;
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []); // intentionally [] — uses refs for mutable state

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Enrich positions with live WS prices every tick ──────────────────────
  const positions = useMemo(() => {
    return rawPositions
      .filter((p) => parseFloat(p.quantity) !== 0)
      .map((p) => {
        const qty = parseFloat(p.quantity);
        const isShort = qty < 0;
        const avgCost = parseFloat(p.avg_cost);
        // "invested" is a display magnitude (shares × avg price) — use
        // the absolute value so a short reads as a normal positive
        // rupee figure, same as any broker's positions screen.
        const invested = Math.abs(qty) * avgCost;
        const ws = prices[p.instrument_key];
        const ltp = ws?.ltp ? parseFloat(ws.ltp) : null;
        const prevClose = ws?.cp ? parseFloat(ws.cp) : null;
        const sector = ws?.sector ?? getSector(p.instrument_key);
        const symbol = ws?.symbol ?? p.symbol;
        const name = ws?.name ?? p.name ?? symbol;
        const currentValue = ltp ? ltp * Math.abs(qty) : invested;
        // qty carries the sign, so this naturally flips correctly for a
        // short: price falling below avgCost with qty < 0 → positive P&L.
        const unrealisedPnl = ltp ? (ltp - avgCost) * qty : 0;
        const unrealisedPct =
          invested > 0 ? (unrealisedPnl / invested) * 100 : 0;
        const todayPnl = ltp && prevClose ? (ltp - prevClose) * qty : 0;
        const todayPct =
          prevClose && prevClose > 0
            ? ((ltp - prevClose) / prevClose) * 100 * (isShort ? -1 : 1)
            : 0;
        return {
          ...p,
          qty,
          isShort,
          positionSide: isShort ? "SHORT" : "LONG",
          avgCost,
          invested,
          ltp,
          prevClose,
          currentValue,
          unrealisedPnl,
          unrealisedPct,
          todayPnl,
          todayPct,
          sector,
          symbol,
          name,
          realisedPnl: parseFloat(p.realised_pnl ?? 0),
        };
      });
  }, [rawPositions, prices]);

  // ── Aggregate totals (combined — CNC + MIS together) ──────────────────────
  // Kept as-is for existing consumers (DashboardPage's home summary shows the
  // whole book, delivery + intraday combined, same as Groww's home screen).
  const totals = useMemo(
    () => summarizeTotals(positions, wallets),
    [positions, wallets],
  );

  // ── Sector allocation (combined) ──────────────────────────────────────────
  const sectorAllocation = useMemo(
    () => summarizeSectorAllocation(positions),
    [positions],
  );

  // ── Best / Worst (combined) ────────────────────────────────────────────────
  const { bestPerformer, worstPerformer } = useMemo(
    () => summarizeBestWorst(positions),
    [positions],
  );

  // ── Holdings (CNC/delivery) vs Positions (MIS/intraday) split ─────────────
  // This is what backs the Portfolio screen's Holdings/Positions toggle.
  // product_type comes straight from the `positions` Postgres table via
  // GET /api/positions, so no extra API call is needed — just partition
  // the already-fetched + already-live-priced list.
  const holdingsPositions = useMemo(
    () => positions.filter((p) => p.product_type === "CNC"),
    [positions],
  );

  const intradayPositions = useMemo(
    () => positions.filter((p) => p.product_type === "MIS"),
    [positions],
  );

  // Cash balance is wallet-level, not position-level, so it's shared across
  // both tabs — only the position-derived numbers (invested/current/P&L)
  // actually differ between Holdings and Positions.
  const holdingsTotals = useMemo(
    () => summarizeTotals(holdingsPositions, wallets),
    [holdingsPositions, wallets],
  );

  const intradayTotals = useMemo(
    () => summarizeTotals(intradayPositions, wallets),
    [intradayPositions, wallets],
  );

  const holdingsSectorAllocation = useMemo(
    () => summarizeSectorAllocation(holdingsPositions),
    [holdingsPositions],
  );

  const { bestPerformer: holdingsBestPerformer, worstPerformer: holdingsWorstPerformer } =
    useMemo(() => summarizeBestWorst(holdingsPositions), [holdingsPositions]);

  return {
    // Combined (back-compat — Dashboard etc.)
    positions,
    totals,
    sectorAllocation,
    wallets,
    bestPerformer,
    worstPerformer,

    // Holdings (CNC / delivery) — Portfolio screen "Holdings" tab
    holdingsPositions,
    holdingsTotals,
    holdingsSectorAllocation,
    holdingsBestPerformer,
    holdingsWorstPerformer,

    // Positions (MIS / intraday) — Portfolio screen "Positions" tab
    intradayPositions,
    intradayTotals,

    loading,
    error,
    refresh,
  };
}