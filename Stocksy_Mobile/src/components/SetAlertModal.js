import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Input from "./Input";
import alertService from "../../services/alertService";
import { fetchWallets } from "../../services/walletService";
import { showToast } from "../../services/uiBridge";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const formatPrice = (ltp) =>
  ltp != null ? `₹${Number(ltp).toLocaleString("en-IN")}` : "—";

const WALLET_COLORS = [Colors.primary, Colors.gain, Colors.warning, "#A855F7", Colors.danger];

const ACTIONS = [
  { key: "NOTIFY", label: "Just Notify" },
  { key: "BUY", label: "Buy" },
  { key: "SELL", label: "Sell" },
];

/**
 * SetAlertModal
 *
 * Two things live here now:
 *   - NOTIFY — the original notify-only alert. One number, direction
 *     inferred server-side, done.
 *   - BUY / SELL (GTT) — auto-places a real CNC order once triggered.
 *     Needs a quantity and which wallet to execute against, same inputs
 *     a manual order needs. CNC-only, same reasoning real brokers use:
 *     a GTT can sit un-triggered for days/weeks, which doesn't fit MIS's
 *     same-day square-off rule — so Intraday isn't offered here at all.
 *
 * Props:
 * @param {boolean}  visible
 * @param {function} onClose
 * @param {string}   instrumentKey
 * @param {string}   symbol
 * @param {string}   name
 * @param {number}   ltp — current live price, shown for reference
 */
const SetAlertModal = ({ visible, onClose, instrumentKey, symbol, name, ltp }) => {
  const [action, setAction] = useState("NOTIFY");
  const [targetPrice, setTargetPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [wallets, setWallets] = useState([]);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [selectedWalletId, setSelectedWalletId] = useState(null);

  const isGtt = action === "BUY" || action === "SELL";

  useEffect(() => {
    if (!visible || !isGtt || wallets.length > 0) return;

    const loadWallets = async () => {
      setWalletsLoading(true);
      try {
        const data = await fetchWallets();
        const list = data.wallets || [];
        setWallets(list);
        if (list.length > 0) setSelectedWalletId((prev) => prev || list[0].id);
      } catch (err) {
        // Global toast already covers this.
      } finally {
        setWalletsLoading(false);
      }
    };

    loadWallets();
  }, [visible, isGtt]);

  const resetAndClose = () => {
    setAction("NOTIFY");
    setTargetPrice("");
    setQuantity("");
    onClose();
  };

  const handleCreate = async () => {
    const price = Number(targetPrice);

    if (!targetPrice || !(price > 0)) {
      showToast("Enter a valid target price", "error");
      return;
    }

    let qty = null;
    if (isGtt) {
      qty = Number(quantity);
      if (!quantity || !(qty > 0)) {
        showToast("Enter a valid quantity", "error");
        return;
      }
      if (!selectedWalletId) {
        showToast("Select a wallet", "error");
        return;
      }
    }

    setSubmitting(true);
    try {
      await alertService.createAlert({
        instrumentKey,
        symbol,
        name,
        targetPrice: price,
        action,
        quantity: qty,
        walletId: isGtt ? selectedWalletId : undefined,
      });

      showToast(
        isGtt
          ? `${action === "BUY" ? "Buy" : "Sell"} GTT set for ${symbol} at ${formatPrice(price)}`
          : `Alert set for ${symbol} at ${formatPrice(price)}`,
        "success",
      );
      resetAndClose();
    } catch (err) {
      // Validation/server errors already surface via the global toast
      // interceptor in services/api.js — nothing extra to do here.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={resetAndClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.iconWrap}>
              <Ionicons name="notifications-outline" size={26} color={Colors.primary} />
            </View>

            <Text style={styles.title}>Set Price Alert</Text>
            <Text style={styles.subtitle}>
              {symbol} · Current price {formatPrice(ltp)}
            </Text>

            {/* ── Action selector ─────────────────────────────────────────── */}
            <Text style={styles.label}>Action</Text>
            <View style={styles.actionRow}>
              {ACTIONS.map((a) => {
                const isSelected = action === a.key;
                return (
                  <TouchableOpacity
                    key={a.key}
                    style={[styles.actionChip, isSelected && styles.actionChipSelected]}
                    onPress={() => setAction(a.key)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.actionChipText, isSelected && styles.actionChipTextSelected]}>
                      {a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Input
              label={isGtt ? "Trigger price" : "Notify me when price reaches"}
              value={targetPrice}
              onChangeText={setTargetPrice}
              placeholder="e.g. 2450"
              keyboardType="decimal-pad"
            />

            {isGtt && (
              <>
                <Input
                  label="Quantity"
                  value={quantity}
                  onChangeText={setQuantity}
                  placeholder="e.g. 5"
                  keyboardType="number-pad"
                />

                <Text style={styles.label}>Wallet</Text>
                {walletsLoading ? (
                  <ActivityIndicator color={Colors.primary} style={{ marginVertical: moderateScale(12) }} />
                ) : wallets.length === 0 ? (
                  <Text style={styles.hint}>
                    You don't have a wallet yet — create one from the Buy screen first.
                  </Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: moderateScale(10) }}>
                    {wallets.map((w, i) => {
                      const isSelected = w.id === selectedWalletId;
                      const wColor = WALLET_COLORS[i % WALLET_COLORS.length];
                      return (
                        <TouchableOpacity
                          key={w.id}
                          style={[
                            styles.walletChip,
                            isSelected && { borderColor: wColor, backgroundColor: wColor + "15" },
                          ]}
                          onPress={() => setSelectedWalletId(w.id)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="wallet-outline" size={13} color={wColor} />
                          <Text style={[styles.walletChipText, isSelected && { color: wColor }]} numberOfLines={1}>
                            {w.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}

                <Text style={styles.hint}>
                  This places a real Delivery (CNC) order automatically when triggered GTT
                  isn't available for Intraday, since a trigger can sit for days and Intraday
                  positions must close the same day. If it can't execute (insufficient
                  funds/holdings), we'll email you instead of placing a partial order.
                </Text>
              </>
            )}

            {!isGtt && (
              <Text style={styles.hint}>
                We'll email you the moment {symbol} hits this price. This only sends a
                notification it won't place an order for you.
              </Text>
            )}

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.cancelButton} onPress={resetAndClose} disabled={submitting}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createButton, submitting && styles.createButtonDisabled]}
                onPress={handleCreate}
                disabled={submitting}
                activeOpacity={0.85}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.white} size="small" />
                ) : (
                  <Text style={styles.createButtonText}>
                    {isGtt ? `Create ${action === "BUY" ? "Buy" : "Sell"} GTT` : "Create Alert"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(24),
  },
  card: {
    width: "100%",
    maxWidth: 400,
    maxHeight: "85%",
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: moderateScale(24),
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(37,99,235,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(14),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(4),
  },
  subtitle: {
    fontSize: fontScale(13),
    color: Colors.textSecondary,
    marginBottom: moderateScale(18),
  },
  label: {
    fontSize: fontScale(12.5),
    fontWeight: "700",
    color: Colors.textSecondary,
    marginBottom: moderateScale(8),
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  actionRow: {
    flexDirection: "row",
    gap: moderateScale(8),
    marginBottom: moderateScale(16),
  },
  actionChip: {
    flex: 1,
    paddingVertical: moderateScale(10),
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: "center",
  },
  actionChipSelected: {
    borderColor: Colors.primary,
    backgroundColor: "rgba(37,99,235,0.08)",
  },
  actionChipText: {
    fontSize: fontScale(13),
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  actionChipTextSelected: {
    color: Colors.primaryDark,
  },
  walletChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(9),
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginRight: moderateScale(8),
  },
  walletChipText: {
    fontSize: fontScale(12.5),
    fontWeight: "600",
    color: Colors.textSecondary,
    maxWidth: moderateScale(90),
  },
  hint: {
    fontSize: fontScale(12.5),
    color: Colors.textMuted,
    lineHeight: 18,
    marginTop: moderateScale(6),
    marginBottom: moderateScale(4),
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: moderateScale(16),
  },
  cancelButton: {
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(16),
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: fontScale(14),
    fontWeight: "600",
  },
  createButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(22),
    alignItems: "center",
    justifyContent: "center",
    minWidth: 150,
  },
  createButtonDisabled: {
    opacity: 0.7,
  },
  createButtonText: {
    color: Colors.white,
    fontSize: fontScale(14),
    fontWeight: "700",
  },
});

export default SetAlertModal;