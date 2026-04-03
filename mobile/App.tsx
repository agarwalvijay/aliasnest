import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

import { apiRequest } from "./src/api";

type User = {
  id: number;
  email: string;
  timezone: string;
};

type Mask = {
  id: number;
  address: string;
  local_part: string;
  domain: string;
  is_active: boolean;
  unread_count: number;
};

type Domain = {
  id: number;
  name: string;
  is_default: boolean;
  is_verified: boolean;
  can_use_for_mask: boolean;
  verification_token: string | null;
  verify_host: string | null;
  mx_host: string | null;
  mx_type: string | null;
  mx_value: string | null;
  mx_target_host: string | null;
  public_smtp_port: number;
};

type Message = {
  id: number;
  mask_id: number;
  from: string;
  to: string;
  subject: string;
  preview: string;
  is_outbound: boolean;
  is_read: boolean;
  received_at_utc: string;
  received_at_local: string;
  timezone: string;
};

type MessageDetail = Message & { body: string };

type InboxMessage = Message & { mask_address: string };

type ViewMode = "inbox" | "message" | "settings" | "register";

const TOKEN_KEY = "aliasnest_token";
const AVATAR_COLORS = ["#2f80ed", "#f2994a", "#eb5757", "#9b51e0", "#27ae60", "#56ccf2", "#bb6bd9"];
const TIMEZONE_OPTIONS = [
  "UTC",
  "America/Chicago",
  "America/New_York",
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function senderLabel(message: InboxMessage): string {
  return message.is_outbound ? `To: ${message.to}` : message.from;
}

function initialsFromSender(sender: string): string {
  const clean = sender.replace(/<.*?>/g, "").trim();
  const parts = clean.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function shortTime(isoUtc: string): string {
  const date = new Date(isoUtc);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

const SWIPE_THRESHOLD = 90;

function SwipeableRow({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }) {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => translateX.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > SWIPE_THRESHOLD) {
          Animated.timing(translateX, {
            toValue: g.dx > 0 ? 600 : -600,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            translateX.setValue(0);
            onDelete();
          });
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  return (
    <View style={{ overflow: "hidden" }}>
      <View style={swipeStyles.deleteBackground}>
        <MaterialCommunityIcons name="trash-can-outline" size={24} color="#fff" />
        <MaterialCommunityIcons name="trash-can-outline" size={24} color="#fff" />
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const swipeStyles = StyleSheet.create({
  deleteBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#c4314b",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
});

export default function App() {
  const topInset = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const passwordRef = useRef<TextInput>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regInvite, setRegInvite] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("inbox");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [timezoneInput, setTimezoneInput] = useState("UTC");
  const [timezoneDropdownOpen, setTimezoneDropdownOpen] = useState(false);

  const [masks, setMasks] = useState<Mask[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedMaskId, setSelectedMaskId] = useState<number | null>(null); // null = all inbox

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);
  const [showReplyComposer, setShowReplyComposer] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyAllMode, setReplyAllMode] = useState(false);

  const [newMaskLocalPart, setNewMaskLocalPart] = useState("");
  const [newMaskDomain, setNewMaskDomain] = useState("");
  const [newDomain, setNewDomain] = useState("");

  const selectedMask = useMemo(() => masks.find((m) => m.id === selectedMaskId) || null, [masks, selectedMaskId]);
  const availableDomainNames = useMemo(() => domains.filter((d) => d.can_use_for_mask).map((d) => d.name), [domains]);
  const mailboxLabel = selectedMask ? selectedMask.address : "All inbox";

  const messageSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          viewMode === "message" &&
          gestureState.dx > 16 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onMoveShouldSetPanResponder: (_, gestureState) =>
          viewMode === "message" &&
          gestureState.dx > 18 &&
          Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx > 72 && Math.abs(gestureState.dy) < 44) {
            goBackToInbox();
          }
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [viewMode],
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      if (showReplyComposer) {
        setShowReplyComposer(false);
        setReplyDraft("");
        return true;
      }
      if (viewMode === "message") {
        goBackToInbox();
        return true;
      }
      if (viewMode === "settings") {
        setViewMode("inbox");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [drawerOpen, showReplyComposer, viewMode]);

  useEffect(() => {
    const run = async () => {
      try {
        const stored = await SecureStore.getItemAsync(TOKEN_KEY);
        if (stored) {
          setToken(stored);
        }
      } finally {
        setBooting(false);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setMasks([]);
      setDomains([]);
      setMessages([]);
      setSelectedMaskId(null);
      setSelectedMessage(null);
      return;
    }
    void refreshAccount(token, selectedMaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Auto-refresh: re-fetch when app comes to foreground (e.g. after tapping a notification)
  // and poll every 60s while active. Clear badge whenever app becomes active.
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void Notifications.setBadgeCountAsync(0);
        void refreshAccount(token, selectedMaskId);
      }
    });
    const poll = setInterval(() => void refreshAccount(token, selectedMaskId), 60_000);
    return () => { sub.remove(); clearInterval(poll); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedMaskId]);

  async function refreshAccount(activeToken: string, preferredMaskId: number | null) {
    setBusy(true);
    setError(null);
    try {
      const me = await apiRequest<User>("/api/me", "GET", activeToken);
      setUser(me);
      if (!timezoneDropdownOpen) setTimezoneInput(me.timezone || "UTC");

      const domainPayload = await apiRequest<{ items: Domain[] }>("/api/domains", "GET", activeToken);
      setDomains(domainPayload.items);
      const firstUsableDomain = domainPayload.items.find((d) => d.can_use_for_mask)?.name || "";
      setNewMaskDomain((prev) => prev || firstUsableDomain);

      const maskPayload = await apiRequest<{ items: Mask[] }>("/api/masks", "GET", activeToken);
      const loadedMasks = maskPayload.items;
      setMasks(loadedMasks);

      const nextMaskId = preferredMaskId && loadedMasks.some((m) => m.id === preferredMaskId) ? preferredMaskId : null;
      setSelectedMaskId(nextMaskId);
      await loadInboxMessages(activeToken, nextMaskId, loadedMasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account");
    } finally {
      setBusy(false);
    }
  }

  async function loadInboxMessages(activeToken: string, maskId: number | null, maskList: Mask[]) {
    if (maskId) {
      const payload = await apiRequest<{ items: Message[] }>(`/api/masks/${maskId}/messages?limit=100`, "GET", activeToken);
      const selected = maskList.find((m) => m.id === maskId);
      const address = selected ? selected.address : "Unknown alias";
      const mapped = payload.items.map((msg) => ({ ...msg, mask_address: address }));
      setMessages(mapped);
      return;
    }

    if (maskList.length === 0) {
      setMessages([]);
      return;
    }

    const results = await Promise.all(
      maskList.map(async (mask) => {
        const payload = await apiRequest<{ items: Message[] }>(`/api/masks/${mask.id}/messages?limit=60`, "GET", activeToken);
        return payload.items.map((msg) => ({ ...msg, mask_address: mask.address }));
      }),
    );

    const merged = results.flat().sort((a, b) => {
      const tA = new Date(a.received_at_utc).getTime();
      const tB = new Date(b.received_at_utc).getTime();
      return tB - tA;
    });
    setMessages(merged);
  }

  async function doLogin() {
    setBusy(true);
    setError(null);
    try {
      const payload = await apiRequest<{ token: string }>("/api/auth/login", "POST", undefined, { email, password });
      await SecureStore.setItemAsync(TOKEN_KEY, payload.token);
      setToken(payload.token);
      setViewMode("inbox");
      void registerPushToken(payload.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    if (token) {
      try {
        await apiRequest("/api/auth/logout", "POST", token);
      } catch {
        // ignore
      }
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setEmail("");
    setPassword("");
    setViewMode("inbox");
    setDrawerOpen(false);
  }

  async function chooseMailbox(maskId: number | null) {
    if (!token) return;
    setDrawerOpen(false);
    setViewMode("inbox");
    setSelectedMessage(null);
    setBusy(true);
    try {
      setSelectedMaskId(maskId);
      await loadInboxMessages(token, maskId, masks);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed loading inbox");
    } finally {
      setBusy(false);
    }
  }

  async function openMessage(messageId: number) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await apiRequest<MessageDetail>(`/api/messages/${messageId}`, "GET", token);
      setSelectedMessage(detail);
      setViewMode("message");
      setShowReplyComposer(false);
      setReplyDraft("");
      setReplyAllMode(false);

      if (!detail.is_outbound && !detail.is_read) {
        await apiRequest(`/api/messages/${messageId}/mark-read`, "POST", token);
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, is_read: true } : m)));
        setMasks((prev) =>
          prev.map((m) => (m.id === detail.mask_id ? { ...m, unread_count: Math.max(0, m.unread_count - 1) } : m)),
        );
        setSelectedMessage((prev) => (prev ? { ...prev, is_read: true } : prev));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed loading message");
    } finally {
      setBusy(false);
    }
  }

  function deleteMessage() {
    if (!token || !selectedMessage) return;
    Alert.alert("Delete message?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await apiRequest(`/api/messages/${selectedMessage.id}`, "DELETE", token);
            setSelectedMessage(null);
            setShowReplyComposer(false);
            setReplyDraft("");
            setViewMode("inbox");
            await loadInboxMessages(token, selectedMaskId, masks);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Delete failed");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function toggleReadState() {
    if (!token || !selectedMessage || selectedMessage.is_outbound) return;
    setBusy(true);
    setError(null);
    try {
      const nextRead = !selectedMessage.is_read;
      await apiRequest(`/api/messages/${selectedMessage.id}/${nextRead ? "mark-read" : "mark-unread"}`, "POST", token);
      const refreshed = await apiRequest<MessageDetail>(`/api/messages/${selectedMessage.id}`, "GET", token);
      setSelectedMessage(refreshed);
      await loadInboxMessages(token, selectedMaskId, masks);
      await refreshMaskCounts(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function refreshMaskCounts(activeToken: string) {
    const payload = await apiRequest<{ items: Mask[] }>("/api/masks", "GET", activeToken);
    setMasks(payload.items);
  }

  function goBackToInbox() {
    setViewMode("inbox");
    setShowReplyComposer(false);
    setReplyDraft("");
  }

  async function sendReply() {
    if (!token || !selectedMessage) return;
    const body = replyDraft.trim();
    if (!body) {
      Alert.alert("Reply required", "Please type a reply first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/messages/${selectedMessage.id}/reply`, "POST", token, {
        body,
        reply_all: replyAllMode,
      });
      setReplyDraft("");
      setShowReplyComposer(false);
      await refreshAccount(token, selectedMaskId);
      Alert.alert("Reply sent", replyAllMode ? "Sent to all recipients." : "Reply sent.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveTimezone() {
    if (!token) return;
    const tz = timezoneInput.trim();
    if (!tz) {
      Alert.alert("Timezone required", "Enter a timezone like America/Chicago.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/me/timezone", "PATCH", token, { timezone: tz });
      await refreshAccount(token, selectedMaskId);
      setTimezoneDropdownOpen(false);
      Alert.alert("Saved", "Timezone updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update timezone");
    } finally {
      setBusy(false);
    }
  }

  async function addDomain() {
    if (!token) return;
    const cleanDomain = newDomain.trim().toLowerCase();
    if (!cleanDomain) {
      Alert.alert("Domain required", "Enter a domain like example.com.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/domains", "POST", token, { domain_name: cleanDomain });
      setNewDomain("");
      await refreshAccount(token, selectedMaskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add domain");
    } finally {
      setBusy(false);
    }
  }

  async function verifyDomain(domainId: number) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/domains/${domainId}/verify`, "POST", token);
      await refreshAccount(token, selectedMaskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Domain verification failed");
    } finally {
      setBusy(false);
    }
  }

  function deleteDomain(domainId: number) {
    if (!token) return;
    Alert.alert("Delete domain?", "All associated masks and messages will be lost.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await apiRequest(`/api/domains/${domainId}`, "DELETE", token);
            await refreshAccount(token, selectedMaskId);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to delete domain");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function createMask() {
    if (!token) return;
    const cleanLocal = newMaskLocalPart.trim().toLowerCase();
    if (!cleanLocal) {
      Alert.alert("Mask required", "Enter a local part for the mask.");
      return;
    }
    if (!newMaskDomain) {
      Alert.alert("Domain required", "Select or add a verified domain first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/masks", "POST", token, {
        local_part: cleanLocal,
        domain_name: newMaskDomain,
      });
      setNewMaskLocalPart("");
      await refreshAccount(token, selectedMaskId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create mask");
    } finally {
      setBusy(false);
    }
  }

  function deleteMask(maskId: number) {
    if (!token) return;
    Alert.alert("Delete mask?", "All messages for this mask will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          setError(null);
          try {
            await apiRequest(`/api/masks/${maskId}`, "DELETE", token);
            const nextSelection = selectedMaskId === maskId ? null : selectedMaskId;
            await refreshAccount(token, nextSelection);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to delete mask");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function toggleMask(maskId: number, isActive: boolean) {
    if (!token) return;
    try {
      await apiRequest(`/api/masks/${maskId}`, "PATCH", token, { is_active: isActive });
      setMasks((prev) => prev.map((m) => m.id === maskId ? { ...m, is_active: isActive } : m));
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to update mask");
    }
  }

  async function doRegister() {
    setError(null);
    if (regPassword !== regConfirm) { setError("Passwords do not match."); return; }
    if (regPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    setBusy(true);
    try {
      const payload = await apiRequest<{ token: string }>("/api/auth/register", "POST", undefined, {
        email: regEmail.trim().toLowerCase(),
        password: regPassword,
        invite_code: regInvite.trim(),
      });
      await SecureStore.setItemAsync(TOKEN_KEY, payload.token);
      setToken(payload.token);
      setViewMode("inbox");
      void registerPushToken(payload.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  async function registerPushToken(activeToken: string) {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;
      // getDevicePushTokenAsync returns the native FCM token (Android) or APNs token (iOS)
      // This bypasses Expo's relay — server sends directly via Firebase Admin SDK
      const deviceToken = await Notifications.getDevicePushTokenAsync();
      await apiRequest("/api/push-token", "POST", activeToken, {
        token: deviceToken.data,
        platform: deviceToken.type, // "fcm" | "apns"
      });
    } catch {
      // Non-fatal: push notifications are optional
    }
  }

  async function copyValue(label: string, value: string | null | undefined) {
    const cleaned = (value || "").trim();
    if (!cleaned) return;
    await Clipboard.setStringAsync(cleaned);
    Alert.alert("Copied", `${label} copied.`);
  }

  if (booting) {
    return (
      <SafeAreaView style={[styles.centered, { paddingTop: topInset }]}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  if (!token) {
    if (viewMode === "register") {
      return (
        <SafeAreaView style={[styles.container, { paddingTop: topInset }]}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center" }}>
            <ScrollView contentContainerStyle={styles.loginCard} keyboardShouldPersistTaps="handled">
              <Text style={styles.brand}>AliasNest</Text>
              <Text style={styles.subtitle}>Create an account</Text>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TextInput
                value={regEmail}
                onChangeText={setRegEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                returnKeyType="next"
                placeholder="Email"
                style={styles.input}
              />
              <TextInput
                value={regPassword}
                onChangeText={setRegPassword}
                secureTextEntry
                placeholder="Password (min 8 chars)"
                returnKeyType="next"
                style={styles.input}
              />
              <TextInput
                value={regConfirm}
                onChangeText={setRegConfirm}
                secureTextEntry
                placeholder="Confirm password"
                returnKeyType="next"
                style={styles.input}
              />
              <TextInput
                value={regInvite}
                onChangeText={setRegInvite}
                autoCapitalize="none"
                placeholder="Invite code (if required)"
                returnKeyType="done"
                onSubmitEditing={() => void doRegister()}
                style={styles.input}
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={() => void doRegister()} disabled={busy}>
                <Text style={styles.primaryBtnText}>{busy ? "Creating account…" : "Create account"}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setViewMode("inbox"); setError(null); }} style={styles.switchAuthBtn}>
                <Text style={styles.switchAuthText}>Already have an account? <Text style={styles.switchAuthLink}>Sign in</Text></Text>
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.loginCard}>
          <Text style={styles.brand}>AliasNest</Text>
          <Text style={styles.subtitle}>Sign in to your inbox</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="Email"
            style={styles.input}
          />
          <TextInput
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            returnKeyType="done"
            onSubmitEditing={() => void doLogin()}
            style={styles.input}
          />
          <TouchableOpacity style={styles.primaryBtn} onPress={doLogin} disabled={busy}>
            <Text style={styles.primaryBtnText}>{busy ? "Signing in..." : "Sign in"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setViewMode("register"); setError(null); }} style={styles.switchAuthBtn}>
            <Text style={styles.switchAuthText}>New to AliasNest? <Text style={styles.switchAuthLink}>Create account</Text></Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        {viewMode === "inbox" ? (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity style={styles.iconButton} onPress={() => setDrawerOpen(true)}>
                <MaterialCommunityIcons name="menu" size={22} color="#fff" />
              </TouchableOpacity>
              <View>
                <Text style={styles.headerTitle}>Inbox</Text>
                <Text style={styles.headerSubTitle} numberOfLines={1}>{mailboxLabel}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.iconButton} onPress={() => void refreshAccount(token, selectedMaskId)}>
              <MaterialCommunityIcons name="refresh" size={22} color="#fff" />
            </TouchableOpacity>
          </>
        ) : null}

        {viewMode === "message" ? (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity style={styles.iconButton} onPress={goBackToInbox}>
                <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Message</Text>
            </View>
            <View style={styles.messageHeaderActions}>
              {!selectedMessage?.is_outbound ? (
                <TouchableOpacity style={styles.iconButtonLight} onPress={() => void toggleReadState()}>
                  <MaterialCommunityIcons
                    name={selectedMessage?.is_read ? "email-outline" : "email-open-outline"}
                    size={20}
                    color="#0a66c2"
                  />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.iconButtonDanger} onPress={() => void deleteMessage()}>
                <MaterialCommunityIcons name="trash-can-outline" size={19} color="#c4314b" />
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {viewMode === "settings" ? (
          <>
            <View style={styles.headerLeft}>
              <TouchableOpacity style={styles.iconButton} onPress={() => setViewMode("inbox")}>
                <MaterialCommunityIcons name="arrow-left" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Settings</Text>
            </View>
            <View />
          </>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {viewMode === "inbox" ? (
        <FlatList
          data={messages}
          keyExtractor={(item) => String(item.id)}
          refreshing={busy}
          onRefresh={() => void refreshAccount(token, selectedMaskId)}
          ListEmptyComponent={<Text style={styles.emptyText}>No messages yet.</Text>}
          renderItem={({ item }) => {
            const isUnread = !item.is_outbound && !item.is_read;
            return (
              <SwipeableRow onDelete={() => {
                if (!token) return;
                apiRequest(`/api/messages/${item.id}`, "DELETE", token)
                  .then(() => setMessages((prev) => prev.filter((m) => m.id !== item.id)))
                  .catch(() => void refreshAccount(token, selectedMaskId));
              }}>
                <TouchableOpacity style={[styles.messageRow, isUnread && styles.messageUnread]} onPress={() => void openMessage(item.id)}>
                  <View style={styles.rowMain}>
                    <View style={[styles.avatarCircle, { backgroundColor: avatarColor(senderLabel(item)) }]}>
                      <Text style={styles.avatarText}>{initialsFromSender(senderLabel(item))}</Text>
                    </View>
                    <View style={styles.rowContent}>
                      <View style={styles.messageTopLine}>
                        <Text style={[styles.senderText, isUnread && styles.senderTextUnread]} numberOfLines={1}>{senderLabel(item)}</Text>
                        {isUnread ? <View style={styles.unreadDot} /> : null}
                        <Text style={styles.timeText}>{item.received_at_local}</Text>
                      </View>
                      <Text style={[styles.subjectText, isUnread && styles.subjectTextUnread]} numberOfLines={1}>{item.subject}</Text>
                      {item.preview ? <Text style={styles.previewText} numberOfLines={1}>{item.preview}</Text> : null}
                      <Text style={styles.aliasText} numberOfLines={1}>{item.mask_address}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </SwipeableRow>
            );
          }}
        />
      ) : null}

      {viewMode === "message" ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.messageScreenWrap} {...messageSwipeResponder.panHandlers}>
          <ScrollView style={styles.detailScreen}>
            {selectedMessage ? (
              <>
                <Text style={styles.detailSubject}>{selectedMessage.subject}</Text>
                <View style={styles.detailHeaderRow}>
                  <View style={[styles.avatarCircle, styles.detailAvatar, { backgroundColor: avatarColor(selectedMessage.from) }]}>
                    <Text style={styles.avatarText}>{initialsFromSender(selectedMessage.from)}</Text>
                  </View>
                  <View style={styles.detailMetaColumn}>
                    <Text style={styles.detailMeta} numberOfLines={1}>From: {selectedMessage.from}</Text>
                    <Text style={styles.detailMeta} numberOfLines={1}>To: {selectedMessage.to}</Text>
                    <Text style={styles.detailMeta}>
                      {selectedMessage.is_outbound ? "Sent" : "Received"}: {selectedMessage.received_at_local} {selectedMessage.timezone}
                    </Text>
                  </View>
                  {!selectedMessage.is_outbound ? (
                    <View style={styles.inlineReplyIcons}>
                      <TouchableOpacity
                        style={styles.inlineReplyBtn}
                        onPress={() => {
                          setReplyAllMode(false);
                          setShowReplyComposer(true);
                        }}
                      >
                        <MaterialCommunityIcons name="reply-outline" size={19} color="#0a66c2" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.inlineReplyBtn}
                        onPress={() => {
                          setReplyAllMode(true);
                          setShowReplyComposer(true);
                        }}
                      >
                        <MaterialCommunityIcons name="reply-all-outline" size={19} color="#0a66c2" />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>

                <View style={styles.bodyCard}>
                  <Text style={styles.bodyText}>{selectedMessage.body}</Text>
                </View>

                {showReplyComposer ? (
                  <View style={styles.replyComposerCard}>
                    <Text style={styles.replyComposerTitle}>{replyAllMode ? "Reply all" : "Reply"}</Text>
                    <TextInput
                      value={replyDraft}
                      onChangeText={setReplyDraft}
                      placeholder="Write your reply..."
                      multiline
                      style={styles.replyInput}
                    />
                    <View style={styles.replyComposerActions}>
                      <TouchableOpacity
                        style={styles.secondaryBtn}
                        onPress={() => {
                          setShowReplyComposer(false);
                          setReplyDraft("");
                        }}
                      >
                        <Text style={styles.secondaryBtnText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.primaryBtnSmall} onPress={() => void sendReply()}>
                        <Text style={styles.primaryBtnText}>Send</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.emptyText}>No message selected.</Text>
            )}
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      ) : null}

      {viewMode === "settings" ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView style={styles.settingsScreen}>
          <Text style={styles.settingsSectionTitle}>Account</Text>
          <Text style={styles.userText}>{user?.email}</Text>

          <Text style={styles.settingsLabel}>Timezone</Text>
          <View style={styles.inlineRow}>
            <TouchableOpacity
              style={[styles.input, styles.inlineInput, styles.dropdownInput]}
              onPress={() => setTimezoneDropdownOpen((prev) => !prev)}
            >
              <Text style={styles.dropdownInputText}>{timezoneInput}</Text>
              <MaterialCommunityIcons name={timezoneDropdownOpen ? "chevron-up" : "chevron-down"} size={18} color="#607089" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void saveTimezone()}>
              <MaterialCommunityIcons name="check" size={16} color="#1d2b43" />
            </TouchableOpacity>
          </View>
          {timezoneDropdownOpen ? (
            <View style={styles.dropdownList}>
              <ScrollView style={styles.dropdownScroll}>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <TouchableOpacity
                    key={tz}
                    style={[styles.dropdownOption, timezoneInput === tz && styles.dropdownOptionActive]}
                    onPress={() => {
                      setTimezoneInput(tz);
                      setTimezoneDropdownOpen(false);
                    }}
                  >
                    <Text style={[styles.dropdownOptionText, timezoneInput === tz && styles.dropdownOptionTextActive]}>{tz}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Text style={styles.settingsSectionTitle}>Custom Domains</Text>
          <View style={styles.inlineRow}>
            <TextInput
              value={newDomain}
              onChangeText={setNewDomain}
              style={[styles.input, styles.inlineInput]}
              autoCapitalize="none"
              placeholder="example.com"
            />
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void addDomain()}>
              <Text style={styles.secondaryBtnText}>Add</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.settingsList}>
            {domains.filter((domain) => !domain.is_default).map((domain) => (
              <View key={domain.id} style={styles.settingsRow}>
                <View style={styles.settingsRowMain}>
                  <Text style={styles.settingsRowTitle}>{domain.name}</Text>
                  <Text style={styles.settingsRowSubtitle} numberOfLines={2}>
                    {domain.is_default
                      ? "Default domain"
                      : domain.is_verified
                        ? "Verified"
                        : domain.verify_host && domain.verification_token
                          ? "Pending verification"
                          : "Pending verification"}
                  </Text>
                </View>
                {!domain.is_default && !domain.is_verified ? (
                  <TouchableOpacity style={styles.secondaryBtnCompact} onPress={() => void verifyDomain(domain.id)}>
                    <Text style={styles.secondaryBtnText}>Verify</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.deleteIconBtn} onPress={() => void deleteDomain(domain.id)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color="#c4314b" />
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <View style={styles.settingsList}>
            {domains.filter((domain) => !domain.is_default && !domain.is_verified).map((domain) => (
              <View key={`dns-${domain.id}`} style={styles.dnsCard}>
                <Text style={styles.settingsRowTitle}>DNS records for {domain.name}</Text>

                <View style={styles.dnsRow}>
                  <Text style={styles.dnsLabel}>TXT host</Text>
                  <Text style={styles.dnsValue} numberOfLines={1}>{domain.verify_host}</Text>
                  <TouchableOpacity style={styles.copyIconBtn} onPress={() => void copyValue("TXT host", domain.verify_host)}>
                    <MaterialCommunityIcons name="content-copy" size={15} color="#0b6bce" />
                  </TouchableOpacity>
                </View>

                <View style={styles.dnsRow}>
                  <Text style={styles.dnsLabel}>TXT value</Text>
                  <Text style={styles.dnsValue} numberOfLines={1}>{domain.verification_token}</Text>
                  <TouchableOpacity style={styles.copyIconBtn} onPress={() => void copyValue("TXT value", domain.verification_token)}>
                    <MaterialCommunityIcons name="content-copy" size={15} color="#0b6bce" />
                  </TouchableOpacity>
                </View>

                <View style={styles.dnsRow}>
                  <Text style={styles.dnsLabel}>MX host</Text>
                  <Text style={styles.dnsValue} numberOfLines={1}>{domain.mx_host}</Text>
                  <TouchableOpacity style={styles.copyIconBtn} onPress={() => void copyValue("MX host", domain.mx_host)}>
                    <MaterialCommunityIcons name="content-copy" size={15} color="#0b6bce" />
                  </TouchableOpacity>
                </View>

                <View style={styles.dnsRow}>
                  <Text style={styles.dnsLabel}>MX type</Text>
                  <Text style={styles.dnsValue} numberOfLines={1}>{domain.mx_type}</Text>
                  <TouchableOpacity style={styles.copyIconBtn} onPress={() => void copyValue("MX type", domain.mx_type)}>
                    <MaterialCommunityIcons name="content-copy" size={15} color="#0b6bce" />
                  </TouchableOpacity>
                </View>

                <View style={styles.dnsRow}>
                  <Text style={styles.dnsLabel}>MX value</Text>
                  <Text style={styles.dnsValue} numberOfLines={1}>{domain.mx_value}</Text>
                  <TouchableOpacity style={styles.copyIconBtn} onPress={() => void copyValue("MX value", domain.mx_value)}>
                    <MaterialCommunityIcons name="content-copy" size={15} color="#0b6bce" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.dnsHint}>
                  Ensure your MX target resolves to your public IP and router forwards TCP {domain.public_smtp_port} to this server.
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.settingsSectionTitle}>Aliases</Text>
          <View style={styles.inlineRow}>
            <TextInput
              value={newMaskLocalPart}
              onChangeText={setNewMaskLocalPart}
              style={[styles.input, styles.inlineInput]}
              autoCapitalize="none"
              placeholder="shopping-1"
            />
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void createMask()}>
              <Text style={styles.secondaryBtnText}>Create</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.domainPills}>
            {availableDomainNames.map((domainName) => (
              <TouchableOpacity
                key={domainName}
                onPress={() => setNewMaskDomain(domainName)}
                style={[styles.domainPill, newMaskDomain === domainName && styles.domainPillActive]}
              >
                <Text style={styles.domainPillText}>{domainName}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.settingsList}>
            {masks.map((mask) => (
              <View key={mask.id} style={[styles.settingsRow, !mask.is_active && styles.settingsRowPaused]}>
                <View style={styles.settingsRowMain}>
                  <Text style={[styles.settingsRowTitle, !mask.is_active && styles.settingsRowTitlePaused]}>{mask.address}</Text>
                  <Text style={styles.settingsRowSubtitle}>
                    {mask.is_active ? `${mask.unread_count} unread` : "Paused — not accepting mail"}
                  </Text>
                </View>
                <TouchableOpacity style={styles.pauseIconBtn} onPress={() => void toggleMask(mask.id, !mask.is_active)}>
                  <MaterialCommunityIcons name={mask.is_active ? "pause-circle-outline" : "play-circle-outline"} size={20} color={mask.is_active ? "#607089" : "#27ae60"} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteIconBtn} onPress={() => void deleteMask(mask.id)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color="#c4314b" />
                </TouchableOpacity>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={doLogout}>
            <Text style={styles.logoutBtnText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
      ) : null}

      {drawerOpen ? (
        <View style={styles.drawerOverlay}>
          <View style={[styles.drawerPanel, { paddingTop: topInset + 14 }]}>
            <Text style={styles.drawerTitle}>Inbox</Text>

            <TouchableOpacity style={[styles.drawerItem, selectedMaskId === null && styles.drawerItemActive]} onPress={() => void chooseMailbox(null)}>
              <Text style={styles.drawerItemText}>All inbox</Text>
            </TouchableOpacity>

            {masks.map((mask) => (
              <TouchableOpacity
                key={mask.id}
                style={[styles.drawerItem, selectedMaskId === mask.id && styles.drawerItemActive, !mask.is_active && styles.drawerItemPaused]}
                onPress={() => void chooseMailbox(mask.id)}
              >
                <Text style={[styles.drawerItemText, !mask.is_active && styles.drawerItemTextPaused]} numberOfLines={1}>{mask.address}</Text>
                {!mask.is_active ? <Text style={styles.drawerPausedBadge}>paused</Text> : null}
                {mask.is_active && mask.unread_count > 0 ? <Text style={styles.drawerBadge}>{mask.unread_count}</Text> : null}
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.drawerItem}
              onPress={() => {
                setDrawerOpen(false);
                setViewMode("settings");
              }}
            >
              <Text style={styles.drawerItemText}>Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.drawerItem} onPress={doLogout}>
              <Text style={styles.drawerItemText}>Sign out</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
        </View>
      ) : null}

      {busy ? <ActivityIndicator style={styles.busy} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6fa",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#0a66c2",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  messageHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTitle: {
    fontSize: 19,
    fontWeight: "600",
    color: "#ffffff",
  },
  headerSubTitle: {
    fontSize: 12,
    color: "#d9e7fb",
    maxWidth: 250,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  iconButtonLight: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#c9dbf3",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  iconButtonDanger: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f0b8c2",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  iconButtonText: {
    fontSize: 20,
    color: "#ffffff",
    fontWeight: "600",
  },
  brand: {
    fontSize: 34,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  subtitle: {
    color: "#52627c",
    marginBottom: 8,
  },
  error: {
    color: "#b42318",
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  loginCard: {
    marginTop: 90,
    marginHorizontal: 16,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d6e0ee",
    padding: 16,
    gap: 10,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#cfd9e8",
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 10,
    color: "#0f172a",
  },
  dropdownInput: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownInputText: {
    color: "#0f172a",
    fontSize: 14,
  },
  dropdownList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#d8e2f1",
    borderRadius: 10,
    backgroundColor: "#fff",
    maxHeight: 220,
  },
  dropdownScroll: {
    maxHeight: 220,
  },
  dropdownOption: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#edf2fa",
  },
  dropdownOptionActive: {
    backgroundColor: "#edf5ff",
  },
  dropdownOptionText: {
    color: "#1d2b43",
    fontSize: 13,
  },
  dropdownOptionTextActive: {
    color: "#0b6bce",
    fontWeight: "600",
  },
  primaryBtn: {
    backgroundColor: "#0b6bce",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  messageRow: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e9edf5",
  },
  messageUnread: {
    borderLeftWidth: 4,
    borderLeftColor: "#0a66c2",
    paddingLeft: 6,
    backgroundColor: "#f8fbff",
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  avatarText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  rowContent: {
    flex: 1,
  },
  messageTopLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  senderText: {
    flex: 1,
    color: "#1b1f26",
    fontSize: 16,
    fontWeight: "500",
  },
  senderTextUnread: {
    fontWeight: "700",
  },
  timeText: {
    color: "#6a7383",
    fontSize: 12,
    marginLeft: 6,
  },
  subjectText: {
    color: "#232a35",
    fontSize: 15,
    marginTop: 3,
    fontWeight: "400",
  },
  subjectTextUnread: {
    fontWeight: "600",
  },
  previewText: {
    color: "#8a9ab4",
    fontSize: 12,
    marginTop: 2,
  },
  aliasText: {
    color: "#6d7a90",
    fontSize: 13,
    marginTop: 3,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#0a66c2",
    marginHorizontal: 6,
    marginTop: 2,
  },
  emptyText: {
    color: "#607089",
    padding: 18,
    fontSize: 14,
  },
  detailScreen: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  messageScreenWrap: {
    flex: 1,
  },
  detailSubject: {
    color: "#0f172a",
    fontSize: 21,
    fontWeight: "700",
    marginBottom: 8,
  },
  detailHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 6,
  },
  detailAvatar: {
    marginTop: 0,
  },
  detailMetaColumn: {
    flex: 1,
  },
  detailMeta: {
    color: "#51607a",
    fontSize: 12,
    marginBottom: 2,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: "#c7d2e5",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  secondaryBtnCompact: {
    borderWidth: 1,
    borderColor: "#c7d2e5",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  secondaryBtnText: {
    color: "#1d2b43",
    fontWeight: "600",
    fontSize: 12,
  },
  deleteBtn: {
    borderRadius: 10,
    backgroundColor: "#c4314b",
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  deleteBtnCompact: {
    borderRadius: 10,
    backgroundColor: "#c4314b",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  deleteIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f0b8c2",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  copyIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bfd3ef",
    backgroundColor: "#f8fbff",
    alignItems: "center",
    justifyContent: "center",
  },
  dnsCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8e2f1",
    padding: 9,
  },
  dnsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  dnsLabel: {
    width: 70,
    color: "#51607a",
    fontSize: 12,
    fontWeight: "600",
  },
  dnsValue: {
    flex: 1,
    color: "#1d2b43",
    fontSize: 12,
  },
  dnsHint: {
    marginTop: 8,
    color: "#607089",
    fontSize: 11,
    lineHeight: 16,
  },
  deleteBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  primaryBtnSmall: {
    backgroundColor: "#0b6bce",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
  },
  bodyCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e4eaf6",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 10,
  },
  bodyText: {
    color: "#18233a",
    fontSize: 13,
    lineHeight: 20,
  },
  inlineReplyIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  inlineReplyBtn: {
    borderWidth: 1,
    borderColor: "#bfd3ef",
    borderRadius: 999,
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fbff",
  },
  replyComposerCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#d8e2f1",
    borderRadius: 10,
    backgroundColor: "#fff",
    padding: 10,
  },
  replyComposerTitle: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  replyInput: {
    borderWidth: 1,
    borderColor: "#cfd9e8",
    borderRadius: 10,
    padding: 10,
    minHeight: 84,
    textAlignVertical: "top",
    color: "#0f172a",
  },
  replyComposerActions: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  settingsScreen: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  settingsSectionTitle: {
    color: "#0f172a",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
    marginTop: 6,
  },
  settingsLabel: {
    color: "#51607a",
    fontSize: 13,
    marginBottom: 4,
  },
  userText: {
    color: "#52627c",
    marginBottom: 8,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inlineInput: {
    flex: 1,
  },
  settingsList: {
    marginTop: 8,
    gap: 8,
  },
  settingsRow: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8e2f1",
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingsRowMain: {
    flex: 1,
  },
  settingsRowTitle: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 13,
  },
  settingsRowSubtitle: {
    color: "#607089",
    fontSize: 12,
    marginTop: 2,
  },
  domainPills: {
    gap: 6,
    paddingVertical: 8,
    paddingRight: 10,
  },
  domainPill: {
    borderWidth: 1,
    borderColor: "#cfd9e8",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  domainPillActive: {
    borderColor: "#0b6bce",
    backgroundColor: "#edf5ff",
  },
  domainPillText: {
    color: "#1d2b43",
    fontSize: 12,
    fontWeight: "600",
  },
  logoutBtn: {
    marginTop: 16,
    marginBottom: 24,
    borderRadius: 10,
    backgroundColor: "#192d4d",
    paddingVertical: 11,
    alignItems: "center",
  },
  logoutBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  drawerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(12, 23, 40, 0.35)",
  },
  drawerPanel: {
    width: 290,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: "#d8e2f1",
  },
  drawerTitle: {
    color: "#0f172a",
    fontWeight: "700",
    fontSize: 20,
    marginBottom: 10,
  },
  drawerItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 4,
  },
  drawerItemActive: {
    backgroundColor: "#edf5ff",
  },
  drawerItemText: {
    color: "#1d2b43",
    fontSize: 13,
    fontWeight: "600",
    maxWidth: 210,
  },
  drawerBadge: {
    backgroundColor: "#0b6bce",
    color: "#fff",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  drawerItemPaused: {
    opacity: 0.6,
  },
  drawerItemTextPaused: {
    color: "#8a9ab2",
  },
  drawerPausedBadge: {
    fontSize: 10,
    fontWeight: "600",
    color: "#c49b00",
    backgroundColor: "#fef9e0",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: "hidden",
  },
  settingsRowPaused: {
    opacity: 0.7,
    backgroundColor: "#fafbfc",
  },
  settingsRowTitlePaused: {
    color: "#8a9ab2",
  },
  pauseIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d8e2f1",
    backgroundColor: "#f4f8ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  switchAuthBtn: {
    alignItems: "center",
    paddingVertical: 4,
  },
  switchAuthText: {
    color: "#607089",
    fontSize: 13,
  },
  switchAuthLink: {
    color: "#0a66c2",
    fontWeight: "600",
  },
  busy: {
    position: "absolute",
    right: 14,
    top: 14,
  },
});
