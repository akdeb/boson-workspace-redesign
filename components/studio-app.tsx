"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowRight, BarChart3, BookOpen, Bot, Check, CircleDollarSign, FileText,
  Gift, Hand, KeyRound, LayoutList, MessageCircleMore, Phone, Play, Plus,
  Presentation, SquareUserRound, WalletCards
} from "lucide-react";

type Studio = "voice" | "avatar";
type VoiceMode = "chat" | "tts";

const voiceChoices = [
  ["Chloe", "EN", "A friendly and clear female voice ..."],
  ["Eleanor", "EN", "A calm, articulate female voice wi..."],
  ["Nora", "EN", "A female speaker with a calm, cle..."],
  ["Jake", "EN", "A male speaker with an energetic..."],
];

const avatarVoices = [
  ["Mia", "EN-US", "Conversational · Energetic"],
  ["Marcus", "EN-US", "Enthusiastic · Confident"],
  ["Ava", "EN-US", "Upbeat · Clear"],
  ["Diane", "EN-US", "Professional · Serious"],
];

const avatarPresets: Record<string, string> = {
  "Welcome message": "Hi, I'm Maya — your Boson AI avatar. Write your script in any language, choose a face, and I’ll bring it to life for you.",
  "Product launch": "Meet the product designed to make your work simpler, faster, and more creative.",
  "Quarterly update": "Welcome to our quarterly update. Here are the milestones we reached together.",
  "Course intro": "Welcome to the course. Let’s begin with the ideas that will shape everything ahead.",
};

const ttsPresets: Record<string, string> = {
  "Welcome message": "Welcome! It’s great to have you here.",
  "Product launch": "Today, we’re excited to introduce something new.",
  "Multilingual": "Hello, bonjour, hola — any language works.",
  "Teaching": "Let’s break this idea down step by step.",
};

function Logo() {
  return <Image className="logo" src="/assets/logo-presence.svg" alt="Boson Workspace" width={249} height={42} priority />;
}

function SideIcon({ name }: { name: string }) {
  const map: Record<string, React.ReactNode> = {
    avatar: <Bot />, voice: <MessageCircleMore />, keys: <KeyRound />, docs: <FileText />,
    pricing: <CircleDollarSign />, overview: <LayoutList />, usage: <BarChart3 />, payments: <WalletCards />,
  };
  return map[name];
}

function Sidebar({ studio }: { studio: Studio }) {
  const router = useRouter();
  return (
    <aside className="sidebar">
      <div className="brand"><Logo /></div>
      <div className="side-content">
        <NavSection label="PLAYGROUND">
          <button className={`nav-item ${studio === "avatar" ? "active" : ""}`} onClick={() => router.push("/workspace/avatar")}><SideIcon name="avatar" />Avatar Studio</button>
          <button className={`nav-item ${studio === "voice" ? "active" : ""}`} onClick={() => router.push("/workspace/voice-studio")}><SideIcon name="voice" />Voice Studio</button>
        </NavSection>
        <NavSection label="INTEGRATE">
          <button className="nav-item locked" disabled><SideIcon name="keys" />API Keys</button>
          <button className="nav-item locked" disabled><SideIcon name="docs" />API Docs<span className="external">↗</span></button>
          <button className="nav-item locked" disabled><SideIcon name="pricing" />Pricing<span className="external">↗</span></button>
        </NavSection>
        <NavSection label="BILLING & USAGE">
          <button className="nav-item locked" disabled><SideIcon name="overview" />Overview</button>
          <button className="nav-item locked" disabled><SideIcon name="usage" />Usage</button>
          <button className="nav-item locked" disabled><SideIcon name="payments" />Payments</button>
        </NavSection>
      </div>
      <div className="sidebar-bottom">
        <div className="notice"><b>API has moved to paid<br />usage</b><p>Keep enough balance so your<br />service keeps running without<br />interruption. Your API key stays<br />the same.</p></div>
        <div className="profile"><Image src="/assets/profile.png" alt="Akash Deb" width={42} height={42} /><div><b>Akash Deb</b><span>Balance: <em>$9.94</em></span></div></div>
      </div>
    </aside>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="nav-section"><h2>{label}</h2><nav>{children}</nav></section>;
}

function Wave({ active = false }: { active?: boolean }) {
  return <span className={`wave ${active ? "wave-active" : ""}`}>{[15,27,37,30,24,34,19].map((h,i)=><i key={i} style={{height:h}} />)}</span>;
}

function VoiceCard({ item, active, onClick }: { item: string[]; active: boolean; onClick: () => void }) {
  return <div className={`voice-card ${active ? "selected" : ""}`} onClick={onClick} role="button" tabIndex={0}>
    <Wave active={active} /><div className="voice-copy"><div><b>{item[0]}</b><span>{item[1]}</span></div><p>{item[2]}</p></div>
    <button className="play" aria-label={`Play ${item[0]}`}><Play /></button>
  </div>;
}

function PanelTabs({ avatar, history, setHistory }: { avatar: boolean; history: boolean; setHistory: (v:boolean)=>void }) {
  return <div className="panel-tabs"><button className={!history ? "active" : ""} onClick={()=>setHistory(false)}>{avatar ? "Avatar" : "Settings"}</button><button className={history ? "active" : ""} onClick={()=>setHistory(true)}>History</button></div>;
}

function HistoryPanel() {
  return <div className="history-empty"><span>◷</span><h3>No history yet</h3><p>Your generated sessions will appear here.</p></div>;
}

function VoicePanel({ mode }: { mode: VoiceMode }) {
  const [selected, setSelected] = useState(0);
  const [history, setHistory] = useState(false);
  return <aside className="settings-panel"><PanelTabs avatar={false} history={history} setHistory={setHistory} />{history ? <HistoryPanel /> : <div className="panel-scroll">
    <h2>Voice</h2><p className="help">Pick a voice. Tap play to preview</p>
    <div className="voice-list">{voiceChoices.map((v,i)=><VoiceCard key={v[0]} item={v} active={i===selected} onClick={()=>setSelected(i)} />)}</div>
    <button className="browse">Browse all voices <ArrowRight /></button>
    {mode === "tts" && <><h2 className="panel-section">Mode</h2><p className="help">Audio plays instantly when you select streaming</p><div className="mode-switch"><button className="active">Streaming</button><button>Play when finished</button></div></>}
    <h2 className="panel-section">Model</h2><div className="model-field">{mode === "chat" ? "Higgs Realtime" : "Higgs TTS 3"}</div>
  </div>}</aside>;
}

function Segmented({ items, value, onChange, label }: { items: [string,string][]; value:string; onChange:(v:string)=>void; label:string }) {
  return <div className="segmented" role="radiogroup" aria-label={label}>{items.map(([id,text])=><button key={id} role="radio" aria-checked={value===id} className={value===id ? "active" : ""} onClick={()=>onChange(id)}>{text}</button>)}</div>;
}

function ScenarioIcon({ i }: { i:number }) {
  if(i===0) return <span className="mini-boson">≋</span>;
  const icons=[<Phone key="p"/>,<SquareUserRound key="u"/>,<LayoutList key="l"/>];
  return <span className={`scenario-icon c${i}`}>{icons[i-1]}</span>;
}

function VoiceMain({ mode, setMode }: { mode: VoiceMode; setMode:(m:VoiceMode)=>void }) {
  const [scenario, setScenario] = useState<number|null>(null);
  const [text, setText] = useState("");
  const scenarios = [["Higgs Live","Experience Higgs Realtime"],["Receptionist","Books tables and answers café questions."],["AI Interviewer","Runs a mock interview and gives feedback."],["Customer Support","Handles support calls and requests."]];
  const presets = Object.keys(ttsPresets);
  return <main className="voice-main">
    <header className="voice-header"><h1>Voice Studio</h1><button disabled><Plus />New session</button></header>
    <div className="voice-canvas">
      <Segmented label="Voice Studio mode" value={mode} onChange={(v)=>setMode(v as VoiceMode)} items={[["chat","Chat"],["tts","Text-to-speech"]]} />
      {mode === "chat" ? <>
        <div className="chat-intro"><div className="orb" /><h2>Higgs Realtime Agents</h2><p>Pick a scenario and start chatting.</p></div>
        <div className="scenario-grid">{scenarios.map((s,i)=><button key={s[0]} className={scenario===i?"selected":""} onClick={()=>setScenario(i)}><ScenarioIcon i={i}/><span><b>{s[0]}</b><small>{s[1]}</small></span></button>)}</div>
        <button className="start-chat" disabled={scenario===null}><Phone />Start chatting</button>
      </> : <>
        <div className="tts-intro"><div className="wave-tile"><Wave active /></div><h2>Type anything. Click generate.</h2><p>Voice will start playing instantly.</p></div>
        <div className="composer-wrap"><PresetRow labels={presets} onPick={(p)=>setText(ttsPresets[p])} /><div className="composer"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Type anything. Click generate to hear it instantly. Any language works."/><ComposerFooter enabled={!!text} /></div></div>
      </>}
    </div>
  </main>;
}

function PresetRow({ labels, onPick }: { labels:string[]; onPick:(p:string)=>void }) {
  const icons=[<Hand key="h"/>,<Presentation key="p"/>,<Gift key="g"/>,<BookOpen key="b"/>];
  return <div className="presets">{labels.map((p,i)=><button key={p} onClick={()=>onPick(p)}>{icons[i]}{p}</button>)}</div>;
}

function ComposerFooter({ enabled }: { enabled:boolean }) {
  return <div className="composer-footer"><span>Type <kbd>/</kbd> to add control tags</span><button disabled={!enabled}><Wave />Generate</button></div>;
}

function AvatarPanel() {
  const [face,setFace]=useState(0); const [voice,setVoice]=useState(0); const [history,setHistory]=useState(false);
  const faces=[["Maya","/assets/Maya.png"],["Andre","/assets/Andre.png"],["Camila","/assets/Camila.png"]];
  return <aside className="settings-panel avatar-panel"><PanelTabs avatar history={history} setHistory={setHistory}/>{history?<HistoryPanel/>:<div className="panel-scroll">
    <h2>Face</h2><p className="help">Pick the face your audience sees</p><div className="faces">{faces.map((f,i)=><button key={f[0]} className={face===i?"selected":""} onClick={()=>setFace(i)}><Image src={f[1]} alt={f[0]} fill sizes="110px"/><span>{f[0]}</span>{face===i&&<i><Check/></i>}</button>)}</div>
    <button className="browse">Browse all faces <ArrowRight/></button>
    <h2 className="panel-section">Voice</h2><p className="help">Pick the voice for your avatar. Tap play to preview</p><div className="voice-list">{avatarVoices.map((v,i)=><VoiceCard key={v[0]} item={v} active={i===voice} onClick={()=>setVoice(i)}/>)}</div>
    <button className="browse">Browse all voices <ArrowRight/></button>
  </div>}</aside>;
}

function AvatarMain() {
  const [mode,setMode]=useState("speech"); const [text,setText]=useState(avatarPresets["Welcome message"]);
  return <main className="avatar-main"><div className="dot-grid"/><div className="avatar-content">
    <Segmented label="Avatar mode" value={mode} onChange={setMode} items={[["speech","Speech"],["chat","Chat"]]}/>
    <div className="avatar-image"><Image src="/assets/Maya.png" alt="Maya avatar" fill sizes="464px" priority/></div>
    <div className="avatar-composer"><PresetRow labels={Object.keys(avatarPresets)} onPick={(p)=>setText(avatarPresets[p])}/><div className="composer"><textarea value={text} onChange={e=>setText(e.target.value)}/><ComposerFooter enabled={!!text}/></div></div>
  </div></main>;
}

export default function StudioApp({ initialStudio }: { initialStudio:Studio }) {
  const [voiceMode,setVoiceMode]=useState<VoiceMode>("chat");
  return <div className="app-shell"><Sidebar studio={initialStudio}/><div className="workspace">{initialStudio==="voice"?<><VoiceMain mode={voiceMode} setMode={setVoiceMode}/><VoicePanel mode={voiceMode}/></>:<><AvatarMain/><AvatarPanel/></>}</div></div>;
}
