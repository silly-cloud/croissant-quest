import { notFound } from "next/navigation";
import { RoundScreen } from "@/components/RoundScreen";
import type { RoundMode } from "@/lib/engine";

export const metadata = { title: "Round · Croissant Quest" };

export default async function RoundPage({
  params,
  searchParams,
}: {
  params: Promise<{ topic: string }>;
  searchParams: Promise<{ mode?: string | string[] }>;
}) {
  const { topic } = await params;
  const { mode } = await searchParams;
  const t = Number(topic);
  if (!Number.isInteger(t) || t < 1 || t > 44) notFound();
  const m = Array.isArray(mode) ? mode[0] : mode;
  const parsed: RoundMode = m === "weak" || m === "ai" ? m : "normal";
  return <RoundScreen topic={t} mode={parsed} />;
}
