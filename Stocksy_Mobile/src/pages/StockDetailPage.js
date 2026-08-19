import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  StatusBar,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BarChart } from "react-native-gifted-charts";
import { WebView } from "react-native-webview";

import useMarketData from "../hooks/useMarketData";
import useHistoricalData from "../hooks/useHistoricalData";
import ChartView from "../components/ChartView";
import useFundamentals from "../hooks/useFundamentals";
import SetAlertModal from "../components/SetAlertModal";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

const RANGES = ["1D", "1W", "1M", "3M", "1Y"];

const formatPrice = (ltp) =>
  ltp != null ? `₹${Number(ltp).toLocaleString("en-IN")}` : "—";

const calcChange = (ltp, cp) => {
  if (!ltp || !cp || cp === 0)
    return { label: "—", isPositive: true, value: 0, diff: 0 };
  const pct = ((ltp - cp) / cp) * 100;
  const diff = (ltp - cp).toFixed(2);
  return {
    label: `${Math.abs(pct).toFixed(2)}% ${pct >= 0 ? "▲" : "▼"}`,
    isPositive: pct >= 0,
    value: pct,
    diff,
  };
};

const StockDetailPage = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const {
    instrumentKey,
    symbol,
    name,
    sector = "Equity",
    domain,
  } = route.params;

  const [activeRange, setActiveRange] = useState("1M");
  const [alertModalVisible, setAlertModalVisible] = useState(false);

  const { prices, isConnected } = useMarketData();
  const {
    fundamentals,
    loading: fundamentalsLoading,
    error,
  } = useFundamentals(symbol);
  const live = prices[instrumentKey];
  const ltp = live?.ltp ?? null;
  const cp = live?.cp ?? null;
  const isLive = live?.isLive ?? false;
  const lastUpdated = live?.lastUpdated ?? null;
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated * 1000).toLocaleString("en-IN", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const {
    label: changeLabel,
    isPositive,
    value: changePct,
    diff,
  } = calcChange(ltp, cp);

  const { candles, loading: chartLoading } = useHistoricalData(
    instrumentKey,
    activeRange,
  );

  const accentColor = isPositive ? Colors.success : Colors.danger;
  const accentBg = isPositive
    ? "rgba(16,185,129,0.12)"
    : "rgba(239,68,68,0.12)";

  const [showFundamentals, setShowFundamentals] = useState(true);
  const [chartExpanded, setChartExpanded] = useState(false);

  const [showDetails, setShowDetails] = useState(true);
  const [financialType, setFinancialType] = useState("quarterly");
  const financialData = fundamentals?.financials?.[financialType] || [];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedData = financialData[selectedIndex];
  const profile = fundamentals?.profile;

  const shareholding = fundamentals?.shareholding?.quarters || [];

  const [selectedHoldingIndex, setSelectedHoldingIndex] = useState(0);

  const selectedHolding = shareholding[selectedHoldingIndex];

  useEffect(() => {
    if (financialData.length > 0) {
      setSelectedIndex(financialData.length - 1);
    }
  }, [financialType, financialData]);

  const revenueData = financialData.map((item, index) => ({
    value: item.revenue,

    label: item.period,

    frontColor:
      index === selectedIndex ? Colors.primary : "rgba(59,130,246,0.25)",

    onPress: () => setSelectedIndex(index),

    labelTextStyle: {
      color: index === selectedIndex ? Colors.text : Colors.textMuted,

      fontWeight: index === selectedIndex ? "700" : "500",

      fontSize: fontScale(Typography.tiny),
    },
  }));

  const profitData = financialData.map((item, index) => ({
    value: item.profit,

    frontColor:
      index === selectedIndex ? Colors.success : "rgba(16,185,129,0.25)",

    onPress: () => setSelectedIndex(index),
  }));

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Ionicons
            name="arrow-back"
            size={moderateScale(20)}
            color={Colors.text}
          />
        </TouchableOpacity>

        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {symbol}
        </Text>

        <TouchableOpacity
          onPress={() => setAlertModalVisible(true)}
          style={styles.alertBtn}
        >
          <Ionicons
            name="notifications-outline"
            size={moderateScale(20)}
            color={Colors.text}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {/* ── Company row ─────────────────────────────────────────────────── */}
        <View style={styles.companyRow}>
          {/* Logo */}
          <View style={styles.logoBox}>
            {domain ? (
              <Image
                source={{
                  uri: `https://img.logo.dev/${domain}?token=pk_Bym4BAakTJudMK4MGnfpnw`,
                }}
                style={styles.logo}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.logoFallback}>{symbol?.slice(0, 2)}</Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.companyName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.sectorLabel} numberOfLines={1}>
              {sector} · NSE
            </Text>
          </View>
        </View>

        {/* ── Price + change badge ─────────────────────────────────────────── */}
        <View style={styles.priceRow}>
          <Text style={styles.ltp}>{formatPrice(ltp)}</Text>

          <Text
            style={[
              styles.priceChange,
              {
                color: accentColor,
              },
            ]}
          >
            {`${changePct >= 0 ? "+" : ""}₹${Math.abs(diff)} (${changeLabel})`}
          </Text>
        </View>

        {/* ── Chart card ──────────────────────────────────────────────────── */}
        <View style={styles.chartCard}>
          {/* Chart fills the card */}
          <ChartView
            candles={candles}
            livePrice={ltp}
            isPositive={isPositive}
            loading={chartLoading}
            height={200}
          />

          {/* Range tabs + expand button share one row, so expand sits right beside 1Y */}
          <View style={styles.rangeRow}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r}
                onPress={() => setActiveRange(r)}
                style={[
                  styles.rangeTab,
                  activeRange === r && { backgroundColor: accentColor },
                ]}
              >
                <Text
                  style={[
                    styles.rangeLabel,
                    activeRange === r && styles.rangeLabelActive,
                  ]}
                >
                  {r}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.expandBtn}
              onPress={() => setChartExpanded(true)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="expand-outline"
                size={moderateScale(15)}
                color={Colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Expanded candlestick chart modal ────────────────────────────── */}
        <ExpandedChartModal
          visible={chartExpanded}
          symbol={symbol}
          name={name}
          ltp={ltp}
          changeLabel={changeLabel}
          isPositive={isPositive}
          accentColor={accentColor}
          accentBg={accentBg}
          candles={candles}
          chartLoading={chartLoading}
          onClose={() => setChartExpanded(false)}
        />

        {/* ── Details Dropdown ─────────────────────────────────────────── */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.dropdownHeader}
            onPress={() => setShowDetails(!showDetails)}
          >
            <View style={styles.sectionTitleRow}>
              <Ionicons
                name="information-circle-outline"
                size={moderateScale(18)}
                color="black"
              />

              <Text style={styles.cardTitle}>Details</Text>
            </View>

            <Ionicons
              name={showDetails ? "chevron-up" : "chevron-down"}
              size={moderateScale(18)}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>

          {showDetails && (
            <View style={styles.statsRow}>
              <StatPill
                label="Open"
                value={
                  candles.length > 0
                    ? formatPrice(candles[candles.length - 1]?.open)
                    : "—"
                }
              />
              <StatPill
                label="High"
                value={
                  candles.length > 0
                    ? formatPrice(candles[candles.length - 1]?.high)
                    : "—"
                }
                color={Colors.success}
              />
              <StatPill
                label="Low"
                value={
                  candles.length > 0
                    ? formatPrice(candles[candles.length - 1]?.low)
                    : "—"
                }
                color={Colors.danger}
              />
              <StatPill label="Close" value={formatPrice(cp)} />
            </View>
          )}
        </View>

        {/* ── Fundamentals Dropdown ───────────────────────────────────── */}
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.dropdownHeader}
            onPress={() => setShowFundamentals(!showFundamentals)}
          >
            <View style={styles.sectionTitleRow}>
              <Ionicons
                name="information-circle-outline"
                size={moderateScale(18)}
                color="black"
              />

              <Text style={styles.cardTitle}>Fundamentals</Text>
            </View>

            <Ionicons
              name={showFundamentals ? "chevron-up" : "chevron-down"}
              size={moderateScale(18)}
              color={Colors.textSecondary}
            />
          </TouchableOpacity>
          {showFundamentals && fundamentalsLoading && (
            <Text style={{ marginTop: moderateScale(12) }}>
              Loading fundamentals...
            </Text>
          )}
          {showFundamentals && error && (
            <Text style={{ color: "red", marginTop: moderateScale(12) }}>
              {error}
            </Text>
          )}
          {showFundamentals &&
            !fundamentalsLoading &&
            fundamentals?.metrics && (
              <View style={styles.fundamentalsGrid}>
                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>Market Cap</Text>
                  <Text style={styles.fundamentalValue}>
                    ₹
                    {Number(fundamentals.metrics.market_cap).toLocaleString(
                      "en-IN",
                    )}{" "}
                    Cr
                  </Text>
                </View>

                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>ROE</Text>
                  <Text style={styles.fundamentalValue}>
                    {fundamentals.metrics.roe}%
                  </Text>
                </View>

                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>P/E Ratio</Text>
                  <Text style={styles.fundamentalValue}>
                    {fundamentals.metrics.pe_ratio}
                  </Text>
                </View>

                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>Industry P/E</Text>
                  <Text style={styles.fundamentalValue}>
                    {fundamentals.metrics.industry_pe}
                  </Text>
                </View>

                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>Dividend Yield</Text>
                  <Text style={styles.fundamentalValue}>
                    {fundamentals.metrics.dividend_yield}%
                  </Text>
                </View>

                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>Book Value</Text>
                  <Text style={styles.fundamentalValue}>
                    {fundamentals.metrics.book_value}
                  </Text>
                </View>

                <View style={styles.fundamentalItem}>
                  <Text style={styles.fundamentalLabel}>Debt to Equity</Text>
                  <Text style={styles.fundamentalValue}>
                    {fundamentals.metrics.debt_to_equity}
                  </Text>
                </View>
              </View>
            )}
        </View>

        {/* ── Financial Performance ───────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Ionicons
              name="information-circle-outline"
              size={moderateScale(18)}
              color="black"
            />

            <Text style={styles.cardTitle}>Financial Performance</Text>
          </View>
          {selectedData && (
            <View style={styles.financialStatsRow}>
              {/* Revenue */}
              <View>
                <Text style={styles.financialStatLabel}>REVENUE (CR)</Text>

                <Text style={styles.financialStatValue}>
                  ₹
                  {selectedData?.revenue != null
                    ? Number(selectedData.revenue).toLocaleString("en-IN")
                    : "--"}
                </Text>
              </View>

              {/* Profit */}
              <View>
                <Text style={styles.financialStatLabel}>PROFIT (CR)</Text>

                <Text
                  style={[styles.financialStatValue, { color: Colors.success }]}
                >
                  ₹
                  {selectedData?.profit != null
                    ? Number(selectedData.profit).toLocaleString("en-IN")
                    : "--"}
                </Text>
              </View>
            </View>
          )}

          {/* Toggle Buttons */}
          <View style={styles.financialToggleRow}>
            <TouchableOpacity
              onPress={() => setFinancialType("quarterly")}
              style={[
                styles.financialToggleBtn,
                financialType === "quarterly" &&
                  styles.financialToggleBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.financialToggleText,
                  financialType === "quarterly" &&
                    styles.financialToggleTextActive,
                ]}
              >
                Quarterly
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setFinancialType("yearly")}
              style={[
                styles.financialToggleBtn,
                financialType === "yearly" && styles.financialToggleBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.financialToggleText,
                  financialType === "yearly" &&
                    styles.financialToggleTextActive,
                ]}
              >
                Yearly
              </Text>
            </TouchableOpacity>
          </View>

          <BarChart
            data={revenueData}
            secondaryData={profitData}
            barWidth={20}
            spacing={38}
            roundedTop
            hideRules
            xAxisThickness={0}
            yAxisThickness={0}
            noOfSections={4}
            disableScroll
            isAnimated
            initialSpacing={16}
            endSpacing={16}
            xAxisLabelTextStyle={{
              marginTop: moderateScale(12),
            }}
            yAxisTextStyle={{
              color: Colors.textMuted,
              fontSize: fontScale(10),
            }}
          />
        </View>

        {/* ── About Company ───────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Ionicons
              name="information-circle-outline"
              size={moderateScale(18)}
              color="black"
            />

            <Text style={styles.cardTitle}>About Company</Text>
          </View>

          {/* Description */}
          <Text style={styles.companyDescription}>
            {profile?.description || "No company description available."}
          </Text>

          <View style={styles.divider} />

          <AboutRow label="CEO" value={profile?.ceo || "--"} />

          <AboutRow label="Founded" value={profile?.founded || "--"} />

          <AboutRow label="NSE Symbol" value={profile?.nse_symbol || symbol} />

          <AboutRow label="Industry" value={profile?.industry || "--"} />
        </View>

        {/* ── Shareholding Pattern ───────────────────────── */}
        <View style={styles.card}>
          <View style={styles.sectionTitleRow}>
            <Ionicons
              name="information-circle-outline"
              size={moderateScale(18)}
              color="black"
            />

            <Text style={styles.cardTitle}>Shareholding Pattern</Text>
          </View>

          {/* Quarter Selector */}
          <View style={styles.holdingQuarterRow}>
            {shareholding.map((item, index) => (
              <TouchableOpacity
                key={item.period}
                onPress={() => setSelectedHoldingIndex(index)}
                style={[
                  styles.holdingQuarterChip,

                  selectedHoldingIndex === index &&
                    styles.holdingQuarterChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.holdingQuarterText,

                    selectedHoldingIndex === index &&
                      styles.holdingQuarterTextActive,
                  ]}
                >
                  {item.period}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Bars */}
          {selectedHolding?.data?.map((item) => (
            <View key={item.category} style={styles.shareholdingItem}>
              <View style={styles.shareholdingTopRow}>
                <Text style={styles.shareholdingLabel}>{item.category}</Text>

                <Text style={styles.shareholdingValue}>{item.value}%</Text>
              </View>

              {/* Progress Track */}
              <View style={styles.shareholdingTrack}>
                <View
                  style={[
                    styles.shareholdingBar,
                    {
                      width: `${item.value}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* ── Action bar ──────────────────────────────────────────────────────── */}
      <View
        style={[
          styles.actionBar,
          { paddingBottom: moderateScale(12) + insets.bottom },
        ]}
      >
        <TouchableOpacity
          style={styles.sellBtn}
          onPress={() => {
            navigation.navigate("BuyOrder", {
              instrumentKey,
              symbol,
              name,
              sector,
              orderType: "SELL",
            });
          }}
        >
          <Text style={styles.sellText}>Sell</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.buyBtn}
          onPress={() => {
            navigation.navigate("BuyOrder", {
              instrumentKey,
              symbol,
              name,
              sector,
              orderType: "BUY",
            });
          }}
        >
          <Text style={styles.buyText}>Buy</Text>
        </TouchableOpacity>
      </View>

      <SetAlertModal
        visible={alertModalVisible}
        onClose={() => setAlertModalVisible(false)}
        instrumentKey={instrumentKey}
        symbol={symbol}
        name={name}
        ltp={ltp}
      />
    </SafeAreaView>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const StatPill = ({ label, value, color = Colors.text }) => (
  <View style={styles.statPill}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
  </View>
);

const AboutRow = ({ label, value, valueColor = Colors.text, last = false }) => (
  <>
    <View style={styles.aboutRow}>
      <Text style={styles.aboutLabel}>{label}</Text>
      <Text style={[styles.aboutValue, { color: valueColor }]}>{value}</Text>
    </View>
    {!last && <View style={styles.divider} />}
  </>
);

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(12),
    paddingBottom: moderateScale(10),
  },
  backBtn: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(10),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
    marginRight: moderateScale(12),
    flexShrink: 0,
  },
  alertBtn: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(10),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: moderateScale(12),
    flexShrink: 0,
  },
  headerTitle: {
    flex: 1,
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: -0.3,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(5),
    borderRadius: moderateScale(20),
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: fontScale(Typography.small), fontWeight: "600" },

  scroll: { paddingBottom: moderateScale(110) },

  // Company row
  companyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(20),
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(12),
    gap: moderateScale(12),
  },
  logoBox: {
    width: moderateScale(44),
    height: moderateScale(44),
    borderRadius: moderateScale(12),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  logo: { width: 36, height: 36, borderRadius: 8 },
  logoFallback: {
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
    color: Colors.primary,
  },
  companyName: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.text,
  },
  sectorLabel: {
    fontSize: fontScale(Typography.small),
    color: Colors.textMuted,
    marginTop: moderateScale(2),
  },

  // Price
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(20),
    gap: moderateScale(12),
  },
  ltp: {
    fontSize: fontScale(Typography.display),
    fontWeight: "700",
    color: Colors.text,
    letterSpacing: -0.4,
    lineHeight: moderateScale(38),
  },
  changeBadge: {
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(5),
    borderRadius: moderateScale(20),
  },
  changeBadgeText: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "700",
  },

  // Chart card — white card like the reference image
  chartCard: {
    marginHorizontal: moderateScale(16),
    borderRadius: moderateScale(20),
    paddingTop: moderateScale(16),
    paddingBottom: moderateScale(12),
    marginBottom: moderateScale(16),
    shadowColor: Colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: "hidden",
  },

  // Expand button — floats at bottom-right inside chartCard above range tabs
  expandBtn: {
    width: moderateScale(30),
    height: moderateScale(30),
    borderRadius: moderateScale(15),
    backgroundColor: Colors.divider,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },

  // Range tabs + expand button — inside card at bottom, sharing one row
  rangeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(12),
  },
  rangeTab: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(7),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.divider,
  },
  rangeLabel: {
    fontSize: fontScale(Typography.small),
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  rangeLabelActive: {
    color: Colors.white,
    fontWeight: "700",
  },

  // Stats row
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: moderateScale(16),
    gap: moderateScale(8),
    marginBottom: moderateScale(16),
  },
  dropdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statPill: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: moderateScale(14),
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(8),
    alignItems: "center",
    shadowColor: Colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  statLabel: {
    fontSize: fontScale(10),
    color: Colors.textMuted,
    fontWeight: "500",
    marginBottom: moderateScale(4),
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  statValue: {
    fontSize: fontScale(Typography.small),
    fontWeight: "700",
    color: Colors.text,
  },

  // About card
  card: {
    marginHorizontal: moderateScale(16),
    backgroundColor: Colors.white,
    borderRadius: moderateScale(20),
    padding: moderateScale(16),
    shadowColor: Colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    marginBottom: moderateScale(12),
  },
  cardTitle: {
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
    color: Colors.text,
  },
  aboutRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: moderateScale(11),
  },
  divider: { height: 1, backgroundColor: Colors.background },
  aboutLabel: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textMuted,
  },
  aboutValue: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.text,
  },

  // Credit
  credit: {
    textAlign: "center",
    fontSize: fontScale(10),
    color: Colors.borderLight,
    marginBottom: moderateScale(4),
  },

  // Action bar
  actionBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(12),
    // paddingBottom removed from here — now applied dynamically above
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
    gap: moderateScale(12),
  },
  sellBtn: {
    flex: 1,
    paddingVertical: moderateScale(15),
    borderRadius: moderateScale(14),
    backgroundColor: Colors.lossBg,
    alignItems: "center",
  },
  sellText: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.danger,
  },
  buyBtn: {
    flex: 1,
    paddingVertical: moderateScale(15),
    borderRadius: moderateScale(14),
    backgroundColor: Colors.primary,
    alignItems: "center",
  },
  buyText: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.white,
  },

  fundamentalsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: moderateScale(10),
  },

  fundamentalItem: {
    width: "48%",
    marginBottom: moderateScale(20),
    borderRightWidth: 0.5,
    borderColor: Colors.border,
    paddingRight: moderateScale(10),
  },

  fundamentalLabel: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
    marginBottom: moderateScale(6),
  },

  fundamentalValue: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
  },

  financialToggleRow: {
    flexDirection: "row",
    backgroundColor: Colors.divider,
    borderRadius: moderateScale(12),
    padding: moderateScale(4),
    marginBottom: moderateScale(20),
  },

  financialToggleBtn: {
    flex: 1,
    paddingVertical: moderateScale(10),
    borderRadius: moderateScale(10),
    alignItems: "center",
  },

  financialToggleBtnActive: {
    backgroundColor: Colors.white,
  },

  financialToggleText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },

  financialToggleTextActive: {
    color: Colors.text,
    fontWeight: "700",
  },

  financialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: moderateScale(18),
  },

  financialPeriod: {
    fontSize: fontScale(Typography.caption),
    color: Colors.textSecondary,
  },

  financialRevenue: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    textAlign: "right",
  },

  financialProfit: {
    fontSize: fontScale(Typography.small),
    color: Colors.textMuted,
    marginTop: moderateScale(4),
    textAlign: "right",
  },

  legendRow: {
    flexDirection: "row",
    gap: moderateScale(24),
    marginBottom: moderateScale(20),
  },

  legendItem: {
    flexDirection: "row",
    alignItems: "center",
  },

  legendDot: {
    width: moderateScale(10),
    height: moderateScale(10),
    borderRadius: moderateScale(3),
    marginRight: moderateScale(8),
  },

  legendText: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    fontWeight: "600",
  },

  financialStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: moderateScale(24),
  },

  financialStatLabel: {
    fontSize: fontScale(Typography.small),
    color: Colors.textMuted,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: moderateScale(6),
  },

  financialStatValue: {
    fontSize: fontScale(Typography.h1),
    fontWeight: "800",
    color: Colors.text,
  },

  periodSelectorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: moderateScale(10),
    marginTop: moderateScale(24),
  },

  periodChip: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.divider,
  },

  periodChipText: {
    color: Colors.textSecondary,
    fontWeight: "600",
    fontSize: fontScale(Typography.small),
  },

  companyDescription: {
    fontSize: fontScale(14),
    lineHeight: moderateScale(24),
    color: Colors.textSecondary,
    marginBottom: moderateScale(18),
  },

  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    marginBottom: moderateScale(12),
  },

  holdingQuarterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: moderateScale(10),
    marginBottom: moderateScale(24),
  },

  holdingQuarterChip: {
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(8),
    borderRadius: moderateScale(20),
    backgroundColor: Colors.divider,
  },

  holdingQuarterChipActive: {
    backgroundColor: "rgba(59,130,246,0.12)",
  },

  holdingQuarterText: {
    color: Colors.textSecondary,
    fontWeight: "600",
    fontSize: fontScale(Typography.small),
  },

  holdingQuarterTextActive: {
    color: Colors.primary,
    fontWeight: "700",
  },

  shareholdingItem: {
    marginBottom: moderateScale(24),
  },

  shareholdingTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: moderateScale(10),
  },

  shareholdingLabel: {
    fontSize: fontScale(14),
    color: Colors.text,
    fontWeight: "500",
  },

  shareholdingValue: {
    fontSize: fontScale(14),
    color: Colors.text,
    fontWeight: "700",
  },

  shareholdingTrack: {
    height: moderateScale(10),
    backgroundColor: Colors.border,
    borderRadius: moderateScale(10),
    overflow: "hidden",
  },

  shareholdingBar: {
    height: "100%",
    backgroundColor: Colors.primary,
    borderRadius: moderateScale(10),
  },
});

// ── Expanded Chart Modal ──────────────────────────────────────────────────
/**
 * Full-screen candlestick + volume chart, built on our own OHLC data
 * (ChartView in "candles" mode) rather than TradingView's widget — so it
 * always shows this stock's actual price, no symbol mapping required.
 */
const ExpandedChartModal = ({
  visible,
  symbol,
  name,
  ltp,
  changeLabel,
  isPositive,
  accentColor,
  accentBg,
  candles,
  chartLoading,
  onClose,
}) => {
  // Modals render on a separate native surface, so the automatic
  // SafeAreaView behavior (and the insets read at the screen level)
  // aren't reliable in here — especially with statusBarTranslucent,
  // which draws our content underneath the status bar. Read insets
  // directly inside the modal and push the header down manually.
  const modalInsets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.chartBg} />
      <View style={[tvStyles.safe, { paddingTop: modalInsets.top }]}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={tvStyles.header}>
          {/* Symbol + company name */}
          <View style={tvStyles.left}>
            <Text style={tvStyles.symbol}>{symbol}</Text>
            <Text style={tvStyles.name} numberOfLines={1}>
              {name}
            </Text>
          </View>

          {/* Live price + change badge */}
          <View style={tvStyles.centre}>
            <Text style={tvStyles.ltp}>
              {ltp != null ? `₹${Number(ltp).toLocaleString("en-IN")}` : "—"}
            </Text>
            <View style={[tvStyles.badge, { backgroundColor: accentBg }]}>
              <Text style={[tvStyles.badgeText, { color: accentColor }]}>
                {changeLabel}
              </Text>
            </View>
          </View>

          {/* Close */}
          <TouchableOpacity
            style={tvStyles.closeBtn}
            onPress={onClose}
            activeOpacity={0.75}
          >
            <Ionicons
              name="close"
              size={moderateScale(18)}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* ── Candlestick + volume chart, fed from our own OHLC data ────
             Only mount the WebView while the modal is actually visible.
             RN's <Modal> doesn't reliably attach/load its children until
             shown, so a WebView created while still hidden can get stuck
             with onLoadEnd never firing — which permanently blocks live
             price injection and freezes the chart on its first static
             price. Conditionally mounting forces a clean load every time
             the modal opens. ── */}
        <View style={{ flex: 1, backgroundColor: Colors.chartBg }}>
          {visible && (
            <ChartView
              key={symbol}
              candles={candles}
              livePrice={ltp}
              isPositive={isPositive}
              loading={chartLoading}
              chartType="candles"
              showVolume
              height={"100%"}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const tvStyles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.chartBg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: moderateScale(16),
    paddingVertical: moderateScale(12),
    backgroundColor: Colors.chartBg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.chartSurface,
    gap: moderateScale(8),
  },
  left: {
    flex: 1.2,
  },
  symbol: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    color: Colors.background,
    letterSpacing: -0.3,
  },
  name: {
    fontSize: fontScale(Typography.tiny),
    color: Colors.textSecondary,
    marginTop: moderateScale(1),
  },
  centre: {
    flex: 1,
    alignItems: "flex-end",
  },
  ltp: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "800",
    color: Colors.background,
    letterSpacing: -0.5,
  },
  badge: {
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(20),
    marginTop: moderateScale(4),
  },
  badgeText: {
    fontSize: fontScale(Typography.tiny),
    fontWeight: "700",
  },
  closeBtn: {
    width: moderateScale(34),
    height: moderateScale(34),
    borderRadius: moderateScale(17),
    backgroundColor: Colors.chartSurface,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: moderateScale(6),
  },
});

export default StockDetailPage;