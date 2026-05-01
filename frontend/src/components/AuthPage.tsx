"use client";
import { useState, useEffect } from "react";
import * as api from "@/lib/api";

export default function AuthPage({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { requestAnimationFrame(() => setReady(true)); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      if (mode === "register") await api.register(username, password, displayName);
      else await api.login(username, password);
      onAuth();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="mesh" />
      <div className="grain" />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>

        {/* Wordmark */}
        <div className={`transition-all duration-700 ${ready ? "opacity-100" : "opacity-0 translate-y-4"}`}
          style={{ marginBottom: 48, userSelect: "none" }}>
          <span style={{ fontFamily: "var(--sans)", fontWeight: 700, fontSize: 28, letterSpacing: "-.035em", lineHeight: .9, color: "var(--ink)" }}>
            <span>Edge</span>
            <span style={{ background: "var(--wordmark-gradient)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Word</span>
          </span>
          <sup style={{ fontFamily: "var(--mono)", fontSize: 9, fontWeight: 500, color: "var(--text-2)", marginLeft: 3, display: "inline-block", transform: "translateY(2px)" }}>TM</sup>
        </div>

        {/* Hero opener — pre-auth only */}
        <h1 className={`transition-all duration-1000 ${ready ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
          style={{ fontFamily: "var(--sans)", fontWeight: 700, fontSize: "clamp(40px, 7vw, 88px)", lineHeight: .92, letterSpacing: "-.04em", color: "var(--ink)", textAlign: "center", maxWidth: "14ch", marginBottom: 48 }}>
          Designed for{" "}
          <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, letterSpacing: "-.02em", background: "linear-gradient(135deg, var(--violet) 0, var(--cyan) 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            people who feel
          </span>{" "}
          <span style={{ position: "relative", display: "inline-block", color: "var(--text-3)" }}>
            old
            <span style={{ position: "absolute", left: "-4%", right: "-4%", top: "52%", height: 8, background: "var(--hot)", transform: "rotate(-3deg)", borderRadius: 4 }} />
          </span>{" "}
          alive.
        </h1>

        {/* Auth form */}
        <div className={`transition-all duration-700 delay-300 ${ready ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
          style={{ width: "100%", maxWidth: 420 }}>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 28 }}>
            {(["login", "register"] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(""); }}
                style={{
                  flex: 1, padding: "10px 0", background: mode === m ? "var(--surface-2)" : "var(--surface)", border: `1px solid ${mode === m ? "var(--line-2)" : "var(--line)"}`,
                  borderRadius: 10, cursor: "pointer", fontFamily: "var(--sans)", fontWeight: 500, fontSize: 13, letterSpacing: "-.01em",
                  color: mode === m ? "var(--ink)" : "var(--text-2)", transition: "all .25s var(--ease)",
                }}>
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {mode === "register" && (
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="Your name"
                style={{ width: "100%", padding: "12px 16px", background: "var(--card-bg)", border: "1px solid var(--line-2)", borderRadius: 12, fontFamily: "var(--sans)", fontSize: 15, color: "var(--ink)", outline: "none", backdropFilter: "blur(20px)", transition: "all .25s var(--ease)" }} />
            )}
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" required minLength={3} autoComplete="username"
              style={{ width: "100%", padding: "12px 16px", background: "var(--card-bg)", border: "1px solid var(--line-2)", borderRadius: 12, fontFamily: "var(--sans)", fontSize: 15, color: "var(--ink)", outline: "none", backdropFilter: "blur(20px)", transition: "all .25s var(--ease)" }} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required minLength={6}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              style={{ width: "100%", padding: "12px 16px", background: "var(--card-bg)", border: "1px solid var(--line-2)", borderRadius: 12, fontFamily: "var(--sans)", fontSize: 15, color: "var(--ink)", outline: "none", backdropFilter: "blur(20px)", transition: "all .25s var(--ease)" }} />

            {error && <p style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--hot)", textAlign: "center" }}>{error}</p>}

            <button type="submit" disabled={loading}
              style={{ width: "100%", padding: "12px 0", background: "var(--send-bg)", color: "var(--send-color)", border: "none", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer", fontFamily: "var(--sans)", fontWeight: 600, fontSize: 13, letterSpacing: "-.01em", transition: "all .25s var(--spring)", boxShadow: "var(--send-shadow)", opacity: loading ? 0.5 : 1 }}>
              {loading ? "..." : mode === "login" ? "SIGN IN" : "GET STARTED"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
