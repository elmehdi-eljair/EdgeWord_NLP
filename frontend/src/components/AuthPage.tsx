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
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "register") await api.register(username, password, displayName);
      else await api.login(username, password);
      onAuth();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-dvh flex flex-col relative overflow-hidden"
      style={{ background: "linear-gradient(170deg, #FDFBFF 0%, #F8F4FF 30%, #FFF9FD 60%, #FEFCFF 100%)" }}>

      {/* Living ambient orbs */}
      <div className="absolute top-[-15%] right-[-5%] w-[600px] h-[600px] rounded-full anim-breathe pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(123,63,238,0.07) 0%, transparent 65%)" }} />
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full anim-breathe pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(232,50,184,0.05) 0%, transparent 65%)", animationDelay: "2s" }} />
      <div className="absolute top-[40%] left-[60%] w-[300px] h-[300px] rounded-full anim-breathe pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(149,104,243,0.04) 0%, transparent 65%)", animationDelay: "1s" }} />

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative z-10">
        <div className={`w-full max-w-[440px] transition-all duration-1000 ease-out ${ready ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}>

          {/* Brand mark — floating, glowing */}
          <div className="flex justify-center mb-16">
            <div className="relative">
              <div className="w-[80px] h-[80px] rounded-[22px] relative z-10"
                style={{
                  background: "linear-gradient(135deg, #7B3FEE 0%, #A855F7 40%, #E832B8 100%)",
                  boxShadow: "0 8px 40px rgba(123,63,238,0.3), 0 2px 8px rgba(123,63,238,0.2)",
                }} />
              {/* Glow behind */}
              <div className="absolute inset-0 rounded-[22px] anim-glow"
                style={{ background: "linear-gradient(135deg, #7B3FEE, #E832B8)", filter: "blur(20px)", opacity: 0.3 }} />
            </div>
          </div>

          {/* Headline */}
          <h1 className="text-center font-bold text-ink leading-[1.08] mb-5"
            style={{ fontSize: "clamp(34px, 8vw, 52px)", letterSpacing: "-0.045em" }}>
            Think privately.
          </h1>

          <p className="text-center leading-[1.7] mx-auto max-w-[340px] mb-16"
            style={{ fontSize: "clamp(15px, 3vw, 18px)", color: "#6E6989" }}>
            AI that lives on your machine. Your words stay yours.
          </p>

          {/* Form — no box, no card, just fields floating on the warm background */}
          <div className={`transition-all duration-700 delay-300 ${ready ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>

            {/* Mode switch — soft pills */}
            <div className="flex justify-center mb-10">
              <div className="inline-flex p-1.5 rounded-full shadow-soft"
                style={{ background: "rgba(255,255,255,0.8)", backdropFilter: "blur(12px)" }}>
                <button onClick={() => { setMode("login"); setError(""); }}
                  className={`px-7 py-2.5 rounded-full text-[14px] font-semibold transition-all duration-300 ${
                    mode === "login"
                      ? "bg-white text-ink shadow-medium"
                      : "text-ink-3 hover:text-ink"
                  }`}>
                  Sign in
                </button>
                <button onClick={() => { setMode("register"); setError(""); }}
                  className={`px-7 py-2.5 rounded-full text-[14px] font-semibold transition-all duration-300 ${
                    mode === "register"
                      ? "bg-white text-ink shadow-medium"
                      : "text-ink-3 hover:text-ink"
                  }`}>
                  Create account
                </button>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === "register" && (
                <div className="anim-fade-up">
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-5 py-4 text-[16px] bg-white/80 backdrop-blur-sm border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:bg-white placeholder:text-ink-4 transition-all shadow-soft hover:shadow-medium" />
                </div>
              )}

              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="Username" required minLength={3} autoComplete="username"
                className="w-full px-5 py-4 text-[16px] bg-white/80 backdrop-blur-sm border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:bg-white placeholder:text-ink-4 transition-all shadow-soft hover:shadow-medium" />

              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" required minLength={6}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                className="w-full px-5 py-4 text-[16px] bg-white/80 backdrop-blur-sm border border-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:bg-white placeholder:text-ink-4 transition-all shadow-soft hover:shadow-medium" />

              {error && (
                <p className="text-[14px] text-red text-center anim-fade-up font-medium py-2">{error}</p>
              )}

              <div className="pt-3">
                <button type="submit" disabled={loading}
                  className="w-full py-4.5 text-[16px] font-semibold text-white rounded-2xl active:scale-[0.97] transition-all duration-200 disabled:opacity-40"
                  style={{
                    background: "linear-gradient(135deg, #7B3FEE 0%, #9568F3 50%, #A855F7 100%)",
                    boxShadow: "0 4px 20px rgba(123,63,238,0.35), 0 1px 3px rgba(123,63,238,0.2)",
                    padding: "18px",
                  }}>
                  {loading ? "..." : mode === "login" ? "Continue" : "Get started"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Footer — barely there */}
      <div className={`text-center pb-8 text-[12px] text-ink-4 tracking-wide transition-all duration-1000 delay-700 ${ready ? "opacity-100" : "opacity-0"}`}>
        Runs entirely on your hardware
      </div>
    </div>
  );
}
