"use client";

import Link from "next/link";
import { useGame, useSettings } from "@/lib/game-context";
import type { Pace } from "@/lib/engine";
import type { Theme } from "@/lib/settings";

function Seg<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <label key={v}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

export function SettingsScreen() {
  const { settings, sfx } = useGame();
  const s = useSettings();
  return (
    <div className="settings">
      <h1>Settings</h1>
      <fieldset>
        <legend>Pace</legend>
        <p>Fast moves on by itself after a correct answer. Study waits for you to tap Continue.</p>
        <Seg<Pace>
          name="pace"
          value={s.pace}
          options={[
            ["fast", "🐇 Fast"],
            ["study", "📖 Study"],
          ]}
          onChange={(v) => settings.setPace(v)}
        />
      </fieldset>
      <fieldset>
        <legend>Sound</legend>
        <p>Short beeps for right and wrong answers.</p>
        <Seg<"on" | "off">
          name="sound"
          value={s.muted ? "off" : "on"}
          options={[
            ["on", "🔊 On"],
            ["off", "🔇 Off"],
          ]}
          onChange={(v) => {
            settings.setMuted(v === "off");
            if (v === "on") sfx.tap();
          }}
        />
      </fieldset>
      <fieldset>
        <legend>Theme</legend>
        <p>Follow your device, or choose.</p>
        <Seg<Theme>
          name="theme"
          value={s.theme}
          options={[
            ["system", "Device"],
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
          onChange={(v) => settings.setTheme(v)}
        />
      </fieldset>
      <Link href="/" className="go alt backlink">
        Back to the map
      </Link>
    </div>
  );
}
