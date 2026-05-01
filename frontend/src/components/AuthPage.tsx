"use client";

import { useState } from "react";
import * as api from "@/lib/api";

export default function AuthPage({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-dvh bg-bg flex flex-col overflow-hidden">
      {/* Top gradient accent */}
      <div className="h-1 shrink-0" style={{ background: "linear-gradient(90deg, #7B3FEE 0%, #B85AEE 40%, #E832B8 100%)" }} />

      <div className="flex-1 flex flex-col lg:flex-row">
        {/* ── Left: Brand ── */}
        <div className="lg:flex-[1.2] flex flex-col justify-center px-8 sm:px-14 lg:px-20 xl:px-28 py-14 lg:py-0 relative">
          {/* Ambient glow */}
          <div className="absolute top-[10%] left-[10%] w-[500px] h-[500px] rounded-full opacity-[0.04] pointer-events-none"
            style={{ background: "radial-gradient(circle, #7B3FEE, transparent 70%)" }} />
          <div className="absolute bottom-[5%] right-[20%] w-[300px] h-[300px] rounded-full opacity-[0.03] pointer-events-none"
            style={{ background: "radial-gradient(circle, #E832B8, transparent 70%)" }} />

          <div className="relative z-10 max-w-[560px] animate-fade-up">
            {/* Brand mark */}
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mb-10 sm:mb-14 shadow-glow-violet animate-pulse-glow"
              style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }} />

            {/* Headline — big, warm, human */}
            <h1 className="font-bold text-ink leading-[1.05] mb-6 sm:mb-8"
              style={{ fontSize: "clamp(36px, 6vw, 64px)", letterSpacing: "-0.04em" }}>
              Your AI,<br />
              your machine.
            </h1>

            <p className="text-ink-3 leading-[1.8] mb-10 sm:mb-14 max-w-[440px]"
              style={{ fontSize: "clamp(16px, 2vw, 20px)" }}>
              A private assistant that thinks, understands, and creates
              — powered entirely by your own hardware.
            </p>

            {/* Three value props — warm, not technical */}
            <div className="hidden sm:flex flex-col gap-5 animate-fade-up delay-200">
              {[
                { title: "Completely private", desc: "Your conversations never leave your computer." },
                { title: "Always available", desc: "No internet needed. Works offline, anytime." },
                { title: "Truly yours", desc: "No subscriptions, no limits, no tracking." },
              ].map((v) => (
                <div key={v.title} className="flex items-start gap-4">
                  <div className="w-2 h-2 rounded-full bg-violet-400 mt-2.5 shrink-0" />
                  <div>
                    <span className="text-[16px] sm:text-[18px] font-semibold text-ink">{v.title}</span>
                    <span className="text-[15px] sm:text-[16px] text-ink-3 ml-2">{v.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Auth form ── */}
        <div className="lg:w-[480px] xl:w-[520px] flex items-center justify-center px-8 sm:px-14 py-10 lg:py-0 lg:border-l lg:border-line lg:bg-white/50">
          <div className="w-full max-w-[380px] animate-fade-up delay-150">
            {/* Mode switch */}
            <div className="flex gap-8 mb-10">
              <button onClick={() => { setMode("login"); setError(""); }}
                className={`pb-2.5 font-semibold border-b-[3px] transition-all ${
                  mode === "login"
                    ? "text-ink border-violet-500"
                    : "text-ink-4 border-transparent hover:text-ink-3"
                }`} style={{ fontSize: 18 }}>
                Sign in
              </button>
              <button onClick={() => { setMode("register"); setError(""); }}
                className={`pb-2.5 font-semibold border-b-[3px] transition-all ${
                  mode === "register"
                    ? "text-ink border-violet-500"
                    : "text-ink-4 border-transparent hover:text-ink-3"
                }`} style={{ fontSize: 18 }}>
                Create account
              </button>
            </div>

            <form onSubmit={submit} className="space-y-7">
              {mode === "register" && (
                <div className="animate-fade-up">
                  <label className="text-[12px] font-semibold text-ink-3 uppercase tracking-widest block mb-3">Your name</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="How should we call you?"
                    className="w-full px-0 py-3.5 text-[18px] sm:text-[17px] border-0 border-b-2 border-line focus:border-violet-500 focus:outline-none bg-transparent placeholder:text-ink-4 transition-colors" />
                </div>
              )}

              <div>
                <label className="text-[12px] font-semibold text-ink-3 uppercase tracking-widest block mb-3">Username</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username" required minLength={3} autoComplete="username"
                  className="w-full px-0 py-3.5 text-[18px] sm:text-[17px] border-0 border-b-2 border-line focus:border-violet-500 focus:outline-none bg-transparent placeholder:text-ink-4 transition-colors" />
              </div>

              <div>
                <label className="text-[12px] font-semibold text-ink-3 uppercase tracking-widest block mb-3">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters" required minLength={6}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  className="w-full px-0 py-3.5 text-[18px] sm:text-[17px] border-0 border-b-2 border-line focus:border-violet-500 focus:outline-none bg-transparent placeholder:text-ink-4 transition-colors" />
              </div>

              {error && (
                <div className="px-5 py-4 bg-red-bg text-red text-[14px] rounded-xl animate-scale-in border border-red/10 font-medium">
                  {error}
                </div>
              )}

              <div className="pt-3">
                <button type="submit" disabled={loading}
                  className="w-full py-4 text-[16px] font-semibold text-white rounded-2xl active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-glow-violet"
                  style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #9568F3 100%)" }}>
                  {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Get started"}
                </button>
              </div>
            </form>

            <p className="text-[13px] text-ink-4 mt-10 leading-relaxed">
              Everything stays on your machine.<br />
              No data is ever sent to the cloud.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
