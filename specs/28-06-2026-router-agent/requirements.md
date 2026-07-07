# Requirements: Router Agent

## Server-Side Stack Context

All GOC server-side services use NestJS as the standard framework. The Router Agent is no exception:

| Service | Stack | Port |
|---|---|---|
| `goc-rag-retriever` | NestJS + Fastify | 3000/3001 |
| `goc-lore-agent` | NestJS + Fastify | 3002 |
| `goc-router-agent` | NestJS + Fastify | 3004 |
| `goc-api-gateway` | NestJS + Fastify + socket.io | 3003 |
| `goc-reranker` | NestJS + Fastify | (future) |

NestJS is a **hard constraint** — not a per-service choice. Any change requires updating `tech-stack.md` first.

---

## Scope

This spec covers only the `goc-router-agent` NestJS service. It does not cover:
- The API Service (`goc-api-gateway`) that calls `POST /route` — separate Milestone 2 spec.
- The Lore Keeper Agent (`goc-lore-agent`) — covered under Milestone 1.
- The Gameplay Recommender or Hardware Expert agents — Milestones 3 and 4.
- Streaming responses (Icebox item).
- Swapping the LLM to `claude-haiku-4-5` — the labeled test suite is the evaluation harness for that comparison, but the swap itself is out of scope for this plan.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | NestJS + Fastify adapter | Project-wide standard across all GOC services. Express is not acceptable as either the framework or the NestJS adapter. |
| Language | TypeScript (strict mode) | NestJS standard; consistent with the rest of the GOC service layer. |
| Service boundary | Standalone NestJS HTTP service on port 3004 | Consistent with how goc-lore-agent and goc-rag-retriever are structured. Independent deployment, independent health checks, Docker Compose service isolation. |
| HTTP endpoint | `POST /route` | Single-purpose endpoint. API Service calls it over HTTP (same pattern as agents calling the Retriever). |
| LLM | GPT-4o-mini (`gpt-4o-mini`) | Classification is a single-turn, low-reasoning task. GPT-4o-mini is 10–15x cheaper than GPT-4o with comparable classification accuracy. Every user message hits the router; cost and latency dominate. |
| LLM temperature | `0` | Deterministic classification — no creative variation wanted. |
| Response format | `responseFormat: { type: "json_object" }` (OpenAI JSON mode) | Forces the model to emit valid JSON without markdown fences; eliminates a class of parse failures. |
| Agent framework | LangChain.js (`langchain`, `@langchain/openai`, `@langchain/core`) | Consistent with `goc-lore-agent`; provides the `ChatOpenAI` abstraction that is mockable in Jest. |
| Validation | `class-validator` + `class-transformer` + `ValidationPipe` | NestJS standard DTO validation pipeline. |
| Test framework | Jest + `@nestjs/testing` | NestJS standard. |
| Error handling | Catch-all fallback to `{ route: "GENERAL_CHAT", confidence: 0 }` | Router must never return 5xx — API Service expects a resolved response on every call. `confidence: 0` signals the API Service to emit a clarification event rather than routing blindly. |

---

## HTTP Contract

### `POST /route`

**Request body:**
```json
{
  "userMessage": "Why did Malenia fight Radahn?",
  "conversationHistory": [
    { "role": "user", "content": "Tell me about Elden Ring" },
    { "role": "assistant", "content": "Elden Ring is a 2022 action RPG..." }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `userMessage` | string (non-empty) | Yes | The user's latest message to classify. |
| `conversationHistory` | `{ role: "user"\|"assistant", content: string }[]` | No | Prior turns for context. Omit or pass `[]` for single-turn queries. |

**Response body (200):**
```json
{ "route": "LORE", "confidence": 0.93 }
```

| Field | Type | Description |
|---|---|---|
| `route` | `"LORE" \| "RECOMMENDATION" \| "HARDWARE" \| "GENERAL_CHAT"` | Always present. |
| `confidence` | number in `[0, 1]` | Always present. Always in range. Never NaN or undefined. |

**Error responses:**
- `400` — missing or invalid `userMessage` (validation error from `ValidationPipe`).
- The endpoint never returns `500` for LLM failures — those resolve to `{ route: "GENERAL_CHAT", confidence: 0 }`.

### `GET /health`

Returns `200 { "status": "ok" }` when the service is running. No downstream dependencies to probe.

---

## Output Schema

```typescript
// src/router/constants/routes.ts
export const ROUTES = {
  LORE: 'LORE',
  RECOMMENDATION: 'RECOMMENDATION',
  HARDWARE: 'HARDWARE',
  GENERAL_CHAT: 'GENERAL_CHAT',
} as const;

export const FALLBACK_RESULT = { route: ROUTES.GENERAL_CHAT, confidence: 0 };

// src/router/dto/route-response.dto.ts
export class RouteResponseDto {
  route: 'LORE' | 'RECOMMENDATION' | 'HARDWARE' | 'GENERAL_CHAT';
  confidence: number; // always in [0, 1]
}
```

---

## Confidence Threshold Semantics

The `0.7` threshold is the API Service's concern, not the router's. The router always responds with a value. The API Service logic for Milestone 2:

```
if confidence < 0.7:
    emit "clarification" WS event → ask user to be more specific
else if route === "LORE":
    POST /chat to goc-lore-agent → emit "response" WS event
else:
    emit "response" WS event with message "That agent is coming soon"
```

The router classifies all four routes correctly even though only Lore Keeper is live in Milestone 2. The API Service contains the "is this route live?" gating — the router is unaware of which agents are deployed.

---

## "Initially Hardcoded to Lore Keeper" — What This Means

The roadmap states: "Initially hardcoded to route only to Lore Keeper." This means the **API Service** ignores `RECOMMENDATION` and `HARDWARE` routes in Milestone 2, not the router. When Milestones 3 and 4 add new agents, the API Service routing table is updated — no change to `goc-router-agent` is required.

---

## Test Coverage Expectations

| Test file | What it covers |
|---|---|
| `src/router/dto/route-request.dto.spec.ts` | DTO validation: missing `userMessage`, empty `userMessage`, valid body, `conversationHistory` shape |
| `src/router/router.service.spec.ts` | LangChain.js mock wiring, valid JSON parse, invalid route → fallback, malformed JSON → fallback, thrown error → fallback |
| `src/router/router.controller.spec.ts` | Controller delegates to service, 400 on invalid body |
| `src/router/router.integration.spec.ts` | Full pipeline (HTTP → controller → service → LLM mock → response shape); fallback path returns 200 not 500 |
| `src/router/routing-accuracy.spec.ts` | 30+ labeled `{ input, expectedRoute }` entries; mock LLM; accuracy assertion >= 90% |

**Hard rules:**
- No test makes a real HTTP call. All LangChain.js and OpenAI SDK calls are mocked using `jest.mock`.
- `npm test` must exit 0 on a machine with no `OPENAI_API_KEY` set.
- The labeled test suite must have >= 5 examples per route category.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (default: `3004`) | Port the service listens on. |
| `OPENAI_API_KEY` | Yes | OpenAI API key for GPT-4o-mini calls. |

---

## Constraints

- NestJS + Fastify adapter — NOT Express (hard constraint matching all other GOC services).
- TypeScript strict mode.
- `class-validator` + `ValidationPipe` for DTO validation — no hand-rolled validation.
- `.env` is gitignored; `.env.example` is committed with placeholder values only.
- No hardcoded API keys, URLs, or secrets in source files.
- The service reads `OPENAI_API_KEY` via `ConfigService` at runtime — not at module load time.
- `conversationHistory` entries are plain objects `{ role: "user" | "assistant", content: string }`.
