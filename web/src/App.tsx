import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, apiUpload } from "./api";

// ── helpers ──────────────────────────────────────────────────────────────────
function displayName(addr: string): string {
  const m = addr.match(/^([^<]+?)\s*</);
  return m ? m[1].trim() : addr.replace(/[<>]/g, "").trim();
}
function emailOnly(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}
function senderInitial(addr: string): string {
  return displayName(addr).charAt(0).toUpperCase() || "?";
}
const AVATAR_PALETTE = ["#1a73e8","#0891b2","#137333","#7c3aed","#d93025","#e8710a","#0284c7","#188038"];
function avatarColor(addr: string): string {
  let h = 0;
  for (const c of addr) h = c.charCodeAt(0) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function shortTime(isoUtc: string, localFallback: string): string {
  try {
    const d = new Date(isoUtc);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  } catch { return localFallback; }
}

// ── SVG icons ─────────────────────────────────────────────────────────────────
// Unified set: 1.4 stroke, round caps & joins, 24×24 viewBox, currentColor.
// Pure geometry (close/plus/check) bumps to 1.6 so it doesn't read as anemic.
const IconInbox = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13.5h4.5L9 16h6l1.5-2.5H21"/>
    <path d="M5.5 5h13l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19v-5.5L5.5 5Z"/>
  </svg>
);
// Settings as three sliders ("preferences"), not a gear (machinery).
const IconSettings = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7"  x2="20" y2="7"/>
    <line x1="4" y1="12" x2="20" y2="12"/>
    <line x1="4" y1="17" x2="20" y2="17"/>
    <circle cx="15.5" cy="7"  r="2.2" fill="currentColor" stroke="none"/>
    <circle cx="8.5"  cy="12" r="2.2" fill="currentColor" stroke="none"/>
    <circle cx="16.5" cy="17" r="2.2" fill="currentColor" stroke="none"/>
  </svg>
);
const IconRefresh = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12a8 8 0 1 1-2.6-5.9"/>
    <polyline points="20 4 20 8 16 8"/>
  </svg>
);
const IconLogout = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/>
    <polyline points="9 8 4 12 9 16"/>
    <line x1="4" y1="12" x2="15" y2="12"/>
  </svg>
);
const IconClose = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="6" y1="6" x2="18" y2="18"/>
    <line x1="18" y1="6" x2="6" y2="18"/>
  </svg>
);
const IconPaperclip = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.5 11.5L12 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.5 3.5 0 1 1 5 5l-8.5 8.5a1.5 1.5 0 0 1-2.2-2.1l7.8-7.8"/>
  </svg>
);

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
const IconReply = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="10 7 4 12 10 17"/>
    <path d="M4.5 12H13c4.4 0 7 2.4 7 7"/>
  </svg>
);
const IconReplyAll = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="11 7 5 12 11 17"/>
    <polyline points="7 4 1 9 7 14"/>
    <path d="M5.5 12H12.5c3.3 0 5.5 1.5 6.8 4.5"/>
  </svg>
);
const IconForward = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="14 7 20 12 14 17"/>
    <path d="M19.5 12H11c-4.4 0-7 2.4-7 7"/>
  </svg>
);
const IconMailRead = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="6.5" width="17" height="11" rx="1.8"/>
    <polyline points="4.2 7.2 12 13 19.8 7.2"/>
  </svg>
);
const IconMailUnread = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="6.5" width="17" height="11" rx="1.8"/>
    <polyline points="4.2 7.2 12 13 19.8 7.2"/>
    <circle cx="19.5" cy="5.5" r="2.2" fill="#C8463A" stroke="none"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6.5" x2="20" y2="6.5"/>
    <path d="M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4A1.3 1.3 0 0 1 14.5 4.8V6.5"/>
    <path d="M6.5 6.5L7.4 19.5A1.4 1.4 0 0 0 8.8 20.8h6.4A1.4 1.4 0 0 0 16.6 19.5L17.5 6.5"/>
    <line x1="10" y1="10.5" x2="10" y2="17"/>
    <line x1="14" y1="10.5" x2="14" y2="17"/>
  </svg>
);
const IconCopy = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="8" width="13" height="13" rx="1.8"/>
    <path d="M5 16H4.5A1.5 1.5 0 0 1 3 14.5V4.5A1.5 1.5 0 0 1 4.5 3h10A1.5 1.5 0 0 1 16 4.5V5"/>
  </svg>
);
const IconPause = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="9"  y1="5" x2="9"  y2="19"/>
    <line x1="15" y1="5" x2="15" y2="19"/>
  </svg>
);
const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 5.5L18 12L7 18.5Z"/>
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
// Compose: a calligraphic stroke, not a workshop pencil.
const IconCompose = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20.5L7 20l11.6-11.6a2.1 2.1 0 0 0-3-3L4 17.5v3Z"/>
    <line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/>
  </svg>
);
// ── end icons ─────────────────────────────────────────────────────────────────

// Sandboxed iframe renderer for HTML email bodies. Fills container, scrolls internally.
function HtmlBody({ html }: { html: string }) {
  const srcDoc = useMemo(() => {
    const sanitizedHtml = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      .replace(/\son\w+\s*=\s*[^\s>]*/gi, "");
    return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;color:#202124;font-family:"Google Sans","Inter",system-ui,-apple-system,Roboto,sans-serif;font-size:14px;line-height:1.55;word-wrap:break-word;overflow-wrap:anywhere;}
      body{padding:8px 16px;}
      img{max-width:100%;height:auto;}
      table{max-width:100%;border-collapse:collapse;}
      a{color:#1a73e8;}
      blockquote{border-left:3px solid #e8eaed;margin:8px 0;padding:0 12px;color:#5f6368;}
      pre,code{font-family:"Roboto Mono","SF Mono",Menlo,monospace;background:#f6f8fc;border-radius:4px;}
      pre{padding:8px;overflow-x:auto;}
      code{padding:1px 4px;}
    </style></head><body>${sanitizedHtml}</body></html>`;
  }, [html]);

  return (
    <iframe
      className="read-body-html"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      title="message-body"
    />
  );
}

type User = { id: number; email: string; timezone: string };
type Mask = { id: number; address: string; local_part: string; domain: string; display_name: string; is_active: boolean; unread_count: number };
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
  mask_address?: string;
};
type MessageDetail = Message & { body: string; body_html?: string };

const TOKEN_KEY = "aliasnest_web_token";
const SNAPSHOT_KEY = "aliasnest_web_snapshot_v1";

type BootstrapPayload = {
  user: User;
  masks: Mask[];
  domains: Domain[];
  inbox: { items: Message[] };
};

type Snapshot = {
  user: User;
  masks: Mask[];
  domains: Domain[];
  messages: Message[];
  selectedMaskId: number | null;
};

function readSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Snapshot;
  } catch { return null; }
}

function writeSnapshot(snap: Snapshot): void {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); } catch { /* ignore */ }
}

function clearSnapshot(): void {
  try { localStorage.removeItem(SNAPSHOT_KEY); } catch { /* ignore */ }
}
const TIMEZONE_OPTIONS = [
  "UTC","America/Chicago","America/New_York","America/Los_Angeles","America/Denver",
  "America/Phoenix","America/Anchorage","Pacific/Honolulu","Europe/London","Europe/Berlin",
  "Europe/Paris","Europe/Amsterdam","Asia/Kolkata","Asia/Singapore","Asia/Tokyo","Australia/Sydney",
];

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const initialSnapshot = useMemo<Snapshot | null>(() => (token ? readSnapshot() : null), []);
  const [view, setView] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regInvite, setRegInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [user, setUser] = useState<User | null>(initialSnapshot?.user ?? null);
  const [masks, setMasks] = useState<Mask[]>(initialSnapshot?.masks ?? []);
  const [domains, setDomains] = useState<Domain[]>(initialSnapshot?.domains ?? []);
  const [selectedMaskId, setSelectedMaskId] = useState<number | null>(initialSnapshot?.selectedMaskId ?? null);
  const [messages, setMessages] = useState<Message[]>(initialSnapshot?.messages ?? []);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [newDomain, setNewDomain] = useState("");
  const [newMaskLocal, setNewMaskLocal] = useState("");
  const [newMaskDomain, setNewMaskDomain] = useState("");
  const [newMaskName, setNewMaskName] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "reply_all" | "forward">("reply");
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Compose (new outbound email) state
  const [showComposeModal, setShowComposeModal] = useState(false);
  const [composeFromMaskId, setComposeFromMaskId] = useState<number | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [showComposeCc, setShowComposeCc] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFiles, setComposeFiles] = useState<File[]>([]);
  const [composeSending, setComposeSending] = useState(false);
  const composeFileInputRef = useRef<HTMLInputElement>(null);

  const totalUnread = useMemo(() => masks.reduce((s, m) => s + m.unread_count, 0), [masks]);
  const verifiedDomainNames = useMemo(() => domains.filter((d) => d.can_use_for_mask).map((d) => d.name), [domains]);
  const activeMask = useMemo(() => masks.find((m) => m.id === selectedMaskId) ?? null, [masks, selectedMaskId]);

  useEffect(() => {
    if (!token) return;
    void hydrate(token, selectedMaskId);
  }, [token]);

  // Close settings on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowSettings(false); setShowReplyModal(false); setShowComposeModal(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Auto-refresh: poll every 30s, and refresh immediately when tab becomes visible
  useEffect(() => {
    if (!token) return;
    const poll = setInterval(() => void hydrate(token, selectedMaskId), 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void hydrate(token, selectedMaskId); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(poll); document.removeEventListener("visibilitychange", onVisible); };
  }, [token, selectedMaskId]);

  async function hydrate(activeToken: string, preferredMask: number | null) {
    setBusy(true);
    setError(null);
    try {
      const boot = await apiRequest<BootstrapPayload>("/api/bootstrap?inbox_limit=100", "GET", activeToken);
      setUser(boot.user);
      setTimezone(boot.user.timezone || "UTC");
      setMasks(boot.masks);
      setDomains(boot.domains);
      if (!newMaskDomain) {
        const first = boot.domains.find((d) => d.can_use_for_mask)?.name || "";
        setNewMaskDomain(first);
      }
      const targetMask = preferredMask && boot.masks.some((m) => m.id === preferredMask) ? preferredMask : null;
      setSelectedMaskId(targetMask);
      if (targetMask) {
        await loadMessages(activeToken, targetMask, boot.masks);
        return;
      }
      const inboxMessages = boot.masks.length === 0 ? [] : boot.inbox.items;
      setMessages(inboxMessages);
      writeSnapshot({
        user: boot.user,
        masks: boot.masks,
        domains: boot.domains,
        messages: inboxMessages,
        selectedMaskId: null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  async function loadMessages(activeToken: string, maskId: number | null, maskList: Mask[]) {
    if (maskId) {
      const payload = await apiRequest<{ items: Message[] }>(`/api/masks/${maskId}/messages`, "GET", activeToken);
      const mask = maskList.find((m) => m.id === maskId);
      setMessages(payload.items.map((m) => ({ ...m, mask_address: mask?.address || "" })));
      return;
    }
    if (maskList.length === 0) { setMessages([]); return; }
    const payload = await apiRequest<{ items: Message[] }>(`/api/inbox?limit=100`, "GET", activeToken);
    setMessages(payload.items);
  }

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const payload = await apiRequest<{ token: string }>("/api/auth/login", "POST", undefined, { email, password });
      localStorage.setItem(TOKEN_KEY, payload.token);
      setToken(payload.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (token) { try { await apiRequest("/api/auth/logout", "POST", token); } catch { /* ignore */ } }
    localStorage.removeItem(TOKEN_KEY);
    clearSnapshot();
    setToken(null); setUser(null); setMessages([]); setSelectedMessage(null);
    setReplyBody(""); setReplyMode("reply"); setForwardTo(""); setReplyFiles([]);
  }

  async function openMessage(messageId: number) {
    if (!token) return;
    const detail = await apiRequest<MessageDetail>(`/api/messages/${messageId}`, "GET", token);
    setSelectedMessage(detail);
    setReplyBody("");
    setReplyMode("reply");
    setForwardTo("");
    setReplyFiles([]);
    setShowReplyModal(false);
    if (!detail.is_outbound && !detail.is_read) {
      await apiRequest(`/api/messages/${detail.id}/mark-read`, "POST", token);
      setMessages((prev) => prev.map((m) => (m.id === detail.id ? { ...m, is_read: true } : m)));
      setMasks((prev) => prev.map((m) => m.id === detail.mask_id ? { ...m, unread_count: Math.max(0, m.unread_count - 1) } : m));
    }
  }

  async function toggleUnread() {
    if (!token || !selectedMessage || selectedMessage.is_outbound) return;
    const nextRead = !selectedMessage.is_read;
    await apiRequest(`/api/messages/${selectedMessage.id}/${nextRead ? "mark-read" : "mark-unread"}`, "POST", token);
    const refreshed = await apiRequest<MessageDetail>(`/api/messages/${selectedMessage.id}`, "GET", token);
    setSelectedMessage(refreshed);
    if (nextRead) {
      // Marking as read: optimistically decrement the sidebar count
      setMasks((prev) => prev.map((m) => m.id === refreshed.mask_id ? { ...m, unread_count: Math.max(0, m.unread_count - 1) } : m));
    }
    await hydrate(token, selectedMaskId);
  }

  async function deleteMessage() {
    if (!token || !selectedMessage) return;
    await apiRequest(`/api/messages/${selectedMessage.id}`, "DELETE", token);
    setSelectedMessage(null);
    await hydrate(token, selectedMaskId);
  }

  async function sendReply() {
    if (!token || !selectedMessage || sending) return;
    const form = new FormData();
    if (replyMode === "forward") {
      const to = forwardTo.trim();
      if (!to) return;
      form.append("to", to);
      form.append("body", replyBody);
    } else {
      if (selectedMessage.is_outbound) return;
      const body = replyBody.trim();
      if (!body && replyFiles.length === 0) return;
      form.append("body", body);
      form.append("reply_all", replyMode === "reply_all" ? "true" : "false");
    }
    for (const file of replyFiles) form.append("attachments", file, file.name);
    const endpoint = replyMode === "forward" ? "forward" : "reply";
    setSending(true);
    try {
      await apiUpload(`/api/messages/${selectedMessage.id}/${endpoint}`, form, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      return;
    } finally {
      setSending(false);
    }
    setReplyBody("");
    setForwardTo("");
    setReplyFiles([]);
    setShowReplyModal(false);
    await hydrate(token, selectedMaskId);
  }

  function addReplyFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    // Materialize the FileList now: the caller resets input.value right after,
    // which empties the live FileList before a deferred state updater would read it.
    const files = Array.from(list);
    setReplyFiles((prev) => [...prev, ...files]);
  }

  function removeReplyFile(index: number) {
    setReplyFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function openReply(mode: "reply" | "reply_all" | "forward") {
    setReplyMode(mode);
    if (mode !== "forward") setForwardTo("");
    setReplyFiles([]);
    setShowReplyModal(true);
  }

  function openCompose() {
    // Default the From mask to the active alias, else the first active alias.
    const fallback = masks.find((m) => m.is_active) ?? masks[0] ?? null;
    const preferred = activeMask?.is_active ? activeMask : fallback;
    setComposeFromMaskId(preferred ? preferred.id : null);
    setComposeTo("");
    setComposeCc("");
    setShowComposeCc(false);
    setComposeSubject("");
    setComposeBody("");
    setComposeFiles([]);
    setShowComposeModal(true);
  }

  function addComposeFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    setComposeFiles((prev) => [...prev, ...files]);
  }

  function removeComposeFile(index: number) {
    setComposeFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function sendCompose() {
    if (!token || composeSending || composeFromMaskId == null) return;
    const to = composeTo.trim();
    const body = composeBody.trim();
    if (!to) return;
    if (!body && composeFiles.length === 0) return;
    const form = new FormData();
    form.append("to", to);
    if (composeCc.trim()) form.append("cc", composeCc.trim());
    form.append("subject", composeSubject);
    form.append("body", body);
    for (const file of composeFiles) form.append("attachments", file, file.name);
    setComposeSending(true);
    try {
      await apiUpload(`/api/masks/${composeFromMaskId}/compose`, form, token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
      return;
    } finally {
      setComposeSending(false);
    }
    setShowComposeModal(false);
    await hydrate(token, selectedMaskId);
  }

  async function copyToClipboard(value: string | null | undefined) {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); } catch { /* no-op */ }
  }

  async function updateTimezone() {
    if (!token) return;
    await apiRequest("/api/me/timezone", "PATCH", token, { timezone });
    await hydrate(token, selectedMaskId);
  }

  async function addDomain() {
    if (!token || !newDomain.trim()) return;
    await apiRequest("/api/domains", "POST", token, { domain_name: newDomain.trim().toLowerCase() });
    setNewDomain("");
    await hydrate(token, selectedMaskId);
  }

  async function verifyDomain(domainId: number) {
    if (!token) return;
    await apiRequest(`/api/domains/${domainId}/verify`, "POST", token);
    await hydrate(token, selectedMaskId);
  }

  async function deleteDomain(domainId: number) {
    if (!token) return;
    await apiRequest(`/api/domains/${domainId}`, "DELETE", token);
    await hydrate(token, selectedMaskId);
  }

  async function createMask() {
    if (!token || !newMaskLocal.trim() || !newMaskDomain) return;
    await apiRequest("/api/masks", "POST", token, {
      local_part: newMaskLocal.trim().toLowerCase(),
      domain_name: newMaskDomain,
      display_name: newMaskName.trim(),
    });
    setNewMaskLocal("");
    setNewMaskName("");
    await hydrate(token, selectedMaskId);
  }

  async function renameMask(mask: Mask) {
    if (!token) return;
    const next = window.prompt(`Sender name for ${mask.address} (blank = send as the bare address):`, mask.display_name || "");
    if (next === null) return;
    const display_name = next.trim();
    await apiRequest(`/api/masks/${mask.id}`, "PATCH", token, { display_name });
    setMasks((prev) => prev.map((m) => m.id === mask.id ? { ...m, display_name } : m));
  }

  async function deleteMask(maskId: number) {
    if (!token) return;
    await apiRequest(`/api/masks/${maskId}`, "DELETE", token);
    await hydrate(token, selectedMaskId === maskId ? null : selectedMaskId);
  }

  async function toggleMask(maskId: number, isActive: boolean) {
    if (!token) return;
    await apiRequest(`/api/masks/${maskId}`, "PATCH", token, { is_active: isActive });
    setMasks((prev) => prev.map((m) => m.id === maskId ? { ...m, is_active: isActive } : m));
  }

  async function register() {
    setError(null);
    if (regPassword !== regConfirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const payload = await apiRequest<{ token: string }>("/api/auth/register", "POST", undefined, {
        email: regEmail.trim().toLowerCase(),
        password: regPassword,
        invite_code: regInvite.trim(),
      });
      localStorage.setItem(TOKEN_KEY, payload.token);
      setToken(payload.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  // ── Login / Register ──────────────────────────────────────────────────────
  if (!token) {
    if (view === "register") {
      return (
        <div className="login-shell">
          <div className="login-card">
            <div className="login-brand">
              <div className="login-logo"><IconInbox /></div>
              <h1>aliasnest</h1>
              <p>create an account</p>
            </div>
            <div className="login-body">
              {error && <p className="login-error">{error}</p>}
              <input value={regEmail} onChange={(e) => setRegEmail(e.target.value)} placeholder="Email address" type="email" autoFocus />
              <input value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="Password (min 8 chars)" type="password" />
              <input value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} placeholder="Confirm password" type="password" />
              <input value={regInvite} onChange={(e) => setRegInvite(e.target.value)} placeholder="Invite code (if required)" onKeyDown={(e) => e.key === "Enter" && void register()} />
              <button onClick={() => void register()} disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
              <p className="login-switch">Already have an account? <button className="link-btn" onClick={() => { setView("login"); setError(null); }}>Sign in</button></p>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-brand">
            <div className="login-logo"><IconInbox /></div>
            <h1>aliasnest</h1>
            <p>private mail · sealed</p>
          </div>
          <div className="login-body">
            {error && <p className="login-error">{error}</p>}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              type="email"
              autoFocus
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              type="password"
              onKeyDown={(e) => e.key === "Enter" && void login()}
            />
            <button onClick={() => void login()} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="login-switch">new to aliasnest? <button className="link-btn" onClick={() => { setView("register"); setError(null); }}>Create account</button></p>
          </div>
        </div>
      </div>
    );
  }

  // ── App shell ─────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-icon"><IconInbox /></div>
          <span className="brand-name">aliasnest</span>
        </div>
        <div className="top-actions">
          <span className="user-pill">{user?.email}</span>
          <button className={`settings-btn${showSettings ? " active" : ""}`} title="Settings" onClick={() => setShowSettings((v) => !v)}>
            <IconSettings />
          </button>
          <button className="top-icon" title="Refresh" onClick={() => token && void hydrate(token, selectedMaskId)}>
            <IconRefresh />
          </button>
          <button className="top-icon" title="Sign out" onClick={() => void logout()}>
            <IconLogout />
          </button>
        </div>
      </header>

      {error && <div className="error-bar">{error}</div>}

      {/* Settings modal */}
      {showSettings && (
        <>
          <div className="settings-backdrop" onClick={() => setShowSettings(false)} />
          <div className="settings-modal">
            <div className="settings-modal-head">
              <h2>Settings</h2>
              <button className="icon-btn" onClick={() => setShowSettings(false)} title="Close"><IconClose /></button>
            </div>

            <div className="settings-grid">
              <div className="settings-block">
                <h3>Timezone</h3>
                <div className="row-inline">
                  <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {TIMEZONE_OPTIONS.map((tz) => <option value={tz} key={tz}>{tz}</option>)}
                  </select>
                  <button className="icon-btn" title="Save" onClick={() => void updateTimezone()}><IconCheck /></button>
                </div>
              </div>

              <div className="settings-block">
                <h3>Custom Domains</h3>
                <div className="row-inline">
                  <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" onKeyDown={(e) => e.key === "Enter" && void addDomain()} />
                  <button className="icon-btn" title="Add domain" onClick={() => void addDomain()}><IconPlus /></button>
                </div>
                <div className="stack">
                  {domains.filter((d) => !d.is_default).map((d) => (
                    <article className="sub-card" key={d.id}>
                      <div className="sub-card-head">
                        <strong>{d.name}</strong>
                        <div className="row-inline">
                          {!d.is_verified && <button className="verify-btn" onClick={() => void verifyDomain(d.id)}>Verify</button>}
                          <button className="icon-btn danger-icon" onClick={() => void deleteDomain(d.id)} title="Delete domain"><IconTrash /></button>
                        </div>
                      </div>
                      <span className={`domain-status ${d.is_verified ? "ok" : "pending"}`}>
                        {d.is_verified ? "Verified" : "Pending verification"}
                      </span>
                      {!d.is_verified && (
                        <div className="dns-grid">
                          <span>TXT host</span>
                          <code>{d.verify_host || ""}</code>
                          <button className="icon-btn" title="Copy" onClick={() => void copyToClipboard(d.verify_host)}><IconCopy /></button>
                          <span>TXT value</span>
                          <code>{d.verification_token || ""}</code>
                          <button className="icon-btn" title="Copy" onClick={() => void copyToClipboard(d.verification_token)}><IconCopy /></button>
                          <span>MX host</span>
                          <code>{d.mx_host || ""}</code>
                          <button className="icon-btn" title="Copy" onClick={() => void copyToClipboard(d.mx_host)}><IconCopy /></button>
                          <span>MX type</span>
                          <code>{d.mx_type || ""}</code>
                          <button className="icon-btn" title="Copy" onClick={() => void copyToClipboard(d.mx_type)}><IconCopy /></button>
                          <span>MX value</span>
                          <code>{d.mx_value || ""}</code>
                          <button className="icon-btn" title="Copy" onClick={() => void copyToClipboard(d.mx_value)}><IconCopy /></button>
                        </div>
                      )}
                    </article>
                  ))}
                  {domains.filter((d) => !d.is_default).length === 0 && (
                    <p className="subtle">No custom domains yet.</p>
                  )}
                </div>
              </div>

              <div className="settings-block">
                <h3>Create Mask</h3>
                <div className="row-inline">
                  <input value={newMaskLocal} onChange={(e) => setNewMaskLocal(e.target.value)} placeholder="shopping-1" onKeyDown={(e) => e.key === "Enter" && void createMask()} />
                  <select value={newMaskDomain} onChange={(e) => setNewMaskDomain(e.target.value)}>
                    {verifiedDomainNames.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <button className="icon-btn" title="Create mask" onClick={() => void createMask()}><IconPlus /></button>
                </div>
                <input
                  className="mask-name-input"
                  value={newMaskName}
                  onChange={(e) => setNewMaskName(e.target.value)}
                  placeholder="Sender name (optional, e.g. Vijay Agarwal)"
                  onKeyDown={(e) => e.key === "Enter" && void createMask()}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Main layout */}
      <main className="layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <button
            className="compose-btn"
            onClick={openCompose}
            disabled={masks.length === 0}
            title={masks.length === 0 ? "Create an alias first" : "Compose new email"}
          >
            <IconCompose />
            <span>Compose</span>
          </button>
          <button
            className={`sidebar-all${!selectedMaskId ? " active" : ""}`}
            onClick={() => { setSelectedMessage(null); token && void hydrate(token, null); }}
          >
            <IconInbox />
            <span>Inbox</span>
            {totalUnread > 0 && <span className="sidebar-badge">{totalUnread}</span>}
          </button>

          {masks.length > 0 && <div className="sidebar-label">Correspondence</div>}

          {masks.map((mask) => (
            <div className={`mask-item${!mask.is_active ? " mask-paused" : ""}`} key={mask.id}>
              <button
                className={`mask-btn${selectedMaskId === mask.id ? " active" : ""}`}
                onClick={() => {
                  if (!token) return;
                  setSelectedMessage(null);
                  setSelectedMaskId(mask.id);
                  void loadMessages(token, mask.id, masks);
                }}
              >
                <span className="mask-addr-text">{mask.display_name ? `${mask.display_name} · ${mask.address}` : mask.address}</span>
                {!mask.is_active && <span className="mask-paused-badge">paused</span>}
                {mask.is_active && mask.unread_count > 0 && <span className="sidebar-badge">{mask.unread_count}</span>}
              </button>
              <button className="mask-del-btn" onClick={() => void renameMask(mask)} title="Set sender name">
                <IconCompose />
              </button>
              <button
                className="mask-del-btn"
                onClick={() => void toggleMask(mask.id, !mask.is_active)}
                title={mask.is_active ? "Pause alias" : "Resume alias"}
              >
                {mask.is_active ? <IconPause /> : <IconPlay />}
              </button>
              <button className="mask-del-btn" onClick={() => void deleteMask(mask.id)} title="Delete alias">
                <IconTrash />
              </button>
            </div>
          ))}

          {masks.length === 0 && (
            <p className="sidebar-empty">No aliases yet. Create one in Settings.</p>
          )}
        </aside>

        <div className="main-area">
          {/* Message list */}
          <section className="list-pane">
            <div className="list-header">
              <span className="list-title">{activeMask ? activeMask.address : "Inbox"}</span>
              {messages.length > 0 && <span className="list-count">{messages.length}</span>}
            </div>
            <div className="list-body">
              {messages.length === 0 && (
                <div className="empty-state">
                  <IconInbox />
                  <p>No messages</p>
                </div>
              )}
              {messages.map((msg) => {
                const senderAddr = msg.is_outbound ? msg.to : msg.from;
                const senderText = msg.is_outbound ? `To: ${displayName(msg.to)}` : displayName(msg.from);
                return (
                  <button
                    key={msg.id}
                    className={`message-row${!msg.is_outbound && !msg.is_read ? " unread" : ""}${selectedMessage?.id === msg.id ? " selected" : ""}`}
                    onClick={() => void openMessage(msg.id)}
                  >
                    <div className="msg-avatar" style={{ background: avatarColor(senderAddr) }}>
                      {senderInitial(senderAddr)}
                    </div>
                    <div className="msg-info">
                      <div className="msg-row-line msg-row-line-top">
                        <span className="msg-sender" title={senderAddr}>{senderText}</span>
                        {!selectedMaskId && msg.mask_address && (
                          <span className="msg-mask-tag" title={msg.mask_address}>{msg.mask_address}</span>
                        )}
                        <span className="msg-time">{shortTime(msg.received_at_utc, msg.received_at_local)}</span>
                      </div>
                      <div className="msg-row-line">
                        <span className="msg-subject">{msg.subject || "(no subject)"}</span>
                      </div>
                      <div className="msg-row-line">
                        <span className="msg-preview">{msg.preview || " "}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Read pane */}
          <section className="read-pane">
            {selectedMessage ? (
              <>
                <div className="read-toolbar">
                  {!selectedMessage.is_outbound && (
                    <>
                      <button className="icon-btn" title="Reply" onClick={() => openReply("reply")}>
                        <IconReply />
                      </button>
                      <button className="icon-btn" title="Reply all" onClick={() => openReply("reply_all")}>
                        <IconReplyAll />
                      </button>
                      <button className="icon-btn" title={selectedMessage.is_read ? "Mark unread" : "Mark read"} onClick={() => void toggleUnread()}>
                        {selectedMessage.is_read ? <IconMailUnread /> : <IconMailRead />}
                      </button>
                    </>
                  )}
                  <button className="icon-btn" title="Forward" onClick={() => openReply("forward")}>
                    <IconForward />
                  </button>
                  <button className="icon-btn danger-icon" title="Delete" onClick={() => void deleteMessage()}>
                    <IconTrash />
                  </button>
                  <span className="read-toolbar-spacer" />
                </div>

                <div className="read-content">
                  <h2 className="read-subject">{selectedMessage.subject || "(no subject)"}</h2>
                  <div className="read-meta">
                    <div className="read-avatar" style={{ background: avatarColor(selectedMessage.from) }}>
                      {senderInitial(selectedMessage.from)}
                    </div>
                    <div className="read-meta-info">
                      <div className="read-from-name">
                        {displayName(selectedMessage.from)}
                        <span className="read-from-email">&lt;{emailOnly(selectedMessage.from)}&gt;</span>
                      </div>
                      <div className="read-from-detail">
                        <span>to {emailOnly(selectedMessage.to)}</span>
                      </div>
                    </div>
                    <div className="read-time">{selectedMessage.received_at_local}</div>
                  </div>
                </div>

                <div className="read-body-wrap">
                  {selectedMessage.body_html
                    ? <HtmlBody html={selectedMessage.body_html} />
                    : <pre className="read-body">{selectedMessage.body}</pre>}
                </div>

              </>
            ) : (
              <div className="read-empty">
                <IconInbox />
                <p>Select a message to read</p>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Reply modal */}
      {showReplyModal && selectedMessage && (
        <>
          <div className="settings-backdrop" onClick={() => setShowReplyModal(false)} />
          <div className="reply-modal">
            <div className="reply-modal-head">
              <div className="reply-modal-title">
                <span>{replyMode === "forward" ? "Forward" : replyMode === "reply_all" ? "Reply all" : "Reply"}</span>
                {replyMode !== "forward" && (
                  <span className="reply-modal-recipient">to {displayName(selectedMessage.from)}</span>
                )}
              </div>
              <button className="icon-btn" onClick={() => setShowReplyModal(false)} title="Close">
                <IconClose />
              </button>
            </div>
            {replyMode === "forward" && (
              <input
                autoFocus
                className="reply-modal-to"
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                placeholder="To: name@example.com"
                type="email"
                autoCapitalize="none"
              />
            )}
            <textarea
              autoFocus={replyMode !== "forward"}
              className="reply-modal-textarea"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder={
                replyMode === "forward"
                  ? "Add a note (optional)…"
                  : replyMode === "reply_all"
                  ? "Reply to all…"
                  : `Reply to ${displayName(selectedMessage.from)}…`
              }
            />
            {replyFiles.length > 0 && (
              <div className="reply-attachments">
                {replyFiles.map((file, i) => (
                  <span key={i} className="reply-attachment-chip">
                    <IconPaperclip />
                    <span className="reply-attachment-name">{file.name}</span>
                    <span className="reply-attachment-size">{formatBytes(file.size)}</span>
                    <button className="icon-btn" title="Remove" onClick={() => removeReplyFile(i)}>
                      <IconClose />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => { addReplyFiles(e.target.files); e.target.value = ""; }}
            />
            <div className="reply-modal-actions">
              <button className="icon-btn" title="Attach files" onClick={() => fileInputRef.current?.click()}>
                <IconPaperclip />
              </button>
              {replyMode === "forward" ? (
                <span className="reply-modal-hint">Original message{replyFiles.length === 0 ? " and its attachments" : ""} will be included below.</span>
              ) : (
                <button className="link-btn" onClick={() => setReplyMode(replyMode === "reply" ? "reply_all" : "reply")}>
                  {replyMode === "reply" ? "Switch to reply all" : "Switch to reply"}
                </button>
              )}
              <button
                className="send-btn"
                onClick={() => void sendReply()}
                disabled={
                  sending ||
                  (replyMode === "forward"
                    ? !forwardTo.trim()
                    : !replyBody.trim() && replyFiles.length === 0)
                }
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Compose modal */}
      {showComposeModal && (
        <>
          <div className="settings-backdrop" onClick={() => setShowComposeModal(false)} />
          <div className="reply-modal">
            <div className="reply-modal-head">
              <div className="reply-modal-title">
                <span>New email</span>
              </div>
              <button className="icon-btn" onClick={() => setShowComposeModal(false)} title="Close">
                <IconClose />
              </button>
            </div>
            <div className="compose-from">
              <span className="compose-from-label">From</span>
              <select
                value={composeFromMaskId ?? ""}
                onChange={(e) => setComposeFromMaskId(e.target.value ? Number(e.target.value) : null)}
              >
                {masks.map((m) => (
                  <option key={m.id} value={m.id}>{m.address}</option>
                ))}
              </select>
            </div>
            <input
              autoFocus
              className="reply-modal-to"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              placeholder="To: name@example.com, another@example.com"
              type="text"
              autoCapitalize="none"
            />
            {showComposeCc ? (
              <input
                className="reply-modal-to"
                value={composeCc}
                onChange={(e) => setComposeCc(e.target.value)}
                placeholder="Cc: name@example.com"
                type="text"
                autoCapitalize="none"
              />
            ) : (
              <button className="link-btn compose-cc-toggle" onClick={() => setShowComposeCc(true)}>Add Cc</button>
            )}
            <input
              className="reply-modal-to"
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              placeholder="Subject"
              type="text"
            />
            <textarea
              className="reply-modal-textarea"
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="Write your message…"
            />
            {composeFiles.length > 0 && (
              <div className="reply-attachments">
                {composeFiles.map((file, i) => (
                  <span key={i} className="reply-attachment-chip">
                    <IconPaperclip />
                    <span className="reply-attachment-name">{file.name}</span>
                    <span className="reply-attachment-size">{formatBytes(file.size)}</span>
                    <button className="icon-btn" title="Remove" onClick={() => removeComposeFile(i)}>
                      <IconClose />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              ref={composeFileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => { addComposeFiles(e.target.files); e.target.value = ""; }}
            />
            <div className="reply-modal-actions">
              <button className="icon-btn" title="Attach files" onClick={() => composeFileInputRef.current?.click()}>
                <IconPaperclip />
              </button>
              <button
                className="send-btn"
                onClick={() => void sendCompose()}
                disabled={
                  composeSending ||
                  composeFromMaskId == null ||
                  !composeTo.trim() ||
                  (!composeBody.trim() && composeFiles.length === 0)
                }
              >
                {composeSending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
