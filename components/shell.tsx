"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  BarChart3, Bot, CircleDollarSign, FileText, KeyRound, LayoutList,
  MessageCircleMore, WalletCards, Waypoints,
} from "lucide-react";

/** The workspace chrome every studio sits inside. */

export type Studio = "voice" | "avatar" | "agent";

function Logo() {
  return <Image className="logo" src="/assets/boson-ai-logo.png" alt="Boson AI" width={1536} height={512} priority />;
}

function SideIcon({ name }: { name: string }) {
  const map: Record<string, React.ReactNode> = {
    agent: <Waypoints />, avatar: <Bot />, voice: <MessageCircleMore />, keys: <KeyRound />, docs: <FileText />,
    pricing: <CircleDollarSign />, overview: <LayoutList />, usage: <BarChart3 />, payments: <WalletCards />,
  };
  return map[name];
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="nav-section"><h2>{label}</h2><nav>{children}</nav></section>;
}

export function Sidebar({ studio }: { studio: Studio }) {
  const router = useRouter();
  return (
    <aside className="sidebar">
      <div className="brand"><Logo /></div>
      <div className="side-content">
        <NavSection label="PLAYGROUND">
          <button className={`nav-item ${studio === "agent" ? "active" : ""}`} onClick={() => router.push("/workspace/agent-studio")}><SideIcon name="agent" />Agent Studio</button>
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
        <div className="profile"><Image src="/assets/profile.png" alt="Akash Deb" width={42} height={42} /><div><b>Akash Deb</b><span>Balance: <em>$6.94</em></span></div></div>
      </div>
    </aside>
  );
}

/** Wraps a studio's own content in the sidebar + workspace grid. */
export function Shell({ studio, children }: { studio: Studio; children: React.ReactNode }) {
  return <div className="app-shell">
    <Sidebar studio={studio} />
    <div className="workspace">{children}</div>
  </div>;
}
