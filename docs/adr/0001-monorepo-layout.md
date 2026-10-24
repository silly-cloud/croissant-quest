# 0001 Monorepo layout
Status: accepted. pnpm workspaces: `apps/web` (Next.js App Router), `apps/api` (NestJS), `packages/{shared,content,config}`, `infra/`, `docs/`.
`apps/web` and `apps/api` never import each other; they share only `packages/shared` (zod schemas, pure logic) and `packages/content` (bank JSON).
Deviation from the brief: none.
