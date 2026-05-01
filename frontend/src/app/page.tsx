"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "@/lib/api";
import { Message, Attachment, HealthStatus, Section } from "@/lib/types";
import {
  MicIcon, PaperclipIcon, ImageIcon, SendIcon, StopIcon,
  CopyIcon, RefreshIcon, SpeakerIcon, GearIcon, XIcon,
  FileIcon, PlayIcon, PauseIcon, LogoutIcon, ClockIcon,
} from "@/lib/icons";
import AuthPage from "@/components/AuthPage";

/* ─── Helpers ─── */
function uid() { return Math.random().toString(36).slice(2, 10); }
function fmtTime(t: number) { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

const SECTION_EVERY = 4;

/* ═══════════════════════════════════════════════════════════ */

function ToolResult({ result }: { result: string }) {
  return <div className="rounded-xl px-4 py-3 text-[13px] font-mono text-ink-2 my-3 border-l-[3px] border-violet-400" style={{ background: "rgba(123,63,238,0.04)" }}>{result}</div>;
}

function RAGChip({ source }: { source: string }) {
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-violet-600 border border-violet-200/60" style={{ background: "rgba(123,63,238,0.04)" }}><FileIcon size={10} /> {source}</span>;
}

function AudioPlayer({ blob }: { blob: Blob }) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob); const a = new Audio(url); audioRef.current = a;
    a.addEventListener("timeupdate", () => { if (a.duration) setProgress(a.currentTime / a.duration); });
    a.addEventListener("ended", () => { setPlaying(false); setProgress(0); });
    return () => { a.pause(); URL.revokeObjectURL(url); };
  }, [blob]);
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3 mt-3" style={{ background: "rgba(123,63,238,0.04)" }}>
      <button onClick={() => { if (!audioRef.current) return; playing ? audioRef.current.pause() : audioRef.current.play(); setPlaying(!playing); }}
        className="w-8 h-8 rounded-full bg-violet-500 text-white flex items-center justify-center hover:bg-violet-600 transition-colors shrink-0 shadow-sm">
        {playing ? <PauseIcon size={10} /> : <PlayIcon size={10} />}
      </button>
      <div className="flex-1 h-[3px] bg-violet-100 rounded-full overflow-hidden"><div className="h-full bg-violet-400 rounded-full transition-all duration-100" style={{ width: `${progress * 100}%` }} /></div>
    </div>
  );
}

/* ─── Section Divider (inline in conversation) ─── */
function SectionDivider({ section }: { section: Section }) {
  return (
    <div className="py-6 anim-fade-in">
      <div className="flex items-center gap-4">
        <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(123,63,238,0.12), transparent)" }} />
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-full"
          style={{ background: "rgba(123,63,238,0.04)", backdropFilter: "blur(8px)" }}>
          <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          <span className="text-[12px] font-semibold text-ink-2 tracking-wide">{section.title}</span>
          <span className="text-[10px] text-ink-4 flex items-center gap-1"><ClockIcon size={9} />{fmtTime(section.timestamp)}</span>
        </div>
        <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(123,63,238,0.12), transparent)" }} />
      </div>
    </div>
  );
}

/* ─── User Message ─── */
function UserMessage({ msg, onRerun }: { msg: Message; onRerun: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="anim-fade-up group">
      <div className="flex items-start justify-end gap-3">
        <div className="max-w-[85%] sm:max-w-[70%]">
          {msg.attachments?.map((a, i) => (
            <div key={i} className="flex justify-end mb-2">
              {a.type === "image" && a.url && <img src={a.url} alt={a.name} className="w-20 h-20 rounded-2xl object-cover shadow-soft" />}
              {a.type === "file" && <span className="inline-flex items-center gap-1.5 bg-white/60 rounded-xl px-3 py-2 text-[12px] text-ink-3 shadow-soft"><FileIcon size={13} /> {a.name}</span>}
            </div>
          ))}
          <p className="text-[15px] sm:text-[14px] text-ink font-medium leading-[1.7] whitespace-pre-wrap text-right">{msg.text}</p>
          <div className="flex items-center justify-end gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => { navigator.clipboard.writeText(msg.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="p-1 rounded-md text-ink-4 hover:text-violet-500 transition-colors">{copied ? <span className="text-[10px] text-emerald-500 font-medium px-1">Copied</span> : <CopyIcon size={12} />}</button>
            <button onClick={onRerun} className="p-1 rounded-md text-ink-4 hover:text-violet-500 transition-colors"><RefreshIcon size={12} /></button>
            <span className="text-[10px] text-ink-4 ml-1">{fmtTime(msg.timestamp)}</span>
          </div>
        </div>
        <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 hidden sm:flex items-center justify-center text-[11px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #7B3FEE, #A855F7)" }}>U</div>
      </div>
    </div>
  );
}

/* ─── AI Response ─── */
function AIResponse({ msg, onRerun }: { msg: Message; onRerun: () => void }) {
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="anim-fade-up group">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg shrink-0 mt-0.5 hidden sm:block"
          style={{ background: "linear-gradient(135deg, #7B3FEE, #E832B8)", boxShadow: "0 2px 8px rgba(123,63,238,0.15)" }} />
        <div className="flex-1 min-w-0 max-w-[90%] sm:max-w-[80%]">
          {msg.cached && <div className="mb-2"><span className="text-[10px] font-semibold text-amber bg-amber-bg px-2 py-0.5 rounded-full">INSTANT</span></div>}
          <div className="relative pl-4 border-l-2 border-violet-200/60">
            <p className="text-[15px] sm:text-[14px] text-ink-2 leading-[1.85] whitespace-pre-wrap">{msg.text}</p>
            {msg.toolResult && <ToolResult result={msg.toolResult} />}
            {msg.ragSources && msg.ragSources.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{msg.ragSources.map((s, i) => <RAGChip key={i} source={s} />)}</div>}
            {audioBlob && <AudioPlayer blob={audioBlob} />}
          </div>
          <div className="flex items-center justify-between mt-2 pl-4">
            {msg.tokens != null && <span className="text-[10px] text-ink-4/50 font-mono tracking-wider">{msg.tokens} tok{msg.tps != null && <><span className="mx-1">/</span>{msg.tps.toFixed(1)} t/s</>}{msg.ttft != null && <><span className="mx-1">/</span>{msg.ttft.toFixed(2)}s</>}</span>}
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => { navigator.clipboard.writeText(msg.text); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="p-1 rounded-md text-ink-4 hover:text-violet-500 transition-colors">{copied ? <span className="text-[10px] text-emerald-500 font-medium px-1">Copied</span> : <CopyIcon size={12} />}</button>
              <button onClick={onRerun} className="p-1 rounded-md text-ink-4 hover:text-violet-500 transition-colors"><RefreshIcon size={12} /></button>
              <button onClick={async () => { try { setAudioBlob(await api.speak(msg.text)); } catch {} }} className="p-1 rounded-md text-ink-4 hover:text-violet-500 transition-colors"><SpeakerIcon size={12} /></button>
              <span className="text-[10px] text-ink-4 ml-1">{fmtTime(msg.timestamp)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Thinking ─── */
function ThinkingIndicator() {
  return (
    <div className="anim-fade-up">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg shrink-0 mt-0.5 hidden sm:block" style={{ background: "linear-gradient(135deg, #7B3FEE, #E832B8)" }} />
        <div className="pl-4 border-l-2 border-violet-200/60 py-1">
          <div className="flex items-center gap-2">
            {[0,1,2].map(i => <span key={i} className="w-2 h-2 rounded-full bg-violet-400" style={{ animation: `dotPulse 1.4s ease-in-out ${i*0.15}s infinite` }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Empty State ─── */
function EmptyState({ onSuggestion }: { onSuggestion: (t: string) => void }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6 py-16">
      <div className="text-center max-w-lg w-full">
        <div className="relative inline-block mb-10 anim-fade-up">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-[18px] relative z-10 mx-auto" style={{ background: "linear-gradient(135deg, #7B3FEE 0%, #A855F7 40%, #E832B8 100%)", boxShadow: "0 8px 40px rgba(123,63,238,0.25)" }} />
          <div className="absolute inset-0 rounded-[18px] mx-auto anim-glow" style={{ background: "linear-gradient(135deg, #7B3FEE, #E832B8)", filter: "blur(24px)", opacity: 0.2 }} />
        </div>
        <h2 className="font-bold text-ink mb-3 anim-fade-up delay-1" style={{ fontSize: "clamp(22px, 4vw, 32px)", letterSpacing: "-0.03em" }}>What&apos;s on your mind?</h2>
        <p className="text-ink-3 mb-12 anim-fade-up delay-2 mx-auto max-w-[300px]" style={{ fontSize: "clamp(14px, 2vw, 16px)", lineHeight: 1.6 }}>Ask anything. I&apos;ll classify, reason, and create — all on your CPU.</p>
        <div className="space-y-3 max-w-[400px] mx-auto">
          {["Analyse the sentiment of a customer review", "Who built EdgeWord and what can it do?", "Calculate 256 times 128 plus 42"].map((s, i) => (
            <button key={i} onClick={() => onSuggestion(s)} className={`w-full text-left bg-white/70 backdrop-blur-sm rounded-2xl px-5 py-4 text-[14px] text-ink-3 hover:text-ink hover:bg-white transition-all duration-200 shadow-soft hover:shadow-medium active:scale-[0.98] anim-fade-up delay-${i+3}`}>{s}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Settings Panel ─── */
function SettingsPanel({ open, onClose, health, onLogout }: { open: boolean; onClose: () => void; health: HealthStatus | null; onLogout: () => void }) {
  const [maxTokens, setMaxTokens] = useState(256);
  const [temperature, setTemperature] = useState(0.7);
  useEffect(() => { if (!open) return; setMaxTokens(Number(localStorage.getItem("edgeword_max_tokens")||"256")); setTemperature(Number(localStorage.getItem("edgeword_temperature")||"0.7")); }, [open]);
  const save = (k: string, v: string) => localStorage.setItem(k, v);
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/15 backdrop-blur-sm z-30 anim-fade-in" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[400px] z-40 rounded-t-[24px] sm:rounded-none max-h-[85vh] sm:max-h-none overflow-y-auto scrollbar-hide anim-slide-up sm:anim-fade-in"
        style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(24px)", borderLeft: "1px solid rgba(229,225,240,0.5)" }}>
        <div className="sm:hidden flex justify-center pt-3"><div className="w-10 h-1 bg-ink-5 rounded-full" /></div>
        <div className="px-7 py-6 sm:py-8">
          <div className="flex items-center justify-between mb-10">
            <h2 className="text-[18px] font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>Settings</h2>
            <button onClick={onClose} className="p-2 text-ink-4 hover:text-ink rounded-xl hover:bg-white transition-colors"><XIcon size={16} /></button>
          </div>
          <label className="text-[11px] font-semibold text-ink-4 uppercase tracking-[0.12em] block mb-5">Generation</label>
          <div className="space-y-6 mb-10">
            <div>
              <div className="flex justify-between mb-2"><span className="text-[13px] text-ink-2">Max tokens</span><span className="text-[13px] font-mono text-violet-500 font-semibold">{maxTokens}</span></div>
              <input type="range" min="64" max="1024" step="64" value={maxTokens} onChange={e => { setMaxTokens(Number(e.target.value)); save("edgeword_max_tokens", e.target.value); api.saveSettings({ max_tokens: Number(e.target.value), temperature }); }}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-violet-500" style={{ background: `linear-gradient(to right, #7B3FEE ${maxTokens/10.24}%, #E5E1F0 ${maxTokens/10.24}%)` }} />
            </div>
            <div>
              <div className="flex justify-between mb-2"><span className="text-[13px] text-ink-2">Temperature</span><span className="text-[13px] font-mono text-violet-500 font-semibold">{temperature.toFixed(1)}</span></div>
              <input type="range" min="0" max="1.5" step="0.1" value={temperature} onChange={e => { setTemperature(Number(e.target.value)); save("edgeword_temperature", e.target.value); api.saveSettings({ max_tokens: maxTokens, temperature: Number(e.target.value) }); }}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-violet-500" style={{ background: `linear-gradient(to right, #7B3FEE ${temperature/1.5*100}%, #E5E1F0 ${temperature/1.5*100}%)` }} />
            </div>
          </div>
          {health && (
            <><label className="text-[11px] font-semibold text-ink-4 uppercase tracking-[0.12em] block mb-5">System</label>
            <div className="bg-white rounded-2xl p-5 mb-10 shadow-soft space-y-3">
              {[["Model",health.model?.replace(".gguf","").replace("Llama-3.2-1B-Instruct-Q4_K_M","Llama 3.2 1B")||"—"],["Fast-Path",health.fast_path?"Ready":"Off"],["Compute-Path",health.compute_path?"Ready":"Off"],["RAG",`${health.rag_chunks} chunks`],["Cache",`${health.cache_entries} entries`]].map(([k,v]) => (
                <div key={k} className="flex justify-between"><span className="text-[13px] text-ink-3">{k}</span><span className={`text-[13px] font-medium ${v==="Ready"?"text-emerald-500":v==="Off"?"text-ink-4":"text-ink"}`}>{v}</span></div>
              ))}
            </div></>
          )}
          <div className="space-y-3">
            <button onClick={async () => { await api.clearConversation(); await api.clearSession(); onClose(); location.reload(); }} className="w-full py-3.5 text-[14px] font-medium text-ink-3 bg-white rounded-2xl shadow-soft hover:shadow-medium transition-all text-center">Clear conversation</button>
            <button onClick={() => { api.logout(); onLogout(); }} className="w-full py-3.5 text-[14px] font-medium text-rose-500 bg-white rounded-2xl shadow-soft hover:shadow-medium transition-all text-center">Sign out</button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════ */
export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [lastSummarized, setLastSummarized] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setAuthed(api.isLoggedIn()); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, generating]);
  useEffect(() => { if (!authed) return; const poll = () => api.health().then(setHealth).catch(() => {}); poll(); const iv = setInterval(poll, 30000); return () => clearInterval(iv); }, [authed]);
  useEffect(() => { if (!textareaRef.current) return; textareaRef.current.style.height = "auto"; textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px"; }, [input]);

  // Load persisted conversation on auth
  useEffect(() => {
    if (!authed) return;
    api.loadConversation().then(data => {
      if (!data) return;
      if (data.messages?.length) { setMessages(data.messages); setLastSummarized(data.messages.length); }
      if (data.sections?.length) setSections(data.sections);
      if (data.settings) {
        localStorage.setItem("edgeword_max_tokens", String(data.settings.max_tokens || 256));
        localStorage.setItem("edgeword_temperature", String(data.settings.temperature || 0.7));
      }
    }).catch(() => {});
  }, [authed]);

  // Auto-summarize
  useEffect(() => {
    if (messages.length === 0 || generating) return;
    if (messages.length - lastSummarized < SECTION_EVERY) return;
    const startIdx = lastSummarized;
    const chunk = messages.slice(startIdx, messages.length);
    const text = chunk.map(m => `${m.role === "user" ? "User" : "AI"}: ${m.text}`).join("\n");
    setLastSummarized(messages.length);
    api.summarize(text).then(title => {
      const sec = { id: uid(), title, timestamp: chunk[0].timestamp, messageIndex: startIdx, messageCount: chunk.length };
      setSections(prev => [...prev, sec]);
      api.saveSection(sec);
    });
  }, [messages, generating, lastSummarized]);

  const send = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg && !attachments.length) return;
    if (generating) return;
    const userMsg: Message = { id: uid(), role: "user", text: msg, timestamp: Date.now(), attachments: attachments.length ? [...attachments] : undefined };
    setMessages(p => [...p, userMsg]); setInput(""); setAttachments([]); setGenerating(true);
    api.saveMessage(userMsg);
    try {
      const imgAtt = userMsg.attachments?.find(a => a.type === "image");
      if (imgAtt) {
        const r = await api.ocrChat(imgAtt.file, msg || "What does this image say?");
        const aiMsg = { id: uid(), role: "assistant" as const, text: r.response, tokens: r.tokens, totalS: r.total_s, toolResult: r.ocr ? `[OCR] ${r.ocr.text}` : undefined, timestamp: Date.now() };
        setMessages(p => [...p, aiMsg]);
        api.saveMessage(aiMsg);
      } else {
        const r = await api.chat(msg, { maxTokens: Number(localStorage.getItem("edgeword_max_tokens")||"256"), temperature: Number(localStorage.getItem("edgeword_temperature")||"0.7") });
        const aiMsg = { id: uid(), role: "assistant" as const, text: r.response, sentiment: r.sentiment, ragSources: r.rag_sources.length ? r.rag_sources : undefined, toolResult: r.tool_result||undefined, tokens: r.tokens, tps: r.tps, ttft: r.ttft_s, totalS: r.total_s, cached: r.cached, timestamp: Date.now() };
        setMessages(p => [...p, aiMsg]);
        api.saveMessage(aiMsg);
      }
    } catch (err: any) { setMessages(p => [...p, { id: uid(), role: "assistant", text: `Error: ${err.message}`, timestamp: Date.now() }]); }
    finally { setGenerating(false); }
  }, [input, attachments, generating]);

  const toggleRecording = async () => {
    if (recording) { mediaRecRef.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); const chunks: Blob[] = [];
      rec.ondataavailable = e => chunks.push(e.data);
      rec.onstop = async () => { stream.getTracks().forEach(t => t.stop()); try { const r = await api.transcribe(new File([new Blob(chunks, { type: "audio/webm" })], "r.webm", { type: "audio/webm" })); if (r.text) setInput(p => p + (p ? " " : "") + r.text); } catch {} };
      rec.start(); mediaRecRef.current = rec; setRecording(true);
    } catch {}
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => { if (!e.target.files) return; Array.from(e.target.files).forEach(f => setAttachments(p => [...p, { type: "file", name: f.name, size: f.size, file: f }])); e.target.value = ""; };
  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => { if (!e.target.files) return; Array.from(e.target.files).forEach(f => setAttachments(p => [...p, { type: "image", name: f.name, size: f.size, url: URL.createObjectURL(f), file: f }])); e.target.value = ""; };
  const removeAttachment = (i: number) => { setAttachments(p => { if (p[i].url) URL.revokeObjectURL(p[i].url!); return p.filter((_, j) => j !== i); }); };
  const canSend = input.trim() || attachments.length > 0;

  if (!authed) return <AuthPage onAuth={() => setAuthed(true)} />;

  return (
    <div className="h-dvh flex flex-col" style={{ background: "linear-gradient(170deg, #FDFBFF 0%, #F8F5FF 40%, #FFFAFD 100%)" }}>

      {/* Header */}
      <header className="h-14 px-5 sm:px-7 sticky top-0 z-10 flex items-center justify-between shrink-0"
        style={{ background: "rgba(253,251,255,0.7)", backdropFilter: "blur(20px)" }}>
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-[8px]" style={{ background: "linear-gradient(135deg, #7B3FEE, #A855F7)", boxShadow: "0 2px 8px rgba(123,63,238,0.2)" }} />
          <span className="hidden sm:block text-[16px] font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>EdgeWord</span>
        </div>
        <div className="flex items-center gap-1">
          {health && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-500 mr-3">
              <span className="w-[6px] h-[6px] rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px rgba(16,185,129,0.4)" }} />
              <span className="hidden sm:inline">Online</span>
            </span>
          )}
          <button onClick={() => location.reload()} title="Refresh" className="p-2.5 text-ink-4 hover:text-violet-500 rounded-xl hover:bg-white/60 transition-all"><RefreshIcon size={15} /></button>
          <button onClick={() => setSettingsOpen(true)} title="Settings" className="p-2.5 text-ink-4 hover:text-violet-500 rounded-xl hover:bg-white/60 transition-all"><GearIcon size={15} /></button>
          <button onClick={() => { api.logout(); setAuthed(false); }} title="Sign out" className="p-2.5 text-ink-4 hover:text-rose-500 rounded-xl hover:bg-rose-50/60 transition-all"><LogoutIcon size={15} /></button>
        </div>
      </header>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide">
        {messages.length === 0 && !generating ? (
          <EmptyState onSuggestion={t => send(t)} />
        ) : (
          <div className="max-w-[760px] mx-auto px-4 sm:px-6 py-6 space-y-5">
            {messages.map((m, i) => {
              const section = sections.find(s => s.messageIndex === i);
              return (
                <div key={m.id}>
                  {section && <SectionDivider section={section} />}
                  {m.role === "user"
                    ? <UserMessage msg={m} onRerun={() => send(m.text)} />
                    : <AIResponse msg={m} onRerun={() => { const p = messages[i-1]; if (p) send(p.text); }} />
                  }
                </div>
              );
            })}
            {generating && <ThinkingIndicator />}
          </div>
        )}
      </div>

      {/* Prompt Bar */}
      <div className="sticky bottom-0 px-4 sm:px-6 pb-4 sm:pb-6 pt-4 pb-safe"
        style={{ background: "linear-gradient(to top, rgba(253,251,255,1) 50%, transparent)" }}>
        <div className="max-w-[760px] mx-auto">
          <div className="rounded-[24px] overflow-hidden shadow-elevated transition-shadow duration-300 hover:shadow-violet"
            style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(20px)", border: "1px solid rgba(229,225,240,0.6)" }}>
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-5 pt-4 anim-fade-up">
                {attachments.map((a, i) => (
                  <div key={i} className="relative group">
                    {a.type === "image" && a.url ? <img src={a.url} alt={a.name} className="w-14 h-14 rounded-xl object-cover shadow-soft" /> : <span className="inline-flex items-center gap-1.5 bg-bg-2/50 rounded-xl px-3 py-2 text-[11px] text-ink-3"><FileIcon size={12} />{a.name}</span>}
                    <button onClick={() => removeAttachment(i)} className="absolute -top-1 -right-1 w-4 h-4 bg-ink-2 text-white rounded-full flex items-center justify-center hover:bg-ink transition-colors"><XIcon size={8} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-end">
              <div className="hidden sm:flex items-center gap-0.5 pl-4 pb-3.5">
                <button onClick={toggleRecording} className={`p-2.5 rounded-xl transition-all ${recording ? "text-rose-500 bg-rose-50" : "text-ink-4 hover:text-violet-500 hover:bg-violet-50"}`}><MicIcon size={18} /></button>
                <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-xl text-ink-4 hover:text-violet-500 hover:bg-violet-50 transition-all"><PaperclipIcon size={18} /></button>
                <button onClick={() => imgRef.current?.click()} className="p-2.5 rounded-xl text-ink-4 hover:text-violet-500 hover:bg-violet-50 transition-all"><ImageIcon size={18} /></button>
              </div>
              <textarea ref={textareaRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask me anything..." rows={1}
                className="flex-1 text-[16px] sm:text-[15px] text-ink resize-none border-none outline-none bg-transparent py-4 pl-5 sm:pl-2 pr-2 max-h-[160px] placeholder:text-ink-4/60" />
              <div className="pr-4 pb-3.5">
                {generating
                  ? <button className="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center shadow-sm"><StopIcon size={14} /></button>
                  : <button onClick={() => send()} disabled={!canSend} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${canSend ? "text-white active:scale-90" : "bg-transparent text-ink-4"}`}
                      style={canSend ? { background: "linear-gradient(135deg, #7B3FEE, #A855F7)", boxShadow: "0 2px 12px rgba(123,63,238,0.3)" } : {}}>
                      <SendIcon size={16} />
                    </button>
                }
              </div>
            </div>
            <div className="sm:hidden flex items-center gap-0.5 px-4 pb-2.5">
              <button onClick={toggleRecording} className={`p-2.5 rounded-xl transition-all ${recording ? "text-rose-500 bg-rose-50" : "text-ink-4 active:text-violet-500"}`}><MicIcon size={20} /></button>
              <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-xl text-ink-4 active:text-violet-500"><PaperclipIcon size={20} /></button>
              <button onClick={() => imgRef.current?.click()} className="p-2.5 rounded-xl text-ink-4 active:text-violet-500"><ImageIcon size={20} /></button>
            </div>
          </div>
          {health && (
            <div className="mt-3 text-center text-[11px] text-ink-4/60 font-mono tracking-wider">
              {health.model?.replace(".gguf","").replace("Llama-3.2-1B-Instruct-Q4_K_M","Llama 3.2 1B")}
              <span className="mx-2 text-ink-5">&middot;</span>{messages.filter(m => m.role === "user").length} turns
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
