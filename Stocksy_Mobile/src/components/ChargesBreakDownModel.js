import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Typography, fontScale, moderateScale } from "../theme";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * ChargesBreakdownModal
 *
 * Bottom-sheet shown from BuyOrderScreen (and reusable from a future
 * SellOrderScreen) when the user taps "View charges breakdown".
 * Walks through every line item that makes up the estimated charges
 * for the order currently being built.
 *
 * As of the backend fee-calculation update, every line item shown
 * below is actually deducted from the wallet at fill time (see
 * services/orderService.js -> margin reservation, and
 * services/executionEngine.js -> settlement), computed via the
 * shared formula in utils/feeCalculator.js. This modal mirrors that
 * formula exactly so the pre-trade estimate always matches what
 * actually gets charged.
 *
 * Props:
 * @param {boolean}  visible
 * @param {function} onClose
 * @param {number}   orderValue    quantity * price (turnover for this order)
 * @param {"BUY"|"SELL"} side
 * @param {"CNC"|"MIS"} productType  CNC = Delivery, MIS = Intraday
 */

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) =>
  `₹${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function computeCharges(orderValue, side, productType) {
  const value = orderValue > 0 ? orderValue : 0;

  // Brokerage — mirrors services/orderService.js::calcBrokerage exactly,
  // including the ₹5 floor, verified against Groww's real behavior.
  // This is the only line item actually deducted from the wallet today.
  const brokerage = value > 0 ? Math.max(5, Math.min(20, value * 0.001)) : 0;

  // STT — Delivery: 0.1% both legs. Intraday: 0.025% on the sell leg only.
  const stt =
    productType === "CNC"
      ? value * 0.001
      : side === "SELL"
        ? value * 0.00025
        : 0;

  // Exchange transaction charges (NSE equity, approx.)
  const exchangeTxnCharge = value * 0.0000297;

  // SEBI turnover fee — ₹10 per crore
  const sebiCharge = value * 0.000001;

  // Stamp duty — buyer-side only, 0.015% (capped at ₹1,500/crore), same rate for delivery & intraday
  const stampDuty = side === "BUY" ? value * 0.00015 : 0;

  // GST — 18% on (brokerage + exchange transaction charges)
  const gst = (brokerage + exchangeTxnCharge) * 0.18;

  const total =
    brokerage + stt + exchangeTxnCharge + sebiCharge + stampDuty + gst;

  return {
    brokerage,
    stt,
    exchangeTxnCharge,
    sebiCharge,
    stampDuty,
    gst,
    total,
  };
}

export { computeCharges };

const ChargesBreakdownModal = ({
  visible,
  onClose,
  orderValue = 0,
  side = "BUY",
  productType = "CNC",
}) => {
  const insets = useSafeAreaInsets();
  const charges = useMemo(
    () => computeCharges(orderValue, side, productType),
    [orderValue, side, productType],
  );

  const tradeTypeLabel = productType === "MIS" ? "Intraday" : "Delivery";

  const rows = [
    {
      label: "Stocksy Brokerage",
      sub: "Lower of ₹20 or 0.1% of order value",
      value: charges.brokerage,
    },
    {
      label: "STT / CTT",
      sub:
        productType === "CNC"
          ? "0.1% on buy & sell (Delivery)"
          : side === "SELL"
            ? "0.025% on sell side (Intraday)"
            : "Not charged on intraday buy",
      value: charges.stt,
    },
    {
      label: "Exchange transaction charges",
      sub: "NSE — approx. 0.00297% of order value",
      value: charges.exchangeTxnCharge,
    },
    {
      label: "SEBI charges",
      sub: "₹10 per crore of order value",
      value: charges.sebiCharge,
    },
    {
      label: "Stamp duty",
      sub: side === "BUY" ? "0.015% on buy side" : "Not charged on sell side",
      value: charges.stampDuty,
    },
    {
      label: "GST",
      sub: "18% on (brokerage + transaction charges)",
      value: charges.gst,
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.sheet}>
              {/* Handle bar */}
              <View style={styles.handle} />

              {/* Header */}
              <View style={styles.header}>
                <View>
                  <Text style={styles.title}>Estimated Charges</Text>
                  <Text style={styles.subtitle}>
                    {tradeTypeLabel} · {side === "BUY" ? "Buy" : "Sell"} · on
                    order value of {fmt(orderValue)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons
                    name="close"
                    size={22}
                    color={Colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                style={styles.scroll}
                contentContainerStyle={{ paddingBottom: moderateScale(4) }}
              >
                {rows.map((row) => (
                  <View key={row.label} style={styles.row}>
                    <View style={{ flex: 1, paddingRight: moderateScale(10) }}>
                      <Text style={styles.rowLabel}>{row.label}</Text>
                      <Text style={styles.rowSub}>{row.sub}</Text>
                    </View>
                    <Text style={styles.rowValue}>{fmt(row.value)}</Text>
                  </View>
                ))}

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total estimated charges</Text>
                  <Text style={styles.totalValue}>{fmt(charges.total)}</Text>
                </View>

                <View style={styles.noteBox}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={Colors.textSecondary}
                    style={{ marginTop: 1 }}
                  />
                  <Text style={styles.noteText}>
                    In this demo, All of the above amount is deducted from your
                    wallet balance. This are shown as a realistic estimate of
                    what a live broker would additionally charge on this order.
                  </Text>
                </View>
              </ScrollView>

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={onClose}
                activeOpacity={0.85}
              >
                <Text style={styles.closeBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "80%",
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: moderateScale(24),
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: moderateScale(18),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: moderateScale(16),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  subtitle: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    marginTop: moderateScale(3),
  },
  scroll: {
    marginBottom: moderateScale(4),
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: moderateScale(10),
    borderBottomWidth: 1,
    borderBottomColor: Colors.divider,
  },
  rowLabel: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.text,
  },
  rowSub: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textMuted,
    marginTop: moderateScale(2),
  },
  rowValue: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.text,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: moderateScale(14),
    marginTop: moderateScale(4),
  },
  totalLabel: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
  },
  totalValue: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    color: Colors.primaryDark,
  },
  noteBox: {
    flexDirection: "row",
    gap: moderateScale(8),
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: moderateScale(12),
    marginTop: moderateScale(16),
  },
  noteText: {
    flex: 1,
    fontSize: fontScale(Typography.tiny),
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: moderateScale(15),
    alignItems: "center",
    marginTop: moderateScale(16),
  },
  closeBtnText: {
    color: Colors.white,
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
  },
});

export default ChargesBreakdownModal;