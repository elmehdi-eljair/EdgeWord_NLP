"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "@/lib/api";
import { Message, Attachment, HealthStatus } from "@/lib/types";
import {
  MicIcon, PaperclipIcon, ImageIcon, SendIcon, StopIcon,
  CopyIcon, RefreshIcon, SpeakerIcon, GearIcon, XIcon,
  FileIcon, PlayIcon, PauseIcon,
} from "@/lib/icons";

// ── Helpers ──────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtTime(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Sentiment Pill ──────────────────────────────────────
function SentimentPill({ label, confidence }: { label: string; confidence: number }) {
  const pos = label === "POSITIVE";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${pos ? "bg-green-bg text-green" : "bg-red-bg text-red"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${pos ? "bg-green" : "bg-red"}`} />
      {label} {(confidence * 100).toFixed(0)}%
    </span>
  );
}

// ── RAG Chip ────────────────────────────────────────────
function RAGChip({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-bg-2 text-ink-3 text-[11px] px-2 py-0.5 rounded-full">
      <FileIcon size={12} /> {source}
    </span>
  );
}

// ── Tool Result ─────────────────────────────────────────
function ToolResult({ result }: { result: string }) {
  return (
    <div className="bg-bg-2 rounded-lg px-3 py-2 text-[12px] font-mono text-ink-3 border-l-[3px] border-violet-400 my-2">
      {result}
    </div>
  );
}

// ── Message Actions ─────────────────────────────────────
function MessageActions({ text, onRerun, onSpeak, showSpeak }: {
  text: string; onRerun?: () => void; onSpeak?: () => void; showSpeak?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-0.5">
      <button onClick={copy} className="p-1.5 sm:p-1 rounded-lg text-ink-4 hover:text-ink hover:bg-bg-2 transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Copy">
        {copied ? <span className="text-[11px] text-green font-medium">Copied</span> : <CopyIcon />}
      </button>
      {onRerun && (
        <button onClick={onRerun} className="p-1.5 sm:p-1 rounded-lg text-ink-4 hover:text-ink hover:bg-bg-2 transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Re-run">
          <RefreshIcon />
        </button>
      )}
      {showSpeak && onSpeak && (
        <button onClick={onSpeak} className="p-1.5 sm:p-1 rounded-lg text-ink-4 hover:text-ink hover:bg-bg-2 transition-colors min-w-[36px] min-h-[36px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Speak">
          <SpeakerIcon />
        </button>
      )}
    </div>
  );
}

// ── Audio Player ────────────────────────────────────────
function AudioPlayer({ blob }: { blob: Blob }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener("timeupdate", () => {
      if (a.duration) setProgress(a.currentTime / a.duration);
    });
    a.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { a.pause(); URL.revokeObjectURL(url); };
  }, [blob]);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); } else { audioRef.current.play(); }
    setPlaying(!playing);
  };

  return (
    <div className="flex items-center gap-2 bg-bg-2 rounded-lg px-3 py-2 mt-2">
      <button onClick={toggle} className="w-8 h-8 sm:w-7 sm:h-7 rounded-full bg-violet-500 text-white flex items-center justify-center hover:bg-violet-600 transition-colors shrink-0">
        {playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
      </button>
      <div className="flex-1 h-[3px] bg-line rounded-full overflow-hidden">
        <div className="h-full bg-violet-400 rounded-full transition-all duration-100" style={{ width: `${progress * 100}%` }} />
      </div>
    </div>
  );
}

// ── User Message ────────────────────────────────────────
function UserMessage({ msg, onRerun }: { msg: Message; onRerun: () => void }) {
  return (
    <div className="ml-8 sm:ml-12 lg:ml-16 animate-in">
      {msg.attachments?.map((a, i) => (
        <div key={i} className="mb-2">
          {a.type === "image" && a.url && (
            <img src={a.url} alt={a.name} className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg object-cover border border-line" />
          )}
          {a.type === "file" && (
            <span className="inline-flex items-center gap-1.5 bg-bg-2 rounded-lg px-3 py-1.5 text-[12px] text-ink-3">
              <FileIcon size={14} /> {a.name}
            </span>
          )}
        </div>
      ))}
      <div className="bg-bg-2 rounded-xl px-3 py-2.5 sm:px-4 sm:py-3">
        <p className="text-[14px] sm:text-[13px] font-medium text-ink whitespace-pre-wrap">{msg.text}</p>
        <div className="flex items-center justify-end gap-2 mt-1.5">
          <MessageActions text={msg.text} onRerun={onRerun} />
          <span className="text-[11px] text-ink-4">{fmtTime(msg.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

// ── AI Response ─────────────────────────────────────────
function AIResponse({ msg, onRerun }: { msg: Message; onRerun: () => void }) {
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const handleSpeak = async () => {
    try {
      const blob = await api.speak(msg.text);
      setAudioBlob(blob);
    } catch { /* ignore */ }
  };

  return (
    <div className="mr-4 sm:mr-8 lg:mr-16 animate-in">
      <div className="bg-white rounded-xl border border-line px-3 py-2.5 sm:px-4 sm:py-3">
        {msg.sentiment && (
          <div className="mb-2">
            <SentimentPill label={msg.sentiment.label} confidence={msg.sentiment.confidence} />
          </div>
        )}
        <p className="text-[14px] sm:text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">{msg.text}</p>

        {msg.toolResult && <ToolResult result={msg.toolResult} />}

        {msg.ragSources && msg.ragSources.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {msg.ragSources.map((s, i) => <RAGChip key={i} source={s} />)}
          </div>
        )}

        {audioBlob && <AudioPlayer blob={audioBlob} />}

        <div className="flex items-center justify-between mt-2 flex-wrap gap-1">
          <span className="text-[10px] sm:text-[11px] text-ink-4 font-mono">
            {msg.tokens != null && <>{msg.tokens} tok</>}
            {msg.tps != null && <> · {msg.tps.toFixed(1)} t/s</>}
            {msg.ttft != null && <> · TTFT {msg.ttft.toFixed(3)}s</>}
            {msg.cached && <span className="text-amber ml-1">cached</span>}
          </span>
          <div className="flex items-center gap-2">
            <MessageActions text={msg.text} onRerun={onRerun} onSpeak={handleSpeak} showSpeak />
            <span className="text-[11px] text-ink-4">{fmtTime(msg.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Thinking Indicator ──────────────────────────────────
function ThinkingIndicator() {
  return (
    <div className="mr-4 sm:mr-8 lg:mr-16">
      <div className="bg-white rounded-xl border border-line px-3 py-3 sm:px-4">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "150ms" }} />
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" style={{ animationDelay: "300ms" }} />
          <span className="text-[12px] text-ink-4 ml-2">Generating...</span>
        </div>
      </div>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────
function EmptyState({ onSuggestion }: { onSuggestion: (t: string) => void }) {
  const suggestions = [
    "Classify the sentiment of a review",
    "What is EdgeWord NLP?",
    "What is 256 * 128 + 42?",
  ];
  return (
    <div className="flex-1 flex items-center justify-center px-4">
      <div className="text-center max-w-sm w-full">
        <div className="w-8 h-8 sm:w-7 sm:h-7 rounded-lg mx-auto mb-4" style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }} />
        <h1 className="text-[18px] font-bold text-ink mb-1" style={{ letterSpacing: "-0.02em" }}>EdgeWord Assistant</h1>
        <p className="text-[14px] sm:text-[13px] text-ink-3 mb-6">CPU-native NLP pipeline — classification, generation, RAG</p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => onSuggestion(s)}
              className="flex-1 bg-white border border-line rounded-xl px-4 py-3.5 sm:py-3 text-[13px] text-ink-3 hover:border-violet-200 hover:text-ink cursor-pointer transition-colors text-left sm:text-center active:scale-[0.98]">
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ──────────────────────────────────────
function SettingsPanel({ open, onClose, health }: { open: boolean; onClose: () => void; health: HealthStatus | null }) {
  const [apiKey, setApiKey] = useState("");
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0.7);

  useEffect(() => {
    if (!open) return;
    setApiKey(localStorage.getItem("edgeword_api_key") || "");
    setMaxTokens(Number(localStorage.getItem("edgeword_max_tokens") || "256"));
    setTemperature(Number(localStorage.getItem("edgeword_temperature") || "0.7"));
  }, [open]);

  const save = (key: string, val: string) => localStorage.setItem(key, val);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 sm:block" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[360px] bg-white sm:border-l border-line shadow-xl z-40 rounded-t-2xl sm:rounded-none max-h-[85vh] sm:max-h-none overflow-y-auto">
        <div className="sm:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-line rounded-full" />
        </div>
        <div className="px-5 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[16px] sm:text-[14px] font-bold" style={{ letterSpacing: "-0.01em" }}>Settings</h2>
            <button onClick={onClose} className="p-1.5 text-ink-3 hover:text-ink"><XIcon size={18} /></button>
          </div>

          <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-2">API Key</label>
          <input type="password" value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); save("edgeword_api_key", e.target.value); }}
            placeholder="ew_..."
            className="w-full px-3 py-3 sm:py-2.5 text-[15px] sm:text-[13px] border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white mb-6 font-mono" />

          <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-3">Generation</label>
          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink-2">Max tokens</span>
              <input type="number" value={maxTokens}
                onChange={(e) => { setMaxTokens(Number(e.target.value)); save("edgeword_max_tokens", e.target.value); }}
                className="w-20 px-2 py-1.5 text-[13px] border border-line rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-ink-2">Temperature</span>
              <input type="number" step="0.1" value={temperature}
                onChange={(e) => { setTemperature(Number(e.target.value)); save("edgeword_temperature", e.target.value); }}
                className="w-20 px-2 py-1.5 text-[13px] border border-line rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
          </div>

          {health && (
            <>
              <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-3">System</label>
              <div className="space-y-1.5 text-[13px] text-ink-3 mb-6">
                <div className="flex justify-between"><span>Model</span><span className="text-ink-2 font-medium text-right text-[12px]">{health.model?.replace(".gguf", "") || "none"}</span></div>
                <div className="flex justify-between"><span>Fast-Path</span><span className={health.fast_path ? "text-green" : "text-red"}>{health.fast_path ? "ready" : "off"}</span></div>
                <div className="flex justify-between"><span>Compute-Path</span><span className={health.compute_path ? "text-green" : "text-red"}>{health.compute_path ? "ready" : "off"}</span></div>
                <div className="flex justify-between"><span>RAG chunks</span><span className="text-ink-2">{health.rag_chunks}</span></div>
                <div className="flex justify-between"><span>Cache</span><span className="text-ink-2">{health.cache_entries} entries</span></div>
                <div className="flex justify-between"><span>Uptime</span><span className="text-ink-2">{Math.round(health.uptime_s / 60)}m</span></div>
              </div>
            </>
          )}

          <label className="text-[11px] font-semibold text-ink-3 uppercase tracking-widest block mb-3">Session</label>
          <button onClick={async () => { await api.clearSession(); onClose(); location.reload(); }}
            className="w-full sm:w-auto px-4 py-3 sm:py-2 text-[13px] text-red border border-line rounded-xl hover:bg-red-bg transition-colors">
            Clear conversation
          </button>
        </div>
      </div>
    </>
  );
}

// ── Main Page ───────────────────────────────────────────
export default function Home() {
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

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, generating]);

  // Health polling
  useEffect(() => {
    const poll = () => api.health().then(setHealth).catch(() => {});
    poll();
    const iv = setInterval(poll, 30000);
    return () => clearInterval(iv);
  }, []);

  // Auto-resize textarea
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
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setAttachments([]);
    setGenerating(true);

    try {
      const imgAtt = userMsg.attachments?.find((a) => a.type === "image");
      if (imgAtt) {
        const res = await api.ocrChat(imgAtt.file, msg || "What does this image say?");
        setMessages((prev) => [...prev, {
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
        setMessages((prev) => [...prev, {
          id: uid(), role: "assistant", text: res.response,
          sentiment: res.sentiment,
          ragSources: res.rag_sources.length > 0 ? res.rag_sources : undefined,
          toolResult: res.tool_result || undefined,
          tokens: res.tokens, tps: res.tps, ttft: res.ttft_s, totalS: res.total_s,
          cached: res.cached,
          timestamp: Date.now(),
        }]);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, {
        id: uid(), role: "assistant", text: `Error: ${err.message}`, timestamp: Date.now(),
      }]);
    } finally {
      setGenerating(false);
    }
  }, [input, attachments, generating]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
  };

  // Voice recording
  const toggleRecording = async () => {
    if (recording) {
      mediaRecRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: "audio/webm" });
        const file = new File([blob], "recording.webm", { type: "audio/webm" });
        try {
          const res = await api.transcribe(file);
          if (res.text) setInput((prev) => prev + (prev ? " " : "") + res.text);
        } catch { /* ignore */ }
      };
      recorder.start();
      mediaRecRef.current = recorder;
      setRecording(true);
    } catch { /* mic denied */ }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((f) => {
      setAttachments((prev) => [...prev, { type: "file", name: f.name, size: f.size, file: f }]);
    });
    e.target.value = "";
  };

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    Array.from(e.target.files).forEach((f) => {
      setAttachments((prev) => [...prev, { type: "image", name: f.name, size: f.size, url: URL.createObjectURL(f), file: f }]);
    });
    e.target.value = "";
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => {
      if (prev[idx].url) URL.revokeObjectURL(prev[idx].url!);
      return prev.filter((_, i) => i !== idx);
    });
  };

  return (
    <div className="h-dvh flex flex-col">
      {/* ── Top Bar ── */}
      <header className="h-11 sm:h-12 border-b border-line bg-white px-4 sm:px-6 sticky top-0 z-10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded" style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #B85AEE 50%, #E832B8 100%)" }} />
          <span className="hidden sm:block text-[14px] font-bold text-ink" style={{ letterSpacing: "-0.01em" }}>EdgeWord</span>
        </div>
        <div className="flex items-center gap-3">
          {health && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green">
              <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
              <span className="hidden sm:inline">Online</span>
            </span>
          )}
          <button onClick={() => setSettingsOpen(true)} className="p-1.5 text-ink-3 hover:text-ink transition-colors">
            <GearIcon size={18} />
          </button>
        </div>
      </header>

      {/* ── Conversation ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {messages.length === 0 && !generating ? (
          <EmptyState onSuggestion={(t) => send(t)} />
        ) : (
          <div className="max-w-[680px] mx-auto px-3 sm:px-4 lg:px-6 py-4 space-y-3">
            {messages.map((msg, idx) =>
              msg.role === "user" ? (
                <UserMessage key={msg.id} msg={msg} onRerun={() => send(msg.text)} />
              ) : (
                <AIResponse key={msg.id} msg={msg}
                  onRerun={() => { const prev = messages[idx - 1]; if (prev) send(prev.text); }} />
              )
            )}
            {generating && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {/* ── Prompt Bar ── */}
      <div className="sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-3 sm:px-6 pb-3 sm:pb-4 pt-6 pb-safe">
        <div className="max-w-[680px] mx-auto bg-white rounded-xl sm:rounded-2xl border border-line shadow-lg overflow-hidden">
          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((a, i) => (
                <div key={i} className="relative group">
                  {a.type === "image" && a.url ? (
                    <img src={a.url} alt={a.name} className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg object-cover border border-line" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 bg-bg-2 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-3">
                      <FileIcon size={12} /> {a.name}
                    </span>
                  )}
                  <button onClick={() => removeAttachment(i)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-ink text-white rounded-full flex items-center justify-center opacity-80 hover:opacity-100">
                    <XIcon size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="flex items-end">
            <div className="hidden sm:flex items-center gap-0.5 pl-2 pb-2.5 border-r border-line mr-2 pr-2">
              <button onClick={toggleRecording} className={`p-2 rounded-lg transition-colors ${recording ? "text-red animate-pulse" : "text-ink-3 hover:text-violet-500"}`} title="Voice">
                <MicIcon size={18} />
              </button>
              <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg text-ink-3 hover:text-violet-500 transition-colors" title="File">
                <PaperclipIcon size={18} />
              </button>
              <button onClick={() => imgRef.current?.click()} className="p-2 rounded-lg text-ink-3 hover:text-violet-500 transition-colors" title="Image">
                <ImageIcon size={18} />
              </button>
            </div>

            <textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Type a message..." rows={1}
              className="flex-1 text-[15px] sm:text-[13px] text-ink resize-none border-none outline-none bg-transparent py-3 pl-3 sm:pl-0 pr-2 max-h-[150px]" />

            <div className="pr-2 pb-2">
              {generating ? (
                <button className="w-9 h-9 sm:w-8 sm:h-8 rounded-lg bg-red text-white flex items-center justify-center"><StopIcon size={14} /></button>
              ) : (
                <button onClick={() => send()} disabled={!input.trim() && attachments.length === 0}
                  className={`w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-colors ${input.trim() || attachments.length > 0 ? "bg-violet-500 text-white hover:bg-violet-600 active:scale-95" : "bg-line text-ink-4 cursor-not-allowed"}`}>
                  <SendIcon size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Mobile icon row */}
          <div className="sm:hidden flex items-center gap-1 px-2 py-1.5 border-t border-line">
            <button onClick={toggleRecording} className={`p-2.5 rounded-lg transition-colors ${recording ? "text-red animate-pulse" : "text-ink-3 active:text-violet-500"}`}>
              <MicIcon size={20} />
            </button>
            <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-lg text-ink-3 active:text-violet-500 transition-colors">
              <PaperclipIcon size={20} />
            </button>
            <button onClick={() => imgRef.current?.click()} className="p-2.5 rounded-lg text-ink-3 active:text-violet-500 transition-colors">
              <ImageIcon size={20} />
            </button>
          </div>
        </div>

        {/* Status bar */}
        {health && (
          <div className="max-w-[680px] mx-auto mt-2 text-center text-[11px] text-ink-4 font-mono">
            {health.model?.replace(".gguf", "") ?? "no model"}
            <span className="text-ink-5 mx-1.5">&middot;</span>
            {health.rag_chunks} docs
            <span className="text-ink-5 mx-1.5">&middot;</span>
            {messages.filter((m) => m.role === "user").length} turns
            <span className="text-ink-5 mx-1.5">&middot;</span>
            cache: {health.cache_entries}
          </div>
        )}

        <input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.py,.json,.csv,.yaml,.yml" onChange={handleFile} />
        <input ref={imgRef} type="file" className="hidden" accept="image/*" onChange={handleImage} />
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} health={health} />

      <style jsx>{`
        .animate-in { animation: slideIn 0.2s ease-out; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
