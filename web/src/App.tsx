import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";

// ── helpers ──────────────────────────────────────────────────────────────────
function displayName(addr: string): string {
  const m = addr.match(/^([^<]+?)\s*</);
  return m ? m[1].trim() : addr.replace(/[<>]/g, "").trim();
}
function senderInitial(addr: string): string {
  return displayName(addr).charAt(0).toUpperCase() || "?";
}
const AVATAR_PALETTE = ["#0a66c2","#0891b2","#059669","#7c3aed","#db2777","#ea580c","#0284c7","#65a30d"];
function avatarColor(addr: string): string {
  let h = 0;
  for (const c of addr) h = c.charCodeAt(0) + ((h << 5) - h);
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ── SVG icons ─────────────────────────────────────────────────────────────────
const IconInbox = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  </svg>
);
const IconSettings = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
  </svg>
);
const IconRefresh = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 12A8 8 0 1 1 17.6 6.3"/>
    <path d="M18 3.8V7.8H14"/>
  </svg>
);
const IconLogout = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IconClose = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconReply = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 7L4 12L10 17"/>
    <path d="M5 12H13C17.4 12 20 14.4 20 19"/>
  </svg>
);
const IconReplyAll = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 7L5 12L11 17"/>
    <path d="M6 12H12.5C15.8 12 17.8 13.3 19.3 16"/>
    <path d="M8 4.8L2 9.8L8 14.8" strokeWidth="1.6"/>
    <path d="M3 9.8H9" strokeWidth="1.6"/>
  </svg>
);
const IconMailRead = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="6" width="16" height="12" rx="2.2"/>
    <path d="M4.8 7L11.3 12.1C11.7 12.4 12.3 12.4 12.7 12.1L19.2 7"/>
  </svg>
);
const IconMailUnread = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="6" width="16" height="12" rx="2.2"/>
    <path d="M4.8 7L11.3 12.1C11.7 12.4 12.3 12.4 12.7 12.1L19.2 7"/>
    <circle cx="18.6" cy="6.2" r="2.2" fill="#0a66c2" stroke="none"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M8 7H16M10 4H14M6.8 7L7.6 18.2C7.7 19.2 8.5 20 9.5 20H14.5C15.5 20 16.3 19.2 16.4 18.2L17.2 7"/>
    <path d="M10 10V16M14 10V16"/>
  </svg>
);
const IconCopy = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const IconPause = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>
    <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>
  </svg>
);
const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none">
    <polygon points="5,3 19,12 5,21"/>
  </svg>
);
const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
// ── end icons ─────────────────────────────────────────────────────────────────

type User = { id: number; email: string; timezone: string };
type Mask = { id: number; address: string; local_part: string; domain: string; is_active: boolean; unread_count: number };
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
type MessageDetail = Message & { body: string };

const TOKEN_KEY = "aliasnest_web_token";
const TIMEZONE_OPTIONS = [
  "UTC","America/Chicago","America/New_York","America/Los_Angeles","America/Denver",
  "America/Phoenix","America/Anchorage","Pacific/Honolulu","Europe/London","Europe/Berlin",
  "Europe/Paris","Europe/Amsterdam","Asia/Kolkata","Asia/Singapore","Asia/Tokyo","Australia/Sydney",
];

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [view, setView] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regInvite, setRegInvite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [user, setUser] = useState<User | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedMaskId, setSelectedMaskId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [newDomain, setNewDomain] = useState("");
  const [newMaskLocal, setNewMaskLocal] = useState("");
  const [newMaskDomain, setNewMaskDomain] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyMode, setReplyMode] = useState<"reply" | "reply_all">("reply");

  const totalUnread = useMemo(() => masks.reduce((s, m) => s + m.unread_count, 0), [masks]);
  const verifiedDomainNames = useMemo(() => domains.filter((d) => d.can_use_for_mask).map((d) => d.name), [domains]);
  const activeMask = useMemo(() => masks.find((m) => m.id === selectedMaskId) ?? null, [masks, selectedMaskId]);

  useEffect(() => {
    if (!token) return;
    void hydrate(token, selectedMaskId);
  }, [token]);

  // Close settings on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowSettings(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function hydrate(activeToken: string, preferredMask: number | null) {
    setBusy(true);
    setError(null);
    try {
      const me = await apiRequest<User>("/api/me", "GET", activeToken);
      setUser(me);
      setTimezone(me.timezone || "UTC");
      const maskPayload = await apiRequest<{ items: Mask[] }>("/api/masks", "GET", activeToken);
      setMasks(maskPayload.items);
      const domainPayload = await apiRequest<{ items: Domain[] }>("/api/domains", "GET", activeToken);
      setDomains(domainPayload.items);
      if (!newMaskDomain) {
        const first = domainPayload.items.find((d) => d.can_use_for_mask)?.name || "";
        setNewMaskDomain(first);
      }
      const targetMask = preferredMask && maskPayload.items.some((m) => m.id === preferredMask) ? preferredMask : null;
      setSelectedMaskId(targetMask);
      await loadMessages(activeToken, targetMask, maskPayload.items);
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
    const results = await Promise.all(
      maskList.map(async (mask) => {
        const payload = await apiRequest<{ items: Message[] }>(`/api/masks/${mask.id}/messages?limit=60`, "GET", activeToken);
        return payload.items.map((m) => ({ ...m, mask_address: mask.address }));
      }),
    );
    setMessages(results.flat().sort((a, b) => new Date(b.received_at_utc).getTime() - new Date(a.received_at_utc).getTime()));
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
    setToken(null); setUser(null); setMessages([]); setSelectedMessage(null);
    setReplyBody(""); setReplyMode("reply");
  }

  async function openMessage(messageId: number) {
    if (!token) return;
    const detail = await apiRequest<MessageDetail>(`/api/messages/${messageId}`, "GET", token);
    setSelectedMessage(detail);
    setReplyBody("");
    setReplyMode("reply");
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
    if (!token || !selectedMessage || selectedMessage.is_outbound) return;
    const body = replyBody.trim();
    if (!body) return;
    await apiRequest(`/api/messages/${selectedMessage.id}/reply`, "POST", token, { body, reply_all: replyMode === "reply_all" });
    setReplyBody("");
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
    await apiRequest("/api/masks", "POST", token, { local_part: newMaskLocal.trim().toLowerCase(), domain_name: newMaskDomain });
    setNewMaskLocal("");
    await hydrate(token, selectedMaskId);
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
              <h1>AliasNest</h1>
              <p>Create an account</p>
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
            <h1>AliasNest</h1>
            <p>Private email masking</p>
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
            <p className="login-switch">New to AliasNest? <button className="link-btn" onClick={() => { setView("register"); setError(null); }}>Create account</button></p>
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
          <span className="brand-name">AliasNest</span>
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
            className={`sidebar-all${!selectedMaskId ? " active" : ""}`}
            onClick={() => { setSelectedMessage(null); token && void hydrate(token, null); }}
          >
            <IconInbox />
            <span>All Inbox</span>
            {totalUnread > 0 && <span className="sidebar-badge">{totalUnread}</span>}
          </button>

          {masks.length > 0 && <div className="sidebar-label">MASKS</div>}

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
                <span className="mask-addr-text">{mask.address}</span>
                {!mask.is_active && <span className="mask-paused-badge">paused</span>}
                {mask.is_active && mask.unread_count > 0 && <span className="sidebar-badge">{mask.unread_count}</span>}
              </button>
              <button
                className="mask-del-btn"
                onClick={() => void toggleMask(mask.id, !mask.is_active)}
                title={mask.is_active ? "Pause mask" : "Resume mask"}
              >
                {mask.is_active ? <IconPause /> : <IconPlay />}
              </button>
              <button className="mask-del-btn" onClick={() => void deleteMask(mask.id)} title="Delete mask">
                <IconTrash />
              </button>
            </div>
          ))}

          {masks.length === 0 && (
            <p className="sidebar-empty">No masks yet. Create one in Settings.</p>
          )}
        </aside>

        {/* Message list */}
        <section className="list-pane">
          <div className="list-header">
            <span className="list-title">{activeMask ? activeMask.address : "All Inbox"}</span>
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
                    <div className="msg-row-top">
                      <span className="msg-sender">
                        {msg.is_outbound ? `→ ${displayName(msg.to)}` : displayName(msg.from)}
                      </span>
                      <span className="msg-time">{msg.received_at_local}</span>
                    </div>
                    <div className="msg-subject">{msg.subject}</div>
                    {msg.preview && <div className="msg-preview">{msg.preview}</div>}
                    {!selectedMaskId && msg.mask_address && (
                      <div className="msg-mask-tag">{msg.mask_address}</div>
                    )}
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
              <div className="read-header">
                <h2 className="read-subject">{selectedMessage.subject}</h2>
                <div className="read-meta">
                  <div className="read-avatar" style={{ background: avatarColor(selectedMessage.from) }}>
                    {senderInitial(selectedMessage.from)}
                  </div>
                  <div className="read-meta-info">
                    <div className="read-from-name">{displayName(selectedMessage.from)}</div>
                    <div className="read-from-detail">
                      <span>{selectedMessage.from}</span>
                      <span className="read-meta-sep">→</span>
                      <span>{selectedMessage.to}</span>
                    </div>
                  </div>
                  <div className="read-actions">
                    {!selectedMessage.is_outbound && (
                      <>
                        <button className={`icon-btn${replyMode === "reply" ? " active" : ""}`} title="Reply" onClick={() => setReplyMode("reply")}>
                          <IconReply />
                        </button>
                        <button className={`icon-btn${replyMode === "reply_all" ? " active" : ""}`} title="Reply all" onClick={() => setReplyMode("reply_all")}>
                          <IconReplyAll />
                        </button>
                        <button className="icon-btn" title={selectedMessage.is_read ? "Mark unread" : "Mark read"} onClick={() => void toggleUnread()}>
                          {selectedMessage.is_read ? <IconMailUnread /> : <IconMailRead />}
                        </button>
                      </>
                    )}
                    <button className="icon-btn danger-icon" title="Delete" onClick={() => void deleteMessage()}>
                      <IconTrash />
                    </button>
                  </div>
                </div>
              </div>

              <div className="read-divider" />

              {!selectedMessage.is_outbound && (
                <div className="reply-box">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={replyMode === "reply_all" ? "Reply to all…" : "Reply…"}
                  />
                  <div className="reply-actions">
                    <button className="send-btn" onClick={() => void sendReply()} disabled={!replyBody.trim()}>
                      Send {replyMode === "reply_all" ? "Reply All" : "Reply"}
                    </button>
                  </div>
                </div>
              )}

              <pre className="read-body">{selectedMessage.body}</pre>
            </>
          ) : (
            <div className="read-empty">
              <IconInbox />
              <p>Select a message to read</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
