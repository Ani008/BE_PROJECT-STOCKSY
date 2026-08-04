import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator } from "react-native";
import { KeyboardAvoidingView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Input from "./Input";
import { Colors, Typography, fontScale, moderateScale } from "../theme";

const CONFIRM_WORD = "DELETE";

/**
 * DeleteAccountModal
 *
 * Two-part confirmation before an irreversible account wipe:
 *   1. Type "DELETE" — the standard "make them actually type it"
 *      friction for a destructive, unrecoverable action.
 *   2. Password — only required for email/password accounts. Google
 *      accounts don't have one on file, so it's optional here; if the
 *      backend needs it and it's missing, its error surfaces via the
 *      app's normal toast and the person can try again.
 *
 * Props:
 * @param {boolean}  visible
 * @param {function} onConfirm(password) — called once "DELETE" is typed correctly
 * @param {function} onCancel
 * @param {boolean}  loading — disables the button + shows a spinner while the request is in flight
 */
const DeleteAccountModal = ({ visible, onConfirm, onCancel, loading }) => {
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");

  const isConfirmed = confirmText === CONFIRM_WORD;

  const handleClose = () => {
    setConfirmText("");
    setPassword("");
    onCancel();
  };

  const handleConfirm = () => {
    if (!isConfirmed || loading) return;
    onConfirm(password);
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    style={{ flex: 1, justifyContent: "flex-end" }}  // adjust to match your existing overlay/sheet layout
  >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="warning-outline" size={28} color={Colors.dangerDark} />
          </View>

          <Text style={styles.title}>Delete your account?</Text>

          <Text style={styles.body}>
            This permanently deletes your Stocksy account — every wallet, holding, and
            your remaining balance will be wiped, regardless of how much you currently
            have. This cannot be undone.
          </Text>

          <Input
            label='Type "DELETE" to confirm'
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder="DELETE"
            autoCapitalize="characters"
          />

          <Input
            label="Password (only if you signed up with email)"
            value={password}
            onChangeText={setPassword}
            placeholder="Leave blank if you used Google Sign-In"
            secureTextEntry
          />

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleClose} disabled={loading}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.deleteButton, (!isConfirmed || loading) && styles.deleteButtonDisabled]}
              onPress={handleConfirm}
              disabled={!isConfirmed || loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color={Colors.white} size="small" />
              ) : (
                <Text style={styles.deleteButtonText}>Delete Account</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.5)",
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
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.dangerBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(14),
  },
  title: {
    fontSize: fontScale(Typography.h4),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: moderateScale(8),
  },
  body: {
    fontSize: fontScale(13.5),
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: moderateScale(18),
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: moderateScale(4),
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
  deleteButton: {
    backgroundColor: Colors.dangerDark,
    borderRadius: 12,
    paddingVertical: moderateScale(12),
    paddingHorizontal: moderateScale(22),
    alignItems: "center",
    justifyContent: "center",
    minWidth: 140,
  },
  deleteButtonDisabled: {
    backgroundColor: Colors.borderLight,
  },
  deleteButtonText: {
    color: Colors.white,
    fontSize: fontScale(14),
    fontWeight: "700",
  },
});

export default DeleteAccountModal;