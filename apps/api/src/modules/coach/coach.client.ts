import Anthropic from "@anthropic-ai/sdk";
import { coachConfig } from "./coach.config.js";

export interface CoachRequest {
  prompt: string;
  maxTokens: number;
}

/** One text completion. The service owns timeout (via `signal`), retries and validation. */
export interface CoachClient {
  complete(req: CoachRequest, opts: { signal: AbortSignal }): Promise<string>;
}

export class AnthropicCoachClient implements CoachClient {
  private readonly sdk: Anthropic;

  constructor(apiKey: string) {
    // maxRetries 0: CoachService does its own retries inside one overall deadline.
    this.sdk = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async complete(req: CoachRequest, { signal }: { signal: AbortSignal }): Promise<string> {
    const msg = await this.sdk.messages.create(
      { model: coachConfig.model, max_tokens: req.maxTokens, messages: [{ role: "user", content: req.prompt }] },
      { signal },
    );
    return msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  }
}

/** No key, no client: the service answers {fallback:true, reason:"no_key"} without any network call. */
export function createCoachClient(apiKey: string | undefined): CoachClient | null {
  return apiKey ? new AnthropicCoachClient(apiKey) : null;
}
