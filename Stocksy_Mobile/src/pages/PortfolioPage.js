// src/pages/PortfolioPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Fully dynamic portfolio screen.
// Data flows:  useMarketData (WebSocket) → usePortfolio (enriches positions)
//                                        → this page (renders live)
// Every field — prices, P&L, allocation — updates in real-time.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, ActivityIndicator,
  Animated, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import useMarketData from '../hooks/useMarketData';
import { usePortfolio, SECTOR_COLORS } from '../hooks/usePortfolio';
import { SegmentedToggle, IntradayPositionsView } from '../components';
import {
  Colors, Typography, Shadows,
  SCREEN_WIDTH, moderateScale, fontScale,
} from '../theme';

// ─── Utility helpers ──────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  return '₹' + Math.abs(n).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function sign(n) {
  return n >= 0 ? 'pos' : 'neg';
}

// ─── Reusable: PnlText — colour + optional prefix arrow ──────────────────────
function PnlText({ value, pct, style, size }) {
  const isPos = value >= 0;
  const color = isPos ? Colors.gain : Colors.loss;
  return (
    <Text style={[{ fontSize: size ?? fontScale(Typography.caption), fontWeight: '600', color }, style]}>
      {isPos ? '+' : '-'}{fmt(value)}
      {pct != null ? `  (${fmtPct(pct)})` : ''}
    </Text>
  );
}

// ─── Reusable: StatTile — small metric card ────────────────────────────────
function StatTile({ label, value, sub, subColor, icon, iconColor }) {
  return (
    <View style={styles.tile}>
      {icon && (
        <View style={[styles.tileIconWrap, { backgroundColor: (iconColor ?? Colors.primary) + '18' }]}>
          <Ionicons name={icon} size={moderateScale(16)} color={iconColor ?? Colors.primary} />
        </View>
      )}
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub != null && (
        <Text style={[styles.tileSub, { color: subColor ?? Colors.textSecondary }]} numberOfLines={1}>{sub}</Text>
      )}
    </View>
  );
}

// ─── Reusable: SectionCard ────────────────────────────────────────────────────
function SectionCard({ title, action, onAction, children }) {
  return (
    <View style={styles.card}>
      {(title || action) && (
        <View style={styles.cardHeader}>
          {title && <Text style={styles.cardTitle}>{title}</Text>}
          {action && (
            <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.cardAction}>{action}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

// ─── Reusable: HoldingRow — live flashing price on change ─────────────────────
function HoldingRow({ position, onPress }) {
  const flashAnim = useRef(new Animated.Value(0)).current;
  const prevLtp   = useRef(position.ltp);

  useEffect(() => {
    if (prevLtp.current !== position.ltp && position.ltp != null) {
      prevLtp.current = position.ltp;
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 120, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 0, duration: 400, useNativeDriver: false }),
      ]).start();
    }
  }, [position.ltp]);

  const flashBg = flashAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [
      'rgba(0,0,0,0)',
      position.unrealisedPnl >= 0 ? 'rgba(0,208,156,0.10)' : 'rgba(239,68,68,0.10)',
    ],
  });

  const isPos = position.unrealisedPnl >= 0;
  // Sector colour dot
  const dotColor = SECTOR_COLORS[position.sector] ?? SECTOR_COLORS.Other;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
      <Animated.View style={[styles.holdingRow, { backgroundColor: flashBg }]}>
        {/* Sector dot */}
        <View style={[styles.sectorDot, { backgroundColor: dotColor }]} />

        <View style={styles.holdingInfo}>
          <Text style={styles.holdingSymbol} numberOfLines={1}>{position.symbol ?? position.instrument_key}</Text>
          <Text style={styles.holdingMeta} numberOfLines={1}>{position.name}</Text>
        </View>

        <View style={styles.holdingQty}>
          <Text style={styles.holdingQtyText} numberOfLines={1}>{position.qty} shares</Text>
          <Text style={styles.holdingAvg} numberOfLines={1}>Avg {fmt(position.avgCost)}</Text>
        </View>

        <View style={styles.holdingRight}>
          <Text style={styles.holdingLtp} numberOfLines={1}>
            {position.ltp != null ? fmt(position.ltp) : '—'}
          </Text>
          <Text style={[styles.holdingPnl, { color: isPos ? Colors.gain : Colors.loss }]} numberOfLines={1}>
            {fmtPct(position.unrealisedPct)}
          </Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

// ─── Reusable: SectorBar ─────────────────────────────────────────────────────
function SectorBar({ allocation }) {
  if (!allocation?.length) return null;
  return (
    <View>
      {/* Segmented bar */}
      <View style={styles.allocBarWrap}>
        {allocation.map((item, i) => (
          <View
            key={item.sector}
            style={[
              styles.allocSegment,
              { flex: item.pct, backgroundColor: item.color },
              i === 0 && { borderTopLeftRadius: moderateScale(6), borderBottomLeftRadius: moderateScale(6) },
              i === allocation.length - 1 && { borderTopRightRadius: moderateScale(6), borderBottomRightRadius: moderateScale(6) },
            ]}
          />
        ))}
      </View>
      {/* Legend */}
      <View style={styles.allocLegend}>
        {allocation.map(item => (
          <View key={item.sector} style={styles.allocLegendItem}>
            <View style={[styles.allocDot, { backgroundColor: item.color }]} />
            <Text style={styles.allocLegendText} numberOfLines={1}>{item.sector} {item.pct}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Reusable: PerformerCard ──────────────────────────────────────────────────
function PerformerCard({ label, position, labelColor }) {
  if (!position) return null;
  const isPos = position.unrealisedPnl >= 0;
  return (
    <View style={[styles.performerCard, { borderLeftColor: labelColor, borderLeftWidth: moderateScale(3) }]}>
      <Text style={[styles.performerLabel, { color: labelColor }]} numberOfLines={1}>{label}</Text>
      <Text style={styles.performerSymbol} numberOfLines={1}>{position.symbol}</Text>
      <Text style={styles.performerName} numberOfLines={1}>{position.name}</Text>
      <PnlText value={position.unrealisedPnl} pct={position.unrealisedPct} size={fontScale(Typography.small)} />
    </View>
  );
}

// ─── Reusable: PnlBreakdownRow ────────────────────────────────────────────────
function PnlBreakdownRow({ label, value, pct, dimmed }) {
  const isPos = value >= 0;
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, dimmed && { color: Colors.textMuted }]}>{label}</Text>
      <View style={styles.breakdownRight}>
        <Text style={[styles.breakdownValue, { color: isPos ? Colors.gain : Colors.loss }]} numberOfLines={1}>
          {isPos ? '+' : '-'}{fmt(value)}
        </Text>
        {pct != null && (
          <Text style={[styles.breakdownPct, { color: isPos ? Colors.gain : Colors.loss }]} numberOfLines={1}>
            {fmtPct(pct)}
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PortfolioPage({ navigation }) {
  const insets = useSafeAreaInsets();
  // refresh() isn't defined until usePortfolio() runs below, but
  // useMarketData needs a callback right now — a ref bridges the two so
  // the ORDER_FILLED/RMS_SQUARE_OFF handler always calls the LATEST
  // refresh without a circular hook dependency.
  const refreshRef = useRef(() => {});
  const { prices } = useMarketData(() => refreshRef.current());          // live WS prices
  const {
    // Holdings (CNC/delivery) — what this screen calls the "Holdings" tab
    holdingsPositions: positions,
    holdingsTotals: totals,
    holdingsSectorAllocation: sectorAllocation,
    holdingsBestPerformer: bestPerformer,
    holdingsWorstPerformer: worstPerformer,

    // Positions (MIS/intraday) — the "Positions" tab
    intradayPositions,
    intradayTotals,

    wallets,
    loading, error, refresh,
  } = usePortfolio(prices);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Holdings vs Positions toggle — delivery (CNC) and intraday (MIS) positions
  // are economically different things (different lifecycle, different risk),
  // so they get their own tabs instead of being shown mixed together.
  const [tab, setTab] = useState('holdings');

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />
        <View style={[styles.header, { paddingTop: insets.top + moderateScale(8) }]}>
          <Text style={styles.headerTitle}>Portfolio</Text>
          <View style={{ width: moderateScale(36) }} />
        </View>
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loaderText}>Loading portfolio…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <SafeAreaView style={styles.safe} edges={["left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />
        <View style={[styles.header, { paddingTop: insets.top + moderateScale(8) }]}>
          <Text style={styles.headerTitle}>Portfolio</Text>
          <View style={{ width: moderateScale(36) }} />
        </View>
        <View style={styles.loaderWrap}>
          <Ionicons name="cloud-offline-outline" size={moderateScale(40)} color={Colors.textMuted} />
          <Text style={styles.errorText}>Couldn't load portfolio</Text>
          <Text style={styles.errorSub}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={refresh}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const noPositions = positions.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.primaryDark} />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + moderateScale(8) }]}>
        <View style={{ width: moderateScale(36) }} />
        <Text style={styles.headerTitle}>Portfolio</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('Wallet')}
        >
          <Ionicons name="add" size={moderateScale(22)} color={Colors.white} />
        </TouchableOpacity>
      </View>

      {/* ── Holdings / Positions toggle ── */}
      <View style={styles.toggleRow}>
        <SegmentedToggle
          theme="light"
          value={tab}
          onChange={setTab}
          options={[
            { key: 'holdings', label: 'Holdings' },
            { key: 'positions', label: `Positions${intradayPositions.length ? ` (${intradayPositions.length})` : ''}` },
          ]}
        />
      </View>

      {/* ── Positions (MIS/intraday) tab — dark Groww-style view ── */}
      {tab === 'positions' && (
        <IntradayPositionsView
          positions={intradayPositions}
          totals={intradayTotals}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onExited={refresh}
          onPressPosition={(pos) =>
            navigation.navigate('StockDetail', {
              instrumentKey: pos.instrument_key,
              symbol: pos.symbol,
              name: pos.name,
              sector: pos.sector,
            })
          }
        />
      )}

      {/* ── Holdings (CNC/delivery) tab — everything below is unchanged ── */}
      {tab === 'holdings' && (
      <>
      {/* ── Hero: Portfolio Value ── */}
      <View style={styles.heroZone}>
        <Text style={styles.heroLabel}>Portfolio Value</Text>
        <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>{fmt(totals.portfolioValue)}</Text>
        <View style={styles.heroRow}>
          {/* Today badge */}
          <View style={[
            styles.badge,
            { backgroundColor: totals.totalToday >= 0 ? 'rgba(0,208,156,0.25)' : 'rgba(239,68,68,0.25)' }
          ]}>
            <Ionicons
              name={totals.totalToday >= 0 ? 'caret-up' : 'caret-down'}
              size={moderateScale(11)}
              color={totals.totalToday >= 0 ? '#6EE7B7' : '#FCA5A5'}
            />
            <Text style={[styles.badgeText, {
              color: totals.totalToday >= 0 ? '#6EE7B7' : '#FCA5A5'
            }]}>
              {fmtPct(totals.todayPct)} today
            </Text>
          </View>
          {/* Invested */}
          <Text style={styles.heroSub} numberOfLines={1}>
            Invested {fmt(totals.totalInvested)}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* ── 4 stat tiles ── */}
        <View style={styles.tileGrid}>
          <StatTile
            label="Today's Return"
            value={(totals.totalToday >= 0 ? '+' : '-') + fmt(totals.totalToday)}
            sub={fmtPct(totals.todayPct)}
            subColor={totals.totalToday >= 0 ? Colors.gain : Colors.loss}
            icon="today-outline"
            iconColor={totals.totalToday >= 0 ? Colors.gain : Colors.loss}
          />
          <StatTile
            label="Lifetime Return"
            value={(totals.totalLifetime >= 0 ? '+' : '-') + fmt(totals.totalLifetime)}
            sub={fmtPct(totals.lifetimePct)}
            subColor={totals.totalLifetime >= 0 ? Colors.gain : Colors.loss}
            icon="trending-up-outline"
            iconColor={totals.totalLifetime >= 0 ? Colors.gain : Colors.loss}
          />
          <StatTile
            label="Unrealised"
            value={(totals.totalUnrealised >= 0 ? '+' : '-') + fmt(totals.totalUnrealised)}
            sub={fmtPct(totals.unrealisedPct)}
            subColor={totals.totalUnrealised >= 0 ? Colors.gain : Colors.loss}
            icon="stats-chart-outline"
            iconColor={Colors.primary}
          />
          <StatTile
            label="Cash Balance"
            value={fmt(totals.cashBalance)}
            sub={`${totals.positionCount} position${totals.positionCount !== 1 ? 's' : ''}`}
            icon="wallet-outline"
            iconColor={Colors.warning}
          />
        </View>

        {/* ── P&L Breakdown ── */}
        <SectionCard title="P&L Breakdown">
          <PnlBreakdownRow
            label="Unrealised P&L"
            value={totals.totalUnrealised}
            pct={totals.unrealisedPct}
          />
          <PnlBreakdownRow
            label="Realised P&L"
            value={totals.totalRealised}
          />
          <View style={styles.breakdownDivider} />
          <PnlBreakdownRow
            label="Total Lifetime P&L"
            value={totals.totalLifetime}
            pct={totals.lifetimePct}
          />
        </SectionCard>

        {/* ── Best / Worst performer ── */}
        {(bestPerformer || worstPerformer) && (
          <View style={styles.performerRow}>
            <PerformerCard label="Best" position={bestPerformer} labelColor={Colors.gain} />
            <PerformerCard label="Worst" position={worstPerformer} labelColor={Colors.loss} />
          </View>
        )}

        {/* ── Holdings ── */}
        <SectionCard
          title={`Holdings (${positions.length})`}
          action={positions.length > 5 ? 'See all' : null}
        >
          {noPositions ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="briefcase-outline" size={moderateScale(36)} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No open positions</Text>
            </View>
          ) : (
            positions.map(pos => (
              <HoldingRow
                key={`${pos.wallet_id}:${pos.instrument_key}:${pos.product_type}`}
                position={pos}
                onPress={() =>
                  navigation.navigate('StockDetail', {
                    instrumentKey: pos.instrument_key,
                    symbol: pos.symbol,
                    name: pos.name,
                    sector: pos.sector,
                  })
                }
              />
            ))
          )}
        </SectionCard>

        {/* ── Sector Allocation ── */}
        {sectorAllocation.length > 0 && (
          <SectionCard title="Sector Allocation">
            <SectorBar allocation={sectorAllocation} />
            {/* Value breakdown */}
            <View style={{ marginTop: moderateScale(14), gap: moderateScale(8) }}>
              {sectorAllocation.map(item => (
                <View key={item.sector} style={styles.sectorRow}>
                  <View style={styles.sectorRowLeft}>
                    <View style={[styles.allocDot, { backgroundColor: item.color }]} />
                    <Text style={styles.sectorName} numberOfLines={1}>{item.sector}</Text>
                  </View>
                  <Text style={styles.sectorValue} numberOfLines={1}>{fmt(item.value)}</Text>
                  <Text style={styles.sectorPct}>{item.pct}%</Text>
                </View>
              ))}
            </View>
          </SectionCard>
        )}

        {/* ── Wallets ── */}
        {wallets.length > 0 && (
          <SectionCard title="Wallets">
            {wallets.map((w, i) => (
              <View key={i} style={styles.walletRow}>
                <View style={styles.walletIconWrap}>
                  <Ionicons name="wallet-outline" size={moderateScale(18)} color={Colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.walletType} numberOfLines={1}>{w.wallet_type ?? `Wallet ${i + 1}`}</Text>
                  {w.currency && <Text style={styles.walletCurrency} numberOfLines={1}>{w.currency}</Text>}
                </View>
                <Text style={styles.walletBalance} numberOfLines={1}>{fmt(parseFloat(w.balance))}</Text>
              </View>
            ))}
          </SectionCard>
        )}

        <View style={{ height: moderateScale(32) }} />
      </ScrollView>
      </>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    backgroundColor: Colors.primaryDark,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: moderateScale(16),
    paddingBottom: moderateScale(4),
  },
  headerTitle: {
    fontSize: fontScale(Typography.h4),
    fontWeight: '700',
    color: Colors.white,
    letterSpacing: 0.2,
  },
  addBtn: {
    width: moderateScale(36), height: moderateScale(36), borderRadius: moderateScale(18),
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },

  // Holdings / Positions toggle
  toggleRow: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(16),
    paddingTop: moderateScale(4),
    paddingBottom: moderateScale(8),
  },

  // Hero
  heroZone: {
    backgroundColor: Colors.primaryDark,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(28),
    paddingTop: moderateScale(12),
  },
  heroLabel: {
    fontSize: fontScale(Typography.caption),
    color: 'rgba(255,255,255,0.72)',
    fontWeight: '500',
    marginBottom: moderateScale(4),
  },
  heroValue: {
    fontSize: fontScale(Typography.display),
    fontWeight: '800',
    color: Colors.white,
    letterSpacing: -0.5,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: moderateScale(10),
    marginTop: moderateScale(8),
    flexWrap: 'wrap',
  },
  heroSub: {
    fontSize: fontScale(Typography.small),
    color: 'rgba(255,255,255,0.6)',
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: moderateScale(3),
    borderRadius: moderateScale(20), paddingHorizontal: moderateScale(9), paddingVertical: moderateScale(3),
  },
  badgeText: {
    fontSize: fontScale(Typography.tiny), fontWeight: '600',
  },

  // Scroll
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
    borderTopLeftRadius: moderateScale(24),
    borderTopRightRadius: moderateScale(24),
  },
  scrollContent: {
    padding: moderateScale(16),
    gap: moderateScale(12),
  },

  // Tile grid
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: moderateScale(10),
  },
  tile: {
    width: (SCREEN_WIDTH - moderateScale(42)) / 2,
    backgroundColor: Colors.white,
    borderRadius: moderateScale(14),
    padding: moderateScale(14),
    borderWidth: 0.5,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  tileIconWrap: {
    width: moderateScale(30), height: moderateScale(30), borderRadius: moderateScale(15),
    alignItems: 'center', justifyContent: 'center',
    marginBottom: moderateScale(8),
  },
  tileLabel: { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary, fontWeight: '500', marginBottom: moderateScale(3) },
  tileValue: { fontSize: fontScale(Typography.bodyLarge), fontWeight: '700', color: Colors.text },
  tileSub:   { fontSize: fontScale(Typography.tiny), fontWeight: '600', marginTop: moderateScale(2) },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: moderateScale(16),
    padding: moderateScale(16),
    borderWidth: 0.5,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: moderateScale(12),
  },
  cardTitle:  { fontSize: fontScale(Typography.bodyLarge), fontWeight: '700', color: Colors.text },
  cardAction: { fontSize: fontScale(Typography.caption), color: Colors.primary, fontWeight: '600' },

  // Holding row
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: moderateScale(11),
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
    gap: moderateScale(10),
    borderRadius: moderateScale(6),
    paddingHorizontal: moderateScale(2),
  },
  sectorDot:      { width: moderateScale(8), height: moderateScale(8), borderRadius: moderateScale(4) },
  holdingInfo:    { flex: 2 },
  holdingSymbol:  { fontSize: fontScale(Typography.caption), fontWeight: '700', color: Colors.text },
  holdingMeta:    { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary, marginTop: moderateScale(1) },
  holdingQty:     { flex: 2, alignItems: 'flex-start' },
  holdingQtyText: { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary },
  holdingAvg:     { fontSize: fontScale(Typography.tiny), color: Colors.textMuted, marginTop: moderateScale(1) },
  holdingRight:   { alignItems: 'flex-end' },
  holdingLtp:     { fontSize: fontScale(Typography.caption), fontWeight: '700', color: Colors.text },
  holdingPnl:     { fontSize: fontScale(Typography.tiny), fontWeight: '600', marginTop: moderateScale(1) },

  // P&L breakdown
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: moderateScale(8),
  },
  breakdownLabel: { fontSize: fontScale(Typography.caption), color: Colors.textSecondary },
  breakdownRight: { alignItems: 'flex-end' },
  breakdownValue: { fontSize: fontScale(Typography.caption), fontWeight: '700' },
  breakdownPct:   { fontSize: fontScale(Typography.tiny), fontWeight: '500', marginTop: moderateScale(1) },
  breakdownDivider: {
    height: 0.5, backgroundColor: Colors.border, marginVertical: moderateScale(4),
  },

  // Best/Worst
  performerRow: {
    flexDirection: 'row',
    gap: moderateScale(10),
  },
  performerCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: moderateScale(14),
    padding: moderateScale(14),
    borderWidth: 0.5,
    borderColor: Colors.border,
    gap: moderateScale(3),
    ...Shadows.card,
  },
  performerLabel:  { fontSize: fontScale(Typography.tiny), fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  performerSymbol: { fontSize: fontScale(Typography.bodyLarge), fontWeight: '800', color: Colors.text, marginTop: moderateScale(2) },
  performerName:   { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary, marginBottom: moderateScale(4) },

  // Sector bar
  allocBarWrap: {
    flexDirection: 'row',
    height: moderateScale(10),
    borderRadius: moderateScale(6),
    overflow: 'hidden',
    gap: moderateScale(2),
  },
  allocSegment: { height: '100%' },
  allocLegend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: moderateScale(8), marginTop: moderateScale(10),
  },
  allocLegendItem: { flexDirection: 'row', alignItems: 'center', gap: moderateScale(4) },
  allocLegendText: { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary },
  allocDot: { width: moderateScale(8), height: moderateScale(8), borderRadius: moderateScale(4) },

  // Sector value list
  sectorRow: {
    flexDirection: 'row', alignItems: 'center', gap: moderateScale(8),
  },
  sectorRowLeft: { flexDirection: 'row', alignItems: 'center', gap: moderateScale(6), flex: 1 },
  sectorName:    { fontSize: fontScale(Typography.small), color: Colors.text, fontWeight: '500' },
  sectorValue:   { fontSize: fontScale(Typography.small), fontWeight: '600', color: Colors.text },
  sectorPct:     { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary, width: moderateScale(36), textAlign: 'right' },

  // Wallets
  walletRow: {
    flexDirection: 'row', alignItems: 'center', gap: moderateScale(12),
    paddingVertical: moderateScale(10), borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  walletIconWrap: {
    width: moderateScale(36), height: moderateScale(36), borderRadius: moderateScale(18),
    backgroundColor: Colors.primary + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  walletType:     { fontSize: fontScale(Typography.caption), fontWeight: '600', color: Colors.text },
  walletCurrency: { fontSize: fontScale(Typography.tiny), color: Colors.textSecondary, marginTop: moderateScale(1) },
  walletBalance:  { fontSize: fontScale(Typography.caption), fontWeight: '700', color: Colors.text },

  // Loading / error
  loaderWrap: {
    flex: 1,
    backgroundColor: Colors.background,
    borderTopLeftRadius: moderateScale(24),
    borderTopRightRadius: moderateScale(24),
    alignItems: 'center',
    justifyContent: 'center',
    gap: moderateScale(10),
  },
  loaderText:  { fontSize: fontScale(Typography.caption), color: Colors.textSecondary },
  errorText:   { fontSize: fontScale(Typography.body), fontWeight: '600', color: Colors.text },
  errorSub:    { fontSize: fontScale(Typography.small), color: Colors.textSecondary, textAlign: 'center', paddingHorizontal: moderateScale(40) },
  retryBtn: {
    marginTop: moderateScale(8), paddingHorizontal: moderateScale(24), paddingVertical: moderateScale(10),
    backgroundColor: Colors.primary, borderRadius: moderateScale(20),
  },
  retryText: { color: Colors.white, fontWeight: '600', fontSize: fontScale(Typography.caption) },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: moderateScale(24), gap: moderateScale(8) },
  emptyText: { fontSize: fontScale(Typography.caption), color: Colors.textMuted },
});