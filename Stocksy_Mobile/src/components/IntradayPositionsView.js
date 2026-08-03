import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { placeOrder } from "../../services/orderService";

// ─── Theme tokens — matches PortfolioPage.js's `C` palette so this view sits
// naturally alongside the rest of the (light) app instead of standing out as
// a separate dark screen. Kept as its own const (not imported) so this
// component stays a self-contained, drop-in-anywhere piece — if you ever
// centralise these into src/theme, swap this block for that import.
const L = {
  blue: "#1A56DB",
  blueTint: "rgba(26,86,219,0.08)",
  green: "#059669",
  greenTint: "rgba(5,150,105,0.08)",
  red: "#DC2626",
  redTint: "rgba(220,38,38,0.08)",
  bg: "#F0F4FF",
  card: "#FFFFFF",
  border: "#E2E8F0",
  textPri: "#0F172A",
  textSec: "#64748B",
  textTer: "#94A3B8",
};

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return "—";
  return (
    "₹" +
    Math.abs(n).toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

// ─── Reusable: PositionRow ────────────────────────────────────────────────────
function PositionRow({ position, onPress }) {
  const isPos = position.unrealisedPnl >= 0;
  const isShort = position.isShort ?? position.qty < 0;
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.75}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.tagRow}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>Intraday</Text>
          </View>
          {isShort && (
            <View style={[styles.tag, styles.shortTag]}>
              <Text style={[styles.tagText, styles.shortTagText]}>Short</Text>
            </View>
          )}
        </View>
        <Text style={styles.symbol}>{position.symbol}</Text>
        <Text style={styles.avg}>
          Avg {fmt(position.avgCost)} · Qty {Math.abs(position.qty)}
        </Text>
      </View>

      <View style={styles.rightCol}>
        <Text style={[styles.pnl, { color: isPos ? L.green : L.red }]}>
          {isPos ? "+" : "-"}
          {fmt(position.unrealisedPnl)}
        </Text>
        <Text style={styles.mkt}>
          Mkt {position.ltp != null ? fmt(position.ltp) : "—"}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
/**
 * IntradayPositionsView — the "Positions" tab on the Portfolio screen.
 * Same light theme as the rest of the app (see `L` above, mirrors
 * PortfolioPage.js's `C` tokens).
 *
 * Props:
 *   positions    Array — MIS/intraday positions, already enriched with live
 *                LTP + P&L by usePortfolio() (intradayPositions).
 *   totals       Object — intradayTotals from usePortfolio() (uses
 *                totalUnrealised as "Total Returns" — the day's live P&L on
 *                open intraday positions).
 *   refreshing   boolean — pull-to-refresh spinner state
 *   onRefresh    () => Promise<void> | void
 *   onExited     () => void — called after Exit All completes, so the caller
 *                can refresh() the portfolio.
 *   onPressPosition (position) => void — row tap, e.g. navigate to StockDetail
 */
export default function IntradayPositionsView({
  positions = [],
  totals,
  refreshing = false,
  onRefresh,
  onExited,
  onPressPosition,
}) {
  const [exiting, setExiting] = useState(false);
  const hasPositions = positions.length > 0;
  const totalReturns = totals?.totalUnrealised ?? 0;
  const isPos = totalReturns >= 0;

  const handleExitAll = () => {
    if (!hasPositions || exiting) return;

    Alert.alert(
      "Exit all intraday positions?",
      `This will place a MARKET order (SELL for longs, BUY for shorts) to close all ${positions.length} open intraday position${
        positions.length !== 1 ? "s" : ""
      } at the current price.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Exit all",
          style: "destructive",
          onPress: runExitAll,
        },
      ],
    );
  };

  const runExitAll = async () => {
    setExiting(true);
    const results = await Promise.allSettled(
      positions.map((pos) => {
        const isShort = (pos.isShort ?? pos.qty < 0);
        return placeOrder({
          wallet_id: pos.wallet_id,
          instrument_key: pos.instrument_key,
          symbol: pos.symbol,
          name: pos.name,
          order_type: "MARKET",
          // Shorts are closed by buying back, not selling again.
          side: isShort ? "BUY" : "SELL",
          quantity: Math.abs(pos.qty),
          product_type: "MIS",
          metadata: { reason: "MANUAL_EXIT_ALL" },
        });
      }),
    );

    const failed = results.filter((r) => r.status === "rejected");
    setExiting(false);
    onExited?.();

    if (failed.length > 0) {
      Alert.alert(
        "Some exits failed",
        `${results.length - failed.length} of ${results.length} positions were closed. ${
          failed.length
        } failed — check Orders for details.`,
      );
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={L.blue}
              colors={[L.blue]}
            />
          ) : undefined
        }
      >
        {/* ── Section header ── */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            Intraday positions ({positions.length})
          </Text>
        </View>

        {/* ── Total returns card ── */}
        <View style={styles.totalsCard}>
          <View>
            <Text style={styles.totalsLabel}>TOTAL RETURNS</Text>
            <Text
              style={[
                styles.totalsValue,
                { color: hasPositions ? (isPos ? L.green : L.red) : L.textSec },
              ]}
            >
              {hasPositions ? `${isPos ? "+" : "-"}${fmt(totalReturns)}` : "₹0.00"}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.exitBtn, !hasPositions && { opacity: 0.4 }]}
            onPress={handleExitAll}
            disabled={!hasPositions || exiting}
            activeOpacity={0.8}
          >
            {exiting ? (
              <ActivityIndicator size="small" color={L.red} />
            ) : (
              <>
                <Ionicons
                  name="exit-outline"
                  size={16}
                  color={L.red}
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.exitBtnText}>Exit all</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── List ── */}
        {hasPositions ? (
          <View style={styles.listCard}>
            <Text style={styles.openLabel}>{positions.length} OPEN</Text>
            {positions.map((pos) => (
              <PositionRow
                key={`${pos.wallet_id}:${pos.instrument_key}:${pos.product_type}`}
                position={pos}
                onPress={() => onPressPosition?.(pos)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyWrap}>
            <Ionicons name="flash-outline" size={36} color={L.textTer} />
            <Text style={styles.emptyTitle}>No intraday positions</Text>
            <Text style={styles.emptySub}>
              MIS orders you place today will show up here, and get
              auto-squared-off before market close.
            </Text>
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: L.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: L.textPri,
  },

  totalsCard: {
    backgroundColor: L.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: L.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalsLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: L.textSec,
    marginBottom: 6,
  },
  totalsValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  exitBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: L.redTint,
    minWidth: 84,
    justifyContent: "center",
  },
  exitBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: L.red,
  },

  listCard: {
    backgroundColor: L.card,
    borderRadius: 16,
    borderWidth: 0.5,
    borderColor: L.border,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  openLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: L.textTer,
    letterSpacing: 0.5,
    marginBottom: 6,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderTopWidth: 0.5,
    borderTopColor: L.border,
  },
  tagRow: { flexDirection: "row", marginBottom: 4, gap: 6 },
  tag: {
    backgroundColor: L.blueTint,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  tagText: {
    fontSize: 10,
    fontWeight: "600",
    color: L.blue,
  },
  shortTag: {
    backgroundColor: L.redTint,
  },
  shortTagText: {
    color: L.red,
  },
  symbol: {
    fontSize: 15,
    fontWeight: "700",
    color: L.textPri,
    marginBottom: 2,
  },
  avg: {
    fontSize: 12,
    color: L.textSec,
  },
  rightCol: {
    alignItems: "flex-end",
  },
  pnl: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  mkt: {
    fontSize: 12,
    color: L.textSec,
  },

  emptyWrap: {
    alignItems: "center",
    paddingVertical: 48,
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: L.textPri,
  },
  emptySub: {
    fontSize: 12,
    color: L.textSec,
    textAlign: "center",
    lineHeight: 17,
  },
});