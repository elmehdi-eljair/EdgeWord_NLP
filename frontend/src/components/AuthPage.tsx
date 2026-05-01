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
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") await api.register(username, password, displayName);
      else await api.login(username, password);
      onAuth();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 relative overflow-hidden"
      style={{ background: "linear-gradient(165deg, #FBFAFE 0%, #F4F0FF 40%, #FBF6FF 70%, #FFF8FC 100%)" }}>

      {/* Large ambient glow — centered, warm */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(123,63,238,0.06) 0%, rgba(184,90,238,0.03) 40%, transparent 70%)" }} />

      <div className={`w-full max-w-[420px] relative z-10 transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>

        {/* Brand mark — centered, generous */}
        <div className="flex justify-center mb-12">
          <div className="w-[72px] h-[72px] rounded-[20px] shadow-lg"
            style={{
              background: "linear-gradient(135deg, #7B3FEE 0%, #A855F7 50%, #E832B8 100%)",
              boxShadow: "0 8px 40px rgba(123, 63, 238, 0.25)",
            }} />
        </div>

        {/* Headline — centered, Apple-like, one powerful line */}
        <h1 className="text-center font-bold text-ink leading-[1.1] mb-4"
          style={{ fontSize: "clamp(32px, 7vw, 48px)", letterSpacing: "-0.04em" }}>
          Think privately.
        </h1>

        <p className="text-center text-ink-3 mb-14 mx-auto max-w-[320px]"
          style={{ fontSize: "clamp(15px, 2.5vw, 18px)", lineHeight: 1.6 }}>
          AI that runs on your machine. Nothing leaves. Nothing is tracked. It's just yours.
        </p>

        {/* Form card — glass feel */}
        <div className={`transition-all duration-500 delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>

          {/* Mode switch — pill style */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex p-1 rounded-full" style={{ background: "rgba(123, 63, 238, 0.06)" }}>
              <button onClick={() => { setMode("login"); setError(""); }}
                className={`px-6 py-2.5 rounded-full text-[14px] font-semibold transition-all duration-300 ${
                  mode === "login"
                    ? "bg-white text-ink shadow-md"
                    : "text-ink-3 hover:text-ink"
                }`}>
                Sign in
              </button>
              <button onClick={() => { setMode("register"); setError(""); }}
                className={`px-6 py-2.5 rounded-full text-[14px] font-semibold transition-all duration-300 ${
                  mode === "register"
                    ? "bg-white text-ink shadow-md"
                    : "text-ink-3 hover:text-ink"
                }`}>
                Create account
              </button>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-5">
            {mode === "register" && (
              <div className="animate-fade-up">
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-5 py-4 text-[16px] bg-white border border-line rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300 placeholder:text-ink-4 transition-all shadow-sm" />
              </div>
            )}

            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="Username" required minLength={3} autoComplete="username"
              className="w-full px-5 py-4 text-[16px] bg-white border border-line rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300 placeholder:text-ink-4 transition-all shadow-sm" />

            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Password" required minLength={6}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              className="w-full px-5 py-4 text-[16px] bg-white border border-line rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-300 placeholder:text-ink-4 transition-all shadow-sm" />

            {error && (
              <p className="text-[14px] text-red text-center animate-scale-in font-medium">{error}</p>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-4 text-[16px] font-semibold text-white rounded-2xl active:scale-[0.97] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #7B3FEE 0%, #9568F3 100%)",
                boxShadow: "0 4px 24px rgba(123, 63, 238, 0.3)",
              }}>
              {loading ? "..." : mode === "login" ? "Continue" : "Get started"}
            </button>
          </form>

          <p className="text-center text-[13px] text-ink-4 mt-8">
            Runs on your CPU. No cloud required.
          </p>
        </div>
      </div>
    </div>
  );
}
