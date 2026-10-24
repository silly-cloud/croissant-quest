"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { burst, burstPoint, buzz, floatXP, rain, Sfx, trackPointer } from "./fx";
import { GameStore, SERVER_SNAPSHOT, type GameSnapshot } from "./game-store";
import { HOST_SERVER, RoundHost, type HostSnapshot } from "./round-host";
import { SETTINGS_SERVER, SettingsStore, type SettingsSnapshot } from "./settings";

export interface Game {
  store: GameStore;
  host: RoundHost;
  settings: SettingsStore;
  sfx: Sfx;
}

const Ctx = createContext<Game | null>(null);

export function createGame(): Game {
  const settings = new SettingsStore();
  const sfx = new Sfx(() => settings.muted);
  const store = new GameStore();
  const host = new RoundHost(store, {
    getPace: () => settings.pace,
    fx: {
      right(combo, gain) {
        sfx.right(combo);
        buzz(18);
        const p = burstPoint();
        burst(p.x, p.y, 18 + Math.min(30, combo * 5));
        floatXP("+" + gain, p.x, p.y - 20);
      },
      wrong() {
        sfx.wrong();
        buzz([25, 50, 25]);
      },
      crown() {
        sfx.crown();
        rain();
        buzz([30, 60, 30, 60, 80]);
      },
      finish(perfect) {
        sfx.finish();
        if (perfect) rain();
        burst(innerWidth / 2, innerHeight * 0.32, 30);
      },
    },
  });
  return { store, host, settings, sfx };
}

export function GameProvider({ children, game }: { children: ReactNode; game?: Game }) {
  const [g] = useState<Game>(() => game ?? createGame());
  useEffect(() => {
    const off = trackPointer();
    const resync = () => void g.store.sync();
    addEventListener("online", resync);
    void g.store.loadBank();
    void g.store.sync();
    return () => {
      off();
      removeEventListener("online", resync);
    };
  }, [g]);
  return <Ctx.Provider value={g}>{children}</Ctx.Provider>;
}

export function useGame(): Game {
  const g = useContext(Ctx);
  if (!g) throw new Error("useGame needs <GameProvider>");
  return g;
}

export function useGameSnapshot(): GameSnapshot {
  const { store } = useGame();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
}

export function useHostSnapshot(): HostSnapshot {
  const { host } = useGame();
  return useSyncExternalStore(host.subscribe, host.getSnapshot, () => HOST_SERVER);
}

export function useSettings(): SettingsSnapshot {
  const { settings } = useGame();
  return useSyncExternalStore(settings.subscribe, settings.getSnapshot, () => SETTINGS_SERVER);
}
