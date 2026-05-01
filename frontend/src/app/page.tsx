"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import * as api from "@/lib/api";
import { Message, Attachment, HealthStatus, Section } from "@/lib/types";
import Markdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import AuthPage from "@/components/AuthPage";

function uid(){return Math.random().toString(36).slice(2,10)}

/* ── Custom Dialog System (module-level, replaces browser confirm/alert) ── */
let _dialogState:{msg:string;type:"confirm"|"alert";resolve:(v:boolean)=>void}|null=null;
let _dialogRender:()=>void=()=>{};

function customConfirm(msg:string):Promise<boolean>{
  return new Promise(resolve=>{_dialogState={msg,type:"confirm",resolve};_dialogRender();});
}
function customAlert(msg:string):Promise<void>{
  return new Promise(resolve=>{_dialogState={msg,type:"alert",resolve:()=>resolve()};_dialogRender();});
}

function DialogProvider(){
  const [,forceUpdate]=useState(0);
  _dialogRender=()=>forceUpdate(n=>n+1);
  const d=_dialogState;
  if(!d) return null;
  const close=(v:boolean)=>{d.resolve(v);_dialogState=null;forceUpdate(n=>n+1);};
  return <div style={{position:"fixed",inset:0,zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={()=>close(false)}>
    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,.32)"}}/>
    <div onClick={e=>e.stopPropagation()} style={{position:"relative",width:"100%",maxWidth:400,background:"var(--md-surface)",borderRadius:24,padding:"24px 28px 20px",boxShadow:"0 24px 38px 3px rgba(60,64,67,.14),0 9px 46px 8px rgba(60,64,67,.12)",animation:"settle .25s var(--ease-emph) both"}}>
      <p style={{fontFamily:"var(--sans)",fontSize:15,color:"var(--md-on-surface)",lineHeight:1.6,marginBottom:20}}>{d.msg}</p>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
        {d.type==="confirm"&&<button onClick={()=>close(false)} style={{padding:"10px 20px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface-variant)"}}>Cancel</button>}
        <button onClick={()=>close(true)} style={{padding:"10px 20px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:d.type==="confirm"?"var(--md-error)":"var(--md-primary)"}}>{d.type==="confirm"?"Confirm":"OK"}</button>
      </div>
    </div>
  </div>;
}
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

/* Scenario templates */
const SCENARIOS=[
  {id:"general",name:"General Assistant",icon:"chat",desc:"Balanced, helpful, concise responses",temp:0.7,maxT:256,ctx:4096,topP:0.9,topK:40,rep:1.1,prompt:"You are EdgeWord Assistant, a helpful AI running locally. Be concise, accurate, and friendly."},
  {id:"creative",name:"Creative Writer",icon:"edit",desc:"Expressive, imaginative, longer output",temp:1.0,maxT:1024,ctx:4096,topP:0.95,topK:80,rep:1.0,prompt:"You are a creative writing assistant. Be expressive, use vivid language, metaphors, and narrative techniques. Take creative risks."},
  {id:"coder",name:"Code Engineer",icon:"code",desc:"Precise, technical, code-focused",temp:0.2,maxT:512,ctx:4096,topP:0.8,topK:20,rep:1.2,prompt:"You are a senior software engineer. Write clean, efficient code. Explain technical concepts precisely. Use proper formatting for code blocks."},
  {id:"analyst",name:"Data Analyst",icon:"chart",desc:"Structured, analytical, data-driven",temp:0.3,maxT:512,ctx:4096,topP:0.85,topK:30,rep:1.15,prompt:"You are a data analyst. Provide structured, quantitative analysis. Use tables, bullet points, and clear metrics. Be precise with numbers."},
];

/* Model gallery (mock) */
const MODEL_GALLERY=[
  {id:"llama-1b",name:"Llama 3.2 1B",size:"771 MB",ram:"1.2 GB",tps:"~15 t/s",status:"installed",desc:"Fast, good quality. Current default."},
  {id:"qwen-05b",name:"Qwen 2.5 0.5B",size:"469 MB",ram:"800 MB",tps:"~33 t/s",status:"available",desc:"Fastest. Lower quality on complex tasks."},
  {id:"llama-3b",name:"Llama 3.2 3B",size:"2.0 GB",ram:"3 GB",tps:"~8 t/s",status:"available",desc:"Better reasoning. Needs more RAM."},
  {id:"mistral-7b",name:"Mistral 7B",size:"4.1 GB",ram:"5.5 GB",tps:"~4 t/s",status:"available",desc:"Strong general model. Requires 8+ GB free RAM."},
  {id:"phi-3",name:"Phi-3 Mini 3.8B",size:"2.3 GB",ram:"3.5 GB",tps:"~7 t/s",status:"available",desc:"Microsoft's compact powerhouse. Great at reasoning."},
  {id:"llama-8b",name:"Llama 3 8B",size:"4.6 GB",ram:"5.5 GB",tps:"~3 t/s",status:"available",desc:"Spec target. Best quality but slow on this CPU."},
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
/* ── Code Block with header, language tag, copy button ── */
function CodeBlock({code,lang}:{code:string;lang:string}){
  const [copied,setCopied]=useState(false);
  return(
    <div style={{margin:"16px 0",borderRadius:14,overflow:"hidden",background:"#1E1E2E",boxShadow:"0 2px 8px rgba(0,0,0,.15)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px 10px 18px",background:"#181825",borderBottom:"1px solid rgba(255,255,255,.06)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {/* Traffic light dots */}
          <div style={{display:"flex",gap:5}}>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#F38BA8"}}/>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#FAB387"}}/>
            <span style={{width:10,height:10,borderRadius:"50%",background:"#A6E3A1"}}/>
          </div>
          <span style={{fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"rgba(205,214,244,.5)",letterSpacing:".04em"}}>{lang||"code"}</span>
        </div>
        <button onClick={()=>{navigator.clipboard.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),1500);}}
          style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 12px",background:copied?"rgba(166,227,161,.12)":"rgba(205,214,244,.06)",border:"1px solid rgba(205,214,244,.08)",borderRadius:8,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:copied?"#A6E3A1":"rgba(205,214,244,.6)",transition:"all .2s"}}
          onMouseEnter={e=>{if(!copied){e.currentTarget.style.background="rgba(205,214,244,.1)";e.currentTarget.style.color="rgba(205,214,244,.9)";}}}
          onMouseLeave={e=>{if(!copied){e.currentTarget.style.background="rgba(205,214,244,.06)";e.currentTarget.style.color="rgba(205,214,244,.6)";}}}>
          {copied?<>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            Copied
          </>:<>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </>}
        </button>
      </div>
      {/* Code with syntax highlighting */}
      <SyntaxHighlighter
        language={lang||"text"}
        style={oneDark}
        customStyle={{margin:0,padding:"16px 20px",background:"#1E1E2E",fontSize:13,lineHeight:1.8,borderRadius:0}}
        codeTagProps={{style:{fontFamily:"var(--mono)"}}}
        showLineNumbers={code.split("\n").length>3}
        lineNumberStyle={{color:"rgba(205,214,244,.2)",fontSize:11,minWidth:"2em",paddingRight:12,userSelect:"none"}}
      >{code}</SyntaxHighlighter>
    </div>
  );
}

function Msg({msg,isUser,onRerun}:{msg:Message;isUser:boolean;onRerun?:()=>void}){
  const isError=!isUser&&msg.text.startsWith("Error:");
  const [copied,setCopied]=useState(false);
  return(
    <article style={{position:"relative",padding:`0 0 var(--message-pad-y)`,paddingLeft:48,animation:"settle .35s var(--ease-emph) both"}}>
      <span style={{position:"absolute",left:0,top:0}}>{isUser?<UserAvatar/>:isError?
        <div style={{width:"var(--avatar-size)",height:"var(--avatar-size)",borderRadius:"50%",background:"var(--md-error-container)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-error)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
      :<AsstAvatar/>}</span>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <span style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,color:isError?"var(--md-error)":"var(--md-on-surface)"}}>{isUser?"You":isError?"Error":"EdgeWord"}</span>
        <span style={{fontFamily:"var(--google-sans)",fontSize:12,color:"var(--md-on-surface-variant)",fontWeight:400}}>{fmtTime(msg.timestamp)}</span>
        {msg.autoProfile&&<span style={{padding:"2px 8px",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:10,fontWeight:500,color:"var(--md-tertiary)",background:"var(--md-tertiary-container)"}}>auto: {msg.autoProfile}</span>}
        {msg.skillUsed&&<span style={{padding:"2px 8px",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:10,fontWeight:500,color:"var(--md-secondary)",background:"var(--md-secondary-container)"}}>skill: {msg.skillUsed}</span>}
        {isError&&<button onClick={()=>customAlert(msg.text)} title="View error details" style={{width:28,height:28,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-error)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
          onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        </button>}
      </div>
      {isError?
        <div style={{padding:"12px 16px",background:"var(--md-error-container)",borderRadius:12,fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-error-container)",lineHeight:1.5}}>
          Something went wrong. Tap the info icon for details.
        </div>
      :
        <div className="msg-body" style={{fontFamily:"var(--sans)",fontSize:15.5,lineHeight:1.6,color:"var(--md-on-surface-variant)",fontWeight:400,maxWidth:"62ch"}}>
          <Markdown components={{
            p:({children})=><p style={{marginBottom:".85em"}}>{children}</p>,
            strong:({children})=><strong style={{fontWeight:500,color:"var(--md-on-surface)"}}>{children}</strong>,
            em:({children})=><em style={{color:"var(--md-primary)",fontStyle:"normal",fontWeight:500}}>{children}</em>,
            code:({children,className})=>{
              if(className){
                const lang=className.replace("language-","");
                const code=String(children).replace(/\n$/,"");
                return <CodeBlock code={code} lang={lang}/>;
              }
              return <code style={{fontFamily:"var(--mono)",fontSize:"0.9em",padding:"2px 6px",background:"var(--md-surface-container)",borderRadius:4,color:"var(--md-on-surface)"}}>{children}</code>;
            },
            pre:({children})=><>{children}</>,
            ul:({children})=><ul style={{paddingLeft:20,marginBottom:".85em"}}>{children}</ul>,
            ol:({children})=><ol style={{paddingLeft:20,marginBottom:".85em"}}>{children}</ol>,
            li:({children})=><li style={{marginBottom:4}}>{children}</li>,
            a:({href,children})=><a href={href} target="_blank" rel="noopener" style={{color:"var(--md-primary)",textDecoration:"underline"}}>{children}</a>,
            h1:({children})=><h1 style={{fontFamily:"var(--google-sans)",fontSize:20,fontWeight:500,color:"var(--md-on-surface)",margin:"16px 0 8px"}}>{children}</h1>,
            h2:({children})=><h2 style={{fontFamily:"var(--google-sans)",fontSize:18,fontWeight:500,color:"var(--md-on-surface)",margin:"14px 0 6px"}}>{children}</h2>,
            h3:({children})=><h3 style={{fontFamily:"var(--google-sans)",fontSize:16,fontWeight:500,color:"var(--md-on-surface)",margin:"12px 0 4px"}}>{children}</h3>,
            blockquote:({children})=><blockquote style={{borderLeft:"3px solid var(--md-primary)",paddingLeft:16,margin:"12px 0",color:"var(--md-on-surface-variant)"}}>{children}</blockquote>,
            hr:()=><hr style={{border:"none",borderTop:"1px solid var(--md-outline-variant)",margin:"16px 0"}}/>,
            table:({children})=><div style={{overflowX:"auto",margin:"12px 0"}}><table style={{borderCollapse:"collapse",width:"100%",fontFamily:"var(--sans)",fontSize:13}}>{children}</table></div>,
            th:({children})=><th style={{padding:"8px 12px",borderBottom:"2px solid var(--md-outline)",textAlign:"left",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,color:"var(--md-on-surface)"}}>{children}</th>,
            td:({children})=><td style={{padding:"8px 12px",borderBottom:"1px solid var(--md-outline-variant)",color:"var(--md-on-surface-variant)"}}>{children}</td>,
          }}>{msg.text}</Markdown>
        </div>
      }
      {msg.toolResult&&<div style={{margin:"12px 0",padding:"12px 16px",background:"var(--md-surface-container)",borderRadius:8,fontFamily:"var(--mono)",fontSize:13,color:"var(--md-on-surface-variant)",border:"1px solid var(--md-outline-variant)"}}>{msg.toolResult}</div>}
      {/* Reasoning chain — collapsible stages */}
      {msg.reasoning&&Object.keys(msg.reasoning).length>0&&(()=>{
        const [expanded,setExpanded]=useState(false);
        const stages=["analyse","retrieve","reason","synthesise"];
        const stageLabels:{[k:string]:string}={analyse:"Analyse",retrieve:"Retrieve",reason:"Reason",synthesise:"Synthesise"};
        const stageIcons:{[k:string]:string}={analyse:"search",retrieve:"library",reason:"psychology",synthesise:"edit"};
        return <div style={{margin:"12px 0"}}>
          <button onClick={()=>setExpanded(!expanded)} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"var(--md-primary-container)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-on-primary-container)",transition:"all .2s var(--ease)"}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{transform:expanded?"rotate(90deg)":"rotate(0)",transition:"transform .2s"}}><polyline points="9 18 15 12 9 6"/></svg>
            Reasoning chain · {Object.keys(msg.reasoning).length} stages
          </button>
          {expanded&&<div style={{marginTop:10,display:"flex",flexDirection:"column",gap:8}}>
            {stages.filter(s=>msg.reasoning![s]).map(s=>(
              <div key={s} style={{padding:"10px 14px",background:"var(--md-surface-container-low)",borderRadius:10,borderLeft:"3px solid var(--md-primary)"}}>
                <div style={{fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-primary)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{stageLabels[s]||s}</div>
                <div style={{fontFamily:"var(--sans)",fontSize:13,lineHeight:1.6,color:"var(--md-on-surface-variant)",whiteSpace:"pre-wrap"}}>{msg.reasoning![s]}</div>
              </div>
            ))}
          </div>}
        </div>;
      })()}
      {msg.ragSources&&msg.ragSources.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>{msg.ragSources.map((s,i)=><span key={i} style={{padding:"4px 10px",background:"var(--md-primary-container)",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-on-primary-container)"}}>{s}</span>)}</div>}
      {!isError&&msg.tokens!=null&&<div style={{marginTop:8,fontFamily:"var(--mono)",fontSize:11,color:"var(--md-on-surface-variant)",opacity:.6}}>{msg.tokens} tok{msg.tps!=null&&` · ${msg.tps.toFixed(1)} t/s`}{msg.cached&&" · cached"}</div>}
      {/* Action icons — copy + re-run */}
      {!isError&&<div style={{display:"flex",gap:2,marginTop:6,opacity:0,transition:"opacity .2s var(--ease)"}} className="msg-actions">
        <button onClick={()=>{navigator.clipboard.writeText(msg.text);setCopied(true);setTimeout(()=>setCopied(false),1500);}} title="Copy"
          style={{width:32,height:32,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:copied?"var(--md-primary)":"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all .2s var(--ease)"}}
          onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          {copied?<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          :<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
        </button>
        {onRerun&&<button onClick={onRerun} title="Re-run"
          style={{width:32,height:32,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all .2s var(--ease)"}}
          onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
        </button>}
      </div>}
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
function Settings({open,onClose,health,onLogout,initialTab="profile",autoModeOn=false,setAutoModeOn}:{open:boolean;onClose:()=>void;health:HealthStatus|null;onLogout:()=>void;initialTab?:string;autoModeOn?:boolean;setAutoModeOn?:(v:boolean)=>void}){
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
  const [gPage,setGPage]=useState(0);
  const K_PER_PAGE=10;
  const G_PER_PAGE=6;
  const [maxT,setMaxT]=useState(256);
  const [ctxWin,setCtxWin]=useState(4096);
  const [topP,setTopP]=useState(0.9);
  const [topK,setTopK]=useState(40);
  const [repPen,setRepPen]=useState(1.1);
  const [sysPrompt,setSysPrompt]=useState("You are EdgeWord Assistant, a helpful AI. Be concise and clear.");
  const [modelTab,setModelTab]=useState("config");
  const [scenarioName,setScenarioName]=useState("");
  const [customScenarios,setCustomScenarios]=useState<any[]>([]);
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

  const tabs=[{id:"profile",label:"Profile"},{id:"appearance",label:"Appearance"},{id:"knowledge-full",label:"Knowledge"},{id:"model",label:"Model"},{id:"keys",label:"API Keys"}];

  return(
    <div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 24px 24px",overflowY:"auto"}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{position:"absolute",inset:0,background:"rgba(32,33,36,.32)",opacity:1,transition:"opacity .25s var(--ease)"}}/>
      <section style={{position:"relative",width:"100%",maxWidth:1100,maxHeight:"calc(100vh - 80px)",overflowY:"auto",background:"var(--md-surface)",borderRadius:24,padding:"28px 36px 36px",transform:"translateY(0) scale(1)",boxShadow:"0 24px 38px 3px rgba(60,64,67,.14),0 9px 46px 8px rgba(60,64,67,.12),0 11px 15px -7px rgba(60,64,67,.20)",animation:"settle .35s var(--ease-emph) both"}} className="scrollbar-hide">
        <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24,paddingBottom:16,borderBottom:"1px solid var(--md-outline-variant)"}}>
          <h2 style={{fontFamily:"var(--google-sans)",fontWeight:400,fontSize:24,color:"var(--md-on-surface)",display:"flex",alignItems:"center",gap:12}}>Settings <span style={{fontFamily:"var(--google-sans)",fontSize:12,color:"var(--md-on-surface-variant)",fontWeight:500,padding:"4px 10px",background:"var(--md-surface-container)",borderRadius:999}}>workspace</span></h2>
          <button onClick={onClose} style={{background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-primary)",padding:"8px 14px",transition:"background .2s var(--ease)"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--md-primary-container)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Close</button>
        </header>

        <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:32}}>
          <div style={{display:"flex",flexDirection:"column",gap:2}}>
            {tabs.map(t=>{const isActive=tab===t.id||(t.id==="knowledge-full"&&(tab==="knowledge-gallery"||selectedDoc));return<button key={t.id} onClick={()=>{setTab(t.id);setSelectedDoc(null);}} style={{textAlign:"left",background:isActive?"var(--md-primary-container)":"transparent",border:0,cursor:"pointer",padding:"10px 16px",borderRadius:999,fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,color:isActive?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",letterSpacing:".01em",transition:"background .2s var(--ease)"}}>{t.label}</button>;})}
          </div>

          <div style={{minHeight:300}}>
            {/* ── Profile ── */}
            {tab==="profile"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Profile</h3>
              {[{k:"Display name",f:"display_name",ph:"Your name"},{k:"Email",f:"email",ph:"you@example.com"},{k:"Username",f:"username",ph:"",ro:true}].map(({k,f,ph,ro})=>(
                <div key={k} style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:24,padding:"16px 0",borderTop:"1px solid var(--md-outline-variant)",alignItems:"center"}}>
                  <span style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)"}}>{k}</span>
                  <input key={`${f}-${profile[f]||""}`} defaultValue={profile[f]||""} placeholder={ph} readOnly={!!ro}
                    onBlur={e=>{if(!ro)saveP(f,e.target.value);}}
                    style={{...inputS,opacity:ro?.6:1,cursor:ro?"default":"text"}}/>
                </div>
              ))}
              <div style={{marginTop:24}}><button onClick={()=>{customConfirm("Sign out?").then(ok=>{if(ok){api.logout();onLogout();}})}} style={{padding:"10px 20px",background:"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",transition:"background .2s var(--ease)"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>Sign out</button></div>
            </div>}

            {/* ── Appearance ── */}
            {tab==="appearance"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Theme</h3>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {(["light","dark","system"] as const).map(m=><button key={m} onClick={()=>{setTheme(m);setPref("theme",m);}} style={{flex:1,padding:"10px 0",background:theme===m?"var(--md-primary-container)":"var(--md-surface-container-low)",border:theme===m?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:theme===m?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>{m==="light"?"Light":m==="dark"?"Dark":"System"}</button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Color Theme</h3>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:24}}>
                {VARIANTS.map(v=><button key={v.id} onClick={()=>{setVariant(v.id);setPref("variant",v.id);}} style={{padding:14,background:variant===v.id?"var(--md-primary-container)":"var(--md-surface-container-low)",border:variant===v.id?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:16,cursor:"pointer",textAlign:"left",transition:"all .15s var(--ease)"}}>
                  <div style={{display:"flex",gap:4,marginBottom:8}}>{v.colors.map((c,i)=><span key={i} style={{width:16,height:16,borderRadius:"50%",background:c}}/>)}</div>
                  <div style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface)"}}>{v.name}</div>
                  {v.tag&&<div style={{fontFamily:"var(--google-sans)",fontSize:10,color:"var(--md-on-surface-variant)",marginTop:2}}>{v.tag}</div>}
                </button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Density</h3>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {(["comfortable","compact"] as const).map(d=><button key={d} onClick={()=>{setDensity(d);setPref("density",d);}} style={{flex:1,padding:"10px 0",background:density===d?"var(--md-primary-container)":"var(--md-surface-container-low)",border:density===d?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:density===d?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>{d[0].toUpperCase()+d.slice(1)}</button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Text Size</h3>
              <div style={{display:"flex",gap:8,marginBottom:24}}>
                {(["small","default","large"] as const).map(s=><button key={s} onClick={()=>{setScale(s);setPref("scale",s);}} style={{flex:1,padding:"10px 0",background:scale===s?"var(--md-primary-container)":"var(--md-surface-container-low)",border:scale===s?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:s==="small"?12:s==="large"?15:13,fontWeight:500,color:scale===s?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>Aa</button>)}
              </div>

              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Motion</h3>
              <div style={{display:"flex",gap:8,marginBottom:16}}>
                {(["standard","reduced","auto"] as const).map(m=><button key={m} onClick={()=>{setMotion(m);setPref("motion",m);}} style={{flex:1,padding:"10px 0",background:motion===m?"var(--md-primary-container)":"var(--md-surface-container-low)",border:motion===m?"2px solid var(--md-primary)":"2px solid transparent",borderRadius:12,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:motion===m?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .15s var(--ease)"}}>{m[0].toUpperCase()+m.slice(1)}</button>)}
              </div>

              <button onClick={()=>{["theme","variant","density","scale","motion"].forEach(k=>{const d=k==="theme"?"light":k==="variant"?"classic":k==="density"?"comfortable":k==="scale"?"default":"standard";setPref(k,d);});setTheme("light");setVariant("classic");setDensity("comfortable");setScale("default");setMotion("standard");}}
                style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-primary)",background:"transparent",border:0,cursor:"pointer",padding:"8px 0"}}>Reset to defaults</button>
            </div>}

            {/* ── Knowledge ── */}
            {/* ── Knowledge ── */}
            {tab==="knowledge-full"&&!selectedDoc&&(()=>{
              const filteredDocs=docs.filter((d:any)=>!kSearch||d.name.toLowerCase().includes(kSearch.toLowerCase()));
              const totalPages=Math.ceil(filteredDocs.length/K_PER_PAGE);
              const pagedDocs=filteredDocs.slice(kPage*K_PER_PAGE,(kPage+1)*K_PER_PAGE);
              return <div>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
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
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(200px, 1fr))",gap:10,marginBottom:16}}>
                {pagedDocs.map((d:any)=><div key={d.name} onClick={()=>setSelectedDoc(d.name)} style={{padding:"14px",background:"var(--md-surface-container-low)",borderRadius:14,cursor:"pointer",transition:"all .2s var(--ease)",border:"1px solid transparent"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.borderColor="var(--md-outline-variant)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--md-primary)" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
                    <StatusChip status="ready"/>
                  </div>
                  <div style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:4}}>{d.name}</div>
                  <div style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--md-on-surface-variant)"}}>{d.chunks} chunks</div>
                </div>)}
                {pagedDocs.length===0&&<p style={{fontFamily:"var(--sans)",fontSize:14,color:"var(--md-on-surface-variant)",textAlign:"center",padding:24,gridColumn:"1 / -1"}}>{kSearch?"No results.":"No documents yet."}</p>}
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

              {(()=>{const gTotal=Math.ceil(GALLERY.length/G_PER_PAGE);const paged=GALLERY.slice(gPage*G_PER_PAGE,(gPage+1)*G_PER_PAGE);return<>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))",gap:12,marginBottom:16}}>
                {paged.map(g=><div key={g.id} style={{padding:20,background:"var(--md-surface-container-low)",borderRadius:16,transition:"all .2s var(--ease)",border:"1px solid transparent",cursor:"pointer"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.borderColor="var(--md-outline-variant)";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontFamily:"var(--google-sans)",fontSize:11,fontWeight:500,color:"var(--md-primary)",background:"var(--md-primary-container)",padding:"3px 10px",borderRadius:999}}>{g.category}</span>
                    <StatusChip status="available"/>
                  </div>
                  <div style={{fontFamily:"var(--google-sans)",fontSize:15,fontWeight:500,color:"var(--md-on-surface)",marginBottom:6}}>{g.name}</div>
                  <div style={{fontFamily:"var(--sans)",fontSize:13,color:"var(--md-on-surface-variant)",lineHeight:1.5,marginBottom:12}}>{g.desc}</div>
                  <button onClick={e=>{e.stopPropagation();customAlert(`"${g.name}" will be available for installation in a future update.`);}}
                    style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 16px",background:"var(--md-primary)",color:"var(--md-on-primary)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:13,transition:"all .2s var(--ease)"}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Install
                  </button>
                </div>)}
              </div>
              {gTotal>1&&<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                <button disabled={gPage===0} onClick={()=>setGPage(p=>p-1)} style={{padding:"8px 14px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:gPage===0?"default":"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:gPage===0?"var(--md-outline)":"var(--md-on-surface-variant)",opacity:gPage===0?.4:1}}>Previous</button>
                <span style={{fontFamily:"var(--google-sans)",fontSize:13,color:"var(--md-on-surface-variant)"}}>{gPage+1} of {gTotal}</span>
                <button disabled={gPage>=gTotal-1} onClick={()=>setGPage(p=>p+1)} style={{padding:"8px 14px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:gPage>=gTotal-1?"default":"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:gPage>=gTotal-1?"var(--md-outline)":"var(--md-on-surface-variant)",opacity:gPage>=gTotal-1?.4:1}}>Next</button>
              </div>}
              </>;})()}
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
                <button onClick={()=>customAlert("Re-processing will re-index all chunks.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface-variant)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-low)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>
                  Re-process
                </button>
                {/* Pause */}
                <button onClick={()=>customAlert("Processing paused.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-warning)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-tertiary-container)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                  Pause
                </button>
                {/* Continue */}
                <button onClick={()=>customAlert("Processing resumed.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-success)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="color-mix(in srgb, var(--md-success) 8%, transparent)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  Continue
                </button>
                {/* Stop */}
                <button onClick={()=>customAlert("Processing stopped.")} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-outline)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",transition:"all .2s var(--ease)"}}
                  onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  Stop
                </button>
              </div>

              {/* Danger zone */}
              <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-error)",marginBottom:12}}>Danger Zone</h4>
              <button onClick={async()=>{customConfirm(`Delete ${selectedDoc}? This cannot be undone.`).then(async ok=>{if(ok){await api.deleteKnowledge(selectedDoc);api.listKnowledge().then(r=>setDocs(r.documents||[]));setSelectedDoc(null);setTab("knowledge-full");}})}}
                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"10px 16px",background:"transparent",border:"1px solid var(--md-error)",borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-error)",transition:"all .2s var(--ease)"}}
                onMouseEnter={e=>e.currentTarget.style.background="var(--md-error-container)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                Delete document permanently
              </button>
            </div>}

            {/* ── Model ── */}
            {tab==="model"&&<div>
              {/* Sub-tabs */}
              <div style={{display:"flex",gap:4,marginBottom:16}}>
                {[{id:"config",l:"Configuration"},{id:"scenarios",l:"Scenarios"},{id:"gallery",l:"Model Gallery"}].map(t=>
                  <button key={t.id} onClick={()=>setModelTab(t.id)} style={{padding:"8px 14px",background:modelTab===t.id?"var(--md-primary-container)":"transparent",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:modelTab===t.id?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",transition:"all .2s var(--ease)"}}>{t.l}</button>
                )}
              </div>

              {/* ── Configuration ── */}
              {modelTab==="config"&&<div>
                {/* Active model */}
                <div style={{padding:14,background:"var(--md-surface-container-low)",borderRadius:12,marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:12,background:"var(--md-primary-container)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--md-primary)" strokeWidth="2" strokeLinecap="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)"}}>{health?.model?.replace(".gguf","").replace("Llama-3.2-1B-Instruct-Q4_K_M","Llama 3.2 1B")||"No model"}</div>
                    <div style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--md-on-surface-variant)"}}>Q4_K_M · CPU · 4 threads</div>
                  </div>
                  <StatusChip status="ready"/>
                </div>

                {/* Auto-Mode toggle */}
                <div style={{padding:14,background:autoModeOn?"var(--md-primary-container)":"var(--md-surface-container-low)",borderRadius:12,marginBottom:16,display:"flex",alignItems:"center",gap:12,cursor:"pointer",transition:"all .2s var(--ease)",border:`1px solid ${autoModeOn?"var(--md-primary)":"transparent"}`}}
                  onClick={()=>{const next=!autoModeOn;setAutoModeOn?.(next);api.saveSettings({auto_mode:next});}}>
                  <div style={{width:40,height:40,borderRadius:12,background:autoModeOn?"var(--md-primary)":"var(--md-surface-container)",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s var(--ease)"}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={autoModeOn?"#fff":"var(--md-on-surface-variant)"} strokeWidth="2" strokeLinecap="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)"}}>Auto-Mode {autoModeOn&&<span style={{fontFamily:"var(--google-sans)",fontSize:11,color:"var(--md-primary)",fontWeight:500}}>ON</span>}</div>
                    <div style={{fontFamily:"var(--sans)",fontSize:12,color:"var(--md-on-surface-variant)"}}>{autoModeOn?"Parameters auto-selected per message":"Manually configure parameters below"}</div>
                  </div>
                  <div style={{width:44,height:24,borderRadius:12,background:autoModeOn?"var(--md-primary)":"var(--md-outline)",padding:2,cursor:"pointer",transition:"all .2s var(--ease)"}}>
                    <div style={{width:20,height:20,borderRadius:10,background:"#fff",transform:autoModeOn?"translateX(20px)":"translateX(0)",transition:"transform .2s var(--ease)"}}/>
                  </div>
                </div>

                {/* System Prompt + Parameters (disabled when auto-mode) */}
                <div style={{opacity:autoModeOn?.4:1,pointerEvents:autoModeOn?"none":"auto",transition:"opacity .2s var(--ease)"}}>
                {autoModeOn&&<div style={{padding:"8px 14px",background:"var(--md-primary-container)",borderRadius:8,marginBottom:12,fontFamily:"var(--google-sans)",fontSize:12,color:"var(--md-on-primary-container)"}}>Parameters are auto-managed. Disable Auto-Mode to edit manually.</div>}
                <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:8}}>System Prompt</h4>
                <textarea value={sysPrompt} onChange={e=>setSysPrompt(e.target.value)} rows={3}
                  style={{width:"100%",padding:"12px 14px",background:"var(--md-surface-container-low)",border:"1px solid transparent",borderRadius:12,fontFamily:"var(--sans)",fontSize:13,color:"var(--md-on-surface)",outline:"none",resize:"vertical",lineHeight:1.6,marginBottom:16,transition:"all .2s var(--ease)"}}
                  onFocus={e=>{e.currentTarget.style.borderColor="var(--md-primary)";e.currentTarget.style.background="var(--md-surface)";}}
                  onBlur={e=>{e.currentTarget.style.borderColor="transparent";e.currentTarget.style.background="var(--md-surface-container-low)";}}/>

                {/* Parameters grid */}
                <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Parameters</h4>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                  {/* Each parameter as a mini card with slider */}
                  {[
                    {l:"Temperature",v:temp,set:(n:number)=>{setTemp(n);localStorage.setItem("edgeword_temperature",String(n));api.saveSettings({max_tokens:maxT,temperature:n});},min:0,max:2,step:0.05,desc:"Randomness"},
                    {l:"Max Tokens",v:maxT,set:(n:number)=>{setMaxT(n);localStorage.setItem("edgeword_max_tokens",String(n));api.saveSettings({max_tokens:n,temperature:temp});},min:64,max:2048,step:64,desc:"Output length"},
                    {l:"Context Window",v:ctxWin,set:(n:number)=>{setCtxWin(n);localStorage.setItem("edgeword_context_window",String(n));},min:512,max:8192,step:512,desc:"Memory size"},
                    {l:"Top-P",v:topP,set:(n:number)=>{setTopP(n);localStorage.setItem("edgeword_top_p",String(n));},min:0,max:1,step:0.05,desc:"Nucleus sampling"},
                    {l:"Top-K",v:topK,set:(n:number)=>{setTopK(n);localStorage.setItem("edgeword_top_k",String(n));},min:1,max:100,step:1,desc:"Token candidates"},
                    {l:"Repeat Penalty",v:repPen,set:(n:number)=>{setRepPen(n);localStorage.setItem("edgeword_repeat_penalty",String(n));},min:1.0,max:2.0,step:0.05,desc:"Repetition control"},
                  ].map(p=>(
                    <div key={p.l} style={{padding:12,background:"var(--md-surface-container-low)",borderRadius:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div>
                          <div style={{fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-on-surface)"}}>{p.l}</div>
                          <div style={{fontFamily:"var(--google-sans)",fontSize:10,color:"var(--md-on-surface-variant)"}}>{p.desc}</div>
                        </div>
                        <span style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:500,color:"var(--md-primary)",minWidth:48,textAlign:"right"}}>{p.step<1?p.v.toFixed(2):p.v}</span>
                      </div>
                      <input type="range" min={p.min} max={p.max} step={p.step} value={p.v} onChange={e=>p.set(Number(e.target.value))}
                        style={{width:"100%",height:4,borderRadius:2,appearance:"none",cursor:"pointer",accentColor:"var(--md-primary)",background:`linear-gradient(to right, var(--md-primary) ${(p.v-p.min)/(p.max-p.min)*100}%, var(--md-outline-variant) ${(p.v-p.min)/(p.max-p.min)*100}%)`}}/>
                    </div>
                  ))}
                </div>

                {/* Save as scenario */}
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input value={scenarioName} onChange={e=>setScenarioName(e.target.value)} placeholder="Save as scenario..." style={{...inputS,flex:1}}/>
                  <button onClick={()=>{if(!scenarioName.trim())return;setCustomScenarios(p=>[...p,{id:uid(),name:scenarioName.trim(),temp,maxT,ctx:ctxWin,topP,topK,rep:repPen,prompt:sysPrompt}]);setScenarioName("");}}
                    style={{padding:"10px 16px",background:"var(--md-primary)",color:"var(--md-on-primary)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:13,whiteSpace:"nowrap"}}>Save</button>
                </div>
                </div>{/* close auto-mode disabled wrapper */}
              </div>}

              {/* ── Scenarios ── */}
              {modelTab==="scenarios"&&<div>
                <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Pre-built Scenarios</h4>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
                  {SCENARIOS.map(s=>(
                    <div key={s.id} onClick={()=>{setTemp(s.temp);setMaxT(s.maxT);setCtxWin(s.ctx);setTopP(s.topP);setTopK(s.topK);setRepPen(s.rep);setSysPrompt(s.prompt);localStorage.setItem("edgeword_temperature",String(s.temp));localStorage.setItem("edgeword_max_tokens",String(s.maxT));api.saveSettings({max_tokens:s.maxT,temperature:s.temp});setModelTab("config");}}
                      style={{padding:16,background:"var(--md-surface-container-low)",borderRadius:16,cursor:"pointer",transition:"all .2s var(--ease)",border:"1px solid transparent"}}
                      onMouseEnter={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.borderColor="var(--md-outline-variant)";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <div style={{width:32,height:32,borderRadius:10,background:"var(--md-primary-container)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--md-primary)" strokeWidth="2" strokeLinecap="round">
                            {s.icon==="chat"&&<><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></>}
                            {s.icon==="edit"&&<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>}
                            {s.icon==="code"&&<><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>}
                            {s.icon==="chart"&&<><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></>}
                          </svg>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)"}}>{s.name}</div>
                        </div>
                      </div>
                      <div style={{fontFamily:"var(--sans)",fontSize:12,color:"var(--md-on-surface-variant)",lineHeight:1.5,marginBottom:8}}>{s.desc}</div>
                      <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--md-on-surface-variant)",display:"flex",flexWrap:"wrap",gap:6}}>
                        <span>T:{s.temp}</span><span>Tok:{s.maxT}</span><span>P:{s.topP}</span><span>K:{s.topK}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Custom scenarios */}
                {customScenarios.length>0&&<>
                  <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Your Scenarios</h4>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    {customScenarios.map(s=>(
                      <div key={s.id} onClick={()=>{setTemp(s.temp);setMaxT(s.maxT);setCtxWin(s.ctx);setTopP(s.topP);setTopK(s.topK);setRepPen(s.rep);setSysPrompt(s.prompt);localStorage.setItem("edgeword_temperature",String(s.temp));localStorage.setItem("edgeword_max_tokens",String(s.maxT));api.saveSettings({max_tokens:s.maxT,temperature:s.temp});setModelTab("config");}}
                        style={{padding:14,background:"var(--md-surface-container-low)",borderRadius:14,cursor:"pointer",transition:"all .2s var(--ease)",border:"1px solid transparent",display:"flex",alignItems:"center",gap:10}}
                        onMouseEnter={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.borderColor="var(--md-outline-variant)";}}
                        onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}}>
                        <div style={{width:28,height:28,borderRadius:8,background:"var(--md-tertiary-container)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--md-tertiary)" strokeWidth="2" strokeLinecap="round"><path d="M12 2v20"/><path d="M2 12h20"/></svg>
                        </div>
                        <div>
                          <div style={{fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:"var(--md-on-surface)"}}>{s.name}</div>
                          <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--md-on-surface-variant)"}}>T:{s.temp} · Tok:{s.maxT}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>}
              </div>}

              {/* ── Model Gallery ── */}
              {modelTab==="gallery"&&<div>
                <h4 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>Available Models</h4>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {MODEL_GALLERY.map(m=>(
                    <div key={m.id} style={{padding:16,background:"var(--md-surface-container-low)",borderRadius:16,transition:"all .2s var(--ease)",border:"1px solid transparent"}}
                      onMouseEnter={e=>{e.currentTarget.style.background="var(--md-surface-container-high)";e.currentTarget.style.borderColor="var(--md-outline-variant)";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <div style={{fontFamily:"var(--google-sans)",fontSize:14,fontWeight:500,color:"var(--md-on-surface)"}}>{m.name}</div>
                        <StatusChip status={m.status}/>
                      </div>
                      <div style={{fontFamily:"var(--sans)",fontSize:12,color:"var(--md-on-surface-variant)",lineHeight:1.5,marginBottom:10}}>{m.desc}</div>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                        <span style={{padding:"3px 8px",background:"var(--md-surface-container)",borderRadius:6,fontFamily:"var(--mono)",fontSize:10,color:"var(--md-on-surface-variant)"}}>{m.size}</span>
                        <span style={{padding:"3px 8px",background:"var(--md-surface-container)",borderRadius:6,fontFamily:"var(--mono)",fontSize:10,color:"var(--md-on-surface-variant)"}}>RAM: {m.ram}</span>
                        <span title="Estimated performance on this machine" style={{padding:"3px 8px",background:"var(--md-surface-container)",borderRadius:6,fontFamily:"var(--mono)",fontSize:10,color:"var(--md-primary)",display:"flex",alignItems:"center",gap:4,cursor:"help"}}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                          {m.tps}
                        </span>
                      </div>
                      {m.status==="available"&&<button onClick={()=>customAlert(`Downloading ${m.name}... This feature will be available in a future update.`)}
                        style={{display:"inline-flex",alignItems:"center",gap:6,padding:"8px 14px",background:"var(--md-primary)",color:"var(--md-on-primary)",border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12}}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        Download
                      </button>}
                      {m.status==="installed"&&<span style={{fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-success)"}}>Currently active</span>}
                    </div>
                  ))}
                </div>
              </div>}
            </div>}

            {/* ── API Keys ── */}
            {tab==="keys"&&<div>
              <h3 style={{fontFamily:"var(--google-sans)",fontWeight:500,fontSize:12,letterSpacing:".08em",textTransform:"uppercase",color:"var(--md-on-surface-variant)",marginBottom:10}}>API Keys · {keys.filter((k:any)=>k.is_active).length} active</h3>
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
                    <button onClick={async()=>{customConfirm(`Revoke key "${k.name}"? This cannot be undone.`).then(async ok=>{if(!ok)return;await api.revokeApiKey(k.key_prefix);api.listApiKeys().then(r=>setKeys(r.keys||[]));});}} style={{fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-error)",background:"transparent",border:0,cursor:"pointer",padding:"6px 12px",borderRadius:999,transition:"background .2s var(--ease)"}}
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
  const [chatFiles,setChatFiles]=useState<File[]>([]);
  const [autoModeOn,_setAutoMode]=useState(false);
  const setAutoModeOn=(v:boolean)=>{_setAutoMode(v);localStorage.setItem("edgeword.auto_mode",v?"true":"false");};
  const [reasoningOn,setReasoningOn]=useState(false);
  const chatFileRef=useRef<HTMLInputElement>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const taRef=useRef<HTMLTextAreaElement>(null);
  const mediaRef=useRef<MediaRecorder|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const [showScrollBtn,setShowScrollBtn]=useState(false);

  useEffect(()=>{setAuthed(api.isLoggedIn());_setAutoMode(localStorage.getItem("edgeword.auto_mode")==="true");},[]);
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
    const msg=text||input.trim();if(!msg&&!chatFiles.length)return;if(generating)return;

    // If files attached, read their content and prepend to message
    let fullMsg=msg;
    if(chatFiles.length>0){
      const fileContents:string[]=[];
      for(const f of chatFiles){
        if(f.type.startsWith("image/")){
          // For images, use OCR
          try{const r=await api.ocr(f);fileContents.push(`[File: ${f.name}]\n${r.text}`);}catch{fileContents.push(`[File: ${f.name}] (could not read image)`);}
        }else{
          // For text files, read content
          try{const content=await f.text();fileContents.push(`[File: ${f.name}]\n${content.slice(0,3000)}${content.length>3000?"...(truncated)":""}`);}catch{fileContents.push(`[File: ${f.name}] (could not read)`);}
        }
      }
      fullMsg=fileContents.join("\n\n")+"\n\n"+(msg||"Analyse these files.");
    }

    const um:Message={id:uid(),role:"user",text:msg||(chatFiles.map(f=>f.name).join(", ")),timestamp:Date.now()};
    setMessages(p=>[...p,um]);setInput("");setChatFiles([]);setGenerating(true);api.saveMessage(um);
    try{
      if(reasoningOn){
        // Reasoning mode — SSE streaming
        const reasoning:Record<string,string>={};
        let currentStage="";
        let finalResponse="";
        // Add a placeholder message that we'll update
        const amId=uid();
        setMessages(p=>[...p,{id:amId,role:"assistant",text:"",reasoning:{},timestamp:Date.now()}]);
        await api.chatReason(fullMsg,(event)=>{
          if(event.type==="stage"){
            currentStage=event.name;
            reasoning[event.name]="";
            // Show which stage we're on
            const stageLabel:{[k:string]:string}={analyse:"Analysing...",retrieve:"Retrieving...",reason:"Reasoning...",synthesise:"Writing answer..."};
            setMessages(p=>p.map(m=>m.id===amId?{...m,text:stageLabel[event.name]||"Thinking...",reasoning:{...reasoning}}:m));
          }else if(event.type==="token"){
            reasoning[event.name]=(reasoning[event.name]||"")+event.text;
            // Show live streaming — display synthesise text if available, otherwise show current stage output
            const displayText=reasoning.synthesise||`**${currentStage.toUpperCase()}**\n${reasoning[currentStage]||""}`;
            setMessages(p=>p.map(m=>m.id===amId?{...m,text:displayText,reasoning:{...reasoning}}:m));
          }else if(event.type==="stage_done"){
            reasoning[event.name]=event.output;
            setMessages(p=>p.map(m=>m.id===amId?{...m,reasoning:{...reasoning}}:m));
          }else if(event.type==="done"){
            finalResponse=event.response||"";
            setMessages(p=>p.map(m=>m.id===amId?{...m,text:finalResponse,reasoning:event.reasoning}:m));
          }
        });
        const am:Message={id:amId,role:"assistant",text:finalResponse||reasoning.synthesise||"",reasoning,timestamp:Date.now()};
        api.saveMessage(am);
      }else{
        // Normal mode — streaming
        const amId=uid();
        let streamText="";
        let meta:any={};
        setMessages(p=>[...p,{id:amId,role:"assistant",text:"",timestamp:Date.now()}]);
        await api.chatStream(fullMsg,(event)=>{
          if(event.type==="meta"){
            meta=event;
          }else if(event.type==="token"){
            streamText+=event.text;
            setMessages(p=>p.map(m=>m.id===amId?{...m,text:streamText}:m));
          }else if(event.type==="done"){
            setMessages(p=>p.map(m=>m.id===amId?{...m,
              text:streamText,
              sentiment:meta.sentiment,
              ragSources:meta.rag_sources?.length?meta.rag_sources:undefined,
              toolResult:meta.tool_result||undefined,
              autoProfile:meta.auto_profile||undefined,
              skillUsed:meta.skill_used||undefined,
              tokens:event.tokens,tps:event.tps,ttft:event.ttft_s,totalS:event.total_s,
            }:m));
          }
        },{
          maxTokens:Number(localStorage.getItem("edgeword_max_tokens")||"256"),
          temperature:Number(localStorage.getItem("edgeword_temperature")||"0.7"),
          topP:Number(localStorage.getItem("edgeword_top_p")||"0.9"),
          topK:Number(localStorage.getItem("edgeword_top_k")||"40"),
          repeatPenalty:Number(localStorage.getItem("edgeword_repeat_penalty")||"1.1"),
          systemPrompt:localStorage.getItem("edgeword_system_prompt")||"",
          autoMode:autoModeOn,
        });
        const am:Message={id:amId,role:"assistant",text:streamText,sentiment:meta.sentiment,ragSources:meta.rag_sources?.length?meta.rag_sources:undefined,toolResult:meta.tool_result||undefined,autoProfile:meta.auto_profile||undefined,skillUsed:meta.skill_used||undefined,tokens:meta.tokens,timestamp:Date.now()};
        api.saveMessage(am);
      }
    }catch(err:any){setMessages(p=>[...p,{id:uid(),role:"assistant",text:`Error: ${err.message}`,timestamp:Date.now()}]);}
    finally{setGenerating(false);}
  },[input,generating,chatFiles]);

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
              const rerun=m.role==="user"?()=>send(m.text):i>0?()=>send(messages[i-1].text):undefined;
              return <div key={m.id}>{sec&&<SumDiv section={sec}/>}<Msg msg={m} isUser={m.role==="user"} onRerun={rerun}/></div>;
            })}
            {/* Thinking indicator only shows when generating AND no streaming placeholder exists */}
            {generating&&!messages.some(m=>m.role==="assistant"&&m.text==="")&&<Thinking/>}
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
        {[{l:"Settings",onClick:()=>openSettings("profile")},{l:"Model",onClick:()=>openSettings("model")},{l:"Knowledge",onClick:()=>openSettings("knowledge-full")},{l:"API Keys",onClick:()=>openSettings("keys")},{l:"Sign out",onClick:()=>{customConfirm("Sign out?").then(ok=>{if(ok){api.logout();setAuthed(false);}})},danger:true}].map(a=>(
          <a key={a.l} onClick={a.onClick} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 16px",background:"transparent",border:0,borderRadius:999,fontFamily:"var(--google-sans)",fontSize:13,fontWeight:500,color:a.danger?"var(--md-error)":"var(--md-on-surface-variant)",cursor:"pointer",transition:"background .2s var(--ease)"}}
            onMouseEnter={e=>e.currentTarget.style.background=a.danger?"var(--md-error-container)":"var(--md-surface-container-low)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{a.l}</a>
        ))}
      </nav>

      {/* Composer — fixed bottom */}
      <div style={{position:"fixed",left:"50%",bottom:0,transform:"translateX(-50%)",width:"100%",maxWidth:840,padding:"16px 16px 24px",background:`linear-gradient(to top,var(--md-surface) 0%,var(--md-surface) 65%,transparent 100%)`,zIndex:40}} className="pb-safe">
        <div style={{background:"var(--md-surface-container)",border:"1px solid transparent",borderRadius:28,transition:"all .2s var(--ease)",overflow:"hidden"}}>
          {/* Attached files preview */}
          {chatFiles.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,padding:"10px 16px 0"}}>
            {chatFiles.map((f,i)=><span key={i} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",background:"var(--md-primary-container)",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:12,fontWeight:500,color:"var(--md-on-primary-container)"}}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
              {f.name}
              <button onClick={()=>setChatFiles(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:0,cursor:"pointer",color:"var(--md-on-primary-container)",display:"flex",padding:0}}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>)}
          </div>}
          <div style={{display:"flex",alignItems:"flex-end",gap:10,padding:"var(--composer-pad)"}}>
          <textarea ref={taRef} value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder="Message EdgeWord..."
            rows={1} style={{flex:1,background:"transparent",border:0,outline:0,resize:"none",fontFamily:"var(--sans)",fontSize:15,lineHeight:1.5,color:"var(--md-on-surface)",fontWeight:400,minHeight:24,maxHeight:200,padding:"8px 0"}}/>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {/* Reasoning toggle — icon only, like attach/voice */}
            <button onClick={()=>setReasoningOn(!reasoningOn)} title={reasoningOn?"Reasoning ON — click to disable":"Enable deep reasoning"}
              style={{width:36,height:36,borderRadius:"50%",background:reasoningOn?"var(--md-primary-container)":"transparent",border:0,cursor:"pointer",color:reasoningOn?"var(--md-primary)":"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"all .2s var(--ease)"}}
              onMouseEnter={e=>{if(!reasoningOn)e.currentTarget.style.background="var(--md-surface-container-high)";}}
              onMouseLeave={e=>{if(!reasoningOn)e.currentTarget.style.background="transparent";}}>
              {/* Brain/reasoning icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 0-4 4c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2 4 4 0 0 0-4-4z"/><path d="M12 8v8"/><path d="M8 12h8"/><circle cx="12" cy="19" r="2"/><path d="M12 16v1"/><path d="M6 6a6 6 0 0 0 0 12"/><path d="M18 6a6 6 0 0 1 0 12"/></svg>
            </button>
            <button onClick={()=>fileRef.current?.click()} title="attach" style={{width:36,height:36,borderRadius:"50%",background:"transparent",border:0,cursor:"pointer",color:"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--md-surface-container-high)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <button onClick={toggleRec} title="voice" style={{width:36,height:36,borderRadius:"50%",background:recording?"var(--md-error-container)":"transparent",border:0,cursor:"pointer",color:recording?"var(--md-error)":"var(--md-on-surface-variant)",display:"inline-flex",alignItems:"center",justifyContent:"center",transition:"background .2s var(--ease)"}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 19v4"/></svg>
            </button>
            <button onClick={()=>send()} disabled={!input.trim()&&!chatFiles.length} style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 20px",background:(input.trim()||chatFiles.length)?"var(--md-primary)":"var(--md-surface-container-high)",color:(input.trim()||chatFiles.length)?"var(--md-on-primary)":"var(--md-on-surface-variant)",border:0,borderRadius:999,cursor:(input.trim()||chatFiles.length)?"pointer":"default",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,letterSpacing:".01em",transition:"all .2s var(--ease)",boxShadow:(input.trim()||chatFiles.length)?`0 1px 2px 0 var(--md-shadow),0 1px 3px 1px var(--md-shadow-2)`:"none"}}>
              Send
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.45-7.48a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.18L4.5 11l8 1-8 1-2.49 6.22a1 1 0 0 0 1.39 1.18z"/></svg>
            </button>
          </div>
        </div>
        </div>{/* close composer inner wrapper */}
      </div>

      <input ref={fileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml,image/*" onChange={e=>{if(!e.target.files)return;setChatFiles(p=>[...p,...Array.from(e.target.files!)]);e.target.value="";}} multiple/>
      <input ref={chatFileRef} type="file" style={{display:"none"}} accept=".txt,.md,.py,.json,.csv,.yaml,.yml,.pdf,image/*" onChange={e=>{if(!e.target.files)return;setChatFiles(p=>[...p,...Array.from(e.target.files!)]);e.target.value="";}} multiple/>
      <Settings open={settingsOpen} onClose={()=>setSettingsOpen(false)} health={health} onLogout={()=>setAuthed(false)} initialTab={settingsTab} autoModeOn={autoModeOn} setAutoModeOn={setAutoModeOn}/>
      <DialogProvider/>
    </>
  );
}
