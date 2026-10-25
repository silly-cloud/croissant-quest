# 0005 Coach: server-side Anthropic call with local fallback
Status: accepted. `ANTHROPIC_API_KEY` is read only by the API. Model id lives in `apps/api/src/modules/coach/coach.config.ts` (default `claude-sonnet-5-5`, tier "default").
30 s timeout, up to 2 retries with backoff, per-device rate limit. Generated questions are validated with the shared zod schema, must contain `___`, include the answer among options,
use a known tag, and must not equal a bank question (item 11). If the key is missing, the call fails or validation leaves fewer than 4 questions, `/v1/coach/round` returns `{fallback:true}` and the web app starts a local round. No button is ever dead.
