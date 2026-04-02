import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";

type User = { id: number; email: string; timezone: string };
type Mask = { id: number; address: string; local_part: string; domain: string; unread_count: number };
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

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

  const verifiedDomainNames = useMemo(
    () => domains.filter((d) => d.can_use_for_mask).map((d) => d.name),
    [domains],
  );

  useEffect(() => {
    if (!token) return;
    void hydrate(token, selectedMaskId);
  }, [token]);

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
      setError(e instanceof Error ? e.message : "Failed to load app");
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
    setMessages(
      results
        .flat()
        .sort((a, b) => new Date(b.received_at_utc).getTime() - new Date(a.received_at_utc).getTime()),
    );
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
    if (token) {
      try {
        await apiRequest("/api/auth/logout", "POST", token);
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setMessages([]);
    setSelectedMessage(null);
    setReplyBody("");
    setReplyMode("reply");
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
    }
  }

  async function toggleUnread() {
    if (!token || !selectedMessage || selectedMessage.is_outbound) return;
    const nextRead = !selectedMessage.is_read;
    await apiRequest(`/api/messages/${selectedMessage.id}/${nextRead ? "mark-read" : "mark-unread"}`, "POST", token);
    const refreshed = await apiRequest<MessageDetail>(`/api/messages/${selectedMessage.id}`, "GET", token);
    setSelectedMessage(refreshed);
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
    await apiRequest(`/api/messages/${selectedMessage.id}/reply`, "POST", token, {
      body,
      reply_all: replyMode === "reply_all",
    });
    setReplyBody("");
    await hydrate(token, selectedMaskId);
  }

  async function copyToClipboard(value: string | null | undefined) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // no-op: clipboard permission can fail on older browsers
    }
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
    });
    setNewMaskLocal("");
    await hydrate(token, selectedMaskId);
  }

  async function deleteMask(maskId: number) {
    if (!token) return;
    await apiRequest(`/api/masks/${maskId}`, "DELETE", token);
    await hydrate(token, selectedMaskId === maskId ? null : selectedMaskId);
  }

  if (!token) {
    return (
      <div className="shell login-shell">
        <div className="card login-card">
          <h1>AliasNest</h1>
          {error && <p className="error">{error}</p>}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
          <button onClick={() => void login()} disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-block">
          <h2>AliasNest</h2>
        </div>
        <div className="top-actions">
          <span className="user-pill">{user?.email}</span>
          <button className={`top-icon ${showSettings ? "active" : ""}`} title="Settings" onClick={() => setShowSettings((v) => !v)}>⚙</button>
          <button className="top-icon" title="Refresh" onClick={() => token && void hydrate(token, selectedMaskId)}>⟳</button>
          <button className="top-icon" title="Sign out" onClick={() => void logout()}>⎋</button>
        </div>
      </header>

      {error && <p className="error page-error">{error}</p>}

      {showSettings ? (
        <section className="card settings-card">
          <div className="settings-grid">
            <div className="settings-block">
              <h3>Timezone</h3>
              <div className="row-inline">
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {TIMEZONE_OPTIONS.map((tz) => <option value={tz} key={tz}>{tz}</option>)}
                </select>
                <button className="icon-btn" onClick={() => void updateTimezone()}>✓</button>
              </div>
            </div>

            <div className="settings-block">
              <h3>Custom Domains</h3>
              <div className="row-inline">
                <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" />
                <button className="icon-btn" onClick={() => void addDomain()}>＋</button>
              </div>
              <div className="stack">
                {domains.filter((d) => !d.is_default).map((d) => (
                  <article className="sub-card" key={d.id}>
                    <div className="sub-card-head">
                      <strong>{d.name}</strong>
                      <div className="row-inline">
                        {!d.is_verified ? <button onClick={() => void verifyDomain(d.id)}>Verify</button> : null}
                        <button className="danger icon-btn danger-icon" onClick={() => void deleteDomain(d.id)} title="Delete domain">🗑</button>
                      </div>
                    </div>
                    <p>{d.is_verified ? "Verified" : "Pending verification"}</p>
                    {!d.is_verified ? (
                      <div className="dns-grid">
                        <span>TXT host</span>
                        <code>{d.verify_host || ""}</code>
                        <button className="icon-btn" title="Copy TXT host" onClick={() => void copyToClipboard(d.verify_host)}>⧉</button>
                        <span>TXT value</span>
                        <code>{d.verification_token || ""}</code>
                        <button className="icon-btn" title="Copy TXT value" onClick={() => void copyToClipboard(d.verification_token)}>⧉</button>
                        <span>MX host</span>
                        <code>{d.mx_host || ""}</code>
                        <button className="icon-btn" title="Copy MX host" onClick={() => void copyToClipboard(d.mx_host)}>⧉</button>
                        <span>MX type</span>
                        <code>{d.mx_type || ""}</code>
                        <button className="icon-btn" title="Copy MX type" onClick={() => void copyToClipboard(d.mx_type)}>⧉</button>
                        <span>MX value</span>
                        <code>{d.mx_value || ""}</code>
                        <button className="icon-btn" title="Copy MX value" onClick={() => void copyToClipboard(d.mx_value)}>⧉</button>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <div className="settings-block">
              <h3>Create Mask</h3>
              <div className="row-inline">
                <input value={newMaskLocal} onChange={(e) => setNewMaskLocal(e.target.value)} placeholder="shopping-1" />
                <select value={newMaskDomain} onChange={(e) => setNewMaskDomain(e.target.value)}>
                  {verifiedDomainNames.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <button className="icon-btn" onClick={() => void createMask()}>＋</button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <main className="layout">
        <aside className="card sidebar">
          <button className={!selectedMaskId ? "active" : ""} onClick={() => token && void hydrate(token, null)}>All inbox</button>
          {masks.map((mask) => (
            <div className="mask-row" key={mask.id}>
              <button
                className={selectedMaskId === mask.id ? "active" : ""}
                onClick={() => {
                  if (!token) return;
                  setSelectedMaskId(mask.id);
                  void loadMessages(token, mask.id, masks);
                }}
              >
                {mask.address} {mask.unread_count > 0 ? `(${mask.unread_count})` : ""}
              </button>
              <button className="icon-btn danger-icon" onClick={() => void deleteMask(mask.id)}>🗑</button>
            </div>
          ))}
        </aside>

        <section className="card list">
          {messages.map((msg) => (
            <button key={msg.id} className={`message-row ${!msg.is_outbound && !msg.is_read ? "unread" : ""}`} onClick={() => void openMessage(msg.id)}>
              <div className="line1">
                <strong>{msg.is_outbound ? `To: ${msg.to}` : msg.from}</strong>
                <span>{msg.received_at_local}</span>
              </div>
              <div className="line2">{msg.subject}</div>
              <div className="line3">{msg.mask_address}</div>
            </button>
          ))}
        </section>

        <section className="card read">
          {selectedMessage ? (
            <>
              <div className="read-head">
                <div>
                  <h3>{selectedMessage.subject}</h3>
                  <p>From: {selectedMessage.from}</p>
                  <p>To: {selectedMessage.to}</p>
                </div>
                <div className="msg-actions">
                  {!selectedMessage.is_outbound ? (
                    <>
                      <button
                        className={`icon-btn ${replyMode === "reply" ? "active" : ""}`}
                        title="Reply"
                        onClick={() => setReplyMode("reply")}
                      >
                        ↩
                      </button>
                      <button
                        className={`icon-btn ${replyMode === "reply_all" ? "active" : ""}`}
                        title="Reply all"
                        onClick={() => setReplyMode("reply_all")}
                      >
                        ↪
                      </button>
                      <button className="icon-btn" title={selectedMessage.is_read ? "Mark unread" : "Mark read"} onClick={() => void toggleUnread()}>
                        {selectedMessage.is_read ? "✉" : "✉•"}
                      </button>
                    </>
                  ) : null}
                  <button className="icon-btn danger-icon" title="Delete" onClick={() => void deleteMessage()}>🗑</button>
                </div>
              </div>

              {!selectedMessage.is_outbound ? (
                <div className="reply-box">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={replyMode === "reply_all" ? "Write your reply all..." : "Write your reply..."}
                  />
                  <div className="reply-actions">
                    <button className="send-btn" onClick={() => void sendReply()} disabled={!replyBody.trim()}>
                      Send {replyMode === "reply_all" ? "Reply All" : "Reply"}
                    </button>
                  </div>
                </div>
              ) : null}

              <pre>{selectedMessage.body}</pre>
            </>
          ) : (
            <p>Select a message.</p>
          )}
        </section>
      </main>
    </div>
  );
}
