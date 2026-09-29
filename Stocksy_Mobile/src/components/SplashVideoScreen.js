import React, { useEffect, useRef } from "react";
import { View, StyleSheet } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";

// Update this path once the actual video asset is added to /assets.
// require() bundles it into the app so it works offline and in
// production builds (Expo Go, dev client, and store builds alike) —
// no CDN/network fetch involved.
const SPLASH_SOURCE = require("../../assets/Logo_Video.mp4");

// Hard ceiling in case the "player finished" event is ever missed on a
// given device/OS combo (rare, but this guarantees the splash can never
// get stuck open). Your video is 4s, so this fires ~0.5s after it
// should have already advanced naturally.
const FALLBACK_TIMEOUT_MS = 2500;

const SplashVideoScreen = ({ onFinish }) => {
  const finishedRef = useRef(false);

  const player = useVideoPlayer(SPLASH_SOURCE, (p) => {
    p.muted = true; // audio off, per spec
    p.loop = false;
    p.play();
  });

  const finish = () => {
    if (finishedRef.current) return; // guard against double-fire (event + fallback timer)
    finishedRef.current = true;
    onFinish?.();
  };

  useEffect(() => {
    const subscription = player.addListener("playToEnd", finish);
    const fallback = setTimeout(finish, FALLBACK_TIMEOUT_MS);

    return () => {
      subscription.remove();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  return (
    <View style={styles.container}>
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
        fullscreenOptions={{ enabled: false }}
        allowsPictureInPicture={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F19", // adjust to match your brand splash background
  },
  video: {
    ...StyleSheet.absoluteFillObject, // fills the entire parent — full screen, no letterboxing
  },
});

export default SplashVideoScreen;