import React, { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  TouchableOpacity,
} from "react-native";
import Svg, { G, Path } from "react-native-svg";
import Button from "../components/Button";
import Input from "../components/Input";
import authService from "../../services/authService";
import { SafeAreaView } from "react-native-safe-area-context";

import { API_BASE_URL, WEB_CLIENT_ID } from "../config/env";
//import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

const LoginPage = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const isExpoGo = Constants.executionEnvironment === "storeClient";

  useEffect(() => {
    if (!isExpoGo) {
      GoogleSignin.configure({
        webClientId: WEB_CLIENT_ID,
      });
    }
  }, []);

  const validate = () => {
    const newErrors = {};
    if (!email.trim()) newErrors.email = "Email is required";
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = "Invalid email";
    if (!password) newErrors.password = "Password is required";
    else if (password.length < 6) newErrors.password = "Minimum 6 characters";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const GoogleIcon = () => (
    <Svg width={20} height={20} viewBox="0 0 48 48">
      <Path
        fill={Colors.warning}
        d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12S17.4 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <Path
        fill={Colors.danger}
        d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3 0 5.7 1.1 7.8 3l5.7-5.7C34 6.1 29.3 4 24 4c-7.7 0-14.4 4.3-17.7 10.7z"
      />
      <Path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.1-8l-6.6 5.1C9.6 39.6 16.2 44 24 44z"
      />
      <Path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.3 5.5-6.3 6.8l6.3 5.2C39.4 36.3 44 30.8 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </Svg>
  );

  const handleLogin = async () => {
    if (!validate()) return;

    setLoading(true);

    try {
      const user = await authService.login(email, password);

      console.log("Login Success:", user);

      navigation.replace("MainTabs");
    } catch (err) {
      // No Alert here — the global toast (wired via api.js's interceptor)
      // already shows this. Keeping the catch so the rejection doesn't
      // bubble up unhandled.
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await GoogleSignin.hasPlayServices();

      const userInfo = await GoogleSignin.signIn();

      console.log(JSON.stringify(userInfo, null, 2));

      const tokens = await GoogleSignin.getTokens();

      const idToken = tokens.idToken;

      const res = await fetch(`${API_BASE_URL}/auth/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        Alert.alert("Google Login Failed", data.message);
        return;
      }

      await SecureStore.setItemAsync("token", data.token);

      await SecureStore.setItemAsync("user", JSON.stringify(data));

      navigation.replace("MainTabs");
    } catch (err) {
      console.log(err);
      Alert.alert("Google Login Failed", err.message);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.brand}>Stocksy</Text>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to your account</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              error={errors.email}
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              secureTextEntry
              error={errors.password}
            />

            <Button
              title="Sign In"
              onPress={handleLogin}
              loading={loading}
              style={styles.btn}
            />

            {/* ── Forgot Password ─────────────────────────────────────── */}
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={() => navigation.navigate("ForgotPassword")}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>

            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.divider} />
            </View>

            {!isExpoGo && (
              <TouchableOpacity
                style={styles.googleButton}
                onPress={handleGoogleLogin}
                activeOpacity={0.8}
              >
                <GoogleIcon />

                <Text style={styles.googleButtonText}>
                  Continue with Google
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Text
              style={styles.link}
              onPress={() => navigation.navigate("Signup")}
            >
              Sign Up
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: moderateScale(24) },
  header: { marginBottom: moderateScale(36) },
  brand: {
    fontSize: fontScale(Typography.h1),
    fontWeight: "800",
    color: Colors.primaryDark,
    letterSpacing: -0.5,
    marginBottom: moderateScale(12),
  },
  title: {
    fontSize: fontScale(26),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(6),
  },
  subtitle: { fontSize: fontScale(Typography.body), color: Colors.textSecondary },
  form: { marginBottom: moderateScale(24) },
  btn: { marginTop: moderateScale(8) },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: moderateScale(16) },
  footerText: { fontSize: fontScale(14), color: Colors.textSecondary },
  link: { fontSize: fontScale(14), color: Colors.primaryDark, fontWeight: "600" },

  // Forgot Password
  forgotBtn: {
    alignItems: "center",
    marginTop: moderateScale(16),
  },
  forgotText: {
    fontSize: fontScale(14),
    color: Colors.textSecondary,
  },

  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: moderateScale(28),
    marginBottom: moderateScale(20),
  },

  divider: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },

  dividerText: {
    marginHorizontal: moderateScale(12),
    color: Colors.textMuted,
    fontSize: fontScale(Typography.caption),
    fontWeight: "500",
  },

  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",

    borderWidth: 1,
    borderColor: Colors.borderLight,

    backgroundColor: Colors.white,

    borderRadius: 12,

    paddingVertical: moderateScale(14),
  },

  googleButtonText: {
    marginLeft: moderateScale(12),

    fontSize: fontScale(Typography.body),

    fontWeight: "600",

    color: Colors.text,
  },
});

export default LoginPage;