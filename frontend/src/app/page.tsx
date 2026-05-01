"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "@/lib/api";
import { Message, Attachment, HealthStatus, Section } from "@/lib/types";
import AuthPage from "@/components/AuthPage";

function uid(){return Math.random().toString(36).slice(2,10)}
function fmtTime(t:number){return new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
const SECTION_EVERY=4;

/* ── Variant definitions for Appearance tab ── */
const VARIANTS=[
  {id:"classic",name:"Classic",tag:"DEFAULT",colors:["#1A73E8","#EA4335","#FBBC04","#34A853"]},
  {id:"midnight",name:"Midnight",tag:"",colors:["#6750A4","#00A9D9","#B0479C","#00A36C"]},
  {id:"ember",name:"Ember",tag:"",colors:["#E0418B","#FF6F3D","#B25600","#F29900"]},
  {id:"forest",name:"Forest",tag:"",colors:["#006D52","#B47800","#00658E","#6B8F71"]},
  {id:"mono",name:"Mono",tag:"",colors:["#1F1F1F","#5F5F5F","#1A73E8","#BDBDBD"]},
  {id:"sunrise",name:"Sunrise",tag:"",colors:["#2856E6","#F87171","#F59E0B","#16A34A"]},
];

function setPref(key:string,val:string){
  localStorage.setItem(`edgeword.${key}`,val);
  document.documentElement.setAttribute(`data-${key}`,key==="theme"&&val==="system"?(matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"):val);
  api.updateProfile({[key]:val}).catch(()=>{});
}

/* ── Wordmark ── */
function Wordmark({size=24}:{size?:number}){
  return(
    <span style={{fontFamily:"var(--google-sans)",fontSize:size,fontWeight:500,letterSpacing:"-.02em",lineHeight:1,display:"inline-flex",alignItems:"center",userSelect:"none"}}>
      <span style={{color:"var(--wm-1)"}}>E</span><span style={{color:"var(--wm-2)"}}>d</span>
      <span style={{color:"var(--wm-3)"}}>g</span><span style={{color:"var(--wm-4)"}}>e</span>
      <span style={{display:"inline-block",width:size/5,height:size/5,borderRadius:"50%",background:"var(--wm-dot)",margin:"0 .25em",transform:"translateY(-.05em)"}}/>
      <span style={{color:"var(--wm-5)"}}>W</span><span style={{color:"var(--wm-6)"}}>o</span>
      <span style={{color:"var(--wm-7)"}}>r</span><span style={{color:"var(--wm-8)"}}>d</span>
    </span>
  );
}

/* ── User Avatar ── */
function UserAvatar(){
  return <div style={{width:"var(--avatar-size)",height:"var(--avatar-size)",borderRadius:"50%",background:"var(--md-primary)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,color:"var(--md-on-primary)",flexShrink:0}}>M</div>;
}
/* ── Assistant Avatar (Gemini gradient) ── */
function AsstAvatar(){
  return <div style={{width:"var(--avatar-size)",height:"var(--avatar-size)",borderRadius:"50%",background:`linear-gradient(135deg,var(--wm-1) 0%,var(--wm-2) 50%,var(--wm-3) 100%)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><div style={{width:14,height:14,borderRadius:"50%",background:"#fff"}}/></div>;
}

/* ── Message ── */
function Msg({msg,isUser}:{msg:Message;isUser:boolean}){
  return(
    <article style={{position:"relative",padding:`0 0 var(--message-pad-y)`,paddingLeft:48,animation:"settle .35s var(--ease-emph) both"}}>
      <span style={{position:"absolute",left:0,top:0}}>{isUser?<UserAvatar/>:<AsstAvatar/>}</span>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <span style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,color:"var(--md-on-surface)"}}>{isUser?"You":"EdgeWord"}</span>
        <span style={{fontFamily:"var(--google-sans)",fontSize:12,color:"var(--md-on-surface-variant)",fontWeight:400}}>{fmtTime(msg.timestamp)}</span>
      </div>
      <div style={{fontFamily:"var(--sans)",fontSize:15.5,lineHeight:1.6,color:"var(--md-on-surface-variant)",fontWeight:400,maxWidth:"62ch"}}>
        {msg.text.split("\n").map((p,i)=><p key={i} style={{marginBottom:p?".85em":0}}>{p}</p>)}
      </div>
      {msg.toolResult&&<div style={{margin:"12px 0",padding:"12px 16px",background:"var(--md-surface-container)",borderRadius:8,fontFamily:"var(--mono)",fontSize:13,color:"var(--md-on-surface-variant)",border:"1px solid var(--md-outline-variant)"}}>{msg.toolResult}</div>}
      {msg.ragSources&&msg.ragSources.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>{msg.ragSources.map((s,i)=><span key={i} style={{padding:"4px 10px",background:"var(--md-primary-container)",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-on-primary-container)"}}>{s}</span>)}</div>}
      {msg.tokens!=null&&<div style={{marginTop:8,fontFamily:"var(--mono)",fontSize:11,color:"var(--md-on-surface-variant)",opacity:.6}}>{msg.tokens} tok{msg.tps!=null&&` · ${msg.tps.toFixed(1)} t/s`}{msg.cached&&" · cached"}</div>}
    </article>
  );
}

/* ── Thinking ── */
function Thinking(){
  return(
    <article style={{position:"relative",paddingLeft:48,paddingBottom:"var(--message-pad-y)",animation:"settle .35s var(--ease-emph) both"}}>
      <span style={{position:"absolute",left:0,top:0,animation:"gemini-pulse 1.6s ease-in-out infinite"}}><AsstAvatar/></span>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <span style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,color:"var(--md-on-surface)"}}>EdgeWord</span>
      </div>
      <div style={{fontFamily:"var(--sans)",fontSize:15.5,color:"var(--md-on-surface-variant)"}}>
        <span style={{display:"inline-block",width:8,height:14,background:"var(--md-primary)",marginLeft:0,borderRadius:1.5,animation:"blink 1s steps(1) infinite",verticalAlign:-2}}/>
      </div>
    </article>
  );
}

/* ── Section Divider ── */
function SumDiv({section}:{section:Section}){
  return <div style={{display:"flex",alignItems:"center",gap:12,padding:"16px 0",fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-on-surface-variant)",letterSpacing:".04em"}}>
    <span style={{flex:1,height:1,background:"var(--md-outline-variant)"}}/>
    {section.title}
    <span style={{flex:1,height:1,background:"var(--md-outline-variant)"}}/>
  </div>;
}

/* ── Settings Overlay ── */
function Settings({open,onClose,health,onLogout}:{open:boolean;onClose:()=>void;health:HealthStatus|null;onLogout:()=>void}){
  const [tab,setTab]=useState("profile");
  const [profile,setProfile]=useState<any>({});
  const [docs,setDocs]=useState<any[]>([]);
  const [keys,setKeys]=useState<any[]>([]);
  const [newKeyName,setNewKeyName]=useState("");
  const [createdKey,setCreatedKey]=useState("");
  const [maxT,setMaxT]=useState(256);
  const [temp,setTemp]=useState(0.7);
  const [variant,setVariant]=useState("classic");
  const [theme,setTheme]=useState("light");
  const [density,setDensity]=useState("comfortable");
  const [scale,setScale]=useState("default");
  const [motion,setMotion]=useState("standard");
  const kFileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    if(!open) return; setCreatedKey("");
    setVariant(localStorage.getItem("edgeword.variant")||"classic");
    setTheme(localStorage.getItem("edgeword.theme")||"light");
    setDensity(localStorage.getItem("edgeword.density")||"comfortable");
    setScale(localStorage.getItem("edgeword.scale")||"default");
    setMotion(localStorage.getItem("edgeword.motion")||"standard");
    setMaxT(Number(localStorage.getItem("edgeword_max_tokens")||"256"));
    setTemp(Number(localStorage.getItem("edgeword_temperature")||"0.7"));
    api.getProfile().then(setProfile).catch(()=>{});
    api.listKnowledge().then(d=>setDocs(d.documents||[])).catch(()=>{});
    api.listApiKeys().then(d=>setKeys(d.keys||[])).catch(()=>{});
  },[open]);

  if(!open) return null;

  const saveP=(f:string,v:string)=>{setProfile((p:any)=>({...p,[f]:v}));api.updateProfile({[f]:v});};
  const inputS:React.CSSProperties={width:"100%",background:"var(--md-surface-container-low)",border:"1px solid transparent",borderRadius:8,padding:"10px 14px",fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-surface)",outline:"none",transition:"all .2s var(--ease)"};

  const tabs=[{id:"profile",label:"Profile"},{id:"appearance",label:"Appearance"},{id:"knowledge",label:"Knowledge"},{id:"model",label:"Model"},{id:"keys",label:"API Keys"}];

  return(
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"64px 24px 24px"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{position:"absolute",inset:0,background:"rgba(32,33,36,.32)",opacity:1,transition:"opacity .25s var(--ease)"}}/>
      <section style={{position:"relative",width:"100%",maxWidth:880,background:"var(--md-surface)",borderRadius:24,padding:"32px 40px 40px",transform:"translateY(0) scale(1)",boxShadow:"0 24px 38px 3px rgba(60,64,67,.14),0 9px 46px 8px rgba(60,64,67,.12),0 11px 15px -7px rgba(60,64,67,.20)",animation:"settle .35s var(--ease-emph) both"}}>
        <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,paddingBottom:16,borderBottom:"1px solid var(--md-outline-variant)"}}>
          <h2 style={{fontFamily:"var(--google-sans)",fontWeight:400,fontSize:24,color:"var(--md-on-surface)",display:"flex",alignItems:"center",gap:12}}>Settings <span style={{fontFamily:"var(--google-sans)",fontSize:12,color:"var(--md-on-surface-variant)",fontWeight:500,padding:"4px 10px",background:"var(--md-surface-container)",borderRadius:999}}>workspace</span></h2>
          <button onClick={onClose} style={{background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-primary)",padding:"8px 14px",transition:"background .2s var(--ease)"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--md-primary-container)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Close</button>
        </header>

        <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:32}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{textAlign:"left",background:tab===t.id?"var(--md-primary-container)":"transparent",border:0,cursor:"pointer",padding:"10px 16px",borderRadius:999,fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,color:tab===t.id?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",letterSpacing:".01em",transition:"background .2s var(--ease)"}}>{t.label}</button>)}
          </div>

          <div style={{minHeight:300}}>
            {/* ── Profile ── */}
            {tab==="profile"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Profile</h3>
              {[{k:"Display name",f:"display_name"},{k:"Email",f:"email"}].map(({k,f})=>(
                <div key={k} style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:24,padding:"16px 0",borderTop:"1px solid var(--md-outline-variant)",alignItems:"center"}}>
                  <span style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)"}}>{k}</span>
                  <input value={profile[f]||""} placeholder={f==="email"?"you@example.com":""} onChange={e=>setProfile((p:any)=>({...p,[f]:e.target.value}))} onBlur={e=>saveP(f,e.target.value)} style={inputS}/>
                </div>
              ))}
              <div style={{marginTop:24}}><button onClick={()=>{if(confirm("Sign out?")){{api.logout();onLogout();}}}} style={{padding:"10px 20px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",transition:"background .2s var(--ease)"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Sign out</button></div>
            </div>}

            {/* ── Appearance ── */}
            {tab==="appearance"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Theme</h3>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {(["light","dark","system"] as const).map(m=><button key={m} onClick={()=>{setTheme(m);setPref("theme",m);}} style={{flex:1,padding:"10px 0",background:theme===m?"var(--md-primary-container)":"var(--md-surface-container-low)",border:theme===m?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:theme===m?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>{m==="light"?"Light":m==="dark"?"Dark":"System"}</button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Color Theme</h3>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:24}}>
                {VARIANTS.map(v=><button key={v.id} onClick={()=>{setVariant(v.id);setPref("variant",v.id);}} style={{padding:14,background:variant===v.id?"var(--md-primary-container)":"var(--md-surface-container-low)",border:variant===v.id?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:16,cursor:"pointer",textAlign:"left",transition:"all .15s var(--ease)"}}>
                  <div style={{display:"flex",gap:4,marginBottom:8}}>{v.colors.map((c,i)=><span key={i} style={{width:16,height:16,borderRadius:"50%",background:c}}/>)}</div>
                  <div style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface)"}}>{v.name}</div>
                  {v.tag&&<div style={{fontFamily:"var(--google-sans)",fontSize:10,color:"var(--md-on-surface-variant)",marginTop:2}}>{v.tag}</div>}
                </button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Density</h3>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {(["comfortable","compact"] as const).map(d=><button key={d} onClick={()=>{setDensity(d);setPref("density",d);}} style={{flex:1,padding:"10px 0",background:density===d?"var(--md-primary-container)":"var(--md-surface-container-low)",border:density===d?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:density===d?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>{d[0].toUpperCase()+d.slice(1)}</button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Text Size</h3>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {(["small","default","large"] as const).map(s=><button key={s} onClick={()=>{setScale(s);setPref("scale",s);}} style={{flex:1,padding:"10px 0",background:scale===s?"var(--md-primary-container)":"var(--md-surface-container-low)",border:scale===s?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:s==="small"?12:s==="large"?15:13,fontWeight:500,color:scale===s?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>Aa</button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Motion</h3>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                {(["standard","reduced","auto"] as const).map(m=><button key={m} onClick={()=>{setMotion(m);setPref("motion",m);}} style={{flex:1,padding:"10px 0",background:motion===m?"var(--md-primary-container)":"var(--md-surface-container-low)",border:motion===m?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:motion===m?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>{m[0].toUpperCase()+m.slice(1)}</button>)}
              </div>

              <button onClick={()=>{["theme","variant","density","scale","motion"].forEach(k=>{const d=k==="theme"?"light":k==="variant"?"classic":k==="density"?"comfortable":k==="scale"?"default":"standard";setPref(k,d);});setTheme("light");setVariant("classic");setDensity("comfortable");setScale("default");setMotion("standard");}}
                style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-primary)",background:"transparent",border:0,cursor:"pointer",padding:"8px 0"}}>Reset to defaults</button>
            </div>}

            {/* ── Knowledge ── */}
            {tab==="knowledge"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Knowledge · {docs.length} documents</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {docs.map((d:any)=><div key={d.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",background:"var(--md-surface-container-low)",borderRadius:12}}>
                  <span style={{fontFamily:"var(--google-sans)",fontSize:13.5,fontWeight:500,color:"var(--md-on-surface)"}}>{d.name}</span>
                  <span style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--md-on-surface-variant)"}}>{d.chunks} chunks</span>
                </div>)}
              </div>
              <button onClick={()=>kFileRef.current?.click()} style={{padding:"10px 20px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-primary)",transition:"background .2s var(--ease)"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--md-primary-container)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Upload document</button>
              <input ref={kFileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml" onChange={async e=>{if(!e.target.files)return;for(const f of Array.from(e.target.files))await api.uploadKnowledge(f);api.listKnowledge().then(d=>setDocs(d.documents||[]));e.target.value="";}}/>
            </div>}

            {/* ── Model ── */}
            {tab==="model"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>Model</h3>
              {[["Active model",health?.model?.replace(".gguf","")||"—","text"],["Temperature",temp,"temp"],["Max tokens",maxT,"tokens"]].map(([k,v,t])=>(
                <div key={String(k)} style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:24,padding:"16px 0",borderTop:"1px solid var(--md-outline-variant)",alignItems:"center"}}>
                  <span style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)"}}>{k}</span>
                  {t==="temp"?<input type="number" step="0.1" value={temp} onChange={e=>{setTemp(Number(e.target.value));localStorage.setItem("edgeword_temperature",e.target.value);api.saveSettings({max_tokens:maxT,temperature:Number(e.target.value)});}} style={{...inputS,width:120}}/>
                  :t==="tokens"?<input type="number" value={maxT} onChange={e=>{setMaxT(Number(e.target.value));localStorage.setItem("edgeword_max_tokens",e.target.value);api.saveSettings({max_tokens:Number(e.target.value),temperature:temp});}} style={{...inputS,width:120}}/>
                  :<span style={{fontFamily:"var(--mono)",fontSize:12.5,color:"var(--md-on-surface-variant)"}}>{v}</span>}
                </div>
              ))}
            </div>}

            {/* ── API Keys ── */}
            {tab==="keys"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>API Keys</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {keys.map((k:any)=><div key={k.id} style={{padding:"14px 16px",background:"var(--md-surface-container-low)",borderRadius:12,display:"flex",alignItems:"center",gap:12}}>
                  <span style={{width:10,height:10,borderRadius:"50%",background:k.is_active?"var(--md-success)":"var(--md-outline)"}}/>
                  <span style={{flex:1,fontFamily:"var(--google-sans)",fontSize:13.5,fontWeight:500,color:"var(--md-on-surface)"}}>{k.name}</span>
                  <span style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--md-on-surface-variant)"}}>{k.key_prefix}</span>
                  {k.is_active&&<button onClick={async()=>{await api.revokeApiKey(k.key_prefix);api.listApiKeys().then(r=>setKeys(r.keys||[]));}} style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",background:"transparent",border:0,cursor:"pointer",padding:"8px 14px",borderRadius:999,transition:"background .2s var(--ease)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Revoke</button>}
                </div>)}
              </div>
              <div style={{display:"flex",gap:8}}>
                <input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Key name" style={{...inputS,flex:1}}/>
                <button onClick={async()=>{if(!newKeyName.trim())return;const r=await api.createApiKey(newKeyName.trim());setCreatedKey(r.key);setNewKeyName("");api.listApiKeys().then(d=>setKeys(d.keys||[]));}} style={{padding:"10px 20px",background:"var(--md-primary)",color:"var(--md-on-primary)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,whiteSpace:"nowrap"}}>Create</button>
              </div>
              {createdKey&&<div style={{marginTop:12,padding:"14px 16px",background:"var(--md-primary-container)",borderRadius:12,fontFamily:"var(--mono)",fontSize:11,color:"var(--md-on-primary-container)",wordBreak:"break-all"}}>
                <strong>New key:</strong> {createdKey}
                <div style={{marginTop:8,display:"flex",gap:8}}>
                  <button onClick={()=>navigator.clipboard.writeText(createdKey)} style={{fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-primary)",background:"transparent",border:0,cursor:"pointer"}}>Copy</button>
                  <button onClick={()=>{const b=new Blob([JSON.stringify({key:createdKey,created:new Date().toISOString()},null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="edgeword-key.json";a.click();URL.revokeObjectURL(u);}} style={{fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-primary)",background:"transparent",border:0,cursor:"pointer"}}>Download JSON</button>
                </div>
              </div>}
            </div>}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════ */
export default function Home(){
  const [authed,setAuthed]=useState(false);
  const [messages,setMessages]=useState<Message[]>([]);
  const [input,setInput]=useState("");
  const [generating,setGenerating]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [health,setHealth]=useState<HealthStatus|null>(null);
  const [sections,setSections]=useState<Section[]>([]);
  const [lastSum,setLastSum]=useState(0);
  const [recording,setRecording]=useState(false);
  const scrollRef=useRef<HTMLDivElement>(null);
  const taRef=useRef<HTMLTextAreaElement>(null);
  const mediaRef=useRef<MediaRecorder|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{setAuthed(api.isLoggedIn());},[]);
  useEffect(()=>{scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"});},[messages,generating]);
  useEffect(()=>{if(!authed)return;const p=()=>api.health().then(setHealth).catch(()=>{});p();const iv=setInterval(p,30000);return()=>clearInterval(iv);},[authed]);
  useEffect(()=>{if(!taRef.current)return;taRef.current.style.height="auto";taRef.current.style.height=Math.min(taRef.current.scrollHeight,200)+"px";},[input]);

  // Load persisted
  useEffect(()=>{if(!authed)return;api.loadConversation().then(d=>{if(!d)return;if(d.messages?.length){setMessages(d.messages);setLastSum(d.messages.length);}if(d.sections?.length)setSections(d.sections);if(d.settings){localStorage.setItem("edgeword_max_tokens",String(d.settings.max_tokens||256));localStorage.setItem("edgeword_temperature",String(d.settings.temperature||0.7));}}).catch(()=>{});},[authed]);

  // Auto-summarize
  useEffect(()=>{if(!messages.length||generating||messages.length-lastSum<SECTION_EVERY)return;const si=lastSum;const ch=messages.slice(si);const txt=ch.map(m=>`${m.role==="user"?"User":"AI"}: ${m.text}`).join("\n");setLastSum(messages.length);api.summarize(txt).then(title=>{const sec={id:uid(),title,timestamp:ch[0].timestamp,messageIndex:si,messageCount:ch.length};setSections(p=>[...p,sec]);api.saveSection(sec);});},[messages,generating,lastSum]);

  const send=useCallback(async(text?:string)=>{
    const msg=text||input.trim();if(!msg)return;if(generating)return;
    const um:Message={id:uid(),role:"user",text:msg,timestamp:Date.now()};
    setMessages(p=>[...p,um]);setInput("");setGenerating(true);api.saveMessage(um);
    try{
      const r=await api.chat(msg,{maxTokens:Number(localStorage.getItem("edgeword_max_tokens")||"256"),temperature:Number(localStorage.getItem("edgeword_temperature")||"0.7")});
      const am:Message={id:uid(),role:"assistant",text:r.response,sentiment:r.sentiment,ragSources:r.rag_sources.length?r.rag_sources:undefined,toolResult:r.tool_result||undefined,tokens:r.tokens,tps:r.tps,ttft:r.ttft_s,totalS:r.total_s,cached:r.cached,timestamp:Date.now()};
      setMessages(p=>[...p,am]);api.saveMessage(am);
    }catch(err:any){setMessages(p=>[...p,{id:uid(),role:"assistant",text:`Error: ${err.message}`,timestamp:Date.now()}]);}
    finally{setGenerating(false);}
  },[input,generating]);

  const toggleRec=async()=>{if(recording){mediaRef.current?.stop();setRecording(false);return;}try{const s=await navigator.mediaDevices.getUserMedia({audio:true});const rec=new MediaRecorder(s);const ch:Blob[]=[];rec.ondataavailable=e=>ch.push(e.data);rec.onstop=async()=>{s.getTracks().forEach(t=>t.stop());try{const r=await api.transcribe(new File([new Blob(ch,{type:"audio/webm"})],"r.webm",{type:"audio/webm"}));if(r.text)setInput(p=>p+(p?" ":"")+r.text);}catch{}};rec.start();mediaRef.current=rec;setRecording(true);}catch{}};

  const latestSum=sections.length?sections[sections.length-1].title:null;

  if(!authed) return <AuthPage onAuth={()=>setAuthed(true)}/>;

  return(
    <>
      {/* Wordmark — fixed top-left */}
      <div style={{position:"fixed",top:24,left:24,zIndex:50}}><Wordmark/></div>

      {/* Status row — fixed top-right */}
      <div style={{position:"fixed",top:24,right:24,zIndex:50,display:"flex",alignItems:"center",gap:8}}>
        <span onClick={()=>location.reload()} style={{display:"inline-flex",alignItems:"center",gap:8,cursor:"pointer",padding:"8px 14px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)",transition:"background .2s var(--ease)"}}
          onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-low)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
          Refresh
        </span>
        <span onClick={()=>setSettingsOpen(true)} style={{width:36,height:36,borderRadius:"50%",background:"var(--md-primary)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:15,color:"var(--md-on-primary)",cursor:"pointer",boxShadow:"0 1px 2px 0 var(--md-shadow),0 1px 3px 1px var(--md-shadow-2)",transition:"box-shadow .2s var(--ease)"}}>M</span>
      </div>

      {/* Stage */}
      <div style={{position:"relative",minHeight:"100vh",padding:"24px 24px 48px"}}>
        <div style={{marginTop:96,maxWidth:840,marginLeft:"auto",marginRight:"auto",padding:"0 16px"}}>

          {/* Opener */}
          <h1 style={{fontFamily:"var(--google-sans)",fontWeight:400,fontSize:"clamp(28px, 5vw, 48px)",lineHeight:1.05,letterSpacing:"-.02em",color:"var(--md-on-surface)",marginBottom:8}}>
            {latestSum || <>Begin a new conversation<span style={{color:"var(--md-primary)"}}>.</span></>}
          </h1>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"6px 12px",background:"var(--md-surface-container)",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:12,letterSpacing:".04em",color:"var(--md-on-surface-variant)",fontWeight:500,marginBottom:40}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:"var(--md-success)",animation:"livepulse 2s ease-in-out infinite"}}/>
            {new Date().toLocaleDateString("en",{weekday:"long",day:"numeric",month:"short",year:"numeric"})} · live
          </div>

          {/* Messages */}
          <div ref={scrollRef}>
            {messages.map((m,i)=>{
              const sec=sections.find(s=>s.messageIndex===i);
              return <div key={m.id}>{sec&&<SumDiv section={sec}/>}<Msg msg={m} isUser={m.role==="user"}/></div>;
            })}
            {generating&&<Thinking/>}
          </div>
        </div>
      </div>

      {/* Side actions — desktop only */}
      <nav style={{position:"fixed",left:24,bottom:24,zIndex:45,display:"flex",flexDirection:"column",gap:0,alignItems:"flex-start"}} className="hide-mobile">
        {[{l:"Settings",onClick:()=>setSettingsOpen(true)},{l:"Knowledge",onClick:()=>setSettingsOpen(true)},{l:"API Keys",onClick:()=>setSettingsOpen(true)},{l:"Sign out",onClick:()=>{if(confirm("Sign out?")){api.logout();setAuthed(false);}},danger:true}].map(a=>(
          <a key={a.l} onClick={a.onClick} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 16px",background:"transparent",border:0,borderRadius:999,fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:a.danger?"var(--md-error)":"var(--md-on-surface-variant)",cursor:"pointer",transition:"background .2s var(--ease)"}}
            onMouseEnter={e=>e.currentTarget.style.background=a.danger?"var(--md-error-container)":"var(--md-surface-container-low)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{a.l}</a>
        ))}
      </nav>

      {/* Composer — fixed bottom */}
      <div style={{position:"fixed",left:"50%",bottom:0,transform:"translateX(-50%)",width:"100%",maxWidth:840,padding:"16px 16px 24px",background:`linear-gradient(to top,var(--md-surface) 0%,var(--md-surface) 65%,transparent 100%)`,zIndex:40}} className="pb-safe">
        <div style={{display:"flex",alignItems:"flex-end",gap:10,padding:"var(--composer-pad)",background:"var(--md-surface-container)",border:"1px solid transparent",borderRadius:28,transition:"all .2s var(--ease)"}}>
          <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder="Message EdgeWord..."
            rows={1} style={{flex:1,background:"transparent",border:0,outline:0,resize:"none",fontFamily:"var(--sans)",fontSize:15,lineHeight:1.5,color:"var(--md-on-surface)",fontWeight:400,minHeight:24,maxHeight:200,padding:"8px 0"}}/>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={()=>fileRef.current?.click()} title="attach" style={{width:36,height:36,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <button onClick={toggleRec} title="voice" style={{width:36,height:36,borderRadius:"50%",background:recording?"var(--md-error-container)":"transparent",border:0,cursor:"pointer",color:recording?"var(--md-error)":"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 19v4"/></svg>
            </button>
            <button onClick={()=>send()} disabled={!input.trim()} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 20px",background:input.trim()?"var(--md-primary)":"var(--md-surface-container-high)",color:input.trim()?"var(--md-on-primary)":"var(--md-on-surface-variant)",border:0,borderRadius:999,cursor:input.trim()?"pointer":"default",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,letterSpacing:".01em",transition:"all .2s var(--ease)",boxShadow:input.trim()?`0 1px 2px 0 var(--md-shadow),0 1px 3px 1px var(--md-shadow-2)`:"none"}}>
              Send
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.18L4.5 11l8 1-8 1-2.49 6.22a1 1 0 0 0 1.39 1.18z"/></svg>
            </button>
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml,image/*" onChange={async e=>{if(!e.target.files)return;/* handle */e.target.value="";}}/>
      <Settings open={settingsOpen} onClose={()=>setSettingsOpen(false)} health={health} onLogout={()=>setAuthed(false)}/>
    </>
  );
}
