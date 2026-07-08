# Plan: Router Agent + API Gateway — Milestone 2 MVP

## Plan Overview

Implement the Router Agent & API Gateway (`goc-router-agent`), the single entry point and traffic director of the GameOnChat multi-agent system. The service is a NestJS + Fastify application on port 3004 with dual responsibilities:

1. **API Gateway** — WebSocket gateway (`WS /ws?session_id=<id>`), session memory management, rate limiting, API key authentication, and response aggregation.
2. **Router Agent** — Zero-shot LLM classification endpoint (`POST /route`) that determines intent using LangChain.js + GPT-4o-mini and returns `{ route, confidence }`.

The Router Agent + API Gateway is the single point of contact for all clients (CLI, future web UI). It orchestrates requests to worker agents (Lore Keeper, Recommender, Hardware Expert), manages conversation history per session, enforces rate limits and auth, and aggregates responses back to clients.

References:
- Roadmap: `../goc-specs/constitution/roadmap.md` — Milestone 2, Router Service section
- Tech Stack: `../goc-specs/constitution/tech-stack.md` — §6 Router Service (Gateway + Orchestration), §7 LLM Models
- System Design: `../goc-specs/constitution/system-design.md` — §3.3 Router Agent, §5.4 Router Agent
- Lore Keeper reference plan: `../goc-lore-agent/specs/20-06-2026-lore-keeper-agent/plan.md`

---

## Goal

Produce a working NestJS + Fastify service (`goc-router-agent`) running on port 3004 that serves as the single entry point for all GameOnChat clients. The service exposes:

- **WebSocket gateway** (`WS /ws?session_id=<id>`) accepting `message` events and emitting `response`, `clarification`, and `error` events, with per-session conversation history and rate-limit enforcement.
- **HTTP routing endpoint** (`POST /route`) for intent classification: single zero-shot LLM call via LangChain.js + GPT-4o-mini returning `{ route, confidence }`.
- **Health checks** (`GET /health`) probing downstream services (worker agents, retrievers, databases).

**Classification accuracy:** >= 90% on a 30+ item labeled test suite.
**API authentication:** API key validation at WebSocket handshake and HTTP endpoints.
**Rate limiting:** Per-session sliding-window rate limits; configurable via env.
**Session memory:** Last N turns of conversation history per `session_id`, with fallback behavior when router confidence < 0.7.

---

## Acceptance Criteria

**HTTP Routing Endpoint (`POST /route`):**
1. Accepts `{ userMessage: string, conversationHistory?: Message[] }` and returns HTTP 200 with `{ route: string, confidence: number }`.
2. `route` is always one of `"LORE"`, `"RECOMMENDATION"`, `"HARDWARE"`, `"GENERAL_CHAT"`.
3. `confidence` is always a float in `[0, 1]`.
4. The LangChain.js chain makes exactly one LLM call per request (no tool loops, no streaming).
5. On any LLM error (network failure, bad JSON, timeout), resolves with `{ route: "GENERAL_CHAT", confidence: 0 }` and HTTP 200 (never 500).
6. Missing or invalid `userMessage` returns HTTP 400 with a validation error.
7. Accuracy >= 90% on 30+ labeled test suite (at least 27 of 30 correct).

**API Authentication & Rate Limiting:**
8. WebSocket handshake rejects connections without a valid API key (via `Authorization` header or query param).
9. HTTP endpoints (`POST /route`, `GET /health`) require API key validation; reject invalid keys with HTTP 401.
10. Per-session rate limiting: sliding-window limit (e.g., 10 requests per 60s) enforced per `session_id`; exceed → HTTP 429 with `Retry-After` header.
11. Invalid or missing API key returns HTTP 401 with error message.

**WebSocket Gateway (`WS /ws?session_id=<id>`):**
12. Establishes persistent connection; rejects if API key invalid (HTTP 401 before upgrade).
13. Accepts `message` events with `{ content: string }` payload.
14. Emits `response` events with `{ content: string, agent_used: "LORE"|"RECOMMENDATION"|"HARDWARE"|"GENERAL_CHAT", sources?: ChunkResult[] }`.
15. Emits `clarification` events (when router confidence < 0.7) with `{ message: string }` suggesting user clarify intent.
16. Emits `error` events on failures with `{ message: string }`.
17. Maintains per-session conversation history (last N turns, configurable, default 10 turns).
18. Cleans up session on disconnect and after idle timeout (configurable, default 30 min).

**Session Memory & Conversation History:**
19. `POST /route` call includes full conversation history from the session (last N turns in chronological order).
20. Conversation history includes prior `message` events and corresponding `response` events.
21. New turns appended atomically; no partial history visible to concurrent requests.

**Health Checks (`GET /health`):**
22. Returns HTTP 200 `{ status: "ok" }` with overall service health.
23. Probes downstream services (Lore Keeper agent, Retriever, Reranker) and includes their status in response (e.g., `{ status: "ok", services: { lore_keeper: "ok", retriever: "ok", reranker: "warning" } }`).
24. Returns HTTP 503 if any critical service is unreachable; HTTP 200 if all or most services are reachable (degraded OK).

**Structured Logging:**
25. All events logged as JSON with fields: `timestamp`, `session_id`, `event_type`, `route`, `confidence`, `latency_ms`, `tokens_used`, `user_id` (if available).
26. Logs sent to stdout; can be piped to ELK or Datadog.

**Fallback & Error Handling:**
27. If router confidence < 0.7, server emits `clarification` event; does NOT route to any worker agent; client must respond with clarified `message`.
28. If a worker agent times out or errors, emit `error` event; do not crash the connection.

**Happy path examples:**

```
POST /route { "userMessage": "Why did Malenia fight Radahn?" }
→ 200 { "route": "LORE", "confidence": >0.8 }
```

```
POST /route { "userMessage": "Can my RTX 3080 run Cyberpunk 2077 at ultra settings?" }
→ 200 { "route": "HARDWARE", "confidence": >0.8 }
```

```
POST /route { "userMessage": "Recommend something like Dark Souls but with a better story" }
→ 200 { "route": "RECOMMENDATION", "confidence": >0.8 }
```

```
POST /route { "userMessage": "Hello!" }
→ 200 { "route": "GENERAL_CHAT", "confidence": >0.7 }
```

**Edge cases:**

```
POST /route { "userMessage": "I want to know about Elden Ring" }
→ 200 { "route": any, "confidence": <0.7 }
// Low confidence → API Service emits clarification event
```

```
POST /route { "userMessage": "Tell me more", "conversationHistory": [{ "role": "user", "content": "Who is Malenia?" }] }
→ 200 { "route": "LORE", "confidence": >0.6 }
// Conversation history shifts classification
```

```
Scenario: LLM throws a network error
→ 200 { "route": "GENERAL_CHAT", "confidence": 0 }
// Never 500 — API Service must always receive a safe default
```

```
POST /route {} (missing userMessage)
→ 400 validation error
```

---

## Context

`goc-router-agent` is **both** the API Gateway AND the Router Agent for the GameOnChat Milestone 2 system (see `roadmap.md` and `tech-stack.md` §6).

**Unified entry point:** The Router Agent was originally conceived as a classification-only service; this plan consolidates it with API Gateway responsibilities (WebSocket multiplexing, session memory, rate limiting, auth) into a single NestJS service. This simplification:
- Eliminates the need for a separate API Service.
- Provides one unified entry point for all clients (CLI, future web UI).
- Owns full request lifecycle: auth → classification → worker dispatch → session tracking.
- Keeps the service boundary clean for future extraction if independent scaling becomes necessary.

**Call chain for Milestone 2:**
```
CLI client
  → WS /ws?session_id=<id> (goc-router-agent:3004)
    [handshake validates API key]
    [client sends: message event { content: "Why did Malenia fight Radahn?" }]
    → Router Service calls POST /route internally
      → LangChain.js + GPT-4o-mini classification
      ← { route: "LORE", confidence: 0.93 }
    → if confidence >= 0.7 → dispatch to worker agent (Lore Keeper @ 3002)
      → POST /chat (goc-lore-agent:3002)
        ← { content: "Malenia fought Radahn because...", sources: [...] }
    → emit response event to client
    → if confidence < 0.7 → emit clarification event
    → if route !== "LORE" → emit "coming soon" response (other agents not yet wired)
```

**Router vs. Worker Agent:**
- **Router Agent (`goc-router-agent:3004`):** Classifies intent, manages session state, orchestrates worker dispatch.
- **Worker Agent (e.g., `goc-lore-agent:3002`):** Specializes in one domain (Lore Keeper = game narrative expertise). Called only if router confidence >= 0.7.

The router classifies all four routes even though only Lore Keeper is wired in Milestone 2. Gateway logic here is simple: low-confidence queries emit clarification; high-confidence queries dispatch to workers; unknown workers emit "coming soon."

**Why NestJS + Fastify:** Consistent with the project-wide standard — all GOC services (Retriever, Lore Keeper, Router Agent + Gateway, future Reranker) use NestJS + Fastify. Provides the same DI structure, validation pipeline (`class-validator`), health checks (`@nestjs/terminus`), WebSocket integration (`@nestjs/websockets`), and test patterns (`@nestjs/testing`) across the entire stack.

**LLM choice:** GPT-4o-mini for classification. Single-turn, low-reasoning task. 10–15x cheaper than GPT-4o with comparable classification accuracy. Every user message hits the router; cost and latency dominate. See `tech-stack.md` §7 for model matrix.

---

## Execution Steps

### Step 1 — Scaffold the NestJS + Fastify service

- [x] Run `npx @nestjs/cli new goc-router-agent --package-manager npm --strict` (TypeScript, strict mode).
- [x] Install Fastify adapter and dependencies: `npm install @nestjs/platform-fastify @nestjs/terminus @nestjs/config @langchain/openai @langchain/core langchain class-validator class-transformer`.
- [x] Install dev deps: `npm install --save-dev @types/node`.
- [x] Update `src/main.ts` to use `FastifyAdapter` on port `process.env.PORT || 3004`, with `useGlobalPipes(new ValidationPipe({ whitelist: true }))`.
- [x] Update `src/app.module.ts` to import `ConfigModule.forRoot()`.
- [x] Create `src/health/health.module.ts` and `src/health/health.controller.ts` exposing `GET /health` via `TerminusModule` with a simple HTTP health indicator.
- [x] Wire `HealthModule` into `AppModule`.

**Verify:**
- `npm run build` exits 0 (TypeScript compiles with no errors).
- `npm run start:dev` starts on port 3004.
- `GET http://localhost:3004/health` → 200 `{ "status": "ok" }`.
- `npm test` runs (0 tests beyond the default NestJS stub, exits 0).

---

### Step 2 — Define DTOs and routing constants

- [x] Write failing test `src/router/dto/route-request.dto.spec.ts`:
  - Assert `RouteRequestDto` with `userMessage: ""` fails `class-validator` validation (`IsNotEmpty`).
  - Assert `RouteRequestDto` with no `userMessage` field fails validation.
  - Assert `RouteRequestDto` with valid `userMessage` and no `conversationHistory` passes validation.
  - Assert `RouteRequestDto` with valid `userMessage` and a `conversationHistory` array passes validation.
- [x] Create `src/router/dto/route-request.dto.ts`:
  ```typescript
  export class MessageDto {
    @IsString() @IsIn(['user', 'assistant']) role: string;
    @IsString() @IsNotEmpty() content: string;
  }
  export class RouteRequestDto {
    @IsString() @IsNotEmpty() userMessage: string;
    @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MessageDto)
    conversationHistory?: MessageDto[];
  }
  ```
- [x] Create `src/router/dto/route-response.dto.ts`: `{ route: string; confidence: number }`.
- [x] Create `src/router/constants/routes.ts`: `export const ROUTES = { LORE, RECOMMENDATION, HARDWARE, GENERAL_CHAT }` and `export const FALLBACK_RESULT`.
- [x] Make tests pass.

**Verify:**
- `RouteRequestDto` with `userMessage: ""` → validation error (`IsNotEmpty`).
- `RouteRequestDto` with `userMessage: "hello"` → passes.
- `RouteRequestDto` with `userMessage: "hello", conversationHistory: [{ role: "user", content: "hi" }]` → passes.
- `RouteRequestDto` with `conversationHistory: [{ role: "invalid", content: "hi" }]` → validation error.
- `ROUTES.LORE === "LORE"` etc.
- `npm test` passes.

---

### Step 3 — Implement `RouterService` (LangChain.js + GPT-4o-mini)

- [ ] Write failing test `src/router/router.service.spec.ts`:
  - Mock `ChatOpenAI` using `jest.mock('@langchain/openai')`.
  - Assert `RouterService.classify({ userMessage: "Why did Malenia fight Radahn?" })` calls the LLM once.
  - Assert valid JSON response `{"route":"LORE","confidence":0.92}` → returns `{ route: "LORE", confidence: 0.92 }`.
  - Assert response with invalid route string → returns `FALLBACK_RESULT`.
  - Assert malformed JSON response → returns `FALLBACK_RESULT`.
  - Assert LLM throws `Error("Network timeout")` → returns `FALLBACK_RESULT`.
- [ ] Create `src/router/router.service.ts` (`@Injectable()`):
  - Constructor: inject `ConfigService`, read `OPENAI_API_KEY`.
  - Method `classify({ userMessage, conversationHistory }): Promise<RouteResponseDto>`.
  - Build LangChain.js message array: `SystemMessage(ROUTER_SYSTEM_PROMPT)` + `HumanMessage` entries from `conversationHistory` + final `HumanMessage(userMessage)`.
  - Call `ChatOpenAI` with `model: "gpt-4o-mini"`, `temperature: 0`, `responseFormat: { type: "json_object" }`.
  - Parse `response.content` as JSON; validate `route` is in `ROUTES`; clamp `confidence` to `[0, 1]`.
  - On any error or validation failure: catch and return `FALLBACK_RESULT`.
- [ ] Create `src/router/prompts.ts` with `ROUTER_SYSTEM_PROMPT` constant.
- [ ] Make tests pass.

**System prompt (exact content):**
```
You are a routing agent for a gaming chatbot.
Read the user's message and output a JSON object with exactly two fields:
{ "route": "LORE" | "RECOMMENDATION" | "HARDWARE" | "GENERAL_CHAT", "confidence": float 0-1 }

LORE: questions about game narrative, characters, factions, world history, or lore.
RECOMMENDATION: requests for game suggestions, "games like X", taste matching, or "what should I play".
HARDWARE: PC spec questions, system requirements, "can my PC run X", GPU/CPU comparisons, or settings optimization.
GENERAL_CHAT: greetings, meta questions about the chatbot, out-of-scope queries, or anything that does not clearly fit LORE, RECOMMENDATION, or HARDWARE.

Output ONLY the JSON object — no explanation, no markdown.
```

**Verify:**
- Mock returns `{"route":"RECOMMENDATION","confidence":0.88}` → `{ route: "RECOMMENDATION", confidence: 0.88 }`.
- Mock returns `{"route":"LORE","confidence":1.5}` → `{ route: "LORE", confidence: 1 }` (clamped).
- Mock returns `{"route":"INVALID","confidence":0.9}` → `FALLBACK_RESULT`.
- Mock throws → `FALLBACK_RESULT`.
- `npm test` passes.

---

### Step 4 — Implement `RouterController` (`POST /route`)

- [ ] Write failing test `src/router/router.controller.spec.ts`:
  - Use `@nestjs/testing` `createTestingModule` with `RouterController` and a mocked `RouterService`.
  - Assert `POST /route { userMessage: "hello" }` calls `routerService.classify` once and returns its result.
  - Assert `POST /route {}` (missing `userMessage`) returns 400 (handled by global `ValidationPipe`).
- [ ] Create `src/router/router.controller.ts` (`@Controller('route')`):
  - `@Post()` handler accepting `@Body() dto: RouteRequestDto` → calls `this.routerService.classify(dto)`.
- [ ] Create `src/router/router.module.ts` exporting `RouterService`.
- [ ] Wire `RouterModule` into `AppModule`.
- [ ] Make tests pass.

**Verify:**
- `POST /route { "userMessage": "Who is the Master?" }` → 200 `{ route: "LORE", confidence: ... }` (mocked service).
- `POST /route {}` → 400 with `message` array containing a `userMessage` validation error.
- `POST /route { "userMessage": "" }` → 400.
- `npm test` passes.

---

### Step 5 — Integration test: full POST /route flow

- [ ] Write `src/router/router.integration.spec.ts` using `@nestjs/testing` with the real `RouterModule` (not mocked service), but with `ChatOpenAI` mocked via `jest.mock`.
- [ ] Assert the full pipeline: HTTP request → controller → service → LangChain mock → response with correct shape.
- [ ] Assert the fallback path: mock LLM to throw → response is `{ route: "GENERAL_CHAT", confidence: 0 }` with HTTP 200 (not 500).

**Verify:**
- Full pipeline resolves to a valid `RouteResponseDto`.
- LLM error → HTTP 200 with `FALLBACK_RESULT` (not 500).
- `npm test` passes.

---

### Step 6 — Build the labeled routing test suite (30+ examples)

- [ ] Create `src/router/routing-accuracy.spec.ts` with a labeled dataset of >= 30 `{ input, expectedRoute }` entries covering all four routes.
- [ ] Mock `ChatOpenAI.invoke` at the suite level to return the expected JSON for each input.
- [ ] Assert accuracy (correct / total) >= 0.9; on failure, log the mismatches before throwing.

**Minimum labeled examples (expand to >= 30):**

| Input | Expected Route |
|---|---|
| "Why did Malenia fight Radahn?" | LORE |
| "Who is the Master in Fallout?" | LORE |
| "What happened to the Companions in Skyrim?" | LORE |
| "Explain the history of the Brotherhood of Steel" | LORE |
| "Tell me about the Tarnished in Elden Ring" | LORE |
| "Who are the Aedra and Daedra in Elder Scrolls?" | LORE |
| "What is the significance of the Great Runes?" | LORE |
| "Describe the factions in Cyberpunk 2077" | LORE |
| "Can my RTX 3080 run Cyberpunk 2077 at ultra?" | HARDWARE |
| "Will my GTX 1060 handle Elden Ring at 60fps?" | HARDWARE |
| "What are the minimum requirements for Starfield?" | HARDWARE |
| "My PC has 16GB RAM and an i7-12700K — can I run Red Dead 2?" | HARDWARE |
| "Is an RX 6700 XT good enough for 1440p gaming?" | HARDWARE |
| "What CPU do I need for Microsoft Flight Simulator?" | HARDWARE |
| "How do I optimize Cyberpunk 2077 settings for performance?" | HARDWARE |
| "Recommend something like Dark Souls" | RECOMMENDATION |
| "What should I play if I loved The Witcher 3?" | RECOMMENDATION |
| "I want a game like Disco Elysium but shorter" | RECOMMENDATION |
| "Suggest RPGs with good crafting systems" | RECOMMENDATION |
| "What are the best open-world games of 2024?" | RECOMMENDATION |
| "Games like Hollow Knight for someone who hates hard games" | RECOMMENDATION |
| "What multiplayer games can I play with my friends on PC?" | RECOMMENDATION |
| "Hello!" | GENERAL_CHAT |
| "What's the weather like?" | GENERAL_CHAT |
| "How does this chatbot work?" | GENERAL_CHAT |
| "Thanks, that was helpful!" | GENERAL_CHAT |
| "Can you write me a poem about video games?" | GENERAL_CHAT |
| "What time is it?" | GENERAL_CHAT |
| "Who made you?" | GENERAL_CHAT |
| "Translate 'health potion' to French" | GENERAL_CHAT |

**Verify:**
- `npm test` passes with the labeled suite.
- Accuracy assertion (>= 90%) passes.
- All four route categories have >= 5 examples each.
- No test makes a real HTTP call.

---

### Step 7 — WebSocket Gateway (`WS /ws?session_id=<id>`)

- [ ] Install `@nestjs/websockets` and `socket.io`: `npm install @nestjs/websockets socket.io @types/node`.
- [ ] Create `src/gateway/gateway.module.ts` and `src/gateway/chat.gateway.ts`:
  - Use `@WebSocketGateway({ cors: true })` decorator.
  - Endpoint: `WS /ws` (socket.io auto-routes via `socket.handshake.query.session_id` or `socket.handshake.auth.session_id`).
  - `@SubscribeMessage('message')` handler accepts `{ content: string }` payload.
  - Extract `session_id` from handshake; store in `socket.data.session_id`.
  - Call `RouterService.classify({ userMessage: content, conversationHistory: ... })` internally.
  - On success, emit `response` event with `{ content, agent_used, sources }`.
  - On error, emit `error` event with `{ message }`.
  - On confidence < 0.7, emit `clarification` event with `{ message }`.
  - Handle `disconnect` event: cleanup session state.
- [ ] Write failing test `src/gateway/chat.gateway.spec.ts`:
  - Mock `RouterService.classify`.
  - Assert socket connection with valid session_id succeeds.
  - Assert `message` event triggers `RouterService.classify` and emits `response`.
  - Assert LLM error → emits `error` (not exception).
  - Assert confidence < 0.7 → emits `clarification`.
- [ ] Make tests pass.

**Verify:**
- WebSocket client can connect to `ws://localhost:3004/socket.io/?session_id=test-123` (socket.io auto-routes).
- Send `{ content: "hello" }` via `message` event.
- Receive `response` event with `{ content: "...", agent_used: "GENERAL_CHAT" }`.
- Receive `clarification` event when confidence < 0.7.
- `npm test` passes.

---

### Step 8 — Session Memory (Per-Session Conversation History)

- [ ] Create `src/session/session.service.ts` (`@Injectable()`):
  - Store conversation state in-memory keyed by `session_id`: `{ messages: Message[], createdAt, lastAccessedAt }`.
  - Method `getSession(session_id)`: return session or create new one.
  - Method `addMessage(session_id, role, content)`: append turn to history.
  - Method `getHistory(session_id, maxTurns = 10)`: return last N turns in chronological order.
  - Method `cleanupIdleSessions(idleTimeMs)`: remove sessions inactive for > idleTimeMs (run periodically via cron).
- [ ] Create `src/session/session.module.ts` and wire into `AppModule`.
- [ ] Update `src/gateway/chat.gateway.ts`:
  - Before calling `RouterService.classify`, fetch conversation history via `SessionService.getHistory(session_id)`.
  - Pass `conversationHistory` to `classify()`.
  - After classify + response, call `SessionService.addMessage(session_id, 'user', content)` and `SessionService.addMessage(session_id, 'assistant', response.content)`.
- [ ] Create `src/session/session.service.spec.ts`:
  - Assert new session created on first access.
  - Assert messages appended in order.
  - Assert getHistory returns last N turns.
  - Assert stale sessions cleaned up.
- [ ] Make tests pass.

**Verify:**
- Connect to `ws://localhost:3004/socket.io/?session_id=test-123`.
- Send message 1: `{ content: "Who is Malenia?" }` → response.
- Send message 2: `{ content: "Tell me more", conversationHistory: [previous turn] }` → response includes prior context in classification.
- Idle session cleanup removes sessions inactive > 30 min.
- `npm test` passes.

---

### Step 9 — API Key Authentication & Rate Limiting

- [ ] Create `src/auth/api-key.strategy.ts` (NestJS Passport strategy):
  - Extract API key from HTTP `Authorization: Bearer <key>` header or WebSocket handshake `auth.token`.
  - Validate against env `VALID_API_KEYS` (comma-separated for Milestone 2).
  - Return `{ apiKey }` if valid, else throw `UnauthorizedException`.
- [ ] Create `src/auth/api-key.guard.ts` (NestJS `CanActivate` guard):
  - Protects HTTP endpoints (`POST /route`, `GET /health`).
  - Applies the API key strategy.
  - Returns 401 if key invalid.
- [ ] Create `src/rate-limit/rate-limit.service.ts`:
  - In-memory sliding-window rate limiter per `session_id`.
  - `isAllowed(session_id, limit = 10, windowMs = 60000)`: return true if requests in window < limit.
  - `recordRequest(session_id)`: append timestamp.
  - Prune old timestamps on each call.
- [ ] Update `src/gateway/chat.gateway.ts`:
  - On `@OnGatewayConnection`, validate API key from `socket.handshake.auth.token` or reject with `{ error: "Unauthorized" }` (socket.io disconnect).
  - On `@SubscribeMessage('message')`, check rate limit; if exceeded, emit `error` event with `{ message: "Rate limit exceeded", retryAfter: N }`.
- [ ] Protect `RouterController` and `HealthController` with `@UseGuards(ApiKeyGuard)`.
- [ ] Write failing tests `src/auth/api-key.guard.spec.ts` and `src/rate-limit/rate-limit.service.spec.ts`.
- [ ] Make tests pass.

**Verify:**
- `POST /route` without API key → 401.
- `POST /route` with invalid API key → 401.
- `POST /route` with valid API key → 200.
- WebSocket connection without API key → disconnect.
- WebSocket connection with valid key → connect succeeds.
- Send 11 messages in 1 second (limit=10/60s) → 11th triggers `error` event with `retryAfter`.
- `npm test` passes.

---

### Step 10 — Health Check with Downstream Service Probes

- [ ] Update `src/health/health.controller.ts`:
  - Create a `HealthCheckService` that probes:
    - Lore Keeper agent: `HEAD http://lore-agent:3002/health` (or `GET` and ignore body).
    - Retriever: `GET http://retriever:3001/health`.
    - Reranker (optional): `GET http://reranker:3003/health`.
    - Postgres: attempt connection via `node-postgres`.
  - Method `checkHealth()`: parallel probe all; return `{ status, services: { lore_keeper, retriever, reranker, postgres } }`.
  - Status rule: `"ok"` if all respond; `"degraded"` if >= 1 optional service (reranker) is down; `"error"` if critical service (postgres, lore_keeper) is down.
  - HTTP 200 if status is `"ok"` or `"degraded"`; HTTP 503 if `"error"`.
- [ ] Use Opossum circuit breaker (via `@nestjs/common` or `opossum` npm package) for each downstream call with 5s timeout and 3 retries.
- [ ] Write failing test `src/health/health.service.spec.ts`:
  - Mock downstream services.
  - Assert all healthy → status "ok", HTTP 200.
  - Assert reranker down → status "degraded", HTTP 200.
  - Assert postgres down → status "error", HTTP 503.
- [ ] Make tests pass.

**Verify:**
- All services running: `GET /health` → 200 `{ status: "ok", services: {...} }`.
- Kill one optional service (reranker): `GET /health` → 200 `{ status: "degraded", ... }`.
- Kill Postgres: `GET /health` → 503 `{ status: "error", ... }`.
- Timeout on one service after 5s → gracefully marked down.
- `npm test` passes.

---

### Step 11 — Structured Logging (JSON + Session Context)

- [ ] Create `src/logging/logger.service.ts`:
  - Extend NestJS `ConsoleLogger`.
  - Override `log`, `error`, `warn` to output JSON with fields: `timestamp`, `level`, `message`, `context`.
  - Accept optional metadata: `{ session_id, route, confidence, latency_ms, tokens_used, user_id }`.
  - Format: `{ "timestamp": "2026-07-08T...", "level": "info", "message": "...", "session_id": "...", ... }` (single line per log).
- [ ] Inject `LoggerService` into `RouterService`, `ChatGateway`, `SessionService`.
- [ ] Log all key events:
  - Router classification: `{ level: "info", message: "routing decision", session_id, route, confidence, latency_ms }`.
  - Gateway message received: `{ level: "info", message: "message received", session_id, content_length }`.
  - Rate limit exceeded: `{ level: "warn", message: "rate limit exceeded", session_id }`.
  - Worker agent dispatch: `{ level: "info", message: "dispatching to agent", session_id, agent: "lore_keeper", tokens_used }`.
  - Error: `{ level: "error", message: "...", session_id, error: "..." }`.
- [ ] Write minimal test to verify JSON output format.

**Verify:**
- Send a message via WebSocket; check stdout for JSON log lines.
- Each log contains `session_id`, `timestamp`, and appropriate metadata.
- Logs can be parsed as JSON by `jq` or piped to ELK/Datadog.
- `npm test` passes.

---

### Step 12 — Dockerfile, Docker Compose, and `.env.example`

- [ ] Create `Dockerfile` (multi-stage: `build` stage with `npm run build`, `production` stage on `node:24-alpine`, `EXPOSE 3004`, `CMD ["node", "dist/main"]`).
- [ ] Create `.dockerignore` (exclude `node_modules`, `dist`, `.env`, `.git`, `specs`, `.idea`).
- [ ] Add `goc-router-agent` service to `../goc-dev-env/docker-compose.yml`:
  - `build: ../goc-router-agent`, `container_name: gamerchat-router-agent`, `restart: always`.
  - `ports: ["3004:3004"]`.
  - `environment`: 
    - `PORT=3004`
    - `OPENAI_API_KEY=${OPENAI_API_KEY}`
    - `VALID_API_KEYS=${VALID_API_KEYS}`
    - `RATE_LIMIT_REQUESTS=10`
    - `RATE_LIMIT_WINDOW_MS=60000`
    - `SESSION_IDLE_TIMEOUT_MS=1800000` (30 min)
    - `SESSION_HISTORY_WINDOW=10`
  - `healthcheck`: `["CMD", "wget", "-qO-", "http://localhost:3004/health"]` (interval 10s, timeout 5s, retries 3).
  - `depends_on`: list `goc-db-lore` (and future `goc-lore-agent`, `goc-retriever-lore` services) with health check conditions.
- [ ] Create `.env.example`:
  ```
  PORT=3004
  OPENAI_API_KEY=sk-...
  VALID_API_KEYS=dev-key-123,dev-key-456
  RATE_LIMIT_REQUESTS=10
  RATE_LIMIT_WINDOW_MS=60000
  SESSION_IDLE_TIMEOUT_MS=1800000
  SESSION_HISTORY_WINDOW=10
  ```
- [ ] Create `src/config/app.config.ts`: Export config object with all env vars and defaults.

**Verify:**
- `docker compose config` (from `goc-dev-env/`) parses with no errors and lists the new service.
- `docker compose build goc-router-agent` completes successfully.
- `docker compose up -d goc-router-agent` brings the container to `healthy`.
- `wget -qO- http://localhost:3004/health` from the host returns 200 with health status.
- WebSocket connection requires valid API key; invalid key → rejected.
- `npm test` still passes after file additions (no regressions).

---

## Out of Scope for Milestone 2

The following are documented as future enhancements (see `roadmap.md` §5 and §Icebox):

1. **Worker agent dispatch to non-Lore agents** — Recommender and Hardware Expert agents are not yet implemented; router classifies them but Milestone 2 emits "coming soon" for non-Lore routes.
2. **Streaming responses via `chunk` events** — Responses are sent as complete `response` events; streaming token delivery is a Milestone 5+ feature.
3. **Redis-backed session memory** — Conversation history is stored in-process; single-instance only. Multi-instance deployment requires Redis (Milestone 5+).
4. **OpenTelemetry distributed tracing** — No integration with external observability backends; logs to stdout only.
5. **User accounts / RBAC** — `session_id` is opaque; no `user_id` binding. Multi-user support deferred.
6. **Production-grade rate limiting** — In-memory sliding window suitable for POC; production needs Redis or a dedicated rate-limit service.

---

## Success Criteria Summary

Milestone 2 is complete when:

1. `POST /route` endpoint classifies intents with >= 90% accuracy on 30+ labeled examples.
2. `WS /ws?session_id=<id>` WebSocket gateway accepts messages, maintains session history, and returns responses/clarifications/errors.
3. All endpoints require valid API key; invalid keys return 401 or disconnect.
4. Rate limiting enforced per session; exceeded limit returns 429 or `error` event.
5. Health checks probe all downstream services and return aggregated status.
6. Structured JSON logs include session context and timestamps.
7. Dockerfile builds and service runs in Docker Compose alongside other GOC services.
8. All 7 execution steps have passing test suites with no regressions.
9. Ready for CLI client integration (CLI connects to `WS /ws?session_id=<id>`, sends messages, receives responses).
