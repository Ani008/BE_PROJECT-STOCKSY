import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import CreateWalletModal from "../components/CreateWalletModal";
import MarketClosedModal from "../components/MarketClosedModal";
import ChargesBreakdownModal from "../components/ChargesBreakDownModel";
import SlideToConfirmButton from "../components/SlideToConfirmButton";
import { walletService } from "../../services/walletService";
import { fetchWallets, createWallet } from "../../services/walletService";
import { placeOrder } from "../../services/orderService";
import { showToast } from "../../services/uiBridge";
import { fetchLeverage } from "../../services/leverageService";
import { fetchMarketStatus } from "../../services/marketService";
import useMarketData from "../hooks/useMarketData";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * BuyOrderScreen
 *
 * Props (via navigation params):
 *   instrumentKey  string  e.g. "NSE_EQ|INE002A01018"
 *   symbol         string  e.g. "RELIANCE"
 *   name           string  e.g. "Reliance Industries Ltd"
 *   sector         string  e.g. "Energy"
 *   orderType      string  "BUY" | "SELL"  — defaults to "BUY"
 */

export default function BuyOrderScreen({ navigation, route }) {
  const {
    instrumentKey,
    symbol = "STOCK",
    name = "Stock Name",
    sector = "Equity",
    orderType: initialOrderType = "BUY",
  } = route.params || {};

  // Height of the Android gesture/button nav bar (0 on iOS — handled by the
  // fixed 30px baked into ctaContainer's paddingBottom instead) so the fixed
  // Buy/Sell CTA footer never sits underneath the system nav bar.
  const insets = useSafeAreaInsets();

  // ─── Order state ────────────────────────────────────────────────────────────
  const [orderType, setOrderType] = useState(initialOrderType); // BUY | SELL
  const [tradeType, setTradeType] = useState("Intraday"); // Intraday | Delivery
  const [qty, setQty] = useState("");
  const [priceLimit, setPriceLimit] = useState("");
  const [orderMode, setOrderMode] = useState("Market"); // Market | Limit

  // ─── Wallet state ────────────────────────────────────────────────────────────
  const [wallets, setWallets] = useState([]);
  const [demoBalance, setDemoBalance] = useState(0);
  const [selectedWalletId, setSelectedWalletId] = useState(null);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);

  // ─── Market status ───────────────────────────────────────────────────────────
  // Optimistic isOpen:true until the first fetch resolves, so the screen
  // doesn't flash a false "closed" state while the request is in flight.
  const [marketStatus, setMarketStatus] = useState({
    isOpen: true,
    reason: null,
    nextOpen: null,
  });
  const [marketModalVisible, setMarketModalVisible] = useState(false);

  // ─── Charges breakdown sheet ─────────────────────────────────────────────────
  const [chargesModalVisible, setChargesModalVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchMarketStatus()
      .then((status) => {
        if (cancelled) return;
        setMarketStatus(status);
        if (!status.isOpen) setMarketModalVisible(true);
      })
      .catch(() => {
        // Fail safe: if the status check itself fails, don't block the
        // screen on it — the server-side check in placeOrder() is still
        // the real gate; this is just the proactive heads-up.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Leverage ────────────────────────────────────────────────────────────────
  // { cnc: 1, mis: 5 | 2.5 } — fetched once per symbol, not duplicated
  // client-side, so it can never drift from the backend's Nifty 50 list.
  const [leverage, setLeverage] = useState({ cnc: 1, mis: 1 });

  useEffect(() => {
    if (!symbol || symbol === "STOCK") return;
    fetchLeverage(symbol)
      .then(setLeverage)
      .catch(() => setLeverage({ cnc: 1, mis: 1 })); // fail safe: no leverage, not a crash
  }, [symbol]);

  // ─── Live price ──────────────────────────────────────────────────────────────
  const { prices } = useMarketData();
  const liveData = prices[instrumentKey] || {};
  const ltp = liveData.ltp || 0;
  const cp = liveData.cp || 0;
  const priceChange = ltp && cp ? ltp - cp : 0;
  const pricePct = cp ? ((priceChange / cp) * 100).toFixed(2) : "0.00";
  const isPositive = priceChange >= 0;

  // ─── Animation for live price flash ─────────────────────────────────────────
  const flashAnim = useRef(new Animated.Value(1)).current;
  const prevLtp = useRef(ltp);

  useEffect(() => {
    if (ltp && ltp !== prevLtp.current) {
      prevLtp.current = ltp;
      Animated.sequence([
        Animated.timing(flashAnim, {
          toValue: 0.2,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.timing(flashAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [ltp]);

  // ─── Load wallets ────────────────────────────────────────────────────────────
  useEffect(() => {
    loadWallets();
  }, []);

  async function loadWallets() {
    setWalletsLoading(true);
    try {
      const data = await fetchWallets();
      setWallets(data.wallets || []);
      setDemoBalance(data.demoBalance || 0);
      if (data.wallets && data.wallets.length > 0) {
        setSelectedWalletId(data.wallets[0].id);
      }
    } catch (e) {
      // Global toast already covers this via the api.js interceptor.
    } finally {
      setWalletsLoading(false);
    }
  }

  async function handleCreateWallet({ name: walletName, amount }) {
    setCreatingWallet(true);
    try {
      const data = await createWallet({ name: walletName, amount });
      setWallets(data.wallets || []);
      setDemoBalance(data.demoBalance || 0);
      // Auto-select the newly created wallet
      const newest = data.wallets?.[data.wallets.length - 1];
      if (newest) setSelectedWalletId(newest.id);
      setModalVisible(false);
    } catch (e) {
      // Global toast already covers this (e.g. INSUFFICIENT_FUNDS, VALIDATION_ERROR).
    } finally {
      setCreatingWallet(false);
    }
  }

  // ─── Computed values ─────────────────────────────────────────────────────────
  const effectivePrice =
    orderMode === "Limit" && priceLimit ? parseFloat(priceLimit) : ltp;
  const qtyNum = parseInt(qty) || 0;
  const orderTotal = effectivePrice * qtyNum;

  // Intraday → MIS (leveraged) | Delivery → CNC (1x, full value)
  const productType = tradeType === "Intraday" ? "MIS" : "CNC";
  const activeLeverage = productType === "MIS" ? leverage.mis : leverage.cnc;
  // Intraday (MIS) reserves leveraged margin on BOTH sides now that
  // shorting is supported — a SELL can open/extend a short exactly like a
  // BUY opens/extends a long, and the backend charges the same leveraged
  // margin for it (see orderService.js's openQty logic). CNC SELL is the
  // only side that's still margin-free, since CNC can never open a short
  // — it only ever closes an existing delivery holding.
  const isLeveragedSide = orderType === "BUY" || productType === "MIS";
  const marginRequired = isLeveragedSide ? orderTotal / activeLeverage : 0;

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId);
  const walletBalance = selectedWallet?.balance || 0;
  const canAfford = isLeveragedSide ? walletBalance >= marginRequired : true;
  const canPlace =
    qtyNum > 0 &&
    selectedWalletId &&
    canAfford &&
    marketStatus.isOpen &&
    !placingOrder;

  // ─── Place order ─────────────────────────────────────────────────────────────
  async function handlePlaceOrder() {
    if (!marketStatus.isOpen) {
      // Market flipped closed after the screen loaded (or the user is
      // tapping a disabled-looking button) — re-show the message box
      // instead of letting the request go out at all.
      setMarketModalVisible(true);
      return;
    }
    if (wallets.length === 0) {
      // Button stays tappable in this case (see disabled prop below) —
      // this is the actual feedback path, not a silent no-op.
      showToast("Create a wallet first to start trading", "error");
      setModalVisible(true);
      return;
    }
    if (!canPlace) return;
    setPlacingOrder(true);
    try {
      // TODO: wire to your order API when ready
      // await orderService.placeOrder({ instrumentKey, symbol, qty: qtyNum, price: effectivePrice, tradeType, orderType, walletId: selectedWalletId });
      await placeOrder({
        instrument_key: instrumentKey,
        symbol,
        quantity: qtyNum,
        price: effectivePrice,
        order_type: orderMode.toUpperCase(),
        side: orderType,
        wallet_id: selectedWalletId,
        product_type: productType,
      });
      navigation.replace("OrderSuccess", {
        symbol,
        orderType,
        quantity: qtyNum,
        price: effectivePrice,
        productType,
        amount: isLeveragedSide ? marginRequired : orderTotal,
        walletName: selectedWallet?.name,
      });
    } catch (e) {
      const data = e?.response?.data;
      if (data?.code === "MARKET_CLOSED") {
        // Server is the source of truth — sync local state from its
        // { reason, nextOpen } payload (handles the case where the
        // market closed in the gap between our status fetch and this
        // submit) and surface the same message box.
        setMarketStatus({
          isOpen: false,
          reason: data.reason,
          nextOpen: data.nextOpen,
        });
        setMarketModalVisible(true);
      }
      // Other errors (INSUFFICIENT_FUNDS, holdings, etc.) already covered
      // by the global toast via the api.js interceptor.
    } finally {
      setPlacingOrder(false);
    }
  }

  // ─── Colour helpers ──────────────────────────────────────────────────────────
  const BUY_COLOR = Colors.gain;
  const SELL_COLOR = Colors.danger;
  const accentColor = orderType === "BUY" ? BUY_COLOR : SELL_COLOR;
  const BLUE_BORDER = Colors.primary;
  const BLUE_BG = Colors.primary;

  // ─── Slide-to-confirm CTA state ─────────────────────────────────────────────
  // Mirrors the original TouchableOpacity logic exactly:
  //   - market closed / no wallet → CTA stays interactive as a plain TAP
  //     (not a slide) purely to surface the info modal/toast — dragging
  //     to confirm doesn't make sense when there's nothing to confirm yet.
  //   - genuinely blocked (bad qty, can't afford) → fully inert, dimmed.
  //   - otherwise → real slide-to-confirm gesture.
  let ctaMode;
  let ctaLabel;
  let ctaIcon;

  if (placingOrder) {
    ctaMode = "slide"; // loading prop takes over the visual state
    ctaIcon = orderType === "BUY" ? "trending-up" : "trending-down";
  } else if (!marketStatus.isOpen) {
    ctaMode = "tap";
    ctaLabel = "Tap — Market Closed";
    ctaIcon = "time-outline";
  } else if (wallets.length === 0) {
    ctaMode = "tap";
    ctaLabel = "Tap — Add a Wallet First";
    ctaIcon = "wallet-outline";
  } else if (!canPlace) {
    ctaMode = "disabled";
    ctaLabel =
      qtyNum <= 0
        ? "Enter Quantity"
        : !canAfford
          ? "Insufficient Balance"
          : "Unavailable";
    ctaIcon = orderType === "BUY" ? "trending-up" : "trending-down";
  } else {
    ctaMode = "slide";
    ctaLabel = orderType === "BUY" ? "Slide to Buy" : "Slide to Sell";
    ctaIcon = orderType === "BUY" ? "trending-up" : "trending-down";
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.white} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color="black" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerSymbol}>{symbol}</Text>
          <Text style={styles.headerName} numberOfLines={1}>
            {name}
          </Text>
        </View>
        {/* BUY / SELL toggle */}
        <View style={styles.orderTypeToggle}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              orderType === "BUY" && { backgroundColor: BLUE_BG },
            ]}
            onPress={() => setOrderType("BUY")}
          >
            <Text
              style={[
                styles.toggleText,
                orderType === "BUY" && { color: Colors.white },
              ]}
            >
              BUY
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              orderType === "SELL" && { backgroundColor: SELL_COLOR },
            ]}
            onPress={() => setOrderType("SELL")}
          >
            <Text
              style={[
                styles.toggleText,
                orderType === "SELL" && { color: Colors.white },
              ]}
            >
              SELL
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Live price bar ──────────────────────────────────────────────────── */}
      <View
        style={[styles.priceBar, { borderBottomColor: accentColor + "10" }]}
      >
        <View>
          <Text style={styles.priceLabel}>CURRENT PRICE</Text>
          <Animated.Text
            style={[
              styles.livePrice,
              {
                color: isPositive ? BUY_COLOR : SELL_COLOR,
                opacity: flashAnim,
              },
            ]}
          >
            ₹
            {ltp
              ? ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })
              : "—"}
          </Animated.Text>
        </View>
      </View>

      {/* ── Market closed banner ────────────────────────────────────────────── */}
      {!marketStatus.isOpen && (
        <TouchableOpacity
          style={styles.marketClosedBanner}
          onPress={() => setMarketModalVisible(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="time-outline" size={16} color={Colors.warning} />
          <Text style={styles.marketClosedBannerTxt} numberOfLines={1}>
            Market closed — opens{" "}
            {marketStatus.nextOpen?.dateLabel || "next trading day"} at{" "}
            {marketStatus.nextOpen?.timeLabel || "9:15 AM"}
          </Text>
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Trade type (Intraday / Delivery) ──────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>TRADE TYPE</Text>
            <View style={styles.pillRow}>
              {["Intraday", "Delivery"].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.pill,
                    tradeType === t && {
                      borderColor: BLUE_BORDER,
                      backgroundColor: BLUE_BG,
                    },
                  ]}
                  onPress={() => setTradeType(t)}
                >
                  <Text
                    style={[
                      styles.pillTxt,
                      tradeType === t && { color: Colors.white },
                    ]}
                  >
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── QTY + Price inputs ────────────────────────────────────────── */}
          <View style={styles.inputRow}>
            <View
              style={[
                styles.inputGroup,
                { flex: 1, marginRight: moderateScale(10) },
              ]}
            >
              <Text style={styles.inputLabel}>QTY</Text>
              <TextInput
                style={styles.input}
                value={qty}
                onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ""))}
                placeholder="0"
                placeholderTextColor={Colors.text}
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>
            {orderMode === "Limit" && (
              <View style={[styles.inputGroup, { flex: 1.4 }]}>
                <Text style={styles.inputLabel}>LIMIT PRICE (₹)</Text>
                <TextInput
                  style={styles.input}
                  value={priceLimit}
                  onChangeText={(v) => setPriceLimit(v.replace(/[^0-9.]/g, ""))}
                  placeholder={ltp ? ltp.toFixed(2) : "0.00"}
                  placeholderTextColor={Colors.text}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>
            )}
          </View>

          {/* ── Order mode (Market / Limit) ───────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>ORDER TYPE</Text>
            <View style={styles.pillRow}>
              {["Market", "Limit"].map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.pill,
                    orderMode === m && {
                      borderColor: BLUE_BORDER,
                      backgroundColor: BLUE_BG,
                    },
                  ]}
                  onPress={() => setOrderMode(m)}
                >
                  <Text
                    style={[
                      styles.pillTxt,
                      orderMode === m && { color: Colors.white },
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── Wallet selector ───────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SELECT WALLET</Text>

            {walletsLoading ? (
              <ActivityIndicator
                color={accentColor}
                style={{ marginVertical: moderateScale(16) }}
              />
            ) : wallets.length === 0 ? (
              <View style={styles.noWalletBox}>
                <Ionicons name="wallet-outline" size={32} color={Colors.text} />
                <Text style={styles.noWalletTxt}>No wallets yet</Text>
                <Text style={styles.noWalletSub}>
                  Create a wallet from your demo balance to start trading
                </Text>
                <TouchableOpacity
                  style={[styles.createWalletBtn, { borderColor: accentColor }]}
                  onPress={() => setModalVisible(true)}
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={16}
                    color={accentColor}
                  />
                  <Text
                    style={[styles.createWalletBtnTxt, { color: accentColor }]}
                  >
                    Create a Wallet
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: moderateScale(10) }}
                >
                  {wallets.map((w, i) => {
                    const isSelected = w.id === selectedWalletId;
                    const COLORS = [
                      Colors.primary,
                      Colors.gain,
                      Colors.warning,
                      "#A855F7",
                      Colors.danger,
                    ];
                    const wColor = COLORS[i % COLORS.length];
                    return (
                      <TouchableOpacity
                        key={w.id}
                        style={[
                          styles.walletChip,
                          isSelected && {
                            borderColor: wColor,
                            backgroundColor: wColor + "15",
                          },
                        ]}
                        onPress={() => setSelectedWalletId(w.id)}
                      >
                        <View
                          style={[
                            styles.walletChipIcon,
                            { backgroundColor: wColor + "30" },
                          ]}
                        >
                          <Ionicons
                            name="wallet-outline"
                            size={14}
                            color={wColor}
                          />
                        </View>
                        <View>
                          <Text
                            style={[
                              styles.walletChipName,
                              isSelected && { color: wColor },
                            ]}
                          >
                            {w.name}
                          </Text>
                          <Text style={styles.walletChipBalance}>
                            ₹
                            {w.balance.toLocaleString("en-IN", {
                              minimumFractionDigits: 2,
                            })}
                          </Text>
                        </View>
                        {isSelected && (
                          <Ionicons
                            name="checkmark-circle"
                            size={16}
                            color={wColor}
                            style={{ marginLeft: moderateScale(6) }}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                  {/* Add new wallet chip */}
                  <TouchableOpacity
                    style={[styles.walletChip, styles.walletChipAdd]}
                    onPress={() => setModalVisible(true)}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={18}
                      color={Colors.textSecondary}
                    />
                    <Text style={styles.walletChipAddTxt}>New</Text>
                  </TouchableOpacity>
                </ScrollView>

                {/* Selected wallet detail */}
                {selectedWallet && (
                  <View style={styles.walletDetailRow}>
                    <Text style={styles.walletDetailTxt}>
                      Available:{" "}
                      <Text style={{ color: "black", fontWeight: "600" }}>
                        ₹
                        {walletBalance.toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                        })}
                      </Text>
                    </Text>
                    {isLeveragedSide && qtyNum > 0 && !canAfford && (
                      <Text style={styles.insufficientTxt}>
                        ⚠ Insufficient balance
                      </Text>
                    )}
                  </View>
                )}
              </>
            )}
          </View>

          {/* ── Order summary ─────────────────────────────────────────────── */}
          <View
            style={[styles.summaryCard, { borderColor: accentColor + "40" }]}
          >
            <View style={styles.summaryRow}>
              <Text style={styles.summaryKey}>Price per share</Text>
              <Text style={styles.summaryVal}>
                ₹
                {effectivePrice.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                })}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryKey}>Quantity</Text>
              <Text style={styles.summaryVal}>{qtyNum}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryKey}>Order value</Text>
              <Text style={styles.summaryVal}>
                ₹
                {orderTotal.toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                })}
              </Text>
            </View>
            {productType === "MIS" && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryKey}>Leverage</Text>
                <View style={styles.leverageBadge}>
                  <Text style={styles.leverageBadgeTxt}>{activeLeverage}x</Text>
                </View>
              </View>
            )}
            <View style={[styles.summaryRow, styles.summaryTotal]}>
              <Text
                style={[
                  styles.summaryKey,
                  { color: Colors.text, fontWeight: "700" },
                ]}
              >
                {isLeveragedSide ? "Margin required" : "Estimated credit"}
              </Text>
              <Text
                style={[
                  styles.summaryVal,
                  {
                    color: accentColor,
                    fontWeight: "700",
                    fontSize: fontScale(Typography.bodyLarge),
                  },
                ]}
              >
                ₹
                {(isLeveragedSide ? marginRequired : orderTotal).toLocaleString(
                  "en-IN",
                  { minimumFractionDigits: 2 },
                )}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setChargesModalVisible(true)}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              style={styles.chargesLinkRow}
            >
              <Text style={styles.chargesLinkTxt}>View charges breakdown</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom spacer so button doesn't overlap */}
          <View style={{ height: 100 + insets.bottom }} />
        </ScrollView>

        {/* ── Place order CTA ────────────────────────────────────────────────── */}
        <View
          style={[
            styles.ctaContainer,
            {
              paddingBottom: styles.ctaContainer.paddingBottom + insets.bottom,
            },
          ]}
        >
          <SlideToConfirmButton
            mode={ctaMode}
            label={ctaLabel}
            loadingLabel={
              orderType === "BUY" ? "Placing Buy Order..." : "Placing Sell Order..."
            }
            color={ctaMode === "disabled" ? Colors.textMuted : accentColor}
            icon={ctaIcon}
            loading={placingOrder}
            onConfirm={handlePlaceOrder}
          />
        </View>
      </KeyboardAvoidingView>

      {/* ── Create wallet modal ─────────────────────────────────────────────── */}
      <CreateWalletModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSubmit={handleCreateWallet}
        availableBalance={demoBalance}
        loading={creatingWallet}
      />

      {/* ── Market closed message box ───────────────────────────────────────── */}
      <MarketClosedModal
        visible={marketModalVisible}
        onClose={() => setMarketModalVisible(false)}
        reason={marketStatus.reason}
        nextOpen={marketStatus.nextOpen}
      />

      {/* ── Charges breakdown bottom sheet ──────────────────────────────────── */}
      <ChargesBreakdownModal
        visible={chargesModalVisible}
        onClose={() => setChargesModalVisible(false)}
        orderValue={orderTotal}
        side={orderType}
        productType={productType}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.white,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(12),
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    marginLeft: moderateScale(12),
  },
  headerSymbol: {
    fontSize: fontScale(17),
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 0.5,
  },
  headerName: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    marginTop: moderateScale(1),
  },
  orderTypeToggle: {
    flexDirection: "row",
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: moderateScale(3),
  },
  toggleBtn: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(6),
    borderRadius: 6,
  },
  toggleText: {
    fontSize: fontScale(Typography.small),
    fontWeight: "700",
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },

  // Live price bar
  priceBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(14),
    borderBottomWidth: 1,
    backgroundColor: Colors.white,
  },
  priceLabel: {
    fontSize: fontScale(10),
    color: Colors.textMuted,
    letterSpacing: 1,
    fontWeight: "600",
    marginBottom: moderateScale(2),
  },
  livePrice: {
    fontSize: fontScale(26),
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  priceChangeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(4),
    backgroundColor: "#1A1A24",
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 20,
  },
  priceChangeTxt: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
  },

  // Market closed banner
  marketClosedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(10),
    backgroundColor: Colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  marketClosedBannerTxt: {
    flex: 1,
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    color: Colors.text,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: moderateScale(16) },

  // Section
  section: { marginBottom: moderateScale(20) },
  sectionLabel: {
    fontSize: fontScale(10),
    color: Colors.textMuted,
    letterSpacing: 1.2,
    fontWeight: "700",
    marginBottom: moderateScale(10),
  },

  // Pills (Intraday/Delivery, Market/Limit)
  pillRow: { flexDirection: "row", gap: moderateScale(10) },
  pill: {
    paddingHorizontal: moderateScale(18),
    paddingVertical: moderateScale(9),
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: Colors.white,
    borderColor: Colors.border,
  },
  pillTxt: {
    fontSize: fontScale(14),
    fontWeight: "600",
    color: Colors.textSecondary,
  },

  // Inputs
  inputRow: { flexDirection: "row", marginBottom: moderateScale(20) },
  inputGroup: {},
  inputLabel: {
    fontSize: fontScale(10),
    color: Colors.textMuted,
    letterSpacing: 1.2,
    fontWeight: "700",
    marginBottom: moderateScale(8),
  },
  input: {
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(13),
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },

  // Summary card
  summaryCard: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    padding: moderateScale(14),
    marginBottom: moderateScale(20),
    gap: moderateScale(8),
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryTotal: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: moderateScale(10),
    marginTop: moderateScale(2),
  },
  summaryKey: { fontSize: fontScale(Typography.caption), color: "#777" },
  summaryVal: {
    fontSize: fontScale(Typography.caption),
    color: Colors.text,
    fontWeight: "600",
  },
  chargesLinkRow: {
    marginTop: moderateScale(10),
    alignSelf: "flex-start",
  },
  chargesLinkTxt: {
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    color: Colors.primary,
    textDecorationLine: "underline",
  },
  leverageBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(3),
    borderRadius: 6,
  },
  leverageBadgeTxt: {
    fontSize: fontScale(Typography.small),
    fontWeight: "700",
    color: Colors.primaryDark,
  },

  // Wallet
  noWalletBox: {
    alignItems: "center",
    padding: moderateScale(24),
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: moderateScale(8),
  },
  noWalletTxt: {
    fontSize: fontScale(Typography.body),
    color: Colors.text,
    fontWeight: "600",
  },
  noWalletSub: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  createWalletBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    marginTop: moderateScale(6),
    paddingHorizontal: moderateScale(18),
    paddingVertical: moderateScale(10),
    borderRadius: 8,
    borderWidth: 1,
  },
  createWalletBtnTxt: { fontSize: fontScale(14), fontWeight: "700" },

  walletChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(10),
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: Colors.white,
    borderColor: Colors.border,
    marginRight: moderateScale(10),
  },
  walletChipIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  walletChipName: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.text,
  },
  walletChipBalance: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textSecondary,
    marginTop: moderateScale(1),
  },
  walletChipAdd: {
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "column",
    gap: moderateScale(2),
    minWidth: 60,
  },
  walletChipAddTxt: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textSecondary,
  },
  walletDetailRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(4),
    marginTop: moderateScale(4),
  },
  walletDetailTxt: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
  },
  insufficientTxt: {
    fontSize: fontScale(Typography.small),
    color: Colors.danger,
    fontWeight: "600",
  },

  // CTA
  ctaContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: moderateScale(16),
    paddingBottom: Platform.OS === "ios" ? 30 : 20,
    paddingTop: moderateScale(12),
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  ctaBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(8),
    borderRadius: 12,
    paddingVertical: moderateScale(16),
  },
  ctaBtnTxt: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    letterSpacing: 0.3,
    color: Colors.white,
  },
});