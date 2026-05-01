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
    <div className="min-h-dvh bg-bg flex flex-col relative overflow-hidden">
      {/* Ambient gradient orbs */}
      <div className="absolute top-[-30%] right-[-10%] w-[700px] h-[700px] rounded-full opacity-[0.03] pointer-events-none"
        style={{ background: "radial-gradient(circle, #7B3FEE, transparent 70%)" }} />
      <div className="absolute bottom-[-20%] left-[-15%] w-[500px] h-[500px] rounded-full opacity-[0.02] pointer-events-none"
        style={{ background: "radial-gradient(circle, #E832B8, transparent 70%)" }} />

      {/* Top accent line */}
      <div className="h-[2px] shrink-0" style={{ background: "linear-gradient(90deg, #7B3FEE 0%, #B85AEE 40%, #E832B8 100%)" }} />

      {/* Content */}
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Left: Brand panel */}
        <div className="lg:flex-1 flex flex-col justify-center px-6 sm:px-10 lg:px-16 py-10 lg:py-0">
          <div className="max-w-[420px] mx-auto lg:mx-0 animate-fade-up">
            {/* Brand mark */}
            <div className="w-11 h-11 rounded-xl mb-8 shadow-glow-violet animate-pulse-glow"
              style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }} />

            {/* Title — Vignelli-style large type */}
            <h1 className="font-bold text-ink leading-[1.1] mb-4" style={{ fontSize: 36, letterSpacing: "-0.04em" }}>
              Intelligence<br />on your terms.
            </h1>

            <p className="text-[14px] text-ink-3 leading-[1.7] mb-8 max-w-[340px]">
              Classification, generation, and retrieval — running entirely on your CPU.
              No cloud. No GPU. No data leaves your machine.
            </p>

            {/* Capability pills */}
            <div className="flex flex-wrap gap-2 animate-fade-up delay-200">
              {["Sentiment Analysis", "Text Generation", "RAG", "Voice", "OCR"].map((cap) => (
                <span key={cap} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-line text-[11px] font-semibold text-ink-3 tracking-wide">
                  <span className="w-1 h-1 rounded-full bg-violet-400" />
                  {cap}
                </span>
              ))}
            </div>

            {/* Stats row — Vignelli display numerals */}
            <div className="hidden lg:flex gap-10 mt-12 animate-fade-up delay-400">
              {[
                { n: "14", unit: "ms", label: "Classification" },
                { n: "15", unit: "t/s", label: "Generation" },
                { n: "0", unit: "cloud", label: "Dependencies" },
              ].map((s) => (
                <div key={s.label}>
                  <div className="flex items-baseline gap-0.5">
                    <span className="font-bold text-ink tabular-nums" style={{ fontSize: 34, letterSpacing: "-0.03em" }}>{s.n}</span>
                    <span className="text-[12px] font-semibold text-ink-4">{s.unit}</span>
                  </div>
                  <span className="text-[11px] text-ink-4 uppercase tracking-widest font-semibold">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Auth form */}
        <div className="lg:w-[460px] flex items-center justify-center px-6 sm:px-10 py-8 lg:py-0">
          <div className="w-full max-w-[380px] animate-fade-up delay-150">
            {/* Mode switch — minimal, underline style */}
            <div className="flex gap-6 mb-8">
              <button onClick={() => { setMode("login"); setError(""); }}
                className={`pb-2 text-[14px] font-semibold border-b-2 transition-colors ${
                  mode === "login" ? "text-ink border-violet-500" : "text-ink-4 border-transparent hover:text-ink-3"
                }`}>
                Sign in
              </button>
              <button onClick={() => { setMode("register"); setError(""); }}
                className={`pb-2 text-[14px] font-semibold border-b-2 transition-colors ${
                  mode === "register" ? "text-ink border-violet-500" : "text-ink-4 border-transparent hover:text-ink-3"
                }`}>
                Create account
              </button>
            </div>

            <form onSubmit={submit} className="space-y-5">
              {mode === "register" && (
                <div className="animate-fade-up">
                  <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-2">Name</label>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="How should we call you?"
                    className="w-full px-0 py-3 text-[15px] sm:text-[14px] border-0 border-b-2 border-line focus:border-violet-500 focus:outline-none bg-transparent placeholder:text-ink-4 transition-colors" />
                </div>
              )}

              <div>
                <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-2">Username</label>
                <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a username" required minLength={3} autoComplete="username"
                  className="w-full px-0 py-3 text-[15px] sm:text-[14px] border-0 border-b-2 border-line focus:border-violet-500 focus:outline-none bg-transparent placeholder:text-ink-4 transition-colors" />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-2">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters" required minLength={6}
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  className="w-full px-0 py-3 text-[15px] sm:text-[14px] border-0 border-b-2 border-line focus:border-violet-500 focus:outline-none bg-transparent placeholder:text-ink-4 transition-colors" />
              </div>

              {error && (
                <div className="px-4 py-3 bg-red-bg text-red text-[13px] rounded-xl animate-scale-in border border-red/10 font-medium">
                  {error}
                </div>
              )}

              <div className="pt-2">
                <button type="submit" disabled={loading}
                  className="w-full px-4 py-3.5 text-[14px] font-semibold text-white rounded-xl active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-glow-violet"
                  style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #9568F3 100%)" }}>
                  {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
                </button>
              </div>
            </form>

            <p className="text-[11px] text-ink-4 mt-8 leading-relaxed text-center lg:text-left">
              Everything runs on your local machine. Your conversations,<br className="hidden sm:block" />
              your data, your control.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
