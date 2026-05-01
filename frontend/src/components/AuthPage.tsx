"use client";
import { useState, useEffect } from "react";
import * as api from "@/lib/api";

export default function AuthPage({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<"login"|"register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(()=>{ requestAnimationFrame(()=>setReady(true)); },[]);

  const submit = async(e:React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      if(mode==="register") await api.register(username,password,displayName);
      else await api.login(username,password);
      onAuth();
    } catch(err:any){ setError(err.message); }
    finally{ setLoading(false); }
  };

  const inputStyle:React.CSSProperties = {
    width:"100%",padding:"12px 16px",background:"var(--md-surface-container-low)",
    border:"1px solid transparent",borderRadius:8,fontFamily:"var(--sans)",fontSize:15,
    color:"var(--md-on-surface)",outline:"none",transition:"all .2s var(--ease)",
  };

  return (
    <div style={{ minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",background:"var(--md-surface)" }}>

      {/* Wordmark — Google multi-color */}
      <div className={`transition-all duration-700 ${ready?"opacity-100":"opacity-0 translate-y-2"}`}
        style={{ marginBottom:32,fontFamily:"var(--google-sans)",fontSize:24,fontWeight:500,letterSpacing:"-.02em",lineHeight:1,userSelect:"none",display:"inline-flex",alignItems:"center" }}>
        <span style={{color:"var(--wm-1)"}}>E</span><span style={{color:"var(--wm-2)"}}>d</span>
        <span style={{color:"var(--wm-3)"}}>g</span><span style={{color:"var(--wm-4)"}}>e</span>
        <span style={{display:"inline-block",width:5,height:5,borderRadius:"50%",background:"var(--wm-dot)",margin:"0 .3em",transform:"translateY(-.05em)"}} />
        <span style={{color:"var(--wm-5)"}}>W</span><span style={{color:"var(--wm-6)"}}>o</span>
        <span style={{color:"var(--wm-7)"}}>r</span><span style={{color:"var(--wm-8)"}}>d</span>
      </div>

      {/* Hero — pre-auth only */}
      <h1 className={`transition-all duration-1000 ${ready?"opacity-100 translate-y-0":"opacity-0 translate-y-4"}`}
        style={{ fontFamily:"var(--google-sans)",fontWeight:400,fontSize:"clamp(32px, 6vw, 48px)",lineHeight:1.05,letterSpacing:"-.02em",color:"var(--md-on-surface)",textAlign:"center",marginBottom:8,maxWidth:"16ch" }}>
        A conversation, set in <span style={{color:"var(--md-primary)"}}>colour</span>.
      </h1>

      <div className={`transition-all duration-700 delay-200 ${ready?"opacity-100":"opacity-0"}`}
        style={{ display:"inline-flex",alignItems:"center",gap:8,padding:"6px 12px",background:"var(--md-surface-container)",borderRadius:999,fontFamily:"var(--google-sans)",fontSize:12,letterSpacing:".04em",color:"var(--md-on-surface-variant)",fontWeight:500,marginBottom:40 }}>
        <span style={{width:8,height:8,borderRadius:"50%",background:"var(--md-success)",animation:"livepulse 2s ease-in-out infinite"}} />
        Ready
      </div>

      {/* Form */}
      <div className={`transition-all duration-700 delay-300 ${ready?"opacity-100 translate-y-0":"opacity-0 translate-y-3"}`}
        style={{ width:"100%",maxWidth:400 }}>

        {/* Tabs — Material text buttons */}
        <div style={{ display:"flex",gap:4,marginBottom:24 }}>
          {(["login","register"] as const).map(m=>(
            <button key={m} onClick={()=>{setMode(m);setError("");}}
              style={{
                flex:1,padding:"10px 0",background:mode===m?"var(--md-primary-container)":"transparent",
                border:0,borderRadius:999,cursor:"pointer",fontFamily:"var(--google-sans)",fontWeight:500,fontSize:14,
                letterSpacing:".01em",color:mode===m?"var(--md-on-primary-container)":"var(--md-on-surface-variant)",
                transition:"all .2s var(--ease)",
              }}>
              {m==="login"?"Sign in":"Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{display:"flex",flexDirection:"column",gap:12}}>
          {mode==="register" && (
            <input type="text" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name" style={inputStyle}
              onFocus={e=>{e.currentTarget.style.background="var(--md-surface)";e.currentTarget.style.borderColor="var(--md-primary)";}}
              onBlur={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}} />
          )}
          <input type="text" value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username" required minLength={3} autoComplete="username" style={inputStyle}
            onFocus={e=>{e.currentTarget.style.background="var(--md-surface)";e.currentTarget.style.borderColor="var(--md-primary)";}}
            onBlur={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}} />
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required minLength={6}
            autoComplete={mode==="register"?"new-password":"current-password"} style={inputStyle}
            onFocus={e=>{e.currentTarget.style.background="var(--md-surface)";e.currentTarget.style.borderColor="var(--md-primary)";}}
            onBlur={e=>{e.currentTarget.style.background="var(--md-surface-container-low)";e.currentTarget.style.borderColor="transparent";}} />

          {error && <p style={{fontFamily:"var(--sans)",fontSize:13,color:"var(--md-error)",textAlign:"center"}}>{error}</p>}

          <button type="submit" disabled={loading}
            style={{
              width:"100%",padding:"12px 0",background:"var(--md-primary)",color:"var(--md-on-primary)",
              border:0,borderRadius:999,cursor:loading?"not-allowed":"pointer",fontFamily:"var(--google-sans)",
              fontWeight:500,fontSize:14,letterSpacing:".01em",transition:"all .2s var(--ease)",
              boxShadow:`0 1px 2px 0 var(--md-shadow),0 1px 3px 1px var(--md-shadow-2)`,opacity:loading?.5:1,
            }}>
            {loading?"...":mode==="login"?"Sign in":"Get started"}
          </button>
        </form>
      </div>
    </div>
  );
}
