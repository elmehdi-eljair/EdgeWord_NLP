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

/* Knowledge Gallery — mock packs */
const GALLERY=[
  {id:"tech-fundamentals",name:"Technology Fundamentals",desc:"Core concepts in software engineering, cloud, networks, databases.",category:"Technology",icon:"computer"},
  {id:"python-mastery",name:"Python Mastery",desc:"Advanced Python patterns, stdlib deep dives, performance tips.",category:"Coding",icon:"code"},
  {id:"web-dev",name:"Web Development",desc:"HTML, CSS, JS, React, Next.js, APIs, deployment best practices.",category:"Coding",icon:"web"},
  {id:"ai-ml",name:"AI & Machine Learning",desc:"Neural networks, transformers, RAG, fine-tuning, MLOps.",category:"Technology",icon:"model_training"},
  {id:"health-wellness",name:"Health & Wellness",desc:"Nutrition, exercise science, mental health, sleep optimization.",category:"Health",icon:"health_and_safety"},
  {id:"personal-finance",name:"Personal Finance",desc:"Budgeting, investing, tax planning, retirement strategies.",category:"Finance",icon:"account_balance"},
  {id:"startup-guide",name:"Startup Playbook",desc:"Fundraising, product-market fit, growth, team building.",category:"Business",icon:"rocket_launch"},
  {id:"data-science",name:"Data Science",desc:"Statistics, pandas, visualization, feature engineering, modeling.",category:"Coding",icon:"analytics"},
  {id:"cybersecurity",name:"Cybersecurity",desc:"OWASP, encryption, pen testing, incident response, compliance.",category:"Technology",icon:"security"},
  {id:"writing-comm",name:"Writing & Communication",desc:"Business writing, storytelling, presentations, copywriting.",category:"General",icon:"edit_note"},
];

const K_STATUSES:{[k:string]:{label:string;color:string;bg:string}}={
  available:{label:"Available",color:"var(--md-on-surface-variant)",bg:"var(--md-surface-container)"},
  installing:{label:"Installing",color:"var(--md-tertiary)",bg:"var(--md-tertiary-container)"},
  installed:{label:"Installed",color:"var(--md-primary)",bg:"var(--md-primary-container)"},
  processing:{label:"Processing",color:"var(--md-warning)",bg:"var(--md-tertiary-container)"},
  ready:{label:"Ready",color:"var(--md-success)",bg:"color-mix(in srgb, var(--md-success) 12%, transparent)"},
  paused:{label:"Paused",color:"var(--md-on-surface-variant)",bg:"var(--md-surface-container-high)"},
  error:{label:"Error",color:"var(--md-error)",bg:"var(--md-error-container)"},
};

function StatusChip({status}:{status:string}){
  const s=K_STATUSES[status]||K_STATUSES.available;
  return <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:s.color,background:s.bg}}>
    <span style={{width:6,height:6,borderRadius:"50%",background:s.color}}/>
    {s.label}
  </span>;
}

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
function Settings({open,onClose,health,onLogout,initialTab="profile"}:{open:boolean;onClose:()=>void;health:HealthStatus|null;onLogout:()=>void;initialTab?:string}){
  const [tab,setTab]=useState("profile");
  const [profile,setProfile]=useState<any>({});
  const [docs,setDocs]=useState<any[]>([]);
  const [keys,setKeys]=useState<any[]>([]);
  const [newKeyName,setNewKeyName]=useState("");
  const [createdKey,setCreatedKey]=useState("");
  const [kSearch,setKSearch]=useState("");
  const [selectedDoc,setSelectedDoc]=useState<string|null>(null);
  const [kPage,setKPage]=useState(0);
  const [uploading,setUploading]=useState<string|null>(null);
  const K_PER_PAGE=10;
  const [maxT,setMaxT]=useState(256);
  const [temp,setTemp]=useState(0.7);
  const [variant,setVariant]=useState("classic");
  const [theme,setTheme]=useState("light");
  const [density,setDensity]=useState("comfortable");
  const [scale,setScale]=useState("default");
  const [motion,setMotion]=useState("standard");
  const kFileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    if(!open) return; setCreatedKey(""); setSelectedDoc(null); setKSearch("");
    setTab(initialTab||"profile");
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
  },[open,initialTab]);

  if(!open) return null;

  const saveP=(f:string,v:string)=>{setProfile((p:any)=>({...p,[f]:v}));api.updateProfile({[f]:v});};
  const inputS:React.CSSProperties={width:"100%",background:"var(--md-surface-container-low)",border:"1px solid transparent",borderRadius:8,padding:"10px 14px",fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-surface)",outline:"none",transition:"all .2s var(--ease)"};

  const tabs=[{id:"profile",label:"Profile"},{id:"appearance",label:"Appearance"},{id:"knowledge",label:"Knowledge"},{id:"model",label:"Model"},{id:"keys",label:"API Keys"}];

  return(
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"64px 24px 24px"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{position:"absolute",inset:0,background:"rgba(32,33,36,.32)",opacity:1,transition:"opacity .25s var(--ease)"}}/>
      <section style={{position:"relative",width:"100%",maxWidth:(tab==="knowledge-full"||selectedDoc)?1100:880,background:"var(--md-surface)",borderRadius:24,padding:"32px 40px 40px",transform:"translateY(0) scale(1)",boxShadow:"0 24px 38px 3px rgba(60,64,67,.14),0 9px 46px 8px rgba(60,64,67,.12),0 11px 15px -7px rgba(60,64,67,.20)",animation:"settle .35s var(--ease-emph) both",transition:"max-width .35s var(--ease-emph)"}}>
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
              {[{k:"Display name",f:"display_name",ph:"Your name"},{k:"Email",f:"email",ph:"you@example.com"},{k:"Username",f:"username",ph:"",ro:true}].map(({k,f,ph,ro})=>(
                <div key={k} style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:24,padding:"16px 0",borderTop:"1px solid var(--md-outline-variant)",alignItems:"center"}}>
                  <span style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)"}}>{k}</span>
                  <input key={`${f}-${profile[f]||""}`} defaultValue={profile[f]||""} placeholder={ph} readOnly={!!ro}
                    onBlur={e=>{if(!ro)saveP(f,e.target.value);}}
                    style={{...inputS,opacity:ro?.6:1,cursor:ro?"default":"text"}}/>
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)"}}>Knowledge · {docs.length} documents</h3>
                {/* Fullscreen knowledge management button */}
                <button onClick={()=>{setTab("knowledge-full");}} title="Manage knowledge" style={{width:36,height:36,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
                </button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {docs.map((d:any)=><div key={d.name} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",background:"var(--md-surface-container-low)",borderRadius:12}}>
                  <span style={{fontFamily:"var(--google-sans)",fontSize:13.5,fontWeight:500,color:"var(--md-on-surface)"}}>{d.name}</span>
                  <span style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--md-on-surface-variant)"}}>{d.chunks} chunks</span>
                </div>)}
                {docs.length===0&&<p style={{fontFamily:"var(--sans)",fontSize:13,color:"var(--md-on-surface-variant)",padding:16,textAlign:"center"}}>No documents yet. Upload files to build your knowledge base.</p>}
              </div>
              <button onClick={()=>kFileRef.current?.click()} style={{padding:"10px 20px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-primary)",transition:"background .2s var(--ease)"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--md-primary-container)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Add Knowledge</button>
              <input ref={kFileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml,.pdf" multiple onChange={async e=>{if(!e.target.files)return;for(const f of Array.from(e.target.files))await api.uploadKnowledge(f);api.listKnowledge().then(d=>setDocs(d.documents||[]));e.target.value="";}}/>
            </div>}

            {/* ── Knowledge Fullscreen ── */}
            {tab==="knowledge-full"&&!selectedDoc&&(()=>{
              const filteredDocs=docs.filter((d:any)=>!kSearch||d.name.toLowerCase().includes(kSearch.toLowerCase()));
              const totalPages=Math.ceil(filteredDocs.length/K_PER_PAGE);
              const pagedDocs=filteredDocs.slice(kPage*K_PER_PAGE,(kPage+1)*K_PER_PAGE);
              return <div>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <button onClick={()=>{setTab("knowledge");setKSearch("");setKPage(0);}} style={{width:36,height:36,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
                </button>
                <h3 style={{flex:1,fontFamily:"var(--google-sans)",fontWeight:500,fontSize:20,color:"var(--md-on-surface)"}}>Knowledge Base</h3>
              </div>

              {/* Two sub-tabs: Gallery + My Documents */}
              <div style={{display:"flex",gap:4,marginBottom:20}}>
                <button onClick={()=>setKPage(0)} style={{padding:"8px 16px",background:"var(--md-primary-container)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-primary-container)"}}>My Documents</button>
                <button onClick={()=>{setTab("knowledge-gallery");setKPage(0);}} style={{padding:"8px 16px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)",transition:"background .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-low)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Gallery</button>
              </div>

              {/* Search */}
              <div style={{position:"relative",marginBottom:16}}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--md-on-surface-variant)" strokeWidth="2" strokeLinecap="round" style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)"}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={kSearch} onChange={e=>{setKSearch(e.target.value);setKPage(0);}} placeholder="Search documents or content..."
                  style={{width:"100%",padding:"12px 14px 12px 42px",background:"var(--md-surface-container-low)",border:"1px solid transparent",borderRadius:28,fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-surface)",outline:"none",transition:"all .2s var(--ease)"}}/>
              </div>

              {/* Upload area */}
              <div style={{padding:24,border:"2px dashed var(--md-outline-variant)",borderRadius:16,textAlign:"center",marginBottom:16,cursor:"pointer",transition:"all .2s var(--ease)"}}
                onClick={()=>kFileRef.current?.click()}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--md-primary)";e.currentTarget.style.background="var(--md-primary-container)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--md-outline-variant)";e.currentTarget.style.background="transparent";}}>
                <div style={{fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)"}}>
                  {uploading?`Uploading ${uploading}...`:"Drop files here or click to upload"}
                </div>
                {uploading&&<div style={{marginTop:8,height:4,background:"var(--md-surface-container-highest)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",background:"var(--md-primary)",borderRadius:2,width:"60%",animation:"pulse 1.5s ease-in-out infinite"}}/></div>}
              </div>

              {/* Document list with status chips */}
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                {pagedDocs.map((d:any)=><div key={d.name} onClick={()=>setSelectedDoc(d.name)} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"var(--md-surface-container-low)",borderRadius:12,cursor:"pointer",transition:"background .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
                  onMouseLeave={e=>e.currentTarget.style.background="var(--md-surface-container-low)"}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-primary)" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</div>
                    <div style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--md-on-surface-variant)"}}>{d.chunks} chunks</div>
                  </div>
                  <StatusChip status="ready"/>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--md-on-surface-variant)" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                </div>)}
                {pagedDocs.length===0&&<p style={{fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-surface-variant)",textAlign:"center",padding:24}}>{kSearch?"No results.":"No documents yet."}</p>}
              </div>

              {/* Pagination */}
              {totalPages>1&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <button disabled={kPage===0} onClick={()=>setKPage(p=>p-1)} style={{padding:"8px 14px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:kPage===0?"default":"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:kPage===0?"var(--md-outline)":"var(--md-on-surface-variant)",opacity:kPage===0?.4:1}}>Previous</button>
                <span style={{fontFamily:"var(--google-sans)",fontSize:13,color:"var(--md-on-surface-variant)"}}>{kPage+1} of {totalPages}</span>
                <button disabled={kPage>=totalPages-1} onClick={()=>setKPage(p=>p+1)} style={{padding:"8px 14px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:kPage>=totalPages-1?"default":"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:kPage>=totalPages-1?"var(--md-outline)":"var(--md-on-surface-variant)",opacity:kPage>=totalPages-1?.4:1}}>Next</button>
              </div>}

              <input ref={kFileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml,.pdf" multiple onChange={async e=>{
                if(!e.target.files)return;
                for(const f of Array.from(e.target.files)){
                  setUploading(f.name);
                  await api.uploadKnowledge(f);
                }
                setUploading(null);
                api.listKnowledge().then(d=>setDocs(d.documents||[]));
                e.target.value="";
              }}/>
            </div>})()}

            {/* ── Knowledge Gallery ── */}
            {tab==="knowledge-gallery"&&<div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                <button onClick={()=>setTab("knowledge-full")} style={{width:36,height:36,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
                </button>
                <h3 style={{flex:1,fontFamily:"var(--google-sans)",fontWeight:500,fontSize:20,color:"var(--md-on-surface)"}}>Knowledge Gallery</h3>
              </div>
              <p style={{fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-surface-variant)",marginBottom:20,lineHeight:1.6}}>
                Install pre-built knowledge packs to augment your AI with domain expertise. Each pack adds curated content for RAG retrieval.
              </p>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))",gap:12}}>
                {GALLERY.map(g=><div key={g.id} style={{padding:20,background:"var(--md-surface-container-low)",borderRadius:16,transition:"all .2s var(--ease)",border:"1px solid transparent",cursor:"pointer"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.borderColor="var(--md-outline-variant)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-primary)",background:"var(--md-primary-container)",padding:"3px 10px",borderRadius:999}}>{g.category}</span>
                    <StatusChip status="available"/>
                  </div>
                  <div style={{fontFamily:"var(--google-sans)",fontSize:15,fontWeight:500,color:"var(--md-on-surface)",marginBottom:6}}>{g.name}</div>
                  <div style={{fontFamily:"var(--sans)",fontSize:13,color:"var(--md-on-surface-variant)",lineHeight:1.5,marginBottom:12}}>{g.desc}</div>
                  <button onClick={e=>{e.stopPropagation();alert(`"${g.name}" will be available for installation in a future update.`);}}
                    style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 16px",background:"var(--md-primary)",color:"var(--md-on-primary)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:13,transition:"all .2s var(--ease)"}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Install
                  </button>
                </div>)}
              </div>
            </div>}

            {/* ── Document Detail Page ── */}
            {selectedDoc&&<div>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
                <button onClick={()=>setSelectedDoc(null)} style={{width:36,height:36,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
                </button>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--md-primary)" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                <h3 style={{flex:1,fontFamily:"var(--google-sans)",fontWeight:500,fontSize:18,color:"var(--md-on-surface)"}}>{selectedDoc}</h3>
              </div>

              {/* Status + info */}
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
                <StatusChip status="ready"/>
                <span style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--md-on-surface-variant)"}}>{selectedDoc.split(".").pop()?.toUpperCase()}</span>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:10,marginBottom:24}}>
                {[{l:"Chunks",v:docs.find((d:any)=>d.name===selectedDoc)?.chunks||0},{l:"Source",v:"Upload"},{l:"Indexed",v:"Yes"}].map(s=>(
                  <div key={s.l} style={{padding:"14px 16px",background:"var(--md-surface-container-low)",borderRadius:12}}>
                    <div style={{fontFamily:"var(--google-sans)",fontSize:11,color:"var(--md-on-surface-variant)",fontWeight:500,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div>
                    <div style={{fontFamily:"var(--google-sans)",fontSize:16,fontWeight:500,color:"var(--md-on-surface)"}}>{s.v}</div>
                  </div>
                ))}
              </div>

              {/* Processing controls */}
              <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:12}}>Processing</h4>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:24}}>
                {/* Re-process */}
                <button onClick={()=>alert("Re-processing will re-index all chunks.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-low)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
                  Re-process
                </button>
                {/* Pause */}
                <button onClick={()=>alert("Processing paused.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-warning)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-tertiary-container)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  Pause
                </button>
                {/* Continue */}
                <button onClick={()=>alert("Processing resumed.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-success)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="color-mix(in srgb, var(--md-success) 8%, transparent)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Continue
                </button>
                {/* Stop */}
                <button onClick={()=>alert("Processing stopped.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  Stop
                </button>
              </div>

              {/* Danger zone */}
              <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-error)",marginBottom:12}}>Danger Zone</h4>
              <button onClick={async()=>{if(confirm(`Delete ${selectedDoc}? This cannot be undone.`)){await api.deleteKnowledge(selectedDoc);api.listKnowledge().then(r=>setDocs(r.documents||[]));setSelectedDoc(null);setTab("knowledge-full");}}}
                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-error)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",transition:"all .2s var(--ease)"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Delete document permanently
              </button>
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
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:16}}>API Keys · {keys.filter((k:any)=>k.is_active).length} active</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {keys.map((k:any)=><div key={k.id} style={{padding:"16px",background:"var(--md-surface-container-low)",borderRadius:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <span style={{width:10,height:10,borderRadius:"50%",background:k.is_active?"var(--md-success)":"var(--md-outline)",flexShrink:0}}/>
                    <span style={{flex:1,fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)"}}>{k.name}</span>
                    <span style={{fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:k.is_active?"var(--md-success)":"var(--md-on-surface-variant)"}}>{k.is_active?"ACTIVE":"REVOKED"}</span>
                  </div>
                  <div style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--md-on-surface-variant)",marginBottom:6}}>{k.key_prefix}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,fontFamily:"var(--google-sans)",fontSize:11,color:"var(--md-on-surface-variant)",marginBottom:k.is_active?10:0}}>
                    <span>{k.total_requests} requests</span>
                    <span style={{color:"var(--md-outline)"}}>·</span>
                    <span>{k.total_tokens} tokens</span>
                    <span style={{color:"var(--md-outline)"}}>·</span>
                    <span>{k.created_at?new Date(k.created_at*1000).toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"})+" "+new Date(k.created_at*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"—"}</span>
                  </div>
                  {k.is_active&&<div style={{display:"flex",gap:6}}>
                    <button onClick={async()=>{await api.revokeApiKey(k.key_prefix);api.listApiKeys().then(r=>setKeys(r.keys||[]));}} style={{fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-error)",background:"transparent",border:0,cursor:"pointer",padding:"6px 12px",borderRadius:999,transition:"background .2s var(--ease)"}}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Revoke</button>
                  </div>}
                </div>)}
              </div>
              <div style={{display:"flex",gap:8}}>
                <input value={newKeyName} onChange={e=>setNewKeyName(e.target.value)} placeholder="Key name" style={{...inputS,flex:1}}
                  onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(!newKeyName.trim())return;api.createApiKey(newKeyName.trim()).then(r=>{setCreatedKey(r.key);setNewKeyName("");api.listApiKeys().then(d=>setKeys(d.keys||[]));});}}}/>
                <button onClick={async()=>{if(!newKeyName.trim())return;const r=await api.createApiKey(newKeyName.trim());setCreatedKey(r.key);setNewKeyName("");api.listApiKeys().then(d=>setKeys(d.keys||[]));}} style={{padding:"10px 20px",background:"var(--md-primary)",color:"var(--md-on-primary)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,whiteSpace:"nowrap"}}>Create</button>
              </div>
              {createdKey&&<div style={{marginTop:12,padding:"16px",background:"var(--md-primary-container)",borderRadius:16}}>
                <div style={{fontFamily:"var(--mono)",fontSize:12,color:"var(--md-on-primary-container)",wordBreak:"break-all",marginBottom:10,lineHeight:1.5}}>
                  <strong>New key:</strong> {createdKey}
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {/* Copy — icon + label on desktop, icon only on mobile */}
                  <button onClick={()=>navigator.clipboard.writeText(createdKey)} title="Copy" style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-primary)",background:"transparent",border:0,cursor:"pointer",padding:"6px 10px",borderRadius:999,transition:"background .2s var(--ease)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    <span className="hide-mobile">Copy</span>
                  </button>
                  {/* Download — icon + label on desktop, icon only on mobile */}
                  <button onClick={()=>{const b=new Blob([JSON.stringify({key:createdKey,created:new Date().toISOString()},null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download="edgeword-key.json";a.click();URL.revokeObjectURL(u);}} title="Download JSON"
                    style={{display:"inline-flex",alignItems:"center",gap:6,fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-primary)",background:"transparent",border:0,cursor:"pointer",padding:"6px 10px",borderRadius:999,transition:"background .2s var(--ease)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container)"}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <span className="hide-mobile">Download JSON</span>
                  </button>
                </div>
                <div style={{fontFamily:"var(--google-sans)",fontSize:11,color:"var(--md-on-primary-container)",opacity:.7,marginTop:6}}>Save this key — it won't be shown again.</div>
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
  const [settingsTab,setSettingsTab]=useState("profile");
  const openSettings=(t:string)=>{setSettingsTab(t);setSettingsOpen(true);};
  const [health,setHealth]=useState<HealthStatus|null>(null);
  const [sections,setSections]=useState<Section[]>([]);
  const [lastSum,setLastSum]=useState(0);
  const [recording,setRecording]=useState(false);
  const scrollRef=useRef<HTMLDivElement>(null);
  const taRef=useRef<HTMLTextAreaElement>(null);
  const mediaRef=useRef<MediaRecorder|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const [showScrollBtn,setShowScrollBtn]=useState(false);

  useEffect(()=>{setAuthed(api.isLoggedIn());},[]);
  const scrollToBottom=useCallback(()=>window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"}),[]);
  useEffect(()=>{scrollToBottom();},[messages,generating,scrollToBottom]);
  useEffect(()=>{
    const onScroll=()=>{const distFromBottom=document.body.scrollHeight-window.scrollY-window.innerHeight;setShowScrollBtn(distFromBottom>300);};
    window.addEventListener("scroll",onScroll,{passive:true});return()=>window.removeEventListener("scroll",onScroll);
  },[]);
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
        <span onClick={()=>openSettings("profile")} style={{width:36,height:36,borderRadius:"50%",background:"var(--md-primary)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:15,color:"var(--md-on-primary)",cursor:"pointer",boxShadow:"0 1px 2px 0 var(--md-shadow),0 1px 3px 1px var(--md-shadow-2)",transition:"box-shadow .2s var(--ease)"}}>M</span>
      </div>

      {/* Stage */}
      <div style={{position:"relative",minHeight:"100vh",padding:"24px 24px 110px"}}>
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

      {/* Scroll to bottom button */}
      {showScrollBtn&&<button onClick={scrollToBottom} style={{position:"fixed",bottom:100,right:24,zIndex:45,width:40,height:40,borderRadius:"50%",background:"var(--md-surface-container-high)",border:"1px solid var(--md-outline-variant)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--md-on-surface-variant)",boxShadow:"0 2px 6px 2px var(--md-shadow-2)",transition:"all .2s var(--ease)",animation:"settle .25s var(--ease-emph) both"}}
        onMouseEnter={e=>{e.currentTarget.style.background="var(--md-primary-container)";e.currentTarget.style.color="var(--md-on-primary-container)";}}
        onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.color="var(--md-on-surface-variant)";}}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14"/><polyline points="19 12 12 19 5 12"/></svg>
      </button>}

      {/* Side actions — desktop only */}
      <nav style={{position:"fixed",left:24,bottom:24,zIndex:45,display:"flex",flexDirection:"column",gap:0,alignItems:"flex-start"}} className="hide-mobile">
        {[{l:"Settings",onClick:()=>openSettings("profile")},{l:"Knowledge",onClick:()=>openSettings("knowledge-full")},{l:"API Keys",onClick:()=>openSettings("keys")},{l:"Sign out",onClick:()=>{if(confirm("Sign out?")){api.logout();setAuthed(false);}},danger:true}].map(a=>(
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
      <Settings open={settingsOpen} onClose={()=>setSettingsOpen(false)} health={health} onLogout={()=>setAuthed(false)} initialTab={settingsTab}/>
    </>
  );
}
