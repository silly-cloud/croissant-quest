"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { registerCanvas } from "@/lib/fx";
import { useGame, useGameSnapshot, useSettings } from "@/lib/game-context";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,600;1,400&display=swap";

/** Fredoka and Lora load after first paint and never block it; offline, the system fonts stay. */
function FontLoader() {
  useEffect(() => {
    if (document.querySelector("link[data-cq-fonts]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONTS;
    l.dataset.cqFonts = "1";
    document.head.appendChild(l);
  }, []);
  return null;
}

function Stat({
  cls,
  icon,
  value,
  label,
}: {
  cls: string;
  icon: string;
  value: number;
  label: string;
}) {
  const [bump, setBump] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setBump(true);
    const t = setTimeout(() => setBump(false), 420);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className={`stat ${cls}${bump ? " bump" : ""}`}>
      <i aria-hidden="true">{icon}</i>
      <span>{value}</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Hud() {
  const { state } = useGameSnapshot();
  const { settings, sfx } = useGame();
  const s = useSettings();
  return (
    <header id="hud">
      <Stat cls="s-streak" icon="🔥" value={state.streak} label="day streak" />
      <Stat cls="s-xp" icon="⭐" value={state.xp} label="XP" />
      <Stat cls="s-cr" icon="🥐" value={state.cro} label="croissants" />
      <div className="sp" />
      <div className="tools">
        <button
          type="button"
          className="ghost"
          aria-label={
            s.pace === "study"
              ? "Pace: study. Switch to fast"
              : "Pace: fast. Switch to study"
          }
          title={
            s.pace === "study"
              ? "Study pace: read the pronunciation, then tap Continue"
              : "Fast pace: moves on by itself"
          }
          onClick={() => {
            settings.setPace(s.pace === "study" ? "fast" : "study");
            sfx.tap();
          }}
        >
          <span aria-hidden="true">{s.pace === "study" ? "📖" : "🐇"}</span>
        </button>
        <button
          type="button"
          className="ghost"
          aria-label={s.muted ? "Sound off. Turn on" : "Sound on. Turn off"}
          onClick={() => {
            settings.setMuted(!s.muted);
            if (s.muted) sfx.tap();
          }}
        >
          <span aria-hidden="true">{s.muted ? "🔇" : "🔊"}</span>
        </button>
        <button
          type="button"
          className="ghost"
          aria-label="Switch light or dark theme"
          onClick={() => settings.toggleTheme()}
        >
          <span aria-hidden="true">◐</span>
        </button>
        <Link href="/settings" className="ghost" aria-label="Settings">
          <span aria-hidden="true">⚙</span>
        </Link>
      </div>
    </header>
  );
}

/** Always in the page so a screen reader hears it appear; only has content when saving to the API fails. */
export function SyncBanner() {
  const { sync } = useGameSnapshot();
  return (
    <div role="status" aria-live="polite">
      {sync === "error" && (
        <p className="syncbanner">
          ⚠ Not synced to the cloud. Your progress is safe on this device and
          will sync when the connection is back.
        </p>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    registerCanvas(canvas.current);
    return () => registerCanvas(null);
  }, []);
  return (
    <>
      <FontLoader />
      <a href="#main" className="skip">
        Skip to content
      </a>
      <div id="app">
        <Hud />
        <SyncBanner />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
      <canvas id="fx" ref={canvas} aria-hidden="true" />
    </>
  );
}
