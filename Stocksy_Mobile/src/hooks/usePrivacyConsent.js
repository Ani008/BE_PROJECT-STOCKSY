import { useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "privacyPolicyAccepted";

/**
 * Tracks whether this device has already accepted the Privacy Policy /
 * Terms & Conditions, so the consent modal only ever shows once (on the
 * first Signup or Signup with Google attempt).
 */
export default function usePrivacyConsent() {
  const [hasAccepted, setHasAccepted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadConsent = async () => {
      try {
        const value = await AsyncStorage.getItem(STORAGE_KEY);
        setHasAccepted(value === "true");
      } catch (err) {
        console.error(err);
        setHasAccepted(false);
      } finally {
        setLoading(false);
      }
    };

    loadConsent();
  }, []);

  const markAccepted = useCallback(async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, "true");
    } catch (err) {
      console.error(err);
    }
    setHasAccepted(true);
  }, []);

  return { hasAccepted, loading, markAccepted };
}