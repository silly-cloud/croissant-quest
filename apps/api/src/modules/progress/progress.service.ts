import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { BANK, qid } from "@cq/content";
import { mergeStates, normState, type State, type ProgressResponse } from "@cq/shared";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { Prisma } from "../../generated/prisma/client.js";

const KNOWN_QIDS = new Set(BANK.map(qid));
export const LOG_CAP = 120;
const INT_MAX = 2_147_483_647;

/** State has no index signature; the wire/JSON type is a loose object. */
const asBody = (s: State) => s as unknown as ProgressResponse["state"];
const clampInt = (n: number) => Math.max(0, Math.min(INT_MAX, Math.trunc(Number.isFinite(n) ? n : 0)));

/** The copy that gets stored: capped log, as the legacy client did (normState already caps feelLog at 20). */
export function trimForStorage(s: State): State {
  return { ...s, log: s.log.slice(-LOG_CAP) };
}

export const TS_SKEW_MS = 5 * 60 * 1000;
/** A client clock is not trusted: never more than 5 minutes ahead of the server; missing -> server time. */
export function clampTs(ts: number, now: number): number {
  return ts > 0 ? Math.min(ts, now + TS_SKEW_MS) : now;
}

const DAY_MS = 86_400_000;
/**
 * `last` may be at most server-today (UTC) + 1 day (the furthest any time zone is ahead). A later
 * one, or none, takes its streak with it: the pair is one fact (ADR 0006), so the server's pair wins.
 */
export function boundLast(s: State, now: number): void {
  const latest = new Date(now + DAY_MS).toISOString().slice(0, 10);
  if (!s.last || s.last > latest) {
    s.last = null;
    s.streak = 0;
  }
}

@Injectable()
export class ProgressService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<ProgressResponse> {
    const row = await this.prisma.progress.findUnique({ where: { userId } });
    if (!row) return { state: asBody(normState({})), version: 0 };
    return { state: asBody(normState(row.state, KNOWN_QIDS)), version: row.version };
  }

  /**
   * Compare-and-swap on `version`. The conditional UPDATE is the lock: of two writers holding the
   * same If-Match, Postgres lets one update the row, the other re-checks `version = n` after the
   * first commits, matches nothing, and gets the 409 with the server copy.
   */
  async put(userId: string, ifMatch: number, incoming: unknown, now = Date.now()): Promise<ProgressResponse> {
    const mine = normState(incoming, KNOWN_QIDS);
    mine.ts = clampTs(mine.ts, now);
    boundLast(mine, now);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.progress.createMany({
        data: [{ userId, state: normState({}) as unknown as Prisma.InputJsonObject, version: 0 }],
        skipDuplicates: true,
      });
      const row = await tx.progress.findUniqueOrThrow({ where: { userId } });
      if (row.version !== ifMatch) return { ok: false as const, row };

      const merged = trimForStorage(mergeStates(normState(row.state, KNOWN_QIDS), mine));
      const { count } = await tx.progress.updateMany({
        where: { userId, version: row.version },
        data: {
          state: merged as unknown as Prisma.InputJsonObject,
          ts: BigInt(Math.max(0, Math.trunc(merged.ts))),
          version: row.version + 1,
          xp: clampInt(merged.xp),
          streak: clampInt(merged.streak),
        },
      });
      if (count === 0) {
        const fresh = await tx.progress.findUniqueOrThrow({ where: { userId } });
        return { ok: false as const, row: fresh };
      }
      return { ok: true as const, state: merged, version: row.version + 1 };
    });

    if (!outcome.ok) {
      const body: ProgressResponse = { state: asBody(normState(outcome.row.state, KNOWN_QIDS)), version: outcome.row.version };
      throw new ConflictException(body);
    }
    return { state: asBody(outcome.state), version: outcome.version };
  }
}
