import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Typography, fontScale, moderateScale } from "../theme";
import { showToast } from "../../services/uiBridge";

const PRIVACY_URL = "https://www.stocksy.online/";

/**
 * PrivacyConsentModal
 *
 * Shown the first time a user attempts Signup or Signup with Google
 * (gated by usePrivacyConsent — see SignupPage.js). Gives a short overview
 * of the privacy policy plus a link to the full policy, and requires the
 * checkbox to be ticked before continuing. Ticking off + Continue without
 * checking it turns the checkbox red and raises the global toast instead
 * of proceeding.
 *
 * Props:
 * @param {boolean}  visible
 * @param {function} onAccept   called once the box is checked and the user taps Continue
 * @param {function} onCancel   called on backdrop dismiss / Cancel
 */
const PrivacyConsentModal = ({ visible, onAccept, onCancel }) => {
  const [checked, setChecked] = useState(false);
  const [showError, setShowError] = useState(false);

  const handleToggle = () => {
    setShowError(false);
    setChecked((prev) => !prev);
  };

  const handleContinue = () => {
    if (!checked) {
      setShowError(true);
      showToast("Please accept the Privacy Policy to use the app", "error");
      return;
    }
    setShowError(false);
    setChecked(false);
    onAccept();
  };

  const handleOpenFullPolicy = () => {
    Linking.openURL(PRIVACY_URL);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Privacy Policy & Terms</Text>

          <Text style={styles.body}>
            Before creating your account, here's a quick summary: Stocksy collects the
            account details you provide and basic usage data to run the app and keep your
            account secure. Your market data and watchlists are used only to power features
            inside the app. By continuing, you also agree to our Terms & Conditions.
          </Text>

          <TouchableOpacity onPress={handleOpenFullPolicy} activeOpacity={0.7}>
            <Text style={styles.link}>Read the full Privacy Policy — {PRIVACY_URL}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.checkboxRow} onPress={handleToggle} activeOpacity={0.7}>
            <View
              style={[
                styles.checkbox,
                checked && styles.checkboxChecked,
                showError && !checked && styles.checkboxErrorBorder,
              ]}
            >
              {checked && <Ionicons name="checkmark" size={14} color={Colors.white} />}
            </View>
            <Text style={[styles.checkboxLabel, showError && !checked && styles.checkboxErrorText]}>
              I accept the Privacy Policy and Terms & Conditions
            </Text>
          </TouchableOpacity>

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.7}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.continueButton} onPress={handleContinue} activeOpacity={0.85}>
              <Text style={styles.continueButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: moderateScale(24),
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: moderateScale(24),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(10),
  },
  body: {
    fontSize: fontScale(13.5),
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: moderateScale(14),
  },
  link: {
    fontSize: fontScale(13),
    color: Colors.primaryDark,
    fontWeight: "600",
    marginBottom: moderateScale(18),
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: moderateScale(22),
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.borderLight,
    marginRight: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxErrorBorder: {
    borderColor: Colors.dangerDark,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: fontScale(13.5),
    color: Colors.text,
    fontWeight: "500",
  },
  checkboxErrorText: {
    color: Colors.dangerDark,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  cancelButton: {
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(16),
  },
  cancelButtonText: {
    color: Colors.textSecondary,
    fontSize: fontScale(14),
    fontWeight: "600",
  },
  continueButton: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(24),
    alignItems: "center",
  },
  continueButtonText: {
    color: Colors.white,
    fontSize: fontScale(14),
    fontWeight: "700",
  },
});

export default PrivacyConsentModal;