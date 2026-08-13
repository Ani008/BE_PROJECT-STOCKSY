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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
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
function PositionRow({ position, onPress, onSetStopLoss }) {
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
          {position.hasStopLoss && (
            // NOTE: hasStopLoss isn't populated yet — wire it up by passing
            // this component the open orders list (GET /api/orders?status=OPEN)
            // and matching on wallet_id + instrument_key + product_type +
            // order_type IN ('SL','SL_M'). Left as a no-op badge for now so
            // the UI is ready the moment that data is threaded through.
            <View style={[styles.tag, styles.slTag]}>
              <Text style={[styles.tagText, styles.slTagText]}>SL set</Text>
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
        <TouchableOpacity
          style={styles.slBtn}
          activeOpacity={0.7}
          onPress={(e) => {
            e.stopPropagation?.();
            onSetStopLoss?.(position);
          }}
        >
          <Ionicons name="shield-half-outline" size={12} color={L.blue} />
          <Text style={styles.slBtnText}>
            {position.hasStopLoss ? "Edit SL" : "Set SL"}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Set Stop Loss modal ────────────────────────────────────────────────────
// Places a resting SL_M (stop-loss market) order on the OPPOSITE side of the
// position, for the full open quantity — same order_type/side/product_type
// contract orderService.placeOrder already validates and links to this
// position (see migration 011). SL_M rather than SL: one fewer input to get
// wrong (no limit price), and it always fills once triggered instead of
// risking a missed fill in a fast-moving/gappy print.
function SetStopLossModal({ position, visible, onClose, onPlaced }) {
  const [trigger, setTrigger] = useState("");
  const [placing, setPlacing] = useState(false);

  if (!position) return null;

  const isShort = position.isShort ?? position.qty < 0;
  // Closing side is always the opposite of how the position is held.
  const closingSide = isShort ? "BUY" : "SELL";
  const ltp = position.ltp;

  const handleClose = () => {
    if (placing) return;
    setTrigger("");
    onClose?.();
  };

  const handleSubmit = async () => {
    const triggerNum = parseFloat(trigger);

    if (!triggerNum || triggerNum <= 0) {
      Alert.alert("Enter a trigger price", "Trigger price must be a positive number.");
      return;
    }

    // Mirror the backend's own directional check (services/orderService.js
    // validateTriggerDirection) here too, so the person gets an inline
    // error instead of a round-trip rejection.
    if (ltp != null) {
      if (closingSide === "SELL" && triggerNum >= ltp) {
        Alert.alert(
          "Invalid trigger price",
          `For a long position, the stop-loss trigger must be BELOW the current price (₹${fmt(ltp)}).`,
        );
        return;
      }
      if (closingSide === "BUY" && triggerNum <= ltp) {
        Alert.alert(
          "Invalid trigger price",
          `For a short position, the stop-loss trigger must be ABOVE the current price (₹${fmt(ltp)}).`,
        );
        return;
      }
    }

    setPlacing(true);
    try {
      await placeOrder({
        wallet_id: position.wallet_id,
        instrument_key: position.instrument_key,
        symbol: position.symbol,
        name: position.name,
        order_type: "SL_M",
        side: closingSide,
        quantity: Math.abs(position.qty),
        trigger_price: triggerNum,
        product_type: position.product_type,
        metadata: { reason: "MANUAL_STOP_LOSS" },
      });

      setTrigger("");
      onPlaced?.();
    } catch (err) {
      Alert.alert(
        "Couldn't place stop-loss",
        err?.response?.data?.message || err?.message || "Something went wrong.",
      );
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Set stop-loss · {position.symbol}</Text>
          <Text style={styles.modalSub}>
            {closingSide === "SELL"
              ? `Auto-sell ${Math.abs(position.qty)} qty if price falls to your trigger.`
              : `Auto-buy to cover ${Math.abs(position.qty)} qty if price rises to your trigger.`}
          </Text>

          <View style={styles.modalLtpRow}>
            <Text style={styles.modalLtpLabel}>Current price</Text>
            <Text style={styles.modalLtpValue}>{ltp != null ? fmt(ltp) : "—"}</Text>
          </View>

          <Text style={styles.inputLabel}>TRIGGER PRICE (₹)</Text>
          <TextInput
            style={styles.modalInput}
            value={trigger}
            onChangeText={setTrigger}
            placeholder={closingSide === "SELL" ? "e.g. below current price" : "e.g. above current price"}
            placeholderTextColor={L.textTer}
            keyboardType="decimal-pad"
            editable={!placing}
          />

          <View style={styles.modalBtnRow}>
            <TouchableOpacity style={styles.modalCancelBtn} onPress={handleClose} disabled={placing}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalSubmitBtn, placing && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={placing}
            >
              {placing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.modalSubmitText}>Place stop-loss</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  const [slPosition, setSlPosition] = useState(null); // position currently in the "Set SL" modal
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
                onSetStopLoss={setSlPosition}
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

      <SetStopLossModal
        position={slPosition}
        visible={!!slPosition}
        onClose={() => setSlPosition(null)}
        onPlaced={() => {
          const symbol = slPosition?.symbol;
          setSlPosition(null);
          onExited?.(); // reuse the same "refresh portfolio" callback the parent already wires up
          Alert.alert(
            "Stop-loss placed",
            `We'll watch ${symbol} and auto-close this position if it hits your trigger price.`,
          );
        }}
      />
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
  slTag: {
    backgroundColor: L.greenTint,
  },
  slTagText: {
    color: L.green,
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
    marginBottom: 6,
  },
  slBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: L.blue,
  },
  slBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: L.blue,
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

  // ── Set Stop Loss modal ──────────────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: L.card,
    borderRadius: 18,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: L.textPri,
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    color: L.textSec,
    lineHeight: 17,
    marginBottom: 14,
  },
  modalLtpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: L.bg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  modalLtpLabel: {
    fontSize: 12,
    color: L.textSec,
  },
  modalLtpValue: {
    fontSize: 14,
    fontWeight: "700",
    color: L.textPri,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: L.textTer,
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: L.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: L.textPri,
    marginBottom: 18,
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: L.border,
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: "600",
    color: L.textSec,
  },
  modalSubmitBtn: {
    flex: 1.4,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: L.blue,
  },
  modalSubmitText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
});