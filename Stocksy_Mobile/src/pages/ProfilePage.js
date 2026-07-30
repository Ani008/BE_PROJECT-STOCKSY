import React, { useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
  Linking,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import authService from "../../services/authService";
import { showToast } from "../../services/uiBridge";
import DeleteAccountModal from "../components/DeleteAccountModal";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const APP_VERSION = "1.0.0";
const SUPPORT_EMAIL = "indiastocksy@gmail.com";

const getInitials = (name) => {
  if (!name) return "T";
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0][0];
  return initials.toUpperCase();
};

const ProfilePage = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState(null);
  const [accountExpanded, setAccountExpanded] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", loadUser);
    loadUser();
    return unsubscribe;
  }, [navigation]);

  const loadUser = async () => {
    try {
      const stored = await AsyncStorage.getItem("user");
      if (stored) setUser(JSON.parse(stored));
    } catch (err) {
      console.log(err);
    }
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.removeItem("token");
          await AsyncStorage.removeItem("user");
          navigation.replace("Login");
        },
      },
    ]);
  };

  const handleInvite = async () => {
    try {
      await Share.share({
        message:
          "I've been building my portfolio on Stocksy — a zero-risk way to learn real trading with live market data. Join me and let's figure out the markets together 📈\n\nhttps://stocksy.app/invite",
      });
    } catch (err) {
      // Silent — the share sheet failing to open isn't worth alarming over.
    }
  };

  const handleSupport = () => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
      Alert.alert("Couldn't open email", `Reach us anytime at ${SUPPORT_EMAIL}`);
    });
  };

  const handleDeleteAccount = async (password) => {
    setDeletingAccount(true);
    try {
      await authService.deleteAccount(password);
      setDeleteModalVisible(false);
      showToast("Your account has been permanently deleted.", "success");
      navigation.replace("Login");
    } catch (err) {
      // Error toast is already shown globally by the api.js interceptor
      // (e.g. "Incorrect password" or the validation message) — just
      // keep the modal open so they can retry.
    } finally {
      setDeletingAccount(false);
    }
  };

  const displayName = user?.fullName || user?.username || "Trader";
  const displayEmail = user?.email || "—";

  return (
    <SafeAreaView style={styles.safe} edges={["left", "right"]}>
      <StatusBar style="light" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <View style={[styles.hero, { paddingTop: insets.top + moderateScale(16) }]}>
          <Text style={styles.heroTitle}>Profile</Text>

          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{getInitials(displayName)}</Text>
            </View>

            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {displayName}
                </Text>
              </View>
              <Text style={styles.email} numberOfLines={1}>
                {displayEmail}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
        <View style={styles.body}>
          {/* Orders — every order ever placed, Delivery/Intraday toggle lives
              on the OrderHistory screen itself (same pattern as the
              Dashboard's Total Assets card). */}
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("OrderHistory")}
          >
            <View style={styles.cardLeft}>
              <View style={[styles.iconCircle, { backgroundColor: Colors.primaryLight }]}>
                <Ionicons name="receipt-outline" size={20} color={Colors.primaryDark} />
              </View>
              <View>
                <Text style={styles.cardTitle}>Orders</Text>
                <Text style={styles.cardSub}>Every order you've placed, all time</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>

          {/* Account details — expands in place rather than navigating away,
              since it's just a couple of read-only fields. */}
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardHeaderRow}
              activeOpacity={0.7}
              onPress={() => setAccountExpanded((v) => !v)}
            >
              <View style={styles.cardLeft}>
                <View style={[styles.iconCircle, { backgroundColor: Colors.successBg }]}>
                  <Ionicons name="person-outline" size={20} color={Colors.success} />
                </View>
                <View>
                  <Text style={styles.cardTitle}>Account details</Text>
                  <Text style={styles.cardSub}>Name, email & trader ID</Text>
                </View>
              </View>
              <Ionicons
                name={accountExpanded ? "chevron-up" : "chevron-down"}
                size={20}
                color={Colors.textMuted}
              />
            </TouchableOpacity>

            {accountExpanded && (
              <View style={styles.expandedContent}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Full name</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>
                    {displayName}
                  </Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Email</Text>
                  <Text style={styles.detailValue} numberOfLines={1}>
                    {displayEmail}
                  </Text>
                </View>
                {!!user?.id && (
                  <>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Trader ID</Text>
                      <Text style={styles.detailValue} numberOfLines={1}>
                        {user.id.slice(0, 8).toUpperCase()}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>

          {/* Wallet & Funds — reuses the existing WalletScreen rather than
              duplicating balance/withdraw logic here. */}
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("Wallet")}
          >
            <View style={styles.cardLeft}>
              <View style={[styles.iconCircle, { backgroundColor: Colors.warningBg }]}>
                <Ionicons name="wallet-outline" size={20} color={Colors.warning} />
              </View>
              <View>
                <Text style={styles.cardTitle}>Wallet & Funds</Text>
                <Text style={styles.cardSub}>Balances, cards & transactions</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>

          {/* Refer & Invite */}
          <View style={[styles.card, styles.referCard]}>
            <View style={styles.referIconRing}>
              <Ionicons name="heart" size={22} color={Colors.gain} />
            </View>
            <Text style={styles.referTitle}>Share the journey</Text>
            <Text style={styles.referBody}>
              Every confident investor started somewhere — usually with a friend who
              nudged them to begin. Be that person. Invite someone you care about to
              start learning the markets with you, risk-free.
            </Text>
            <TouchableOpacity
              style={styles.referBtn}
              activeOpacity={0.85}
              onPress={handleInvite}
            >
              <Ionicons name="paper-plane-outline" size={16} color={Colors.white} />
              <Text style={styles.referBtnText}>Invite a friend</Text>
            </TouchableOpacity>
          </View>

          {/* Customer support */}
          <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={handleSupport}>
            <View style={styles.cardLeft}>
              <View style={[styles.iconCircle, { backgroundColor: Colors.primaryLight }]}>
                <Ionicons name="headset-outline" size={20} color={Colors.primaryDark} />
              </View>
              <View>
                <Text style={styles.cardTitle}>Customer support</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>

          {/* About */}
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => setAboutExpanded((v) => !v)}
          >
            <View style={styles.cardLeft}>
              <View style={[styles.iconCircle, { backgroundColor: Colors.dangerBg }]}>
                <Ionicons name="information-circle-outline" size={20} color={Colors.danger} />
              </View>
              <Text style={styles.cardTitle}>About</Text>
            </View>
            <Ionicons
              name={aboutExpanded ? "chevron-up" : "chevron-down"}
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
          {aboutExpanded && (
            <View style={styles.aboutContent}>
              <Text style={styles.aboutText}>Stocksy v{APP_VERSION}</Text>
              <Text style={styles.aboutText}>Real-time Paper Trading Platform</Text>
              <Text style={styles.aboutText}>• OMS Engine</Text>
              <Text style={styles.aboutText}>• Live Market Data</Text>
              <Text style={styles.aboutText}>• Portfolio Tracking</Text>
              <Text style={styles.aboutText}>• Redis Streaming</Text>
              <Text style={styles.aboutText}>• PostgreSQL Storage</Text>
              <Text style={[styles.aboutText, { marginTop: moderateScale(10) }]}>
                Developed by Aniket
              </Text>
            </View>
          )}

          {/* Logout */}
          <TouchableOpacity style={styles.logoutCard} onPress={handleLogout} activeOpacity={0.7}>
            <MaterialCommunityIcons name="logout" size={20} color={Colors.danger} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          {/* Delete Account — separated from Logout so it's not mistaken
              for the same, much more common, action. */}
          <TouchableOpacity
            style={styles.deleteAccountCard}
            onPress={() => setDeleteModalVisible(true)}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="delete-outline" size={18} color={Colors.textMuted} />
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <DeleteAccountModal
        visible={deleteModalVisible}
        onConfirm={handleDeleteAccount}
        onCancel={() => setDeleteModalVisible(false)}
        loading={deletingAccount}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingBottom: moderateScale(50) },

  // ── Hero ───────────────────────────────────────────────────────────────
  hero: {
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(20),
    paddingBottom: moderateScale(24),
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    marginBottom: moderateScale(20),
  },
  heroTitle: {
    fontSize: fontScale(Typography.h2),
    fontWeight: "800",
    color: Colors.white,
    marginBottom: moderateScale(20),
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(14),
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: fontScale(22),
    fontWeight: "800",
    color: Colors.white,
  },
  profileInfo: { flex: 1 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  name: {
    fontSize: fontScale(Typography.h3),
    fontWeight: "700",
    color: Colors.white,
    maxWidth: "62%",
  },
  badge: {
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(4),
    borderRadius: 999,
  },
  badgeText: {
    color: Colors.white,
    fontWeight: "600",
    fontSize: fontScale(Typography.tiny),
  },
  email: {
    color: "rgba(255,255,255,0.75)",
    fontSize: fontScale(13),
  },

  // ── Body ───────────────────────────────────────────────────────────────
  body: { paddingHorizontal: moderateScale(20) },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(16),
    marginBottom: moderateScale(14),
    shadowColor: Colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(12),
    flex: 1,
    marginRight: moderateScale(8),
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
  },
  cardSub: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    marginTop: moderateScale(2),
  },

  expandedContent: {
    marginTop: moderateScale(14),
    paddingTop: moderateScale(14),
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: moderateScale(4),
  },
  detailLabel: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
  },
  detailValue: {
    fontSize: fontScale(Typography.body),
    fontWeight: "600",
    color: Colors.text,
    maxWidth: "65%",
  },
  detailDivider: {
    height: 1,
    backgroundColor: Colors.divider,
    marginVertical: moderateScale(8),
  },

  // ── Refer & Invite ────────────────────────────────────────────────────
  referCard: { alignItems: "flex-start" },
  referIconRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.gainBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: moderateScale(10),
  },
  referTitle: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(6),
  },
  referBody: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
    lineHeight: moderateScale(20),
    marginBottom: moderateScale(14),
  },
  referBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: moderateScale(18),
    paddingVertical: moderateScale(11),
    borderRadius: 999,
    alignSelf: "stretch",
    justifyContent: "center",
  },
  referBtnText: {
    color: Colors.white,
    fontWeight: "700",
    fontSize: fontScale(Typography.small),
  },

  // ── About ─────────────────────────────────────────────────────────────
  aboutContent: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(18),
    marginTop: -moderateScale(6),
    marginBottom: moderateScale(14),
  },
  aboutText: {
    color: Colors.textSecondary,
    marginBottom: moderateScale(6),
    lineHeight: 22,
  },

  // ── Logout ────────────────────────────────────────────────────────────
  logoutCard: {
    backgroundColor: Colors.white,
    borderRadius: 18,
    padding: moderateScale(16),
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(10),
    marginTop: moderateScale(6),
  },
  logoutText: {
    color: Colors.danger,
    fontWeight: "700",
    fontSize: fontScale(Typography.bodyLarge),
  },

  // ── Delete Account ────────────────────────────────────────────────────
  deleteAccountCard: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: moderateScale(8),
    paddingVertical: moderateScale(14),
    marginTop: moderateScale(4),
  },
  deleteAccountText: {
    color: Colors.textMuted,
    fontWeight: "600",
    fontSize: fontScale(Typography.small),
  },
});

export default ProfilePage;