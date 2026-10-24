import { Inject, Injectable, Logger } from "@nestjs/common";
import { BANK, qid } from "@cq/content";
import type { CoachExplainBody, CoachExplainResponse, CoachRoundBody, CoachRoundResponse } from "@cq/shared";
import { normState } from "@cq/shared";
import { ProgressService } from "../progress/progress.service.js";
import type { CoachClient, CoachRequest } from "./coach.client.js";
import type { CoachConfig } from "./coach.config.js";
import { COACH_CLIENT, COACH_CONFIG } from "./coach.tokens.js";
import { explainPrompt, roundPrompt } from "./coach.prompts.js";
import { extractJsonArray, validateRound } from "./coach.validate.js";

type Failure = "timeout" | "error";
type Called = { ok: true; text: string } | { ok: false; reason: Failure };

const BY_QID = new Map(BANK.map((q) => [qid(q), q]));
const MIN_VALID = 4;
const EXPLAIN_MAX_CHARS = 600;

const retryable = (e: unknown) => {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status !== "number" || status === 429 || status >= 500;
};

@Injectable()
export class CoachService {
  private readonly log = new Logger("Coach");

  constructor(
    @Inject(COACH_CLIENT) private readonly client: CoachClient | null,
    @Inject(COACH_CONFIG) private readonly cfg: CoachConfig,
    @Inject(ProgressService) private readonly progress: Pick<ProgressService, "get">,
  ) {}

  async round(userId: string | undefined, body: CoachRoundBody): Promise<CoachRoundResponse> {
    if (!this.client) return { fallback: true, reason: "no_key" };
    // an unknown (cookieless) caller has no record: the prompt falls back to the default focus
    const state = userId ? (await this.progress.get(userId)).state : {};
    const n = Math.max(MIN_VALID, body.n); // the response contract never carries fewer than 4
    const prompt = roundPrompt(normState(state), n, body.focus);
    const res = await this.call({ prompt, maxTokens: this.cfg.maxTokens.round });
    if (!res.ok) return { fallback: true, reason: res.reason };

    const rows = extractJsonArray(res.text);
    const questions = rows ? validateRound(rows, n) : [];
    if (questions.length < MIN_VALID) return { fallback: true, reason: "invalid" };
    return { fallback: false, questions };
  }

  async explain(body: CoachExplainBody): Promise<CoachExplainResponse> {
    if (!this.client) return { fallback: true, reason: "no_key" };
    const q = BY_QID.get(body.qid);
    if (!q) return { fallback: true, reason: "invalid" };
    const res = await this.call({ prompt: explainPrompt(q, body.gave), maxTokens: this.cfg.maxTokens.explain });
    if (!res.ok) return { fallback: true, reason: res.reason };
    // model output reaches the screen: any markup at all means we do not show it
    if (/[<>]/.test(res.text)) return { fallback: true, reason: "invalid" };
    const text = Array.from(res.text.trim()).slice(0, EXPLAIN_MAX_CHARS).join("");
    return text ? { fallback: false, text } : { fallback: true, reason: "invalid" };
  }

  /** One deadline (cfg.timeoutMs) covers every attempt; transient errors back off 2x each time. */
  private async call(req: CoachRequest): Promise<Called> {
    const client = this.client!;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return { ok: true, text: await client.complete(req, { signal: ctrl.signal }) };
        } catch (e) {
          if (ctrl.signal.aborted) return { ok: false, reason: "timeout" };
          // log the status only: SDK error messages are not ours to forward
          this.log.warn(`coach call failed (attempt ${attempt + 1}, status ${String((e as { status?: unknown })?.status ?? "none")})`);
          if (!retryable(e) || attempt >= this.cfg.retries) return { ok: false, reason: "error" };
          await sleep(this.cfg.backoffMs * 2 ** attempt, ctrl.signal);
          if (ctrl.signal.aborted) return { ok: false, reason: "timeout" };
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
}
