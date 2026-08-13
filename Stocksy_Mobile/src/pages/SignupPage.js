import React, { useState, useEffect } from "react";
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
import Constants from "expo-constants";
import Svg, { Path } from "react-native-svg";
import Button from "../components/Button";
import Input from "../components/Input";
import PrivacyConsentModal from "../components/PrivacyConsentModal";
import authService from "../../services/authService";
import usePrivacyConsent from "../hooks/usePrivacyConsent";

import { SafeAreaView } from "react-native-safe-area-context";

import { API_BASE_URL, WEB_CLIENT_ID } from "../config/env";
//import { GoogleSignin } from "@react-native-google-signin/google-signin";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

const SignupPage = ({ navigation }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const { hasAccepted, loading: consentLoading, markAccepted } = usePrivacyConsent();
  const [consentModalVisible, setConsentModalVisible] = useState(false);
  
  const [pendingAction, setPendingAction] = useState(null); // 'email' | 'google'

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
    if (!name.trim()) newErrors.name = "Name is required";
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

  const doEmailSignup = async () => {
    setLoading(true);
    try {
      await authService.signup({
        fullName: name,
        email,
        password,
      });
      navigation.replace("MainTabs");
    } catch (err) {
      // No Alert here — the global toast already covers this.
    } finally {
      setLoading(false);
    }
  };

  const doGoogleSignup = async () => {
    try {
      await GoogleSignin.hasPlayServices();

      const userInfo = await GoogleSignin.signIn();

      const idToken = userInfo?.data?.idToken;

      if (!idToken) {
        Alert.alert("Google Signup Failed", "No ID token returned by Google.");
        return;
      }

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
        Alert.alert("Google Signup Failed", data.message);
        return;
      }

      await authService.persistGoogleSession(data);

      navigation.replace("MainTabs");
    } catch (err) {
      console.log(err);
      Alert.alert("Google Signup Failed", err.message);
    }
  };

  // Both signup paths are gated behind privacy-policy acceptance. First
  // time through, this opens the modal and stashes which action to resume;
  // after that it's a no-op passthrough straight into the real signup.
  const requireConsentThen = (action, run) => {
    if (consentLoading) return;
    if (hasAccepted) {
      run();
      return;
    }
    setPendingAction(action);
    setConsentModalVisible(true);
  };

  const handleSignup = () => {
    if (!validate()) return;
    requireConsentThen("email", doEmailSignup);
  };

  const handleGoogleSignup = () => {
    requireConsentThen("google", doGoogleSignup);
  };

  const handleConsentAccept = async () => {
    await markAccepted();
    setConsentModalVisible(false);
    if (pendingAction === "email") doEmailSignup();
    if (pendingAction === "google") doGoogleSignup();
    setPendingAction(null);
  };

  const handleConsentCancel = () => {
    setConsentModalVisible(false);
    setPendingAction(null);
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
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.subtitle}>Get started for free today</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Input
              label="Full Name"
              value={name}
              onChangeText={setName}
              placeholder="Enter Your Name"
              autoCapitalize="words"
              error={errors.name}
            />
            <Input
              label="Email Address"
              value={email}
              onChangeText={setEmail}
              placeholder="Enter Your Email"
              keyboardType="email-address"
              error={errors.email}
            />
            <Input
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Enter Your Password"
              secureTextEntry
              error={errors.password}
            />

            <Button
              title="Create Account"
              onPress={handleSignup}
              loading={loading}
              style={styles.btn}
            />

            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.divider} />
            </View>

            {!isExpoGo && (
              <TouchableOpacity
                style={styles.googleButton}
                onPress={handleGoogleSignup}
                activeOpacity={0.8}
              >
                <GoogleIcon />
                <Text style={styles.googleButtonText}>Sign up with Google</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Text
              style={styles.link}
              onPress={() => navigation.navigate("Login")}
            >
              Sign In
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PrivacyConsentModal
        visible={consentModalVisible}
        onAccept={handleConsentAccept}
        onCancel={handleConsentCancel}
      />
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

  dividerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: moderateScale(20),
    marginBottom: moderateScale(16),
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

export default SignupPage;