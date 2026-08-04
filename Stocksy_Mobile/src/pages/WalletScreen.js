import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Animated,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Button from "../components/Button";
import WalletCard from "../components/WalletCard";
import CreateWalletModal from "../components/CreateWalletModal";
import DemoCard, { CARD_SKINS } from "../components/DemoCard";
import CardCustomizerModal from "../components/Cardcustomizermodal";
import TransactionRow from "../components/TransactionRow";
import Dashboard from "./DashboardPage";

import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  fetchWallets,
  createWallet,
  updateWallet,
  deleteWallet,
} from "../../services/walletService";
import { fetchTransactions } from "../../services/transactionService";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  Colors,
  Typography,
  fontScale,
  moderateScale,
  SCREEN_WIDTH,
} from "../theme";

// ─── Card stack sizing ──────────────────────────────────────────────────────
// The demo card + its two fanned "peeking" shadow cards sit beside the
// action column (Create/Invest/Transactions). The original layout used
// fixed 300/280/265px widths tuned for a 390px-wide phone — that overflows
// the screen on EVERY phone size, including its own 390px baseline (by
// ~28px), because the action column + paddings + card together always add
// up to more than 390px. This computes the largest card width that actually
// fits beside the action column, capped at the original 300px so it doesn't
// look oversized on large phones, and scales the two shadow cards + stack
// area proportionally so the fanned-card effect still looks right at any
// screen size.
const CARD_SECTION_PADDING = moderateScale(20);
const ACTION_COLUMN_SPACE = moderateScale(68) + moderateScale(4); // column width + marginRight
const STACK_MARGIN_LEFT = moderateScale(16);
const CARD_MAX_WIDTH = 300;

const availableForStack =
  SCREEN_WIDTH -
  CARD_SECTION_PADDING * 2 -
  ACTION_COLUMN_SPACE -
  STACK_MARGIN_LEFT;
const STACK_AREA_WIDTH = Math.min(
  availableForStack,
  CARD_MAX_WIDTH * (310 / 300),
);
const CARD_WIDTH = STACK_AREA_WIDTH * (300 / 310);
const CARD_HEIGHT = CARD_WIDTH * (180 / 300);
const STACK_AREA_HEIGHT = CARD_HEIGHT * (210 / 180);
const SHADOW1_WIDTH = CARD_WIDTH * (280 / 300);
const SHADOW1_HEIGHT = CARD_HEIGHT * (170 / 180);
const SHADOW2_WIDTH = CARD_WIDTH * (265 / 300);
const SHADOW2_HEIGHT = CARD_HEIGHT * (165 / 180);

// Palette for sub-wallet icon colours
const WALLET_COLORS = [
  Colors.gain,
  Colors.primary,
  Colors.warning,
  "#EC4899",
  "#8B5CF6",
  Colors.danger,
];

const WALLET_ICONS = [
  "trending-up-outline",
  "briefcase-outline",
  "rocket-outline",
  "shield-checkmark-outline",
  "bar-chart-outline",
  "diamond-outline",
];

const SKIN_STORAGE_KEY = "@stocksy_card_skin";

const WalletScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [demoBalance, setDemoBalance] = useState(0);
  const [wallets, setWallets] = useState([]);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [creating, setCreating] = useState(false);
  const [skinModalVisible, setSkinModalVisible] = useState(false);
  const [activeSkin, setActiveSkin] = useState(CARD_SKINS[0]);

  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [renameValue, setRenameValue] = useState("");

  // Animation values
  const headerOpacity = useRef(new Animated.Value(0)).current;
  const cardScale = useRef(new Animated.Value(0.95)).current;
  const contentTranslate = useRef(new Animated.Value(30)).current;

  // Load saved skin on mount
  useEffect(() => {
    const loadSkin = async () => {
      try {
        const saved = await AsyncStorage.getItem(SKIN_STORAGE_KEY);
        if (saved) {
          const skinObj = CARD_SKINS.find((s) => s.id === saved);
          if (skinObj) setActiveSkin(skinObj);
        }
      } catch (_) {}
    };
    loadSkin();
  }, []);

  // Entrance animations
  useEffect(() => {
    if (!loading) {
      Animated.parallel([
        Animated.timing(headerOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.spring(cardScale, {
          toValue: 1,
          tension: 60,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(contentTranslate, {
          toValue: 0,
          duration: 450,
          delay: 100,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [loading]);

  // ─── Fetch wallets ───────────────────────────────────────────────────
  const loadWallets = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [data, transactions] = await Promise.all([
        fetchWallets(),
        fetchTransactions(5).catch(() => []), // don't block wallet load if this fails
      ]);
      setDemoBalance(data.demoBalance);
      setWallets(data.wallets);
      setRecentTransactions(transactions || []);
    } catch (err) {
      // Global toast already covers this.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadWallets();
  }, [loadWallets]);

  // ─── Create wallet ───────────────────────────────────────────────────
  const handleCreateWallet = async ({ name, amount }) => {
    setCreating(true);
    try {
      const data = await createWallet({ name, amount });
      setDemoBalance(data.demoBalance);
      setWallets(data.wallets);
      setModalVisible(false);
      fetchTransactions(5)
        .then(setRecentTransactions)
        .catch(() => {});
    } catch (err) {
      // Global toast already covers this.
    } finally {
      setCreating(false);
    }
  };

  // ─── Rename wallet ───────────────────────────────────────────────────
  const handleRenameSubmit = async () => {
    if (!renameValue.trim() || !selectedWallet) return;
    try {
      await updateWallet({
        walletId: selectedWallet.id,
        name: renameValue.trim(),
      });
      setRenameModalVisible(false);
      setSelectedWallet(null);
      loadWallets();
    } catch (err) {
      // Global toast already covers this.
    }
  };

  // ─── Delete wallet ───────────────────────────────────────────────────
  const handleDeleteWallet = async (wallet) => {
    Alert.alert(
      "Delete Wallet",
      `Delete "${wallet.name}"?\n\n₹${formatINR(wallet.balance)} will be refunded to your available balance.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const data = await deleteWallet(wallet.id);
              setWallets(data.wallets);
              loadWallets();
            } catch (err) {
              // Global toast already covers this.
            }
          },
        },
      ],
    );
  };

  // ─── Wallet actions menu ─────────────────────────────────────────────
  const handleWalletActions = (wallet) => {
    Alert.alert(wallet.name, "What would you like to do?", [
      {
        text: "Rename",
        onPress: () => {
          setSelectedWallet(wallet);
          setRenameValue(wallet.name);
          setRenameModalVisible(true);
        },
      },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => handleDeleteWallet(wallet),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // ─── Save skin ───────────────────────────────────────────────────────
  const handleSelectSkin = async (skin) => {
    setActiveSkin(skin);
    try {
      await AsyncStorage.setItem(SKIN_STORAGE_KEY, skin.id);
    } catch (_) {}
  };

  // ─── Derived values ──────────────────────────────────────────────────
  const totalAllocated = wallets.reduce((sum, w) => sum + Number(w.balance), 0);
  const allocatedPct =
    demoBalance > 0
      ? Math.round((totalAllocated / (demoBalance + totalAllocated)) * 100)
      : 0;

  const formatINR = (value) =>
    Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });

  // ─── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.gain} />
        <Text style={styles.loadingText}>Loading wallet…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surfaceAlt} />

      {/* ── Header ────────────────────────────────────────────────── */}
      <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={20} color={Colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>My Wallet</Text>

        <TouchableOpacity
          onPress={() => navigation.navigate("AllTransactions")}
          style={styles.headerBtn}
        >
          <Ionicons name="time-outline" size={20} color={Colors.text} />
        </TouchableOpacity>
      </Animated.View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadWallets(true)}
            tintColor={Colors.gain}
          />
        }
      >
        {/* ── Card Section ──────────────────────────────────────────── */}
        <View style={styles.cardSection}>
          {/* Action column */}
          <View style={styles.actionColumn}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setModalVisible(true)}
            >
              <Ionicons name="add" size={22} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Create</Text>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate("Home")}
            >
              <Ionicons name="arrow-up-outline" size={20} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Invest</Text>

            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => navigation.navigate("AllTransactions")}
            >
              <Ionicons name="receipt-outline" size={20} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.actionLabel}>Transactions</Text>
          </View>

          {/* Card stack */}
          <View style={styles.cardStackArea}>
            <View style={[styles.stackShadow2]} />
            <View style={[styles.stackShadow1]} />

            <Animated.View style={{ transform: [{ scale: cardScale }] }}>
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={() => setSkinModalVisible(true)}
              >
                <DemoCard
                  balance={demoBalance}
                  skin={activeSkin}
                  style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
                />
                {/* Edit hint */}
                <View style={styles.editHint}>
                  <Ionicons
                    name="color-palette-outline"
                    size={12}
                    color="rgba(255,255,255,0.6)"
                  />
                  <Text style={styles.editHintText}>Tap to customise</Text>
                </View>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>

        {/* ── Balance Breakdown ─────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.balanceBreakdown,
            { transform: [{ translateY: contentTranslate }] },
          ]}
        >
          <View style={styles.breakdownItem}>
            <View style={[styles.breakDot, { backgroundColor: Colors.gain }]} />
            <View>
              <Text style={styles.breakLabel}>Available</Text>
              <Text style={styles.breakValue}>₹{formatINR(demoBalance)}</Text>
            </View>
          </View>

          <View style={styles.breakDivider} />

          <View style={styles.breakdownItem}>
            <View
              style={[styles.breakDot, { backgroundColor: Colors.primary }]}
            />
            <View>
              <Text style={styles.breakLabel}>Allocated</Text>
              <Text style={styles.breakValue}>
                ₹{formatINR(totalAllocated)}
              </Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.progressBarOuter}>
            <View
              style={[styles.progressBarInner, { width: `${allocatedPct}%` }]}
            />
          </View>
        </Animated.View>

        {/* ── Sub-wallets ───────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.section,
            { transform: [{ translateY: contentTranslate }] },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Sub Wallets</Text>
          </View>

          {wallets.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconRing}>
                <Ionicons
                  name="wallet-outline"
                  size={28}
                  color={Colors.textMuted}
                />
              </View>
              <Text style={styles.emptyTitle}>No sub Wallets yet</Text>
              <Text style={styles.emptySubtitle}>
                Create wallets to allocate funds for different strategies.
              </Text>
            </View>
          ) : (
            wallets.map((wallet, index) => (
              <WalletCard
                key={wallet._id || wallet.id || index}
                name={wallet.name}
                balance={wallet.balance}
                iconName={WALLET_ICONS[index % WALLET_ICONS.length]}
                iconColor={WALLET_COLORS[index % WALLET_COLORS.length]}
                onPressActions={() => handleWalletActions(wallet)}
              />
            ))
          )}
        </Animated.View>

        {/* ── Transactions ──────────────────────────────────────────── */}
        <Animated.View
          style={[
            styles.section,
            { transform: [{ translateY: contentTranslate }] },
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Transactions</Text>

            {recentTransactions.length > 0 && (
              <TouchableOpacity
                onPress={() => navigation.navigate("AllTransactions")}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.seeAllText}>View all</Text>
              </TouchableOpacity>
            )}
          </View>

          {recentTransactions.length === 0 ? (
            <View style={styles.emptyTransactions}>
              <View style={styles.emptyIconRing}>
                <Ionicons
                  name="receipt-outline"
                  size={28}
                  color={Colors.textMuted}
                />
              </View>
              <Text style={styles.emptyTitle}>No transactions yet</Text>
              <Text style={styles.emptySubtitle}>
                Your transfers and payments will appear here.
              </Text>
            </View>
          ) : (
            recentTransactions.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} />
            ))
          )}
        </Animated.View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Bottom CTA ──────────────────────────────────────────────── */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: moderateScale(12) + insets.bottom },
        ]}
      >
        <TouchableOpacity
          style={styles.addMoneyBtn}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[Colors.primary, Colors.primary]}
            style={styles.addMoneyGradient}
          >
            <Ionicons
              name="add-circle-outline"
              size={20}
              color={Colors.white}
              style={{ marginRight: moderateScale(8) }}
            />
            <Text style={styles.addMoneyText}>Add Money</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* ── Modals ──────────────────────────────────────────────────── */}
      <CreateWalletModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSubmit={handleCreateWallet}
        availableBalance={demoBalance}
        loading={creating}
      />

      <CardCustomizerModal
        visible={skinModalVisible}
        onClose={() => setSkinModalVisible(false)}
        currentSkinId={activeSkin.id}
        balance={demoBalance}
        onSelectSkin={handleSelectSkin}
      />

      {/* Rename Modal */}
      <Modal visible={renameModalVisible} transparent animationType="fade">
        <View style={styles.renameOverlay}>
          <View style={styles.renameSheet}>
            <Text style={styles.renameTitle}>Rename Wallet</Text>
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Wallet name"
              placeholderTextColor={Colors.textMuted}
              style={styles.renameInput}
              autoFocus
            />
            <View style={styles.renameActions}>
              <TouchableOpacity
                onPress={() => setRenameModalVisible(false)}
                style={styles.renameCancelBtn}
              >
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRenameSubmit}
                style={styles.renameSaveBtn}
              >
                <Text style={styles.renameSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.surfaceAlt,
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(12),
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: fontScale(14),
    fontWeight: "500",
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(14),
    backgroundColor: Colors.surfaceAlt,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.white,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Colors.textMuted,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  headerTitle: {
    fontSize: fontScale(17),
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 0.2,
  },

  // Scroll
  scrollContent: {
    paddingTop: moderateScale(8),
  },

  // Card section
  cardSection: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: moderateScale(20),
    paddingRight: moderateScale(20),
    paddingVertical: moderateScale(16),
    marginBottom: moderateScale(8),
  },
  actionColumn: {
    width: 68,
    alignItems: "center",
    marginRight: moderateScale(4),
  },
  actionButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.white,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Colors.textMuted,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  actionLabel: {
    fontSize: fontScale(10),
    fontWeight: "600",
    color: Colors.textSecondary,
    marginTop: moderateScale(6),
    marginBottom: moderateScale(16),
    letterSpacing: 0.2,
  },
  cardStackArea: {
    position: "relative",
    width: STACK_AREA_WIDTH,
    height: STACK_AREA_HEIGHT,
    marginLeft: STACK_MARGIN_LEFT,
  },
  stackShadow1: {
    position: "absolute",
    width: SHADOW1_WIDTH,
    height: SHADOW1_HEIGHT,
    borderRadius: moderateScale(22),
    backgroundColor: Colors.borderLight,
    top: moderateScale(12),
    left: moderateScale(18),
    transform: [{ rotate: "-9deg" }],
    opacity: 0.7,
  },
  stackShadow2: {
    position: "absolute",
    width: SHADOW2_WIDTH,
    height: SHADOW2_HEIGHT,
    borderRadius: moderateScale(22),
    backgroundColor: Colors.border,
    top: moderateScale(18),
    left: moderateScale(22),
    transform: [{ rotate: "-18deg" }],
    opacity: 0.5,
  },
  editHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(4),
    marginTop: moderateScale(8),
  },
  editHintText: {
    fontSize: fontScale(Typography.tiny),
    color: "rgba(100,116,139,0.7)",
    fontWeight: "500",
  },

  // Balance breakdown
  balanceBreakdown: {
    backgroundColor: Colors.white,
    marginHorizontal: moderateScale(20),
    borderRadius: 18,
    padding: moderateScale(18),
    flexDirection: "row",
    alignItems: "center",
    marginBottom: moderateScale(16),
    shadowColor: Colors.textMuted,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
    flexWrap: "wrap",
    gap: moderateScale(4),
  },
  breakdownItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
    flex: 1,
  },
  breakDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  breakLabel: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textMuted,
    fontWeight: "500",
    letterSpacing: 0.3,
    marginBottom: moderateScale(2),
  },
  breakValue: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
  },
  breakDivider: {
    width: 1,
    height: 36,
    backgroundColor: Colors.divider,
    marginHorizontal: moderateScale(8),
  },
  progressBarOuter: {
    width: "100%",
    height: 4,
    backgroundColor: Colors.divider,
    borderRadius: 2,
    marginTop: moderateScale(14),
    overflow: "hidden",
  },
  progressBarInner: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },

  // Section
  section: {
    marginHorizontal: moderateScale(20),
    marginBottom: moderateScale(16),
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: moderateScale(14),
  },
  sectionTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: 0.1,
  },
  addWalletBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(4),
    backgroundColor: Colors.successBg,
    paddingHorizontal: moderateScale(12),
    paddingVertical: moderateScale(6),
    borderRadius: 20,
  },
  addWalletText: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.gain,
  },
  seeAllText: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.primary,
  },

  // Empty states
  emptyState: {
    alignItems: "center",
    paddingVertical: moderateScale(32),
    backgroundColor: Colors.white,
    borderRadius: 18,
    gap: moderateScale(8),
    borderWidth: 1,
    borderColor: Colors.divider,
    borderStyle: "dashed",
  },
  emptyTransactions: {
    alignItems: "center",
    paddingVertical: moderateScale(32),
    backgroundColor: Colors.white,
    borderRadius: 18,
    gap: moderateScale(8),
    shadowColor: Colors.textMuted,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  emptyIconRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: moderateScale(4),
  },
  emptyTitle: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  emptySubtitle: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: moderateScale(24),
  },

  // Bottom bar
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(12),
    // paddingBottom removed — now dynamic via insets.bottom above
    backgroundColor: "rgba(247,248,250,0.95)",
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  addMoneyBtn: {
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  addMoneyGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: moderateScale(16),
    borderRadius: 16,
  },
  addMoneyText: {
    color: Colors.white,
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  // Rename modal
  renameOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: moderateScale(24),
  },
  renameSheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: moderateScale(24),
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  renameTitle: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(16),
  },
  renameInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(12),
    fontSize: fontScale(Typography.body),
    color: Colors.text,
    marginBottom: moderateScale(20),
    backgroundColor: Colors.background,
  },
  renameActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: moderateScale(12),
  },
  renameCancelBtn: {
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(11),
    borderRadius: 10,
    backgroundColor: Colors.divider,
  },
  renameCancelText: {
    color: Colors.textSecondary,
    fontWeight: "600",
    fontSize: fontScale(14),
  },
  renameSaveBtn: {
    paddingHorizontal: moderateScale(24),
    paddingVertical: moderateScale(11),
    borderRadius: 10,
    backgroundColor: Colors.text,
  },
  renameSaveText: {
    color: Colors.white,
    fontWeight: "700",
    fontSize: fontScale(14),
  },
});

export default WalletScreen;
