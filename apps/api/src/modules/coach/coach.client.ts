import Anthropic from "@anthropic-ai/sdk";
import type { CoachFallbackReason } from "@cq/shared";
import { coachConfig } from "./coach.config.js";

export interface CoachRequest {
  prompt: string;
  maxTokens: number;
}

/** One text completion. The service owns timeout (via `signal`), retries and validation. */
export interface CoachClient {
  complete(req: CoachRequest, opts: { signal: AbortSignal }): Promise<string>;
}

/**
 * A failure the client has already classified (the Claude CLI client throws these). CoachService answers
 * with `reason` as the fallback reason and retries only when `retryable`. Any other error goes through the
 * service's HTTP-status rule, as before.
 */
export class CoachClientError extends Error {
  constructor(
    readonly reason: Exclude<CoachFallbackReason, "no_key" | "timeout">,
    readonly retryable: boolean
  ) {
    super(`coach client: ${reason}`);
  }
}

export class AnthropicCoachClient implements CoachClient {
  private readonly sdk: Anthropic;

  constructor(apiKey: string) {
    // maxRetries 0: CoachService does its own retries inside one overall deadline.
    this.sdk = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async complete(
    req: CoachRequest,
    { signal }: { signal: AbortSignal }
  ): Promise<string> {
    const msg = await this.sdk.messages.create(
      {
        model: coachConfig.model,
        max_tokens: req.maxTokens,
        messages: [{ role: "user", content: req.prompt }],
      },
      { signal }
    );
    return msg.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("");
  }
}

/** No key, no client: the service answers {fallback:true, reason:"no_key"} without any network call. */
export function createCoachClient(
  apiKey: string | undefined
): CoachClient | null {
  return apiKey ? new AnthropicCoachClient(apiKey) : null;
}
