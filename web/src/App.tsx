import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "./api";

type User = { id: number; email: string; timezone: string };
type Mask = { id: number; address: string; local_part: string; domain: string; unread_count: number };
type Domain = { id: number; name: string; is_default: boolean; is_verified: boolean; can_use_for_mask: boolean; verification_token: string | null; verify_host: string | null; mx_host: string | null; mx_type: string | null; mx_value: string | null; public_smtp_port: number };
type Message = { id: number; mask_id: number; from: string; to: string; subject: string; preview: string; is_outbound: boolean; is_read: boolean; received_at_utc: string; received_at_local: string; timezone: string; mask_address?: string };
type MessageDetail = Message & { body: string };

const TOKEN_KEY = "aliasnest_web_token";

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

  const selectedMask = useMemo(() => masks.find((m) => m.id === selectedMaskId) || null, [masks, selectedMaskId]);

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
      const maskPayload = await apiRequest<{ items: Mask[] }>("/api/masks", "GET", activeToken);
      setMasks(maskPayload.items);
      const domainPayload = await apiRequest<{ items: Domain[] }>("/api/domains", "GET", activeToken);
      setDomains(domainPayload.items);
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
    if (token) {
      try { await apiRequest("/api/auth/logout", "POST", token); } catch { /* ignore */ }
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setMessages([]);
    setSelectedMessage(null);
  }

  async function openMessage(messageId: number) {
    if (!token) return;
    const detail = await apiRequest<MessageDetail>(`/api/messages/${messageId}`, "GET", token);
    setSelectedMessage(detail);
    if (!detail.is_outbound && !detail.is_read) {
      await apiRequest(`/api/messages/${detail.id}/mark-read`, "POST", token);
      setMessages((prev) => prev.map((m) => (m.id === detail.id ? { ...m, is_read: true } : m)));
    }
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
        <div>
          <h2>AliasNest Inbox</h2>
          <p>{user?.email}</p>
        </div>
        <div className="top-actions">
          <button onClick={() => setShowSettings((v) => !v)}>{showSettings ? "Close Settings" : "Settings"}</button>
          <button onClick={() => token && void hydrate(token, selectedMaskId)}>Refresh</button>
          <button onClick={() => void logout()}>Sign out</button>
        </div>
      </header>

      {error && <p className="error page-error">{error}</p>}

      {showSettings ? (
        <section className="card settings-card">
          <h3>Custom Domains</h3>
          {domains.filter((d) => !d.is_default).map((d) => (
            <div className="row" key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <p>{d.is_verified ? "Verified" : `TXT ${d.verify_host} = ${d.verification_token}`}</p>
                {!d.is_verified ? <p>MX {d.mx_host} {d.mx_type} {d.mx_value}</p> : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <main className="layout">
        <aside className="card sidebar">
          <button className={!selectedMask ? "active" : ""} onClick={() => token && void hydrate(token, null)}>All inbox</button>
          {masks.map((mask) => (
            <button
              key={mask.id}
              className={selectedMaskId === mask.id ? "active" : ""}
              onClick={() => {
                if (!token) return;
                setSelectedMaskId(mask.id);
                void loadMessages(token, mask.id, masks);
              }}
            >
              {mask.address} {mask.unread_count > 0 ? `(${mask.unread_count})` : ""}
            </button>
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
              <h3>{selectedMessage.subject}</h3>
              <p>From: {selectedMessage.from}</p>
              <p>To: {selectedMessage.to}</p>
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
