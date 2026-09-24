import React from "react";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect } from "@react-navigation/native";
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Text,
} from "react-native";
import {
  Screen,
  Card,
  AppText,
  SectionHeader,
  SegmentedToggle,
} from "../components";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";

import Button from "../components/Button";
import StockCard from "../components/StockCard";
import WatchlistItem from "../components/WatchlistItem";
import MiniHoldingCard from "../components/MiniHoldingCard";
import { usePortfolio } from "../hooks/usePortfolio";
// import Search from "./SearchPage";

// ─── Live market data hook ────────────────────────────────────────────────────
import useMarketData from "../hooks/useMarketData";

import { Colors, moderateScale } from "../theme";

// ─── Sample data ─────────────────────────────────────────────────────────────
const TOP_STOCKS = [
  {
    id: "1",
    key: "NSE_EQ|INE205A01025",
    ticker: "VEDL",
    name: "Vedanta",
    domain: "vedanta-zincinternational.com",
  },
  {
    id: "2",
    key: "NSE_EQ|INE263A01024",
    ticker: "BEL",
    name: "Bharat Electronics",
    domain: "bel-india.in",
  },
  {
    id: "3",
    key: "NSE_EQ|INE053F01010",
    ticker: "IRFC",
    name: "IRFC",
    domain: "irfc.co.in",
  },
  {
    id: "4",
    key: "NSE_EQ|INE040H01021",
    ticker: "SUZLON",
    name: "Suzlon Energy",
    domain: "suzlon.de",
  },
];

const LARGE_CAP_KEYS = [
  {
    key: "NSE_EQ|INE002A01018",
    symbol: "RELIANCE",
    name: "Reliance Industries",
    domain: "ril.com",
  },
  {
    key: "NSE_EQ|INE040A01034",
    symbol: "HDFCBANK",
    name: "HDFC Bank Ltd",
    domain: "hdfcbank.com",
  },
  {
    key: "NSE_EQ|INE467B01029",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    domain: "tcs.com",
  },
  {
    key: "NSE_EQ|INE397D01024",
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Ltd",
    domain: "airtel.in",
  },
  {
    key: "NSE_EQ|INE062A01020",
    symbol: "SBIN",
    name: "State Bank of India",
    domain: "sbi.co.in",
  },
  {
    key: "NSE_EQ|INE090A01021",
    symbol: "ICICIBANK",
    name: "ICICI Bank Ltd",
    domain: "icicibank.com",
  },
  {
    key: "NSE_EQ|INE009A01021",
    symbol: "INFY",
    name: "Infosys Ltd",
    domain: "infosys.com",
  },
];

const MID_CAP_KEYS = [
  {
    key: "NSE_EQ|INE860A01027",
    symbol: "HCLTECH",
    name: "HCL Technologies Ltd",
    domain: "hcltech.com",
  },
  {
    key: "NSE_EQ|INE669C01036",
    symbol: "TECHM",
    name: "Tech Mahindra Ltd",
    domain: "techmahindra.com",
  },
  {
    key: "NSE_EQ|INE081A01020",
    symbol: "TATASTEEL",
    name: "Tata Steel Ltd",
    domain: "tatasteel.com",
  },
  {
    key: "NSE_EQ|INE019A01038",
    symbol: "JSWSTEEL",
    name: "JSW Steel Ltd",
    domain: "jsw.in",
  },
  {
    key: "NSE_EQ|INE044A01036",
    symbol: "SUNPHARMA",
    name: "Sun Pharmaceutical",
    domain: "sunpharma.com",
  },
];

const SMALL_CAP_KEYS = [
  {
    key: "NSE_EQ|INE059A01026",
    symbol: "CIPLA",
    name: "Cipla Ltd",
    domain: "cipla.com",
  },
  {
    key: "NSE_EQ|INE522F01014",
    symbol: "COALINDIA",
    name: "Coal India Ltd",
    domain: "coalindia.in",
  },
  {
    key: "NSE_EQ|INE016A01026",
    symbol: "DABUR",
    name: "Dabur India Ltd",
    domain: "dabur.com",
  },
  {
    key: "NSE_EQ|INE216A01030",
    symbol: "BRITANNIA",
    name: "Britannia Industries",
    domain: "britannia.co.in",
  },
];

// constants/companyDomains.js
const COMPANY_DOMAINS = {
  VEDL: "vedanta-zincinternational.com",
  BEL: "bel-india.in",
  IRFC: "irfc.co.in",
  SUZLON: "suzlon.de",
  RELIANCE: "ril.com",
  TCS: "tcs.com",
  HDFCBANK: "hdfcbank.com",
  INFY: "infosys.com",
  SBIN: "sbi.co.in",
  ICICIBANK: "icicibank.com",
  BHARTIARTL: "airtel.in",
  HCLTECH: "hcltech.com",
  TECHM: "techmahindra.com",
  TATASTEEL: "tatasteel.com",
  JSWSTEEL: "jsw.in",
  SUNPHARMA: "sunpharma.com",
  CIPLA: "cipla.com",
  COALINDIA: "coalindia.in",
  DABUR: "dabur.com",
  BRITANNIA: "britannia.co.in",
};

// ─── Helper: compute % change from close price ───────────────────────────────
const calcChange = (ltp, cp) => {
  if (!ltp || !cp || cp === 0) return null;
  const pct = ((ltp - cp) / cp) * 100;
  const sign = pct >= 0 ? "▲" : "▼";
  return {
    label: `${sign} ${Math.abs(pct).toFixed(2)}%`,
    isPositive: pct >= 0,
  };
};

const DashboardPage = ({ navigation }) => {
  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning!";
    if (hour < 17) return "Good Afternoon!";
    return "Good Evening!";
  }

  const insets = useSafeAreaInsets();

  // ── Live prices from WebSocket ──────────────────────────────────────────────
  // refresh() isn't defined until usePortfolio() runs below — a ref bridges
  // the two so ORDER_FILLED/RMS_SQUARE_OFF pushes always refetch positions
  // instead of leaving a just-covered position (or a just-filled order)
  // looking stale until the next time this screen happens to focus.
  const refreshRef = useRef(() => {});
  const { prices, isConnected } = useMarketData(() => refreshRef.current());
  const {
    // Combined (kept for anything else on this screen that wants the whole book)
    positions,
    totals,
    // Delivery (CNC) vs Intraday (MIS) — the Total Assets card needs these
    // split so closing intraday positions doesn't make it look like money
    // vanished from the (unrelated) delivery holdings.
    holdingsPositions,
    holdingsTotals,
    intradayPositions,
    intradayTotals,
    loading,
    refresh,
  } = usePortfolio(prices);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  const [user, setUser] = useState(null);

  // Total Assets card: Delivery vs Intraday toggle. Defaults to Delivery
  // since that's the "real" long-term holding value people expect to see
  // first; Intraday is same-day-only and can legitimately go to zero.
  const [assetTab, setAssetTab] = useState("delivery");
  const activePositions =
    assetTab === "delivery" ? holdingsPositions : intradayPositions;
  const activeTotals =
    assetTab === "delivery" ? holdingsTotals : intradayTotals;

  // Tab screens stay mounted in the background — without this, Dashboard
  // keeps showing whatever it fetched once at app launch, even after a
  // sell/buy happens on another screen.
  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const loadUser = async () => {
      const stored = await AsyncStorage.getItem("user");

      if (stored) {
        setUser(JSON.parse(stored));
      }
    };

    loadUser();
  }, []);

  // ── Renders a WatchlistItem with live price from WebSocket ──────────────────
  const renderLiveStock = (item) => {
    const live = prices[item.key];
    const change = live ? calcChange(live.ltp, live.cp) : null;
    return (
      <WatchlistItem
        key={item.key}
        ticker={item.symbol}
        name={item.name}
        price={live?.ltp ? `₹${live.ltp.toLocaleString("en-IN")}` : "—"}
        change={change?.label}
        isPositive={change?.isPositive ?? true}
        logoUrl={`https://img.logo.dev/${item.domain}?token=pk_Bym4BAakTJudMK4MGnfpnw`}
        onPress={() =>
          navigation.navigate("StockDetail", {
            // ← add this
            instrumentKey: item.key,
            symbol: item.symbol,
            name: item.name,
            sector: item.sector ?? "Equity",
            domain: item.domain,
          })
        }
      />
    );
  };

  const renderTopStock = (item) => {
    const live = prices[item.key];
    const change = live ? calcChange(live.ltp, live.cp) : null;

    return (
      <StockCard
        key={item.key}
        ticker={item.ticker}
        name={item.name}
        logoUrl={`https://img.logo.dev/${item.domain}?token=pk_Bym4BAakTJudMK4MGnfpnw`}
        price={live?.ltp ? `₹${live.ltp.toLocaleString("en-IN")}` : "—"}
        change={change?.label}
        isPositive={change?.isPositive ?? true}
        onPress={() =>
          navigation.navigate("StockDetail", {
            instrumentKey: item.key,
            symbol: item.ticker,
            name: item.name,
            sector: item.sector ?? "Equity",
            domain: item.domain,
          })
        }
      />
    );
  };

  // Pull Nifty 50 data — key matches what Python saves to Redis (Section 9.2)
  const nifty = prices["NSE_INDEX|Nifty 50"];
  const niftyLtp = nifty?.ltp;
  const niftyChange = nifty ? calcChange(nifty.ltp, nifty.cp) : null;

  const bankNifty = prices["NSE_INDEX|Nifty Bank"];
  const bankNiftyLtp = bankNifty?.ltp;
  const bankNiftyChange = bankNifty
    ? calcChange(bankNifty.ltp, bankNifty.cp)
    : null;

  return (
    <Screen
      style={{ backgroundColor: Colors.background }}
      contentContainerStyle={styles.scroll}
      edges={["left", "right"]}
      statusBarStyle="light-content"
    >
      <View
        style={[
          styles.heroSection,
          { paddingTop: insets.top + moderateScale(20) },
        ]}
      >
        {/* ── Top Header ──────────────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View>
            <AppText variant="caption" color="rgba(255,255,255,0.8)">
              {getGreeting()}
            </AppText>

            <AppText
              variant="h2"
              color="white"
              style={{ marginTop: moderateScale(2) }}
            >
              Hi, {user?.username || "Trader"}
            </AppText>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate("Search")}
            style={styles.iconButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="search-outline" size={22} color="white" />
          </TouchableOpacity>
        </View>

        {/* ── Connection Status ───────────────────────────────────────────────
        <View style={styles.wsDot}>
          <View
            style={[
              styles.dot,
              { backgroundColor: isConnected ? Colors.gain : Colors.danger },
            ]}
          />
          <AppText variant="small" color="white" style={{ fontWeight: "600" }}>
            {isConnected ? "Live Market Data" : "Disconnected"}
          </AppText>
        </View> */}

        {/* ── Main Asset Card ─────────────────────────────────────────────── */}
        <Card style={styles.mainCard}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => navigation.navigate("Portfolio")}
          >
            <AppText variant="caption" color={Colors.textSecondary}>
              {assetTab === "delivery"
                ? "Delivery Value"
                : "Intraday P&L (Today)"}
            </AppText>
            <View style={styles.priceRow}>
              {assetTab === "delivery" ? (
                <AppText variant="h1">
                  ₹
                  {activeTotals?.portfolioValue?.toLocaleString("en-IN") ?? "0"}
                </AppText>
              ) : (
                <AppText
                  variant="h1"
                  color={
                    (activeTotals?.totalUnrealised ?? 0) >= 0
                      ? Colors.success
                      : Colors.danger
                  }
                >
                  {(activeTotals?.totalUnrealised ?? 0) >= 0 ? "+" : "-"}₹
                  {Math.abs(activeTotals?.totalUnrealised ?? 0).toLocaleString(
                    "en-IN",
                    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                  )}
                </AppText>
              )}

              <View
                style={[
                  styles.changeChip,
                  {
                    backgroundColor:
                      (assetTab === "delivery"
                        ? activeTotals?.todayPct
                        : activeTotals?.unrealisedPct) >= 0
                        ? Colors.successBg
                        : Colors.dangerBg,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={
                    (assetTab === "delivery"
                      ? activeTotals?.todayPct
                      : activeTotals?.unrealisedPct) >= 0
                      ? Colors.success
                      : Colors.danger
                  }
                  style={{ fontWeight: "700" }}
                >
                  {(assetTab === "delivery"
                    ? activeTotals?.todayPct
                    : activeTotals?.unrealisedPct) >= 0
                    ? "▲"
                    : "▼"}{" "}
                  {Math.abs(
                    (assetTab === "delivery"
                      ? activeTotals?.todayPct
                      : activeTotals?.unrealisedPct) ?? 0,
                  ).toFixed(2)}
                  %
                </AppText>
              </View>
            </View>
          </TouchableOpacity>

          {/* Delivery / Intraday toggle — keeps the two totals from being
              blended into one confusing number (e.g. exiting all intraday
              positions used to make the whole card total drop with no
              explanation of where the money "went"). */}
          <View style={styles.assetToggleRow}>
            <SegmentedToggle
              theme="neutral"
              value={assetTab}
              onChange={setAssetTab}
              options={[
                { key: "delivery", label: "Delivery" },
                {
                  key: "intraday",
                  label: `Intraday${intradayPositions.length ? ` (${intradayPositions.length})` : ""}`,
                },
              ]}
            />
          </View>

          <View style={styles.miniCardsRow}>
            {activePositions?.length > 0 ? (
              activePositions.slice(0, 2).map((position) => (
                <MiniHoldingCard
                  key={`${position.wallet_id}:${position.instrument_key}:${position.product_type}`}
                  ticker={position.symbol}
                  name={`₹${position.ltp?.toLocaleString("en-IN")}`}
                  change={`${position.unrealisedPct?.toFixed(2)}%`}
                  isPositive={position.unrealisedPnl >= 0}
                  logoUrl={`https://img.logo.dev/${
                    COMPANY_DOMAINS[position.symbol]
                  }?token=pk_Bym4BAakTJudMK4MGnfpnw`}
                  onPress={() =>
                    navigation.navigate("StockDetail", {
                      instrumentKey: position.instrument_key,
                      symbol: position.symbol,
                      name: position.name,
                      sector: position.sector,
                    })
                  }
                />
              ))
            ) : (
              <AppText
                variant="caption"
                color={Colors.textSecondary}
                style={styles.noHoldingsText}
              >
                {assetTab === "delivery"
                  ? "No Delivery Holdings Yet"
                  : "No Intraday Positions Today"}
              </AppText>
            )}
          </View>
        </Card>
      </View>

      {/* ── Index Section — LIVE DATA ────────────────────────────────────── */}
      <SectionHeader title="Index" />

      <View style={styles.miniCardsRow}>
        <MiniHoldingCard
          ticker="NIFTY 50"
          name={
            niftyLtp ? `₹${niftyLtp.toLocaleString("en-IN")}` : "Loading..."
          }
          change={niftyChange?.label ?? undefined}
          isPositive={niftyChange?.isPositive ?? true}
          logoUrl="https://img.logo.dev/nseindia.com?token=pk_Bym4BAakTJudMK4MGnfpnw"
        />
        <MiniHoldingCard
          ticker="BANK NIFTY"
          name={
            bankNiftyLtp
              ? `₹${bankNiftyLtp.toLocaleString("en-IN")}`
              : "Loading..."
          }
          change={bankNiftyChange?.label ?? undefined}
          isPositive={bankNiftyChange?.isPositive ?? true}
          logoUrl="https://img.logo.dev/nseindia.com?token=pk_Bym4BAakTJudMK4MGnfpnw"
        />
      </View>

      {/* ── Top Stocks ──────────────────────────────────────────────────── */}
      <SectionHeader title="Top Stocks" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {TOP_STOCKS.map(renderTopStock)}
      </ScrollView>

      {/* ── Large Cap ─────────────────────────────────────────────────── */}
      <SectionHeader
        title="Large Cap Stocks"
        style={{ marginTop: moderateScale(24) }}
      />
      {LARGE_CAP_KEYS.map(renderLiveStock)}

      {/* ── Mid Cap ───────────────────────────────────────────────────── */}
      <SectionHeader
        title="Mid Cap Stocks"
        style={{ marginTop: moderateScale(24) }}
      />
      {MID_CAP_KEYS.map(renderLiveStock)}

      {/* ── Small Cap ─────────────────────────────────────────────────── */}
      <SectionHeader
        title="Small Cap Stocks"
        style={{ marginTop: moderateScale(24) }}
      />
      {SMALL_CAP_KEYS.map(renderLiveStock)}
    </Screen>
  );
};

const styles = StyleSheet.create({
  heroSection: {
    marginHorizontal: -moderateScale(20),
    marginTop: -moderateScale(20),
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(20),
    paddingBottom: moderateScale(20),
    backgroundColor: Colors.primaryDark,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  scroll: {
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(20),
    paddingBottom: moderateScale(110),
    backgroundColor: Colors.background,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: moderateScale(22),
  },

  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.danger,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },

  // ── Live indicator ──────────────────────────────────────────────────────────
  wsDot: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(4),
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(6),
    borderRadius: 20,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },

  mainCard: {
    backgroundColor: "white",
    borderRadius: 24,
    padding: moderateScale(20),
    shadowColor: Colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    marginBottom: moderateScale(28),
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: moderateScale(18),
  },
  changeChip: {
    marginLeft: "auto",
    backgroundColor: Colors.successBg,
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(4),
    borderRadius: 20,
  },

  miniCardsRow: {
    flexDirection: "row",
    gap: moderateScale(10),
    marginBottom: moderateScale(18),
    minHeight: 58,
    alignItems: "center",
  },
  noHoldingsText: { paddingVertical: moderateScale(18) },
  assetToggleRow: {
    marginTop: moderateScale(4),
    marginBottom: moderateScale(14),
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: moderateScale(14),
    marginTop: moderateScale(24),
  },

  horizontalScroll: {
    gap: moderateScale(14),
    paddingRight: moderateScale(4),
    marginBottom: moderateScale(28),
  },
});

export default DashboardPage;
