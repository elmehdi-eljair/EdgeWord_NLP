"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "@/lib/api";
import { Message, Attachment, HealthStatus, Section } from "@/lib/types";
import AuthPage from "@/components/AuthPage";

/* ─── Helpers ─── */
function uid() { return Math.random().toString(36).slice(2,10); }
function pad(n: number) { return String(n).padStart(3,"0"); }
function fmtTime(t: number) { return new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
const SECTION_EVERY = 4;

/* ═══════════════════════════════════════════════════════
   COMPONENTS — all following edgeword-design-spec.txt
   ═══════════════════════════════════════════════════════ */

/* ─── Corner Tag ─── */
function CornerTag({ label, color }: { label: string; color: string }) {
  return (
    <div style={{ position:"absolute",top:-1,left:24,background:"var(--bg)",padding:"5px 10px",border:"1px solid var(--line)",borderTop:0,borderRadius:"0 0 8px 8px",fontFamily:"var(--mono)",fontSize:9,letterSpacing:".12em",textTransform:"uppercase",color:"var(--text-2)",display:"flex",alignItems:"center",gap:8 }}>
      <span style={{ width:5,height:5,borderRadius:"50%",background:color,boxShadow:`0 0 8px ${color}` }} />
      {label}
    </div>
  );
}

/* ─── User Message ─── */
function UserMsg({ msg, idx }: { msg: Message; idx: number }) {
  return (
    <article style={{ marginBottom:28,animation:"land .6s var(--spring) both" }}>
      <div style={{ position:"relative",padding:"28px 26px 24px",background:"var(--user-card-bg)",border:`1px solid var(--user-border)`,borderRadius:22,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",transition:"transform .4s var(--ease),border-color .3s var(--ease),box-shadow .4s var(--ease)",boxShadow:"var(--card-shadow)",cursor:"default" }}
        onMouseEnter={e=>(e.currentTarget.style.transform="translateY(-2px)",e.currentTarget.style.borderColor="var(--user-hover-border)",e.currentTarget.style.boxShadow="var(--user-hover-shadow)")}
        onMouseLeave={e=>(e.currentTarget.style.transform="",e.currentTarget.style.borderColor="var(--user-border)",e.currentTarget.style.boxShadow="var(--card-shadow)")}>
        <CornerTag label={`USR_${pad(idx+1)} · YOU`} color="var(--lime)" />
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,marginTop:6 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,fontFamily:"var(--sans)",fontWeight:600,fontSize:14,letterSpacing:"-.01em",color:"var(--ink)" }}>
            You
            <span style={{ fontFamily:"var(--mono)",fontSize:8.5,fontWeight:500,letterSpacing:".1em",padding:"3px 6px",borderRadius:4,textTransform:"uppercase",background:"var(--ink)",color:"var(--lime-bright)" }}>Founder</span>
          </div>
          <span style={{ fontFamily:"var(--mono)",fontSize:10,color:"var(--text-3)",letterSpacing:".06em" }}>{fmtTime(msg.timestamp)}</span>
        </div>
        <div style={{ fontFamily:"var(--sans)",fontSize:16,lineHeight:1.6,color:"var(--ink)",fontWeight:400,letterSpacing:"-.005em" }}>
          {msg.text.split("\n").map((p,i)=><p key={i} style={{marginBottom:p?".85em":0}}>{p}</p>)}
        </div>
      </div>
    </article>
  );
}

/* ─── Assistant Message ─── */
function AsstMsg({ msg, idx }: { msg: Message; idx: number }) {
  return (
    <article style={{ marginBottom:28,animation:"land .6s var(--spring) both" }}>
      <div style={{ position:"relative",padding:"28px 26px 24px",background:"var(--asst-card-bg)",border:`1px solid var(--asst-border)`,borderRadius:22,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",transition:"transform .4s var(--ease),border-color .3s var(--ease),box-shadow .4s var(--ease)",boxShadow:"var(--card-shadow)",cursor:"default" }}
        onMouseEnter={e=>(e.currentTarget.style.transform="translateY(-2px)",e.currentTarget.style.borderColor="var(--asst-hover-border)",e.currentTarget.style.boxShadow="var(--asst-hover-shadow)")}
        onMouseLeave={e=>(e.currentTarget.style.transform="",e.currentTarget.style.borderColor="var(--asst-border)",e.currentTarget.style.boxShadow="var(--card-shadow)")}>
        <CornerTag label={`EDW_${pad(idx+1)} · EDGEWORD`} color="var(--violet)" />
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,marginTop:6 }}>
          <div style={{ display:"flex",alignItems:"center",gap:10,fontFamily:"var(--sans)",fontWeight:600,fontSize:14,letterSpacing:"-.01em",color:"var(--ink)" }}>
            EdgeWord
            <span style={{ fontFamily:"var(--mono)",fontSize:8.5,fontWeight:500,letterSpacing:".1em",padding:"3px 6px",borderRadius:4,textTransform:"uppercase",background:"var(--violet)",color:"#fff" }}>Llama 1B</span>
          </div>
          <span style={{ fontFamily:"var(--mono)",fontSize:10,color:"var(--text-3)",letterSpacing:".06em" }}>{fmtTime(msg.timestamp)}</span>
        </div>
        <div style={{ fontFamily:"var(--sans)",fontSize:16,lineHeight:1.6,color:"var(--ink)",fontWeight:400,letterSpacing:"-.005em" }}>
          {msg.text.split("\n").map((p,i)=><p key={i} style={{marginBottom:p?".85em":0}}>{p}</p>)}
        </div>
        {msg.toolResult && (
          <div style={{ marginTop:10,background:"transparent",border:"1px dashed var(--line-2)",borderRadius:14,padding:"14px 20px",fontFamily:"var(--serif)",fontStyle:"italic",fontSize:14.5,color:"var(--text-2)" }}>{msg.toolResult}</div>
        )}
        {msg.ragSources && msg.ragSources.length > 0 && (
          <div style={{ display:"flex",flexWrap:"wrap",gap:6,marginTop:10 }}>
            {msg.ragSources.map((s,i)=>(<span key={i} style={{ display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",background:"var(--surface-2)",border:"1px solid var(--line)",borderRadius:6,fontFamily:"var(--mono)",fontSize:10.5,letterSpacing:".04em",color:"var(--ink)" }}>{s}</span>))}
          </div>
        )}
        {msg.tokens != null && (
          <div style={{ marginTop:12,fontFamily:"var(--mono)",fontSize:9.5,color:"var(--text-3)",letterSpacing:".04em" }}>
            {msg.tokens} tok{msg.tps != null && ` · ${msg.tps.toFixed(1)} t/s`}{msg.ttft != null && ` · ${msg.ttft.toFixed(2)}s TTFT`}
          </div>
        )}
      </div>
    </article>
  );
}

/* ─── Thinking ─── */
function Thinking({ idx }: { idx: number }) {
  return (
    <article style={{ marginBottom:28,animation:"land .6s var(--spring) both" }}>
      <div style={{ position:"relative",padding:"28px 26px 24px",background:"var(--asst-card-bg)",border:"1px solid var(--asst-border)",borderRadius:22,backdropFilter:"blur(20px)",overflow:"hidden" }}>
        <CornerTag label={`EDW_${pad(idx+1)} · GENERATING`} color="var(--violet)" />
        {/* Shimmer */}
        <div style={{ position:"absolute",inset:0,borderRadius:22,background:"linear-gradient(120deg,transparent 30%,rgba(98,68,232,.16) 50%,transparent 70%)",backgroundSize:"200% 100%",animation:"shimmer 2s linear infinite",pointerEvents:"none" }} />
        <div style={{ display:"flex",alignItems:"center",gap:5,marginTop:6 }}>
          {[0,1,2].map(i=><span key={i} style={{ width:7,height:7,borderRadius:"50%",background:"var(--violet)",animation:`bob 1s ease-in-out ${i*.15}s infinite`,boxShadow:"0 0 8px var(--violet)" }} />)}
          <span style={{ marginLeft:10,color:"var(--text-2)",fontFamily:"var(--mono)",fontSize:12,letterSpacing:".06em" }}>thinking</span>
        </div>
      </div>
    </article>
  );
}

/* ─── Section Divider ─── */
function SumDivider({ section }: { section: Section }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:14,margin:"8px 0 28px",fontFamily:"var(--mono)",fontSize:9.5,letterSpacing:".16em",textTransform:"uppercase",color:"var(--text-3)" }}>
      <span style={{ width:5,height:5,borderRadius:"50%",background:"var(--violet)",boxShadow:"0 0 8px var(--violet)" }} />
      {section.title}
      <span style={{ flex:"1 1 auto",height:1,background:"var(--line)" }} />
    </div>
  );
}

/* ─── Settings Overlay ─── */
function SettingsSheet({ open, onClose, health, onLogout, initialTab }: { open: boolean; onClose:()=>void; health: HealthStatus|null; onLogout:()=>void; initialTab?:string }) {
  const [tab, setTab] = useState(initialTab || "profile");
  const [maxT, setMaxT] = useState(256);
  const [temp, setTemp] = useState(0.7);
  const [profile, setProfile] = useState<any>({});
  const [docs, setDocs] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState("");
  const knowledgeFileRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{
    if(!open) return;
    setTab(initialTab || "profile");
    setMaxT(Number(localStorage.getItem("edgeword_max_tokens")||"256"));
    setTemp(Number(localStorage.getItem("edgeword_temperature")||"0.7"));
    setCreatedKey("");
    api.getProfile().then(setProfile).catch(()=>{});
    api.listKnowledge().then(d=>setDocs(d.documents||[])).catch(()=>{});
    api.listApiKeys().then(d=>setKeys(d.keys||[])).catch(()=>{});
  },[open, initialTab]);

  if (!open) return null;

  const saveProfile = (field:string, value:string) => {
    setProfile((p:any)=>({...p,[field]:value}));
    api.updateProfile({[field]:value});
    if(field==="theme"){ document.documentElement.setAttribute("data-theme",value); localStorage.setItem("edgeword.theme",value); }
  };

  const handleDocUpload = async(e:React.ChangeEvent<HTMLInputElement>) => {
    if(!e.target.files) return;
    for(const f of Array.from(e.target.files)){
      await api.uploadKnowledge(f);
    }
    api.listKnowledge().then(d=>setDocs(d.documents||[]));
    e.target.value="";
  };

  const tabs = [{id:"profile",label:"Profile",num:"01"},{id:"knowledge",label:"Knowledge",num:"02"},{id:"model",label:"Model",num:"03"},{id:"keys",label:"API Keys",num:"04"}];

  return (
    <div style={{ position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"80px 32px 40px" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ position:"absolute",inset:0,background:"var(--overlay-bg)",backdropFilter:"blur(20px)",transition:"opacity .4s var(--ease)",opacity: open?1:0 }} />
      <section style={{ position:"relative",width:"100%",maxWidth:960,background:"var(--sheet-bg)",border:"1px solid var(--line-2)",borderRadius:28,padding:"36px 44px 44px",backdropFilter:"blur(24px) saturate(1.1)",boxShadow:"0 30px 80px -20px rgba(20,18,15,.2),0 1px 0 rgba(255,255,255,.8) inset",animation:"land .55s var(--spring) both" }}>
        {/* Head */}
        <header style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:32,paddingBottom:18,borderBottom:"1px solid var(--line)" }}>
          <div style={{ display:"flex",alignItems:"baseline",gap:14 }}>
            <h2 style={{ fontFamily:"var(--sans)",fontWeight:700,fontSize:32,letterSpacing:"-.025em",color:"var(--ink)" }}>
              Settings <span style={{ background:"linear-gradient(135deg,var(--violet),var(--cyan))",WebkitBackgroundClip:"text",backgroundClip:"text",color:"transparent" }}>·</span>
            </h2>
            <span style={{ fontFamily:"var(--mono)",fontSize:10,letterSpacing:".14em",color:"var(--text-3)",textTransform:"uppercase",padding:"4px 8px",border:"1px solid var(--line)",borderRadius:6 }}>V.1.0</span>
          </div>
          <button onClick={onClose} style={{ display:"inline-flex",alignItems:"center",gap:8,padding:"8px 12px",background:"transparent",border:"1px solid var(--line)",borderRadius:10,cursor:"pointer",fontFamily:"var(--mono)",fontSize:10,letterSpacing:".12em",textTransform:"uppercase",color:"var(--text-2)",transition:"all .25s var(--ease)" }}>
            CLOSE
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 1l10 10M11 1L1 11"/></svg>
          </button>
        </header>

        <div style={{ display:"grid",gridTemplateColumns:"200px 1fr",gap:40 }}>
          {/* Tab list */}
          <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ textAlign:"left",background:tab===t.id?"linear-gradient(135deg,rgba(98,68,232,.10),rgba(31,184,212,.06))":"transparent",border:`1px solid ${tab===t.id?"rgba(98,68,232,.3)":"transparent"}`,cursor:"pointer",padding:"10px 14px",borderRadius:10,fontFamily:"var(--sans)",fontWeight:500,fontSize:14,color:tab===t.id?"var(--ink)":"var(--text-2)",display:"flex",justifyContent:"space-between",alignItems:"center",transition:"all .25s var(--ease)" }}>
                {t.label}
                <span style={{ fontFamily:"var(--mono)",fontSize:9.5,color:tab===t.id?"var(--violet)":"var(--text-3)",letterSpacing:".06em" }}>{t.num}</span>
              </button>
            ))}
          </div>

          {/* Tab panels */}
          <div>
            {tab === "profile" && (
              <div>
                <h3 style={{ fontFamily:"var(--sans)",fontWeight:600,fontSize:13,letterSpacing:".16em",textTransform:"uppercase",color:"var(--text-2)",marginBottom:18 }}>
                  <span style={{ color:"var(--violet)" }}>&#9656; </span>PROFILE
                </h3>
                {[{k:"Display name",field:"display_name"},{k:"Email",field:"email"},{k:"Theme",field:"theme",type:"select"},{k:"Accent",field:"accent",type:"select-accent"}].map(({k,field,type})=>(
                  <div key={k} style={{ display:"grid",gridTemplateColumns:"180px 1fr",gap:24,padding:"14px 0",borderTop:"1px solid var(--line)",alignItems:"center" }}>
                    <span style={{ fontFamily:"var(--sans)",fontSize:13,color:"var(--text-2)",fontWeight:500 }}>{k}</span>
                    <div>
                      {type==="select" ? (
                        <select value={profile.theme||"light"} style={{ width:"100%",background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:8,padding:"9px 12px",fontFamily:"var(--sans)",fontSize:14,color:"var(--ink)",outline:"none" }}
                          onChange={e=>saveProfile("theme",e.target.value)}>
                          <option value="light">Light (cream)</option>
                          <option value="dark">Dark (electric)</option>
                        </select>
                      ) : type==="select-accent" ? (
                        <select value={profile.accent||"lime-violet"} style={{ width:"100%",background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:8,padding:"9px 12px",fontFamily:"var(--sans)",fontSize:14,color:"var(--ink)",outline:"none" }}
                          onChange={e=>saveProfile("accent",e.target.value)}>
                          <option value="lime-violet">Lime / Violet</option>
                          <option value="cyan-hot">Cyan / Hot</option>
                          <option value="mono">Mono</option>
                        </select>
                      ) : (
                        <input value={profile[field]||""} onChange={e=>{setProfile((p:any)=>({...p,[field]:e.target.value}));}} onBlur={e=>saveProfile(field,e.target.value)}
                          style={{ width:"100%",background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:8,padding:"9px 12px",fontFamily:"var(--sans)",fontSize:14,color:"var(--ink)",outline:"none" }} />
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ marginTop:24 }}>
                  <button onClick={()=>{ api.logout(); onLogout(); }} style={{ padding:"10px 20px",background:"transparent",border:"1px solid var(--line)",borderRadius:10,cursor:"pointer",fontFamily:"var(--mono)",fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:"var(--hot)",transition:"all .25s var(--ease)" }}>
                    SIGN OUT
                  </button>
                </div>
              </div>
            )}

            {tab === "knowledge" && (
              <div>
                <h3 style={{ fontFamily:"var(--sans)",fontWeight:600,fontSize:13,letterSpacing:".16em",textTransform:"uppercase",color:"var(--text-2)",marginBottom:18 }}>
                  <span style={{ color:"var(--violet)" }}>&#9656; </span>KNOWLEDGE · {docs.length} DOCS
                </h3>
                <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:16 }}>
                  {docs.map((d:any)=>(
                    <div key={d.name} style={{ display:"grid",gridTemplateColumns:"1fr auto auto",gap:14,padding:"12px 14px",background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:12,alignItems:"center" }}>
                      <span style={{ fontFamily:"var(--sans)",fontWeight:500,fontSize:13,color:"var(--ink)" }}>{d.name}</span>
                      <span style={{ fontFamily:"var(--mono)",fontSize:11,color:"var(--text-3)" }}>{d.chunks} chunks</span>
                      <button onClick={async()=>{ await api.deleteKnowledge(d.name); api.listKnowledge().then(r=>setDocs(r.documents||[])); }}
                        style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:".14em",textTransform:"uppercase",color:"var(--text-2)",cursor:"pointer",background:"transparent",border:"1px solid var(--line)",padding:"4px 8px",borderRadius:6 }}>
                        DELETE
                      </button>
                    </div>
                  ))}
                  {docs.length === 0 && <p style={{ fontFamily:"var(--sans)",fontSize:13,color:"var(--text-3)" }}>No documents indexed yet.</p>}
                </div>
                <button onClick={()=>knowledgeFileRef.current?.click()}
                  style={{ padding:"10px 20px",background:"var(--surface)",border:"1px solid var(--line-2)",borderRadius:10,cursor:"pointer",fontFamily:"var(--mono)",fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:"var(--text-2)",transition:"all .25s var(--ease)" }}>
                  UPLOAD DOCUMENT
                </button>
                <input ref={knowledgeFileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml,.pdf" onChange={handleDocUpload} />
              </div>
            )}

            {tab === "model" && (
              <div>
                <h3 style={{ fontFamily:"var(--sans)",fontWeight:600,fontSize:13,letterSpacing:".16em",textTransform:"uppercase",color:"var(--text-2)",marginBottom:18 }}>
                  <span style={{ color:"var(--violet)" }}>&#9656; </span>MODEL
                </h3>
                {[["Active model", health?.model?.replace(".gguf","") || "—"],["Temperature", temp],["Max tokens", maxT]].map(([k,v])=>(
                  <div key={String(k)} style={{ display:"grid",gridTemplateColumns:"180px 1fr",gap:24,padding:"14px 0",borderTop:"1px solid var(--line)",alignItems:"center" }}>
                    <span style={{ fontFamily:"var(--sans)",fontSize:13,color:"var(--text-2)",fontWeight:500 }}>{k}</span>
                    <div>
                      {k === "Temperature" ? (
                        <input type="number" step="0.1" value={temp} onChange={e=>{ setTemp(Number(e.target.value)); localStorage.setItem("edgeword_temperature",e.target.value); api.saveSettings({max_tokens:maxT,temperature:Number(e.target.value)}); }}
                          style={{ width:120,background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:8,padding:"9px 12px",fontFamily:"var(--sans)",fontSize:14,color:"var(--ink)",outline:"none" }} />
                      ) : k === "Max tokens" ? (
                        <input type="number" value={maxT} onChange={e=>{ setMaxT(Number(e.target.value)); localStorage.setItem("edgeword_max_tokens",e.target.value); api.saveSettings({max_tokens:Number(e.target.value),temperature:temp}); }}
                          style={{ width:120,background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:8,padding:"9px 12px",fontFamily:"var(--sans)",fontSize:14,color:"var(--ink)",outline:"none" }} />
                      ) : (
                        <span style={{ fontFamily:"var(--mono)",fontSize:12,color:"var(--text-2)" }}>{v}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "keys" && (
              <div>
                <h3 style={{ fontFamily:"var(--sans)",fontWeight:600,fontSize:13,letterSpacing:".16em",textTransform:"uppercase",color:"var(--text-2)",marginBottom:18 }}>
                  <span style={{ color:"var(--violet)" }}>&#9656; </span>API KEYS · {keys.filter((k:any)=>k.is_active).length} ACTIVE
                </h3>
                <div style={{ display:"flex",flexDirection:"column",gap:8,marginBottom:16 }}>
                  {keys.map((k:any)=>(
                    <div key={k.id} style={{ display:"grid",gridTemplateColumns:"auto 1fr 1fr auto",gap:14,padding:"12px 14px",background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:12,alignItems:"center" }}>
                      <span style={{ width:8,height:8,borderRadius:"50%",background:k.is_active?"var(--lime)":"var(--text-3)",boxShadow:k.is_active?"0 0 10px var(--lime)":"none" }} />
                      <span style={{ fontFamily:"var(--sans)",fontWeight:500,fontSize:13,color:"var(--ink)" }}>{k.name}</span>
                      <span style={{ fontFamily:"var(--mono)",fontSize:11,color:"var(--text-2)",letterSpacing:".02em" }}>{k.key_prefix} · {k.total_requests} req</span>
                      {k.is_active && (
                        <button onClick={async()=>{ await api.revokeApiKey(k.key_prefix); api.listApiKeys().then(r=>setKeys(r.keys||[])); }}
                          style={{ fontFamily:"var(--mono)",fontSize:9,letterSpacing:".14em",textTransform:"uppercase",color:"var(--text-2)",cursor:"pointer",background:"transparent",border:"1px solid var(--line)",padding:"6px 10px",borderRadius:6,transition:"all .2s var(--ease)" }}>
                          REVOKE
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {/* Create new key */}
                <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                  <input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Key name"
                    style={{ flex:1,background:"var(--card-bg)",border:"1px solid var(--line)",borderRadius:8,padding:"9px 12px",fontFamily:"var(--sans)",fontSize:13,color:"var(--ink)",outline:"none" }} />
                  <button onClick={async()=>{
                    if(!newKeyName.trim()) return;
                    const r = await api.createApiKey(newKeyName.trim());
                    setCreatedKey(r.key);
                    setNewKeyName("");
                    api.listApiKeys().then(d=>setKeys(d.keys||[]));
                  }} style={{ padding:"9px 16px",background:"var(--surface)",border:"1px solid var(--line-2)",borderRadius:8,cursor:"pointer",fontFamily:"var(--mono)",fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:"var(--ink)",transition:"all .25s var(--ease)" }}>
                    CREATE
                  </button>
                </div>
                {createdKey && (
                  <div style={{ marginTop:12,padding:"12px 14px",background:"var(--surface-2)",borderRadius:10,fontFamily:"var(--mono)",fontSize:11,color:"var(--ink)",wordBreak:"break-all" }}>
                    <span style={{ color:"var(--lime)",fontWeight:600 }}>NEW KEY:</span> {createdKey}
                    <br/><span style={{ color:"var(--text-3)",fontSize:9 }}>Save this — it won't be shown again.</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════ */
export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");
  const openSettings = (tab="profile") => { setSettingsTab(tab); setSettingsOpen(true); };
  const [health, setHealth] = useState<HealthStatus|null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [lastSummarized, setLastSummarized] = useState(0);
  const [msgCounter, setMsgCounter] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mediaRef = useRef<MediaRecorder|null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{ setAuthed(api.isLoggedIn()); },[]);
  useEffect(()=>{ scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"}); },[messages,generating]);
  useEffect(()=>{ if(!authed) return; const p=()=>api.health().then(setHealth).catch(()=>{}); p(); const iv=setInterval(p,30000); return()=>clearInterval(iv); },[authed]);
  useEffect(()=>{ if(!taRef.current) return; taRef.current.style.height="auto"; taRef.current.style.height=Math.min(taRef.current.scrollHeight,200)+"px"; },[input]);

  // Load persisted conversation
  useEffect(()=>{
    if(!authed) return;
    api.loadConversation().then(d=>{
      if(!d) return;
      if(d.messages?.length){ setMessages(d.messages); setLastSummarized(d.messages.length); setMsgCounter(d.messages.length); }
      if(d.sections?.length) setSections(d.sections);
      if(d.settings){ localStorage.setItem("edgeword_max_tokens",String(d.settings.max_tokens||256)); localStorage.setItem("edgeword_temperature",String(d.settings.temperature||0.7)); }
    }).catch(()=>{});
  },[authed]);

  // Auto-summarize
  useEffect(()=>{
    if(!messages.length || generating || messages.length - lastSummarized < SECTION_EVERY) return;
    const si=lastSummarized; const chunk=messages.slice(si); const txt=chunk.map(m=>`${m.role==="user"?"User":"AI"}: ${m.text}`).join("\n");
    setLastSummarized(messages.length);
    api.summarize(txt).then(title=>{ const sec={id:uid(),title,timestamp:chunk[0].timestamp,messageIndex:si,messageCount:chunk.length}; setSections(p=>[...p,sec]); api.saveSection(sec); });
  },[messages,generating,lastSummarized]);

  const send = useCallback(async(text?:string)=>{
    const msg=text||input.trim(); if(!msg&&!attachments.length) return; if(generating) return;
    const c=msgCounter;
    const userMsg:Message={id:uid(),role:"user",text:msg,timestamp:Date.now(),attachments:attachments.length?[...attachments]:undefined};
    setMessages(p=>[...p,userMsg]); setInput(""); setAttachments([]); setGenerating(true); setMsgCounter(c+1);
    api.saveMessage(userMsg);
    try{
      const imgAtt=userMsg.attachments?.find(a=>a.type==="image");
      if(imgAtt){
        const r=await api.ocrChat(imgAtt.file,msg||"What does this image say?");
        const am={id:uid(),role:"assistant" as const,text:r.response,tokens:r.tokens,totalS:r.total_s,toolResult:r.ocr?`[OCR] ${r.ocr.text}`:undefined,timestamp:Date.now()};
        setMessages(p=>[...p,am]); setMsgCounter(c+2); api.saveMessage(am);
      } else {
        const r=await api.chat(msg,{maxTokens:Number(localStorage.getItem("edgeword_max_tokens")||"256"),temperature:Number(localStorage.getItem("edgeword_temperature")||"0.7")});
        const am={id:uid(),role:"assistant" as const,text:r.response,sentiment:r.sentiment,ragSources:r.rag_sources.length?r.rag_sources:undefined,toolResult:r.tool_result||undefined,tokens:r.tokens,tps:r.tps,ttft:r.ttft_s,totalS:r.total_s,cached:r.cached,timestamp:Date.now()};
        setMessages(p=>[...p,am]); setMsgCounter(c+2); api.saveMessage(am);
      }
    } catch(err:any){ setMessages(p=>[...p,{id:uid(),role:"assistant",text:`Error: ${err.message}`,timestamp:Date.now()}]); }
    finally{ setGenerating(false); }
  },[input,attachments,generating,msgCounter]);

  const toggleRec = async()=>{
    if(recording){ mediaRef.current?.stop(); setRecording(false); return; }
    try{
      const s=await navigator.mediaDevices.getUserMedia({audio:true}); const rec=new MediaRecorder(s); const ch:Blob[]=[];
      rec.ondataavailable=e=>ch.push(e.data);
      rec.onstop=async()=>{ s.getTracks().forEach(t=>t.stop()); try{ const r=await api.transcribe(new File([new Blob(ch,{type:"audio/webm"})],"r.webm",{type:"audio/webm"})); if(r.text) setInput(p=>p+(p?" ":"")+r.text); }catch{} };
      rec.start(); mediaRef.current=rec; setRecording(true);
    }catch{}
  };

  const handleFile=(e:React.ChangeEvent<HTMLInputElement>)=>{ if(!e.target.files) return; Array.from(e.target.files).forEach(f=>setAttachments(p=>[...p,{type:"file",name:f.name,size:f.size,file:f}])); e.target.value=""; };
  const handleImg=(e:React.ChangeEvent<HTMLInputElement>)=>{ if(!e.target.files) return; Array.from(e.target.files).forEach(f=>setAttachments(p=>[...p,{type:"image",name:f.name,size:f.size,url:URL.createObjectURL(f),file:f}])); e.target.value=""; };

  const latestSummary = sections.length > 0 ? sections[sections.length-1].title : null;

  if (!authed) return <AuthPage onAuth={()=>setAuthed(true)} />;

  return (
    <>
      <div className="mesh" />
      <div className="grain" />

      {/* ── Wordmark (fixed top-left) ── */}
      <div style={{ position:"fixed",top:28,left:36,zIndex:60,display:"flex",alignItems:"flex-start",gap:12,userSelect:"none" }}>
        <span style={{ fontFamily:"var(--sans)",fontWeight:700,fontSize:28,letterSpacing:"-.035em",lineHeight:.9,color:"var(--ink)",display:"inline-flex",alignItems:"flex-start" }}>
          <span>Edge</span>
          <span style={{ background:"var(--wordmark-gradient)",WebkitBackgroundClip:"text",backgroundClip:"text",color:"transparent" }}>Word</span>
          <sup style={{ fontFamily:"var(--mono)",fontSize:9,fontWeight:500,letterSpacing:".04em",color:"var(--text-2)",marginLeft:3,display:"inline-block",transform:"translateY(2px)" }}>TM</sup>
        </span>
      </div>

      {/* ── Status row (fixed top-right) ── */}
      <div style={{ position:"fixed",top:32,right:36,zIndex:60,display:"flex",alignItems:"center",gap:10 }}>
        {health && (
          <span onClick={()=>location.reload()} style={{ display:"inline-flex",alignItems:"center",gap:8,padding:"8px 12px",background:"var(--surface)",border:"1px solid var(--line)",borderRadius:999,cursor:"pointer",fontFamily:"var(--mono)",fontSize:10,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-2)",transition:"all .25s var(--ease)",backdropFilter:"blur(20px)" }}>
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 7a5 5 0 0 1 9-3"/><path d="M11 1.5v3h-3"/><path d="M12 7a5 5 0 0 1-9 3"/><path d="M3 12.5v-3h3"/></svg>
            SYNC
          </span>
        )}
        <span onClick={()=>openSettings("profile")} style={{ width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,var(--violet) 0,var(--hot) 100%)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--sans)",fontWeight:700,fontSize:14,color:"#fff",cursor:"pointer",border:"1px solid rgba(255,255,255,.2)",transition:"all .3s var(--ease)",boxShadow:"0 4px 16px -4px rgba(98,68,232,.5)" }}>
          M
        </span>
      </div>

      {/* ── Stage ── */}
      <div style={{ position:"relative",minHeight:"100vh",padding:"32px 40px 220px" }}>
        <div style={{ marginTop:120,maxWidth:760,marginLeft:"auto",marginRight:"auto" }}>

          {/* ── Opener (post-auth: latest summary) ── */}
          <div style={{ marginBottom:56,position:"relative" }}>
            <div style={{ display:"inline-flex",alignItems:"center",gap:10,marginBottom:20,padding:"6px 12px",border:"1px solid var(--line-2)",borderRadius:999,fontFamily:"var(--mono)",fontSize:10,letterSpacing:".14em",textTransform:"uppercase",color:"var(--text-2)",background:"var(--surface)",backdropFilter:"blur(20px)" }}>
              <span style={{ width:6,height:6,background:"var(--hot)",borderRadius:"50%",animation:"pulse 1.4s ease-in-out infinite",boxShadow:"0 0 12px var(--hot)" }} />
              SESSION · LIVE · {new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}).toUpperCase()}
            </div>
            <h1 style={{ fontFamily:"var(--sans)",fontWeight:700,fontSize:"clamp(40px, 7vw, 88px)",lineHeight:.92,letterSpacing:"-.04em",color:"var(--ink)",maxWidth:"14ch" }}>
              {latestSummary || "Begin a new conversation."}
            </h1>
          </div>

          {/* ── Messages ── */}
          <div ref={scrollRef}>
            {messages.map((m,i) => {
              const section = sections.find(s=>s.messageIndex===i);
              return (
                <div key={m.id}>
                  {section && <SumDivider section={section} />}
                  {m.role==="user" ? <UserMsg msg={m} idx={i} /> : <AsstMsg msg={m} idx={i} />}
                </div>
              );
            })}
            {generating && <Thinking idx={msgCounter} />}
          </div>
        </div>
      </div>

      {/* ── Side Actions (desktop, fixed bottom-left) ── */}
      <nav style={{ position:"fixed",left:36,bottom:160,zIndex:55,display:"flex",flexDirection:"column",gap:6 }} className="hidden md:flex">
        {[{label:"SETTINGS",onClick:()=>openSettings("profile")},{label:"KNOWLEDGE",onClick:()=>openSettings("knowledge")},{label:"API KEYS",onClick:()=>openSettings("keys")},{label:"SIGN OUT",onClick:()=>{api.logout();setAuthed(false)},danger:true}].map(a=>(
          <a key={a.label} onClick={a.onClick} style={{ display:"inline-flex",alignItems:"center",gap:10,padding:"8px 12px",background:"var(--surface)",border:"1px solid var(--line)",borderRadius:10,fontFamily:"var(--mono)",fontSize:10,letterSpacing:".1em",textTransform:"uppercase",color:a.danger?"var(--hot)":"var(--text-2)",textDecoration:"none",cursor:"pointer",transition:"all .25s var(--ease)",width:"fit-content",backdropFilter:"blur(20px)" }}>
            &#8853; {a.label}
          </a>
        ))}
      </nav>

      {/* ── Composer (fixed bottom) ── */}
      <div style={{ position:"fixed",left:0,right:0,bottom:0,zIndex:50,padding:"32px 40px 32px",background:"var(--gradient-fade)",backdropFilter:"blur(8px)" }} className="pb-safe">
        <div style={{ maxWidth:760,margin:"0 auto" }}>
          <div style={{ display:"flex",alignItems:"flex-end",gap:14,padding:"14px 14px 14px 22px",background:"var(--composer-bg)",border:"1px solid var(--line-2)",borderRadius:24,backdropFilter:"blur(20px)",transition:"border-color .3s var(--ease),box-shadow .3s var(--ease)",boxShadow:"0 1px 0 rgba(255,255,255,.8) inset, 0 14px 40px -18px rgba(20,18,15,.18)" }}>
            <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} }}
              placeholder="Drop a thought. Press send when ready." rows={1}
              style={{ flex:1,background:"transparent",border:0,outline:0,resize:"none",fontFamily:"var(--sans)",fontSize:16,lineHeight:1.5,color:"var(--ink)",minHeight:28,maxHeight:200,padding:"6px 0" }} />
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <button onClick={()=>fileRef.current?.click()} title="attach" style={{ width:36,height:36,borderRadius:10,background:"var(--surface)",border:"1px solid var(--line)",cursor:"pointer",color:"var(--text-2)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all .25s var(--ease)" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M9 3.5l-5 5a2 2 0 0 0 2.8 2.8l5-5a3.5 3.5 0 0 0-5-5l-5 5a5 5 0 0 0 7 7l5-5"/></svg>
              </button>
              <button onClick={toggleRec} title="voice" style={{ width:36,height:36,borderRadius:10,background:recording?"rgba(230,58,27,.1)":"var(--surface)",border:`1px solid ${recording?"rgba(230,58,27,.3)":"var(--line)"}`,cursor:"pointer",color:recording?"var(--hot)":"var(--text-2)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all .25s var(--ease)" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="5" y="1.5" width="4" height="8" rx="2"/><path d="M2.5 7a4.5 4.5 0 0 0 9 0"/><path d="M7 11.5v1.5"/></svg>
              </button>
              <button onClick={()=>send()} disabled={!input.trim()&&!attachments.length}
                style={{ display:"inline-flex",alignItems:"center",gap:8,padding:"9px 16px",background:"var(--send-bg)",color:"var(--send-color)",border:0,borderRadius:10,cursor:"pointer",fontFamily:"var(--sans)",fontWeight:600,fontSize:13,letterSpacing:"-.01em",transition:"all .25s var(--spring)",boxShadow:"var(--send-shadow)",opacity:input.trim()||attachments.length?1:.4 }}>
                SEND
                <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M0 5h12"/><path d="M9 1l4 4-4 4"/></svg>
              </button>
            </div>
          </div>
          {/* Footer hint row */}
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14,padding:"0 8px",fontFamily:"var(--mono)",fontSize:9.5,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)" }} className="hidden md:flex">
            <div style={{ display:"flex",gap:14,alignItems:"center" }}>
              <span><span style={{ padding:"2px 6px",background:"var(--surface)",border:"1px solid var(--line)",borderRadius:4,color:"var(--text-2)" }}>ENTER</span> SEND</span>
              <span><span style={{ padding:"2px 6px",background:"var(--surface)",border:"1px solid var(--line)",borderRadius:4,color:"var(--text-2)" }}>SHIFT+ENTER</span> NEWLINE</span>
            </div>
            {health && <span>{health.model?.replace(".gguf","")}</span>}
          </div>
        </div>
        <input ref={fileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml" onChange={handleFile} />
        <input ref={imgRef} type="file" style={{display:"none"}} accept="image/*" onChange={handleImg} />
      </div>

      <SettingsSheet open={settingsOpen} onClose={()=>setSettingsOpen(false)} health={health} onLogout={()=>setAuthed(false)} initialTab={settingsTab} />
    </>
  );
}
