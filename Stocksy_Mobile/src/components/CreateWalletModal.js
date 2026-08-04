import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

/**
 * CreateWalletModal
 * A bottom-sheet-style modal for creating a new sub-wallet.
 *
 * Props:
 * @param {boolean}   visible          - Controls modal visibility
 * @param {function}  onClose          - Called when the user dismisses the modal
 * @param {function}  onSubmit         - Called with ({ name, amount }) when form is submitted
 * @param {number}    availableBalance - The user's current demoBalance (to show and validate against)
 * @param {boolean}   [loading]        - Shows spinner on the submit button while API call is in flight
 */
const CreateWalletModal = ({
  visible,
  onClose,
  onSubmit,
  availableBalance = 0,
  loading = false,
}) => {
  const [walletName, setWalletName] = useState("");
  const [walletAmount, setWalletAmount] = useState("");
  const [error, setError] = useState("");

  const formattedAvailable = Number(availableBalance).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const handleClose = () => {
    setWalletName("");
    setWalletAmount("");
    setError("");
    onClose();
  };

  const handleSubmit = () => {
    setError("");
    const trimmedName = walletName.trim();
    const parsedAmount = parseFloat(walletAmount);

    if (!trimmedName) {
      setError("Please enter a wallet name.");
      return;
    }
    if (!walletAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    if (parsedAmount > availableBalance) {
      setError(
        `Amount exceeds your available balance of ₹${formattedAvailable}.`,
      );
      return;
    }

    onSubmit({ name: trimmedName, amount: parsedAmount });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, justifyContent: "flex-end" }} // adjust to match your existing overlay/sheet layout
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.overlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              style={styles.kvContainer}
            >
              <View style={styles.sheet}>
                {/* Handle bar */}
                <View style={styles.handle} />

                {/* Header */}
                <View style={styles.header}>
                  <Text style={styles.title}>Create Wallet</Text>
                  <TouchableOpacity
                    onPress={handleClose}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons
                      name="close"
                      size={22}
                      color={Colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>

                {/* Available balance hint */}
                <View style={styles.balanceHint}>
                  <Ionicons
                    name="information-circle-outline"
                    size={14}
                    color={Colors.textSecondary}
                  />
                  <Text style={styles.balanceHintText}>
                    Available demo balance:{" "}
                    <Text style={styles.balanceValue}>
                      ₹{formattedAvailable}
                    </Text>
                  </Text>
                </View>

                {/* Wallet Name Input */}
                <Text style={styles.label}>Wallet Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Swing Trading, Long Term"
                  placeholderTextColor={Colors.textMuted}
                  value={walletName}
                  onChangeText={(t) => {
                    setWalletName(t);
                    setError("");
                  }}
                  autoCapitalize="words"
                  returnKeyType="next"
                />

                {/* Amount Input */}
                <Text style={styles.label}>Amount (₹)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 10000"
                  placeholderTextColor={Colors.textMuted}
                  value={walletAmount}
                  onChangeText={(t) => {
                    setWalletAmount(t);
                    setError("");
                  }}
                  keyboardType="numeric"
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />

                {/* Inline error */}
                {error ? (
                  <View style={styles.errorRow}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={14}
                      color={Colors.danger}
                    />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Submit button */}
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    loading && styles.submitBtnDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color={Colors.white} />
                  ) : (
                    <Text style={styles.submitBtnText}>Create Wallet</Text>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "flex-end",
  },
  kvContainer: {
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: moderateScale(24),
    paddingBottom: Platform.OS === "ios" ? 40 : 28,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: moderateScale(20),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: moderateScale(16),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
  },
  balanceHint: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.divider,
    borderRadius: 8,
    paddingHorizontal: moderateScale(10),
    paddingVertical: moderateScale(8),
    marginBottom: moderateScale(20),
    gap: moderateScale(6),
  },
  balanceHintText: {
    fontSize: fontScale(Typography.small),
    color: Colors.textSecondary,
  },
  balanceValue: {
    fontWeight: "700",
    color: Colors.gain,
  },
  label: {
    fontSize: fontScale(Typography.caption),
    fontWeight: "600",
    color: Colors.textSecondary,
    marginBottom: moderateScale(6),
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: moderateScale(14),
    paddingVertical: moderateScale(12),
    fontSize: fontScale(Typography.body),
    color: Colors.text,
    marginBottom: moderateScale(16),
    backgroundColor: Colors.background,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(5),
    marginBottom: moderateScale(14),
    marginTop: moderateScale(-8),
  },
  errorText: {
    color: Colors.danger,
    fontSize: fontScale(Typography.small),
    flex: 1,
  },
  submitBtn: {
    backgroundColor: Colors.gain,
    borderRadius: 12,
    paddingVertical: moderateScale(15),
    alignItems: "center",
    marginTop: moderateScale(4),
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: Colors.white,
    fontSize: fontScale(Typography.body),
    fontWeight: "700",
  },
});

export default CreateWalletModal;
