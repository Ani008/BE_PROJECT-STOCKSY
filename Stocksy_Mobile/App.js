import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Text, TextInput } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import "react-native-get-random-values";

// Financial data (prices, index values, quantities) must never get cropped
// or misread — a truncated number here isn't cosmetic, it's a trust/safety
// issue for a trading app. So text scaling from the device's OS-level
// accessibility font size setting is fully locked off, app-wide, rather
// than just capped. A 1.2x cap still leaves enough slack to crop tightly
// packed numeric rows (e.g. index tickers) on larger OS accessibility text
// sizes. This matches how other trading apps (e.g. Groww) handle this.
if (Text.defaultProps == null) Text.defaultProps = {};
Text.defaultProps.allowFontScaling = false;
if (TextInput.defaultProps == null) TextInput.defaultProps = {};
TextInput.defaultProps.allowFontScaling = false;

import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { ToastProvider } from "./src/context/ToastProvider";
import SessionExpiredScreen from "./src/components/SessionExpiredScreen";
import SplashVideoScreen from "./src/components/SplashVideoScreen";
import { registerSessionExpiredHandler } from "./services/uiBridge";

// ─── Auth screens ─────────────────────────────────────────────────────────────
import LoginPage from "./src/pages/LoginPage";
import SignupPage from "./src/pages/SignupPage";

import WalletScreen from "./src/pages/WalletScreen";
import AllTransactionsPage from "./src/pages/AllTransactionsPage";
import ForgotPasswordScreen from "./src/pages/ForgotPasswordScreen";
import SearchPage from "./src/pages/SearchPage";
import BuyOrderScreen from "./src/pages/Buyorderscreen";
import OrderSuccessScreen from "./src/pages/OrderSuccessScreen";

import StockDetailPage from "./src/pages/StockDetailPage";
import OrderHistoryPage from "./src/pages/OrderHistoryPage";
import JournalScreen from "./src/pages/JournalScreen";
import AlertsPage from "./src/pages/AlertsPage";

// ─── Tab screens ──────────────────────────────────────────────────────────────
import DashboardPage from "./src/pages/DashboardPage";
import PortfolioPage from "./src/pages/PortfolioPage";
import MarketPage from "./src/pages/MarketPage";
import ProfilePage from "./src/pages/ProfilePage";

import { ExchangePage, MarketsPage } from "./src/pages/PlaceholderPages";

// ─── Token check ──────────────────────────────────────────────────────────────
import { getStoredToken } from "./services/authService";

// ─────────────────────────────────────────────────────────────────────────────
// Tab icon map
// ─────────────────────────────────────────────────────────────────────────────
const TAB_ICONS = {
  Home: { active: "home", inactive: "home-outline" },
  Portfolio: { active: "briefcase", inactive: "briefcase-outline" },
  Exchange: { active: "swap-horizontal", inactive: "swap-horizontal-outline" },
  Markets: { active: "bar-chart", inactive: "bar-chart-outline" },
  Profile: { active: "person", inactive: "person-outline" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Bottom Tab Navigator — shown for all authenticated screens
// ─────────────────────────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator();

function MainTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: "#3B82F6",
        tabBarInactiveTintColor: "#94A3B8",
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginBottom: 2,
        },
        tabBarStyle: {
          backgroundColor: "white",
          borderTopColor: "#F1F5F9",
          borderTopWidth: 1,
          // Custom height + explicit padding turns off React Navigation's
          // automatic safe-area handling for this tab bar — so it has to
          // be done manually here. insets.bottom is 0 on gesture-nav
          // devices, and the real 3-button nav bar height on devices
          // like the Redmi Note 11/7 — this adapts per device instead
          // of a fixed value that only happened to work on iOS.
          height: 60 + insets.bottom,
          paddingTop: 6,
          paddingBottom: 12 + insets.bottom,
          // Shadow for iOS
          shadowColor: "#000",
          shadowOpacity: 0.06,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -3 },
          // Elevation for Android
          elevation: 12,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = TAB_ICONS[route.name];
          const iconName = focused ? icons.active : icons.inactive;

          return <Ionicons name={iconName} size={22} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={DashboardPage} />
      <Tab.Screen name="Portfolio" component={PortfolioPage} />
      <Tab.Screen name="Markets" component={MarketPage} />
      <Tab.Screen name="Profile" component={ProfilePage} />
    </Tab.Navigator>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root Stack — Login/Signup sit outside the tab navigator so the tab bar
// never appears on auth screens. navigation.replace('MainTabs') after login
// removes auth screens from the stack entirely.
// ─────────────────────────────────────────────────────────────────────────────
const Stack = createNativeStackNavigator();

export default function App() {
  // Video splash plays first, on every cold launch, regardless of auth
  // state — this is intentionally checked before isAuthenticated so it
  // shows even for already-logged-in users, not just first-time/logged-out
  // ones.
  const [showSplashVideo, setShowSplashVideo] = useState(true);

  // null = still checking, true = has token, false = no token
  const [isAuthenticated, setIsAuthenticated] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    // Runs in parallel with the splash video (not after it) — by the
    // time the ~4s video finishes, this has almost always already
    // resolved, so there's no extra spinner flash once the splash
    // video hands off to the real app.
    const checkToken = async () => {
      const token = await getStoredToken();
      setIsAuthenticated(!!token);
    };
    checkToken();
  }, []);

  // Registered once — api.js's interceptor calls triggerSessionExpired()
  // from outside the React tree whenever any request comes back 401
  // SESSION_EXPIRED. This is the only place that reacts to it.
  useEffect(() => {
    registerSessionExpiredHandler(() => setSessionExpired(true));
  }, []);

  const handleReLogin = () => {
    // Token's already cleared by the interceptor at the point of
    // failure. Flipping both flags here forces a full remount of the
    // NavigationContainer below with initialRouteName freshly
    // evaluated as "Login" — same mechanism the app already uses for
    // the normal logged-out state.
    setSessionExpired(false);
    setIsAuthenticated(false);
  };

  if (showSplashVideo) {
    return <SplashVideoScreen onFinish={() => setShowSplashVideo(false)} />;
  }

  // ── Splash / loading state ──────────────────────────────────────────────────
  // Shown for the fraction of a second while SecureStore is read.
  // Prevents a flash of the Login screen for already-logged-in users.
  if (isAuthenticated === null) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  if (sessionExpired) {
    return (
      <SafeAreaProvider>
        <SessionExpiredScreen onLoginPress={handleReLogin} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator
          initialRouteName={isAuthenticated ? "MainTabs" : "Login"}
          screenOptions={{ headerShown: false }}
        >
          {/* ── Auth screens (no tab bar) ──────────────────────────────────── */}
          <Stack.Screen name="Login" component={LoginPage} />
          <Stack.Screen name="Signup" component={SignupPage} />
          <Stack.Screen
            name="ForgotPassword"
            component={ForgotPasswordScreen}
          />

          {/* ── Authenticated shell (tab bar lives inside here) ────────────── */}
          <Stack.Screen name="MainTabs" component={MainTabs} />
          <Stack.Screen name="Wallet" component={WalletScreen} />
          <Stack.Screen name="AllTransactions" component={AllTransactionsPage} />
          <Stack.Screen name="OrderHistory" component={OrderHistoryPage} />
          <Stack.Screen name="Journal" component={JournalScreen} />
          <Stack.Screen name="Alerts" component={AlertsPage} />

          <Stack.Screen name="Search" component={SearchPage} />
          <Stack.Screen name="StockDetail" component={StockDetailPage} />
          <Stack.Screen name="BuyOrder" component={BuyOrderScreen} />
          <Stack.Screen name="OrderSuccess" component={OrderSuccessScreen} />
        </Stack.Navigator>
        </NavigationContainer>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
});