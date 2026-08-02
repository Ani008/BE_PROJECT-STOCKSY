import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import alertService from "../../services/alertService";
import { showToast } from "../../services/uiBridge";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const formatPrice = (price) =>
  price != null ? `₹${Number(price).toLocaleString("en-IN")}` : "—";

const STATUS_META = {
  ACTIVE: { label: "Active", color: Colors.primary, bg: "rgba(37,99,235,0.1)" },
  TRIGGERED: { label: "Triggered", color: Colors.success, bg: "rgba(16,185,129,0.12)" },
  EXECUTED: { label: "Executed", color: Colors.success, bg: "rgba(16,185,129,0.12)" },
  FAILED: { label: "Failed", color: Colors.dangerDark, bg: Colors.dangerBg },
  CANCELLED: { label: "Cancelled", color: Colors.textMuted, bg: Colors.divider },
};

const ACTION_LABEL = { BUY: "Buy GTT", SELL: "Sell GTT", NOTIFY: "Alert" };

const AlertRow = ({ alert, onCancel }) => {
  const meta = STATUS_META[alert.status] || STATUS_META.ACTIVE;
  const arrow = alert.direction === "ABOVE" ? "↑" : "↓";
  const isGtt = alert.action === "BUY" || alert.action === "SELL";

  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.symbol}>{alert.symbol}</Text>
          <View style={styles.actionBadge}>
            <Text style={styles.actionBadgeText}>{ACTION_LABEL[alert.action] || "Alert"}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>

        <Text style={styles.detail}>
          {isGtt
            ? `${alert.action === "BUY" ? "Buy" : "Sell"} ${alert.quantity} when price ${
                alert.direction === "ABOVE" ? "rises to" : "falls to"
              }`
            : `Notify when price ${alert.direction === "ABOVE" ? "rises to" : "falls to"}`}{" "}
          <Text style={styles.detailStrong}>{formatPrice(alert.target_price)}</Text> {arrow}
        </Text>

        {(alert.status === "TRIGGERED" || alert.status === "EXECUTED") && (
          <Text style={styles.triggeredDetail}>
            {alert.status === "EXECUTED" ? "Order placed at" : "Triggered at"}{" "}
            {formatPrice(alert.triggered_price)}
          </Text>
        )}

        {alert.status === "FAILED" && (
          <Text style={styles.failedDetail} numberOfLines={2}>
            {alert.fail_reason || "Order could not be placed."}
          </Text>
        )}
      </View>

      {alert.status === "ACTIVE" && (
        <TouchableOpacity
          onPress={() => onCancel(alert)}
          style={styles.cancelBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle-outline" size={moderateScale(22)} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const AlertsPage = ({ navigation }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await alertService.getAlerts();
      setAlerts(data || []);
    } catch (err) {
      // Global toast already covers this.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleCancel = (alert) => {
    Alert.alert(
      "Cancel this alert?",
      `You won't be notified when ${alert.symbol} reaches ${formatPrice(alert.target_price)}.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel Alert",
          style: "destructive",
          onPress: async () => {
            try {
              await alertService.cancelAlert(alert.id);
              showToast("Alert cancelled", "success");
              load();
            } catch (err) {
              // Global toast already covers this.
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.gain} />
        <Text style={styles.loadingText}>Loading your alerts…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surfaceAlt} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={moderateScale(20)} color={Colors.text} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Price Alerts</Text>

        <View style={styles.headerBtn} />
      </View>

      <FlatList
        data={alerts}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <AlertRow alert={item} onCancel={handleCancel} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.gain} />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIconRing}>
              <Ionicons
                name="notifications-outline"
                size={moderateScale(28)}
                color={Colors.textMuted}
              />
            </View>
            <Text style={styles.emptyTitle}>No alerts yet</Text>
            <Text style={styles.emptySubtitle}>
              Open any stock and tap the bell icon to get notified when it hits your price.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surfaceAlt },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.surfaceAlt,
  },
  loadingText: {
    marginTop: moderateScale(12),
    color: Colors.textSecondary,
    fontSize: fontScale(Typography.caption),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: moderateScale(20),
    paddingVertical: moderateScale(14),
  },
  headerBtn: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(18),
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  listContent: {
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(40),
    flexGrow: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: moderateScale(16),
    marginBottom: moderateScale(12),
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    marginBottom: moderateScale(6),
  },
  actionBadge: {
    backgroundColor: Colors.divider,
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(20),
  },
  actionBadgeText: {
    fontSize: fontScale(11),
    fontWeight: "700",
    color: Colors.textSecondary,
  },
  symbol: {
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
    color: Colors.text,
  },
  statusBadge: {
    paddingHorizontal: moderateScale(8),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(20),
  },
  statusText: {
    fontSize: fontScale(11),
    fontWeight: "700",
  },
  detail: {
    fontSize: fontScale(13),
    color: Colors.textSecondary,
  },
  detailStrong: {
    fontWeight: "700",
    color: Colors.text,
  },
  triggeredDetail: {
    fontSize: fontScale(12),
    color: Colors.success,
    marginTop: moderateScale(4),
    fontWeight: "600",
  },
  failedDetail: {
    fontSize: fontScale(12),
    color: Colors.dangerDark,
    marginTop: moderateScale(4),
    fontWeight: "600",
  },
  cancelBtn: {
    paddingLeft: moderateScale(12),
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: moderateScale(60),
    gap: moderateScale(8),
  },
  emptyIconRing: {
    width: moderateScale(60),
    height: moderateScale(60),
    borderRadius: moderateScale(30),
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
    lineHeight: moderateScale(20),
    paddingHorizontal: moderateScale(24),
  },
});

export default AlertsPage;