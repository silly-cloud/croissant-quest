import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { GameProvider } from "@/lib/game-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Croissant Quest",
  description: "Learn French A1 grammar one croissant at a time.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

// Applies a saved light/dark choice before first paint, so there is no flash.
const THEME_BOOT =
  "try{var t=localStorage.getItem('croissant-quest-v1-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script>{THEME_BOOT}</script>
      </head>
      <body>
        <GameProvider>
          <AppShell>{children}</AppShell>
        </GameProvider>
      </body>
    </html>
  );
}
