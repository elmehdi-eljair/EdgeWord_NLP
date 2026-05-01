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
      if (mode === "register") {
        await api.register(username, password, displayName);
      } else {
        await api.login(username, password);
      }
      onAuth();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-dvh flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        {/* Brand */}
        <div className="text-center mb-8">
          <div
            className="w-10 h-10 rounded-xl mx-auto mb-4"
            style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }}
          />
          <h1 className="text-[22px] font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>
            EdgeWord
          </h1>
          <p className="text-[13px] text-ink-3 mt-1">CPU-native NLP pipeline</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-line p-6 shadow-sm">
          {/* Tabs */}
          <div className="flex gap-0 mb-6 bg-bg-2 rounded-xl p-0.5">
            <button
              onClick={() => { setMode("login"); setError(""); }}
              className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-colors ${
                mode === "login"
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setMode("register"); setError(""); }}
              className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-colors ${
                mode === "register"
                  ? "bg-white text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink"
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-1.5">
                  Display name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  className="w-full px-3 py-2.5 text-[15px] sm:text-[13px] border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white"
                />
              </div>
            )}

            <div>
              <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                required
                minLength={3}
                autoComplete="username"
                className="w-full px-3 py-2.5 text-[15px] sm:text-[13px] border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white"
              />
            </div>

            <div>
              <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                className="w-full px-3 py-2.5 text-[15px] sm:text-[13px] border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white"
              />
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-bg text-red text-[13px] rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 text-[13px] font-medium bg-violet-500 text-white rounded-xl hover:bg-violet-600 transition-colors disabled:bg-line disabled:text-ink-4 disabled:cursor-not-allowed"
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                ? "Sign in"
                : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-ink-4 mt-4">
          Runs entirely on your machine. No cloud. No tracking.
        </p>
      </div>
    </div>
  );
}
