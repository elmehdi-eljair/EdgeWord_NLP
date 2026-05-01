"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "@/lib/api";
import { Message, Attachment, HealthStatus } from "@/lib/types";
import {
  MicIcon, PaperclipIcon, ImageIcon, SendIcon, StopIcon,
  CopyIcon, RefreshIcon, SpeakerIcon, GearIcon, XIcon,
  FileIcon, PlayIcon, PauseIcon,
} from "@/lib/icons";
import AuthPage from "@/components/AuthPage";

/* ─── Helpers ─────────────────────────────────────────── */
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtTime(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ─── Sentiment Pill ──────────────────────────────────── */
function SentimentPill({ label, confidence }: { label: string; confidence: number }) {
  const pos = label === "POSITIVE";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide ${
      pos ? "bg-green-bg text-green" : "bg-red-bg text-red"
    }`}>
      <span className={`w-[5px] h-[5px] rounded-full ${pos ? "bg-green" : "bg-red"}`} />
      {label}
      <span className="opacity-60">{(confidence * 100).toFixed(0)}%</span>
    </span>
  );
}

/* ─── RAG Chip ────────────────────────────────────────── */
function RAGChip({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-violet-50 text-violet-500 text-[11px] font-medium px-2.5 py-1 rounded-full border border-violet-200/50">
      <FileIcon size={11} /> {source}
    </span>
  );
}

/* ─── Tool Result ─────────────────────────────────────── */
function ToolResult({ result }: { result: string }) {
  return (
    <div className="bg-bg rounded-xl px-4 py-3 text-[12px] font-mono text-ink-2 border-l-[3px] border-violet-400 my-3 leading-relaxed">
      {result}
    </div>
  );
}

/* ─── Action Button ───────────────────────────────────── */
function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label}
      className="p-1.5 rounded-lg text-ink-4 hover:text-violet-500 hover:bg-violet-50 transition-all duration-150 sm:opacity-0 sm:group-hover:opacity-100 min-w-[32px] min-h-[32px] sm:min-w-0 sm:min-h-0 flex items-center justify-center">
      {icon}
    </button>
  );
}

/* ─── Audio Player ────────────────────────────────────── */
function AudioPlayer({ blob }: { blob: Blob }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener("timeupdate", () => { if (a.duration) setProgress(a.currentTime / a.duration); });
    a.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { a.pause(); URL.revokeObjectURL(url); };
  }, [blob]);

  return (
    <div className="flex items-center gap-3 bg-bg rounded-xl px-4 py-3 mt-3">
      <button onClick={() => { if (!audioRef.current) return; playing ? audioRef.current.pause() : audioRef.current.play(); setPlaying(!playing); }}
        className="w-8 h-8 rounded-full bg-violet-500 text-white flex items-center justify-center hover:bg-violet-600 transition-colors shrink-0 shadow-sm">
        {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      </button>
      <div className="flex-1 h-[3px] bg-line rounded-full overflow-hidden">
        <div className="h-full bg-violet-400 rounded-full transition-all duration-150 ease-out" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

/* ─── User Message ────────────────────────────────────── */
function UserMessage({ msg, onRerun }: { msg: Message; onRerun: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(msg.text); setCopied(true); setTimeout(() => setCopied(false), 1200); };

  return (
    <div className="ml-10 sm:ml-16 lg:ml-24 animate-fade-up group">
      {msg.attachments?.map((a, i) => (
        <div key={i} className="mb-2">
          {a.type === "image" && a.url && (
            <img src={a.url} alt={a.name} className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover border border-line shadow-sm" />
          )}
          {a.type === "file" && (
            <span className="inline-flex items-center gap-1.5 bg-white border border-line rounded-lg px-3 py-1.5 text-[12px] text-ink-3 shadow-sm">
              <FileIcon size={13} /> {a.name}
            </span>
          )}
        </div>
      ))}
      <div className="bg-violet-500 rounded-2xl rounded-br-md px-4 py-3 shadow-sm">
        <p className="text-[14px] sm:text-[13px] font-medium text-white leading-relaxed whitespace-pre-wrap">{msg.text}</p>
      </div>
      <div className="flex items-center justify-end gap-1 mt-1.5 pr-1">
        <ActionBtn icon={copied ? <span className="text-[10px] text-green font-semibold">Copied</span> : <CopyIcon size={13} />} label="Copy" onClick={copy} />
        <ActionBtn icon={<RefreshIcon size={13} />} label="Re-run" onClick={onRerun} />
        <span className="text-[10px] text-ink-4 ml-1">{fmtTime(msg.timestamp)}</span>
      </div>
    </div>
  );
}

/* ─── AI Response ─────────────────────────────────────── */
function AIResponse({ msg, onRerun }: { msg: Message; onRerun: () => void }) {
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(msg.text); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const handleSpeak = async () => { try { setAudioBlob(await api.speak(msg.text)); } catch {} };

  return (
    <div className="mr-6 sm:mr-12 lg:mr-20 animate-fade-up group">
      <div className="bg-white rounded-2xl rounded-bl-md border border-line px-4 py-3.5 shadow-sm hover:shadow-glow-violet transition-shadow duration-300">
        {/* Sentiment + meta row */}
        {msg.sentiment && (
          <div className="flex items-center gap-2 mb-3">
            <SentimentPill label={msg.sentiment.label} confidence={msg.sentiment.confidence} />
            {msg.cached && (
              <span className="text-[10px] font-semibold text-amber bg-amber-bg px-2 py-0.5 rounded-full">CACHED</span>
            )}
          </div>
        )}

        {/* Response text */}
        <p className="text-[14px] sm:text-[13px] text-ink-2 leading-[1.7] whitespace-pre-wrap">{msg.text}</p>

        {/* Tool result */}
        {msg.toolResult && <ToolResult result={msg.toolResult} />}

        {/* RAG sources */}
        {msg.ragSources && msg.ragSources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {msg.ragSources.map((s, i) => <RAGChip key={i} source={s} />)}
          </div>
        )}

        {/* Audio player */}
        {audioBlob && <AudioPlayer blob={audioBlob} />}

        {/* Footer: metrics + actions */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-line/50">
          {msg.tokens != null && (
            <span className="text-[10px] text-ink-4 font-mono tracking-wide">
              {msg.tokens} tok
              {msg.tps != null && <><span className="text-ink-5 mx-1">/</span>{msg.tps.toFixed(1)} t/s</>}
              {msg.ttft != null && <><span className="text-ink-5 mx-1">/</span>{msg.ttft.toFixed(2)}s TTFT</>}
            </span>
          )}
          <div className="flex items-center gap-0.5">
            <ActionBtn icon={copied ? <span className="text-[10px] text-green font-semibold">Copied</span> : <CopyIcon size={13} />} label="Copy" onClick={copy} />
            <ActionBtn icon={<RefreshIcon size={13} />} label="Re-run" onClick={onRerun} />
            <ActionBtn icon={<SpeakerIcon size={13} />} label="Speak" onClick={handleSpeak} />
            <span className="text-[10px] text-ink-4 ml-1.5">{fmtTime(msg.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Thinking Indicator ──────────────────────────────── */
function ThinkingIndicator() {
  return (
    <div className="mr-6 sm:mr-12 lg:mr-20 animate-fade-up">
      <div className="bg-white rounded-2xl rounded-bl-md border border-line px-5 py-4 shadow-sm">
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-2 h-2 rounded-full bg-violet-400"
              style={{ animation: `dotBounce 1.4s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
          <span className="text-[12px] text-ink-4 ml-2 font-medium">Thinking...</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Empty State ─────────────────────────────────────── */
function EmptyState({ onSuggestion }: { onSuggestion: (t: string) => void }) {
  const suggestions = [
    { text: "Analyse the sentiment of a product review", icon: "chart" },
    { text: "Who created EdgeWord and how does it work?", icon: "info" },
    { text: "Calculate 256 * 128 + 42 for me", icon: "calc" },
  ];
  return (
    <div className="flex-1 flex items-center justify-center px-5 py-10">
      <div className="text-center max-w-md w-full">
        {/* Brand mark */}
        <div className="animate-fade-up">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-6 shadow-glow-violet animate-pulse-glow"
            style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }} />
        </div>

        <div className="animate-fade-up delay-150">
          <h1 className="font-bold text-ink mb-2" style={{ fontSize: 26, letterSpacing: "-0.03em" }}>
            What can I help you with?
          </h1>
          <p className="text-[13px] text-ink-3 leading-relaxed max-w-[300px] mx-auto">
            Classification, generation, and RAG — all running locally on your CPU.
          </p>
        </div>

        {/* Suggestion cards */}
        <div className="mt-8 space-y-2.5 animate-fade-up delay-300">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => onSuggestion(s.text)}
              className="w-full bg-white border border-line rounded-xl px-5 py-3.5 text-[13px] text-ink-3 hover:border-violet-200 hover:text-ink hover:shadow-glow-violet cursor-pointer transition-all duration-200 text-left active:scale-[0.98] group flex items-center gap-3">
              <span className="w-8 h-8 rounded-lg bg-bg flex items-center justify-center text-ink-4 group-hover:bg-violet-50 group-hover:text-violet-500 transition-colors shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {i === 0 && <><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></>}
                  {i === 1 && <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>}
                  {i === 2 && <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/><path d="M12 8v8"/></>}
                </svg>
              </span>
              <span className="flex-1">{s.text}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-5 group-hover:text-violet-400 transition-colors shrink-0">
                <path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Settings Panel ──────────────────────────────────── */
function SettingsPanel({ open, onClose, health, onLogout }: { open: boolean; onClose: () => void; health: HealthStatus | null; onLogout: () => void }) {
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0.7);

  useEffect(() => {
    if (!open) return;
    setMaxTokens(Number(localStorage.getItem("edgeword_max_tokens") || "256"));
    setTemperature(Number(localStorage.getItem("edgeword_temperature") || "0.7"));
  }, [open]);

  const save = (key: string, val: string) => localStorage.setItem(key, val);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/25 backdrop-blur-sm z-30 animate-fade-in" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[380px] bg-white sm:border-l border-line shadow-xl z-40 rounded-t-2xl sm:rounded-none max-h-[85vh] sm:max-h-none overflow-y-auto animate-slide-up sm:animate-fade-in">
        {/* Mobile handle */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-line-2 rounded-full" />
        </div>

        <div className="px-6 py-5 sm:py-6">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-[16px] sm:text-[15px] font-bold text-ink" style={{ letterSpacing: "-0.01em" }}>Settings</h2>
            <button onClick={onClose} className="p-2 text-ink-4 hover:text-ink hover:bg-bg rounded-lg transition-colors"><XIcon size={16} /></button>
          </div>

          {/* Generation */}
          <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-4">Generation</label>
          <div className="space-y-4 mb-8">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] text-ink-2">Max tokens</span>
                <span className="text-[12px] font-mono text-ink-4">{maxTokens}</span>
              </div>
              <input type="range" min="64" max="1024" step="64" value={maxTokens}
                onChange={(e) => { setMaxTokens(Number(e.target.value)); save("edgeword_max_tokens", e.target.value); }}
                className="w-full h-1 bg-line rounded-full appearance-none cursor-pointer accent-violet-500" />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[13px] text-ink-2">Temperature</span>
                <span className="text-[12px] font-mono text-ink-4">{temperature.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="1.5" step="0.1" value={temperature}
                onChange={(e) => { setTemperature(Number(e.target.value)); save("edgeword_temperature", e.target.value); }}
                className="w-full h-1 bg-line rounded-full appearance-none cursor-pointer accent-violet-500" />
            </div>
          </div>

          {/* System */}
          {health && (
            <>
              <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-4">System</label>
              <div className="bg-bg rounded-xl p-4 mb-8 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Model</span>
                  <span className="text-[12px] font-medium text-ink">{health.model?.replace(".gguf", "").replace("Llama-3.2-1B-Instruct-Q4_K_M", "Llama 3.2 1B") || "none"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Fast-Path</span>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${health.fast_path ? "text-green" : "text-ink-4"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${health.fast_path ? "bg-green" : "bg-ink-4"}`} />{health.fast_path ? "Ready" : "Off"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Compute-Path</span>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${health.compute_path ? "text-green" : "text-ink-4"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${health.compute_path ? "bg-green" : "bg-ink-4"}`} />{health.compute_path ? "Ready" : "Off"}
                  </span>
                </div>
                <div className="h-px bg-line my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">RAG</span>
                  <span className="text-[12px] font-mono text-ink-4">{health.rag_chunks} chunks</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Cache</span>
                  <span className="text-[12px] font-mono text-ink-4">{health.cache_entries} entries</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-ink-3">Uptime</span>
                  <span className="text-[12px] font-mono text-ink-4">{Math.round(health.uptime_s / 60)}m</span>
                </div>
              </div>
            </>
          )}

          {/* Actions */}
          <div className="space-y-3">
            <button onClick={async () => { await api.clearSession(); onClose(); location.reload(); }}
              className="w-full px-4 py-3 text-[13px] font-medium text-ink-3 border border-line rounded-xl hover:bg-bg transition-colors text-center">
              Clear conversation
            </button>
            <button onClick={() => { api.logout(); onLogout(); }}
              className="w-full px-4 py-3 text-[13px] font-medium text-red border border-line rounded-xl hover:bg-red-bg transition-colors text-center">
              Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Main Page ───────────────────────────────────────── */
export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setAuthed(api.isLoggedIn()); }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, generating]);

  useEffect(() => {
    if (!authed) return;
    const poll = () => api.health().then(setHealth).catch(() => {});
    poll();
    const iv = setInterval(poll, 30000);
    return () => clearInterval(iv);
  }, [authed]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  const send = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg && attachments.length === 0) return;
    if (generating) return;

    const userMsg: Message = {
      id: uid(), role: "user", text: msg, timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    setAttachments([]);
    setGenerating(true);

    try {
      const imgAtt = userMsg.attachments?.find((a) => a.type === "image");
      if (imgAtt) {
        const res = await api.ocrChat(imgAtt.file, msg || "What does this image say?");
        setMessages((p) => [...p, {
          id: uid(), role: "assistant", text: res.response,
          tokens: res.tokens, totalS: res.total_s,
          toolResult: res.ocr ? `[OCR] ${res.ocr.text}` : undefined,
          timestamp: Date.now(),
        }]);
      } else {
        const res = await api.chat(msg, {
          maxTokens: Number(localStorage.getItem("edgeword_max_tokens") || "256"),
          temperature: Number(localStorage.getItem("edgeword_temperature") || "0.7"),
        });
        setMessages((p) => [...p, {
          id: uid(), role: "assistant", text: res.response,
          sentiment: res.sentiment,
          ragSources: res.rag_sources.length > 0 ? res.rag_sources : undefined,
          toolResult: res.tool_result || undefined,
          tokens: res.tokens, tps: res.tps, ttft: res.ttft_s, totalS: res.total_s,
          cached: res.cached, timestamp: Date.now(),
        }]);
      }
    } catch (err: any) {
      setMessages((p) => [...p, { id: uid(), role: "assistant", text: `Error: ${err.message}`, timestamp: Date.now() }]);
    } finally {
      setGenerating(false);
    }
  }, [input, attachments, generating]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
  };

  const toggleRecording = async () => {
    if (recording) { mediaRecRef.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const file = new File([new Blob(chunks, { type: "audio/webm" })], "rec.webm", { type: "audio/webm" });
        try { const r = await api.transcribe(file); if (r.text) setInput((p) => p + (p ? " " : "") + r.text); } catch {}
      };
      rec.start(); mediaRecRef.current = rec; setRecording(true);
    } catch {}
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((f) => setAttachments((p) => [...p, { type: "file", name: f.name, size: f.size, file: f }]));
    e.target.value = "";
  };
  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((f) => setAttachments((p) => [...p, { type: "image", name: f.name, size: f.size, url: URL.createObjectURL(f), file: f }]));
    e.target.value = "";
  };
  const removeAttachment = (idx: number) => {
    setAttachments((p) => { if (p[idx].url) URL.revokeObjectURL(p[idx].url!); return p.filter((_, i) => i !== idx); });
  };

  const canSend = input.trim() || attachments.length > 0;

  if (!authed) return <AuthPage onAuth={() => setAuthed(true)} />;

  return (
    <div className="h-dvh flex flex-col bg-bg">
      {/* ── Top Bar ── */}
      <header className="h-12 sm:h-13 border-b border-line bg-white/80 backdrop-blur-md px-4 sm:px-6 sticky top-0 z-10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg shadow-sm"
            style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }} />
          <span className="hidden sm:block text-[15px] font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>EdgeWord</span>
        </div>
        <div className="flex items-center gap-4">
          {health && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green">
              <span className="w-[6px] h-[6px] rounded-full bg-green animate-pulse" />
              <span className="hidden sm:inline">Online</span>
            </span>
          )}
          <button onClick={() => setSettingsOpen(true)} className="p-2 text-ink-4 hover:text-ink hover:bg-bg rounded-lg transition-colors">
            <GearIcon size={17} />
          </button>
        </div>
      </header>

      {/* ── Conversation ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {messages.length === 0 && !generating ? (
          <EmptyState onSuggestion={(t) => send(t)} />
        ) : (
          <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-6 space-y-4">
            {messages.map((msg, idx) =>
              msg.role === "user" ? (
                <UserMessage key={msg.id} msg={msg} onRerun={() => send(msg.text)} />
              ) : (
                <AIResponse key={msg.id} msg={msg} onRerun={() => { const p = messages[idx - 1]; if (p) send(p.text); }} />
              )
            )}
            {generating && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {/* ── Prompt Bar ── */}
      <div className="sticky bottom-0 px-3 sm:px-6 pb-3 sm:pb-5 pt-4 pb-safe"
        style={{ background: "linear-gradient(to top, #FBFAFE 60%, transparent)" }}>

        <div className="max-w-[720px] mx-auto">
          <div className="bg-white rounded-2xl border border-line shadow-lg hover:shadow-glow-violet transition-shadow duration-300 overflow-hidden">
            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 animate-scale-in">
                {attachments.map((a, i) => (
                  <div key={i} className="relative group">
                    {a.type === "image" && a.url ? (
                      <img src={a.url} alt={a.name} className="w-14 h-14 rounded-xl object-cover border border-line" />
                    ) : (
                      <span className="inline-flex items-center gap-1.5 bg-bg rounded-lg px-3 py-2 text-[11px] text-ink-3 border border-line">
                        <FileIcon size={12} /> {a.name}
                      </span>
                    )}
                    <button onClick={() => removeAttachment(i)}
                      className="absolute -top-1 -right-1 w-4 h-4 bg-ink-2 text-white rounded-full flex items-center justify-center hover:bg-ink transition-colors">
                      <XIcon size={8} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input area */}
            <div className="flex items-end">
              {/* Desktop icons */}
              <div className="hidden sm:flex items-center gap-1 pl-3 pb-3 pr-2">
                <button onClick={toggleRecording} title="Voice"
                  className={`p-2 rounded-lg transition-all ${recording ? "text-red bg-red-bg animate-pulse" : "text-ink-4 hover:text-violet-500 hover:bg-violet-50"}`}>
                  <MicIcon size={17} />
                </button>
                <button onClick={() => fileRef.current?.click()} title="File" className="p-2 rounded-lg text-ink-4 hover:text-violet-500 hover:bg-violet-50 transition-all">
                  <PaperclipIcon size={17} />
                </button>
                <button onClick={() => imgRef.current?.click()} title="Image" className="p-2 rounded-lg text-ink-4 hover:text-violet-500 hover:bg-violet-50 transition-all">
                  <ImageIcon size={17} />
                </button>
              </div>

              <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                rows={1}
                className="flex-1 text-[15px] sm:text-[14px] text-ink resize-none border-none outline-none bg-transparent py-3.5 pl-4 sm:pl-1 pr-2 max-h-[150px] placeholder:text-ink-4" />

              <div className="pr-3 pb-3">
                {generating ? (
                  <button className="w-9 h-9 rounded-xl bg-red text-white flex items-center justify-center shadow-sm hover:opacity-90 transition-opacity">
                    <StopIcon size={14} />
                  </button>
                ) : (
                  <button onClick={() => send()} disabled={!canSend}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 ${
                      canSend
                        ? "bg-violet-500 text-white hover:bg-violet-600 active:scale-90 shadow-sm"
                        : "bg-bg text-ink-4"
                    }`}>
                    <SendIcon size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Mobile icons */}
            <div className="sm:hidden flex items-center gap-0.5 px-3 py-2 border-t border-line/50">
              <button onClick={toggleRecording}
                className={`p-2.5 rounded-lg transition-all ${recording ? "text-red bg-red-bg animate-pulse" : "text-ink-4 active:text-violet-500 active:bg-violet-50"}`}>
                <MicIcon size={20} />
              </button>
              <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-lg text-ink-4 active:text-violet-500 active:bg-violet-50 transition-all">
                <PaperclipIcon size={20} />
              </button>
              <button onClick={() => imgRef.current?.click()} className="p-2.5 rounded-lg text-ink-4 active:text-violet-500 active:bg-violet-50 transition-all">
                <ImageIcon size={20} />
              </button>
            </div>
          </div>

          {/* Status line */}
          {health && (
            <div className="mt-2.5 text-center text-[10px] text-ink-4 font-mono tracking-wider animate-fade-in">
              {health.model?.replace(".gguf", "").replace("Llama-3.2-1B-Instruct-Q4_K_M", "Llama 3.2 1B") ?? "no model"}
              <span className="text-ink-5 mx-2">&middot;</span>
              {health.rag_chunks} docs
              <span className="text-ink-5 mx-2">&middot;</span>
              {messages.filter((m) => m.role === "user").length} turns
            </div>
          )}
        </div>

        <input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.py,.json,.csv,.yaml,.yml" onChange={handleFile} />
        <input ref={imgRef} type="file" className="hidden" accept="image/*" onChange={handleImage} />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} health={health} onLogout={() => setAuthed(false)} />
    </div>
  );
}
