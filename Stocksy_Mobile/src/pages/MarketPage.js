// src/pages/MarketPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Markets screen — mood, indices, gainers, losers, sector performance.
// Data flow:  useMarketData (WebSocket) → this page computes everything
//             (mood %, gainers/losers, sector avg) client-side from live ticks.
// No new backend endpoint needed for this version — see NOTE blocks below
// for the two things that DO need backend work (indices coverage, and any
// future volume/view-based cards).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import useMarketData from '../hooks/useMarketData';
import { SECTOR_COLORS } from '../hooks/usePortfolio';

import { Colors, Typography, fontScale, moderateScale } from "../theme";

// ─── Design tokens — matches PortfolioPage / StockDetailPage, not the
// generic theme/Card system, so Markets sits visually with the rest of
// the live-data screens. ──────────────────────────────────────────────
const C = {
  blue: Colors.primaryDark,
  blueDark: Colors.primaryDark,
  green: Colors.success,
  greenBg: Colors.gainBg,
  red: Colors.dangerDark,
  redBg: Colors.lossBg,
  bg: Colors.primaryLight,
  white: Colors.white,
  textPri: Colors.text,
  textSec: Colors.textSecondary,
  textTer: Colors.textMuted,
  border: Colors.border,
};

// ─── Utility helpers — same conventions as PortfolioPage.js ──────────────────
function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return (
    '₹' +
    Math.abs(n).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

function MarketMoodBanner({ percentage, positiveCount, total }) {
  const isPositive = percentage >= 50;
  return (
    <View style={styles.moodBanner}>
      <View style={styles.moodCircle}>
        <Text style={styles.moodPercentage}>{percentage}%</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.moodLabel}>
          Market is mostly {isPositive ? 'positive' : 'negative'} today
        </Text>
        <Text style={styles.moodSubtext}>
          {positiveCount} of {total} tracked stocks are up
        </Text>
      </View>
    </View>
  );
}

function IndexTile({ item, onPress }) {
  const isUp = item.changePct >= 0;
  return (
    <TouchableOpacity style={styles.indexCard} onPress={onPress} activeOpacity={0.75}>
      <Text style={styles.indexSymbol}>{item.symbol}</Text>
      <Text style={styles.indexValue}>{fmt(item.ltp, 2)}</Text>
      <Text style={[styles.indexChange, { color: isUp ? C.green : C.red }]}>
        {fmtPct(item.changePct)}
      </Text>
    </TouchableOpacity>
  );
}

function StockListCard({ title, icon, data, onPressItem }) {
  if (data.length === 0) return null;
  return (
    <View>
      <View style={styles.cardHeaderRow}>
        {icon ? (
          <Ionicons name={icon} size={14} color={C.textSec} style={{ marginRight: moderateScale(6) }} />
        ) : null}
        <Text style={styles.sectionLabel}>{title}</Text>
      </View>

      <View style={styles.card}>
        {data.map((item, idx) => {
          const isUp = item.changePct >= 0;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.listRow, idx === data.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => onPressItem(item)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.listSymbol}>{item.symbol}</Text>
                <Text style={styles.listName} numberOfLines={1}>
                  {item.name}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.listPrice}>{fmt(item.ltp, 2)}</Text>
                <Text style={{ color: isUp ? C.green : C.red, fontWeight: '600', fontSize: fontScale(Typography.small) }}>
                  {fmtPct(item.changePct)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function SectorPerformanceCard({ sectors }) {
  if (sectors.length === 0) return null;
  const totalWeight = sectors.reduce((sum, s) => sum + Math.abs(s.changePct), 0) || 1;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionLabel}>Sector performance</Text>

      <View style={styles.sectorBar}>
        {sectors.map((s) => (
          <View
            key={s.name}
            style={{
              flex: Math.max(Math.abs(s.changePct) / totalWeight, 0.02),
              backgroundColor: s.color,
              height: '100%',
            }}
          />
        ))}
      </View>

      {sectors.map((s, idx) => {
        const isUp = s.changePct >= 0;
        return (
          <View
            key={s.name}
            style={[styles.listRow, idx === sectors.length - 1 && { borderBottomWidth: 0 }]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={[styles.sectorDot, { backgroundColor: s.color }]} />
              <Text style={styles.listSymbol}>{s.name}</Text>
            </View>
            <Text style={{ color: isUp ? C.green : C.red, fontWeight: '600', fontSize: fontScale(Typography.caption) }}>
              {fmtPct(s.changePct)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────

export default function MarketPage({ navigation }) {
  const insets = useSafeAreaInsets();
  const { prices, isConnected } = useMarketData();

  const goToStock = (item) => {
    navigation.navigate('StockDetail', {
      instrumentKey: item.key,
      symbol: item.symbol,
      name: item.name,
      sector: item.sector,
    });
  };

  // ── Flatten the live WS feed into a sortable list, recomputed on
  // every tick since `prices` changes reference each update. ────────────
  const stockList = useMemo(() => {
    return Object.entries(prices).map(([key, data]) => {
      const ltp = data.ltp || 0;
      const cp = data.cp || 0;
      const changePct = cp > 0 ? ((ltp - cp) / cp) * 100 : 0;
      return {
        key,
        symbol: data.symbol || key,
        name: data.name || key,
        sector: data.sector || 'Other',
        ltp,
        cp,
        changePct,
      };
    });
  }, [prices]);

  // NOTE: only Nifty 50 and Bank Nifty are in the Python feed's
  // INSTRUMENT_KEYS today. Sensex and Fin Nifty need their instrument
  // keys added to backend_py/websocket_client.py + config/instruments.js
  // before they can show up here — this screen doesn't fake them.
  const indices = useMemo(
    () => stockList.filter((s) => s.sector === 'Index'),
    [stockList]
  );

  const equities = useMemo(
    () => stockList.filter((s) => s.sector !== 'Index' && s.cp > 0),
    [stockList]
  );

  const mood = useMemo(() => {
    const total = equities.length;
    const positiveCount = equities.filter((s) => s.changePct > 0).length;
    const percentage = total > 0 ? Math.round((positiveCount / total) * 100) : 0;
    return { percentage, positiveCount, total };
  }, [equities]);

  const gainers = useMemo(
    () => [...equities].sort((a, b) => b.changePct - a.changePct).slice(0, 4),
    [equities]
  );

  const losers = useMemo(
    () => [...equities].sort((a, b) => a.changePct - b.changePct).slice(0, 4),
    [equities]
  );

  // NOTE: SECTOR_COLORS (from usePortfolio.js) uses slightly different
  // keys than config/instruments.js in a few places (e.g. "Metal" vs
  // "Metals", "Infra" vs "Infrastructure") — those fall back to the
  // generic fallback color below until that map is reconciled.
  const sectorPerformance = useMemo(() => {
    const groups = {};
    equities.forEach((s) => {
      if (!groups[s.sector]) groups[s.sector] = { total: 0, count: 0 };
      groups[s.sector].total += s.changePct;
      groups[s.sector].count += 1;
    });

    return Object.entries(groups)
      .map(([name, { total, count }]) => ({
        name,
        changePct: total / count,
        color: SECTOR_COLORS[name] || SECTOR_COLORS.Other || C.textTer,
      }))
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 6);
  }, [equities]);

  const isLoading = !isConnected && stockList.length === 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={C.blue} />
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={[styles.header, { paddingTop: insets.top + moderateScale(8) }]}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerTitle}>Markets</Text>
          </View>
          <MarketMoodBanner
            percentage={mood.percentage}
            positiveCount={mood.positiveCount}
            total={mood.total}
          />
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={C.blue} />
            <Text style={styles.loadingText}>Connecting to live market feed…</Text>
          </View>
        ) : (
          <View style={styles.body}>
            {indices.length > 0 && (
              <View>
                <Text style={styles.sectionLabel}>Indices</Text>
                <View style={styles.indicesGrid}>
                  {indices.map((item) => (
                    <IndexTile key={item.key} item={item} onPress={() => goToStock(item)} />
                  ))}
                </View>
              </View>
            )}

            <StockListCard
              title="Top gainers"
              icon="trending-up"
              data={gainers}
              onPressItem={goToStock}
            />

            <StockListCard
              title="Top losers"
              icon="trending-down"
              data={losers}
              onPressItem={goToStock}
            />

            <SectorPerformanceCard sectors={sectorPerformance} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(8),
    paddingBottom: moderateScale(20),
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTopRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: moderateScale(14),
  },
  headerTitle: {
    color: C.white,
    fontSize: fontScale(Typography.h3),
    fontWeight: '600',
  },
  moodBanner: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 16,
    padding: moderateScale(14),
    flexDirection: 'row',
    alignItems: 'center',
  },
  moodCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: moderateScale(12),
  },
  moodPercentage: {
    color: C.white,
    fontSize: fontScale(14),
    fontWeight: '600',
  },
  moodLabel: {
    color: C.white,
    fontSize: fontScale(14),
    fontWeight: '500',
    marginBottom: moderateScale(2),
  },
  moodSubtext: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: fontScale(Typography.small),
  },
  loadingBox: {
    paddingVertical: moderateScale(60),
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: moderateScale(12),
    fontSize: fontScale(Typography.caption),
    color: C.textSec,
  },
  body: {
    paddingHorizontal: moderateScale(14),
    paddingTop: moderateScale(16),
    paddingBottom: moderateScale(24),
    gap: moderateScale(14),
  },
  sectionLabel: {
    fontSize: fontScale(Typography.body),
    fontWeight: '600',
    color: C.textPri,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: moderateScale(8),
    paddingHorizontal: moderateScale(2),
  },
  indicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: moderateScale(8),
    marginBottom: moderateScale(14),
  },
  indexCard: {
    width: '48.5%',
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    padding: moderateScale(12),
    marginBottom: moderateScale(10),
  },
  indexSymbol: {
    fontSize: fontScale(Typography.small),
    color: C.textSec,
    marginBottom: moderateScale(4),
  },
  indexValue: {
    fontSize: fontScale(Typography.body),
    fontWeight: '600',
    color: C.textPri,
    marginBottom: moderateScale(2),
  },
  indexChange: {
    fontSize: fontScale(Typography.small),
    fontWeight: '600',
  },
  card: {
    backgroundColor: C.white,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    padding: moderateScale(12),
  },
  listRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: moderateScale(9),
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  listSymbol: {
    fontSize: fontScale(Typography.caption),
    fontWeight: '600',
    color: C.textPri,
  },
  listName: {
    fontSize: fontScale(Typography.tiny),
    color: C.textTer,
    marginTop: moderateScale(1),
  },
  listPrice: {
    fontSize: fontScale(Typography.caption),
    fontWeight: '600',
    color: C.textPri,
  },
  sectorBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: moderateScale(8),
    marginBottom: moderateScale(10),
  },
  sectorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: moderateScale(8),
  },
});