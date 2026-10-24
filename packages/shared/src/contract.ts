import { z } from "zod";
import { Question } from "@cq/content";

/** HTTP contract between apps/web and apps/api. Both import from here, never from each other. */

/** A save document. The server runs normState on it, so unknown fields are ignored. */
export const StateBody = z.looseObject({});

export const ProgressResponse = z.object({
  /** normalised State */
  state: StateBody,
  /** monotonically increasing; send back as If-Match on PUT */
  version: z.number().int().min(0),
});
export type ProgressResponse = z.infer<typeof ProgressResponse>;

export const PutProgressBody = z.object({ state: StateBody });
export type PutProgressBody = z.infer<typeof PutProgressBody>;

export const CoachRoundBody = z.object({
  /** how many questions to write, 1-8 */
  n: z.number().int().min(1).max(8).default(8),
  /** rule tags to focus on (the server also reads the learner's record from the saved state) */
  focus: z.array(z.string()).max(6).default([]),
});
export type CoachRoundBody = z.infer<typeof CoachRoundBody>;

export const CoachRoundResponse = z.discriminatedUnion("fallback", [
  z.object({
    fallback: z.literal(false),
    questions: z.array(Question).min(4).max(8),
  }),
  z.object({
    fallback: z.literal(true),
    reason: z.enum(["no_key", "timeout", "error", "invalid"]),
  }),
]);
export type CoachRoundResponse = z.infer<typeof CoachRoundResponse>;

export const CoachExplainBody = z.object({
  qid: z.string().max(400),
  /** what the learner typed; the server truncates to 60 chars */
  gave: z.string().max(400),
});
export type CoachExplainBody = z.infer<typeof CoachExplainBody>;

export const CoachExplainResponse = z.discriminatedUnion("fallback", [
  z.object({ fallback: z.literal(false), text: z.string() }),
  z.object({
    fallback: z.literal(true),
    reason: z.enum(["no_key", "timeout", "error", "invalid"]),
  }),
]);
export type CoachExplainResponse = z.infer<typeof CoachExplainResponse>;

export const HealthResponse = z.object({
  ok: z.literal(true),
  db: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const API_PREFIX = "/v1";
export const DEVICE_COOKIE = "cq_device";

/** GET /v1/questions: everything the web app needs from @cq/content. */
export const QuestionsResponse = z.object({
  questions: z.array(Question),
  tags: z.record(z.string(), z.tuple([z.string(), z.string()])),
  tagNames: z.record(z.string(), z.string()),
  topics: z.array(z.tuple([z.number(), z.string()])),
  rules: z.record(z.string(), z.string()),
  pron: z.record(z.string(), z.tuple([z.string(), z.string(), z.string()])),
});
export type QuestionsResponse = z.infer<typeof QuestionsResponse>;
