import api from "./api";
import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "token";

// ─── Token helpers ────────────────────────────────────────────────────────────

export const getStoredToken = async () => {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const storeToken = async (token) => {
  await AsyncStorage.setItem(TOKEN_KEY, token);
};

const clearToken = async () => {
  await AsyncStorage.removeItem(TOKEN_KEY);
};

// Google login/signup hit a separate backend route (/auth/google) and
// were, until now, persisting their session with SecureStore instead of
// AsyncStorage — a different storage backend than the one getStoredToken()
// (and api.js's request interceptor) actually reads from. That meant a
// Google session looked successful for one screen, then silently failed
// auth on the very next API call / app relaunch. This helper makes Google
// auth persist through the exact same path as email/password auth.
export const persistGoogleSession = async (data) => {
  await storeToken(data.token);

  await AsyncStorage.setItem(
    "user",
    JSON.stringify({
      id: data.id,
      username: data.username,
      fullName: data.fullName,
      email: data.email,
      avatar: data.avatar,
    }),
  );
};

// ─── Auth calls ───────────────────────────────────────────────────────────────

const signup = async ({ fullName, email, password }) => {
  const response = await api.post("/auth/signup", {
    fullName,
    email,
    password,
  });

  // Mirror login()'s persistence — SignupPage navigates straight into
  // MainTabs after this resolves, so without storing the token/user here
  // the very first screens the person sees would have no auth session.
  await storeToken(response.data.token);

  await AsyncStorage.setItem(
    "user",
    JSON.stringify({
      id: response.data.id,
      username: response.data.username,
      fullName: response.data.fullName,
      email: response.data.email,
    }),
  );

  return response.data;
};

export const login = async (email, password) => {
  const response = await api.post("/auth/login", { email, password });

  await storeToken(response.data.token);
  console.log("LOGIN RESPONSE:", response.data);

  await AsyncStorage.setItem(
    "user",
    JSON.stringify({
      id: response.data.id,
      username: response.data.username,
      fullName: response.data.fullName,
      email: response.data.email,
    }),
  );
  const test = await AsyncStorage.getItem("user");
  console.log("STORED USER:", test);

  return response.data;
};

export const logout = async () => {
  await clearToken();
  const response = await api.post("/auth/logout");
  return response.data;
};

// password is only required for local (email/password) accounts — the
// backend skips that check for Google accounts. Safe to always pass
// whatever the modal collected; the backend ignores it if not needed.
export const deleteAccount = async (password) => {
  const response = await api.delete("/auth/account", {
    data: password ? { password } : {},
  });

  await clearToken();
  await AsyncStorage.removeItem("user");

  return response.data;
};

// ─── Default export (object) so both import styles work ──────────────────────
// LoginPage.js  → import authService from '...'  → authService.login(...)
// App.js        → import { getStoredToken } from '...'  → getStoredToken()

const authService = { signup, login, logout, getStoredToken, deleteAccount, persistGoogleSession };
export default authService;