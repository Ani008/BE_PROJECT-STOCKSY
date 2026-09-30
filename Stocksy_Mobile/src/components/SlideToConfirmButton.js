import React, { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Colors, Typography, fontScale, moderateScale } from "../theme";

const TRACK_HEIGHT = moderateScale(56);
const THUMB_SIZE = TRACK_HEIGHT - moderateScale(8); // 4px padding all round
const CONFIRM_THRESHOLD = 0.72; // % of travel distance to count as a confirm

/**
 * SlideToConfirmButton — drag-to-confirm order CTA.
 *
 * Replaces a plain tap button for irreversible actions (placing a real
 * buy/sell order) with a deliberate slide gesture, so a stray tap can't
 * fire an order by accident.
 *
 * Modes:
 *   "slide"    — normal interactive state, user must drag to confirm
 *   "tap"      — used for the "market closed" / "no wallet" cases where
 *                the original design kept the CTA tappable purely to
 *                surface an explanatory modal/toast, not to place an
 *                order. A single tap calls onConfirm immediately.
 *   "disabled" — genuinely blocked (bad qty, insufficient funds, order
 *                in flight) — track is inert and dimmed.
 *
 * Props:
 *   label        string   — text shown on the track, e.g. "Slide to Buy"
 *   loadingLabel string   — text shown while `loading` is true
 *   color        string   — accent color (thumb + track tint)
 *   icon         string   — Ionicons name shown on the thumb
 *   mode         string   — "slide" | "tap" | "disabled" (default "slide")
 *   loading      bool     — order is in flight; locks the thumb at the
 *                           end and shows a spinner
 *   onConfirm    func     — called once, when the slide completes (or on
 *                           tap, in "tap" mode)
 */
const SlideToConfirmButton = ({
  label,
  loadingLabel = "Placing order...",
  color = Colors.primary,
  icon = "arrow-forward",
  mode = "slide",
  loading = false,
  onConfirm,
}) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const [confirmed, setConfirmed] = useState(false);
  const firedRef = useRef(false); // guards against double-firing onConfirm

  const maxTranslate = Math.max(trackWidth - THUMB_SIZE - moderateScale(8), 1);
  const isInteractive = mode === "slide" && !loading;

  // PanResponder.create() only runs ONCE, inside the useRef initializer
  // below — its callbacks close over whatever `maxTranslate`/`isInteractive`
  // were on that very first render (when trackWidth was still 0, before
  // onLayout ever fired). Later re-renders compute fresh values, but the
  // already-created handlers can never see them — they'd stay stuck
  // referencing that first render's maxTranslate (effectively ~1px of
  // travel), which is why the thumb wouldn't visibly move at all.
  // Fix: keep the current values in refs that update every render, and
  // have the handlers read `.current` instead of closing over the
  // per-render consts directly.
  const maxTranslateRef = useRef(maxTranslate);
  maxTranslateRef.current = maxTranslate;

  const isInteractiveRef = useRef(isInteractive);
  isInteractiveRef.current = isInteractive;

  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  // If a submit attempt fails, `loading` flips true → false again while
  // this component is still mounted (success navigates away instead) —
  // spring the thumb back so the user can try again.
  const prevLoading = useRef(loading);
  useEffect(() => {
    if (prevLoading.current && !loading) {
      firedRef.current = false;
      setConfirmed(false);
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
    }
    prevLoading.current = loading;
  }, [loading]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => isInteractiveRef.current,
      onStartShouldSetPanResponderCapture: () => isInteractiveRef.current,
      onMoveShouldSetPanResponder: () => isInteractiveRef.current,
      onMoveShouldSetPanResponderCapture: () => isInteractiveRef.current,
      onPanResponderMove: (evt, gesture) => {
        if (!isInteractiveRef.current) return;
        const next = Math.min(Math.max(gesture.dx, 0), maxTranslateRef.current);
        translateX.setValue(next);
      },
      onPanResponderRelease: (evt, gesture) => {
        if (!isInteractiveRef.current) return;
        const max = maxTranslateRef.current;
        const next = Math.min(Math.max(gesture.dx, 0), max);
        const progress = max > 0 ? next / max : 0;

        if (progress >= CONFIRM_THRESHOLD) {
          Animated.spring(translateX, {
            toValue: max,
            useNativeDriver: true,
            friction: 8,
          }).start();
          if (!firedRef.current) {
            firedRef.current = true;
            setConfirmed(true);
            onConfirmRef.current?.();
          }
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        // Another responder (e.g. the ScrollView above) stole the gesture
        // mid-drag — snap back rather than leaving the thumb stranded.
        if (!isInteractiveRef.current) return;
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }).start();
      },
    }),
  ).current;

  // Label fades out as the thumb travels across the track
  const labelOpacity = translateX.interpolate({
    inputRange: [0, Math.max(maxTranslate * 0.6, 1)],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  const trackTint =
    mode === "disabled" ? Colors.textMuted : mode === "tap" ? Colors.warning : color;

  const trackInner = (
    <>
      {/* Track label */}
      <Animated.View
        style={[styles.labelWrap, { opacity: mode === "tap" ? 1 : labelOpacity }]}
        pointerEvents="none"
      >
        {loading ? (
          <Text style={[styles.label, { color: trackTint }]}>{loadingLabel}</Text>
        ) : (
          <>
            <Text style={[styles.label, { color: trackTint }]}>{label}</Text>
            {mode === "slide" && (
              <Ionicons
                name="chevron-forward"
                size={moderateScale(16)}
                color={trackTint}
                style={{ marginLeft: moderateScale(2) }}
              />
            )}
          </>
        )}
      </Animated.View>

      {/* Draggable thumb (panHandlers only actually engage in "slide" mode) */}
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.thumb,
          {
            backgroundColor: mode === "disabled" ? Colors.textMuted : color,
            transform: [
              {
                translateX:
                  mode === "disabled" ? 0 : loading ? maxTranslate : translateX,
              },
            ],
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={Colors.white} />
        ) : confirmed ? (
          <Ionicons name="checkmark" size={moderateScale(20)} color={Colors.white} />
        ) : (
          <Ionicons name={icon} size={moderateScale(20)} color={Colors.white} />
        )}
      </Animated.View>
    </>
  );

  const trackStyle = [
    styles.track,
    {
      backgroundColor: mode === "disabled" ? Colors.divider : `${trackTint}1A`, // ~10% tint
      borderColor: mode === "disabled" ? Colors.border : `${trackTint}33`,
    },
  ];

  // "tap" mode: whole track is a plain button, no PanResponder involved.
  if (mode === "tap") {
    return (
      <Pressable
        style={trackStyle}
        onPress={() => onConfirmRef.current?.()}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      >
        {trackInner}
      </Pressable>
    );
  }

  return (
    <View style={trackStyle} onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
      {trackInner}
    </View>
  );
};

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    justifyContent: "center",
    overflow: "hidden",
  },
  labelWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: fontScale(Typography.bodyLarge),
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    marginLeft: moderateScale(4),
    alignItems: "center",
    justifyContent: "center",
    // subtle elevation so it reads as a physically draggable piece
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
});

export default SlideToConfirmButton;