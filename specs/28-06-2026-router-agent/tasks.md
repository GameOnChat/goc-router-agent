# Tasks: Router Agent + API Gateway — Milestone 2 MVP

**Feature**: Implement the Router Agent & API Gateway (`goc-router-agent`), the single entry point and traffic director of the GameOnChat multi-agent system.

**Goal**: Produce a working NestJS + Fastify service (`goc-router-agent`) running on port 3004 that serves as the single entry point for all GameOnChat clients, with WebSocket gateway, intent classification, session memory, API authentication, and rate limiting.

**Success Criteria**:
- `POST /route` endpoint classifies intents with >= 90% accuracy on 30+ labeled examples
- `WS /ws?session_id=<id>` WebSocket gateway maintains session state and response routing
- All endpoints require valid API key; invalid keys return 401 or disconnect
- Per-session rate limiting enforced; exceeded limit returns 429 or `error` event
- Health checks probe downstream services
- Structured JSON logs with session context
- Full Docker Compose integration

---

## Phase 1: Project Setup

- [X] T001 Scaffold the NestJS + Fastify service per Step 1
  - Run `npx @nestjs/cli new goc-router-agent --package-manager npm --strict` with TypeScript strict mode
  - Install `@nestjs/platform-fastify @nestjs/terminus @nestjs/config @langchain/openai @langchain/core langchain class-validator class-transformer`
  - Install dev deps: `@types/node`
  - Update `src/main.ts` to use `FastifyAdapter` on port 3004 with global `ValidationPipe`
  - Update `src/app.module.ts` to import `ConfigModule.forRoot()`
  - File: `goc-router-agent/src/main.ts`

- [X] T002 Create health check module per Step 1
  - Create `src/health/health.module.ts` and `src/health/health.controller.ts`
  - Expose `GET /health` via `TerminusModule` with HTTP health indicator
  - Wire `HealthModule` into `AppModule`
  - File: `goc-router-agent/src/health/health.controller.ts`

**Verify Phase 1**:
- `npm run build` exits 0 with no TypeScript errors
- `npm run start:dev` starts on port 3004
- `GET http://localhost:3004/health` returns 200 with `{ "status": "ok" }`
- `npm test` runs (default NestJS stub tests, exits 0)

---

## Phase 2: Core Routing Functionality

### Step 2: DTOs and Routing Constants

- [ ] T003 Write failing test for RouteRequestDto per Step 2
  - Create `src/router/dto/route-request.dto.spec.ts`
  - Assert validation rules: `userMessage` required and non-empty, `conversationHistory` optional array of `MessageDto`
  - File: `goc-router-agent/src/router/dto/route-request.dto.spec.ts`

- [ ] T004 [P] Create RouteRequestDto with validation per Step 2
  - Create `src/router/dto/route-request.dto.ts` with `MessageDto` and `RouteRequestDto` classes
  - Use `@IsString()`, `@IsNotEmpty()`, `@IsOptional()`, `@IsArray()`, `@ValidateNested()`, `@Type()` decorators
  - File: `goc-router-agent/src/router/dto/route-request.dto.ts`

- [ ] T005 [P] Create RouteResponseDto per Step 2
  - Create `src/router/dto/route-response.dto.ts` with `route: string` and `confidence: number` fields
  - File: `goc-router-agent/src/router/dto/route-response.dto.ts`

- [ ] T006 [P] Create routing constants per Step 2
  - Create `src/router/constants/routes.ts`
  - Export `ROUTES = { LORE, RECOMMENDATION, HARDWARE, GENERAL_CHAT }` as const
  - Export `FALLBACK_RESULT = { route: "GENERAL_CHAT", confidence: 0 }`
  - File: `goc-router-agent/src/router/constants/routes.ts`

**Verify Step 2**:
- All DTO tests pass; invalid `userMessage` triggers validation error
- `ROUTES.LORE === "LORE"` etc.
- `npm test` passes

### Step 3: RouterService (LangChain.js + GPT-4o-mini)

- [ ] T007 Write failing test for RouterService per Step 3
  - Create `src/router/router.service.spec.ts`
  - Mock `ChatOpenAI` from `@langchain/openai`
  - Test valid JSON response, invalid route fallback, malformed JSON fallback, LLM error fallback
  - File: `goc-router-agent/src/router/router.service.spec.ts`

- [ ] T008 Create system prompt constant per Step 3
  - Create `src/router/prompts.ts` with `ROUTER_SYSTEM_PROMPT`
  - Prompt instructs classification into LORE / RECOMMENDATION / HARDWARE / GENERAL_CHAT with JSON output
  - File: `goc-router-agent/src/router/prompts.ts`

- [ ] T009 Implement RouterService with LangChain per Step 3
  - Create `src/router/router.service.ts` (`@Injectable()`)
  - Inject `ConfigService`, read `OPENAI_API_KEY` from env
  - Implement `classify(userMessage, conversationHistory)` method
  - Build message array: `SystemMessage(ROUTER_SYSTEM_PROMPT)` + conversation history + final `HumanMessage`
  - Call `ChatOpenAI` with `model: "gpt-4o-mini"`, `temperature: 0`, `responseFormat: { type: "json_object" }`
  - Parse response, validate route, clamp confidence to [0, 1]
  - Catch all errors and return `FALLBACK_RESULT`
  - File: `goc-router-agent/src/router/router.service.ts`

**Verify Step 3**:
- Mock returns valid route → service returns same
- Mock returns confidence > 1 → clamped to 1
- Mock returns invalid route → returns `FALLBACK_RESULT`
- Mock throws → returns `FALLBACK_RESULT`
- `npm test` passes

### Step 4: RouterController (POST /route)

- [ ] T010 Write failing test for RouterController per Step 4
  - Create `src/router/router.controller.spec.ts`
  - Mock `RouterService`
  - Test successful classification, validation error on missing `userMessage`
  - File: `goc-router-agent/src/router/router.controller.spec.ts`

- [ ] T011 Implement RouterController with POST /route per Step 4
  - Create `src/router/router.controller.ts` (`@Controller('route')`)
  - `@Post()` handler: accept `@Body() dto: RouteRequestDto`, call `routerService.classify(dto)`
  - File: `goc-router-agent/src/router/router.controller.ts`

- [ ] T012 Create RouterModule per Step 4
  - Create `src/router/router.module.ts`
  - Import and export `RouterService`
  - Wire `RouterModule` into `AppModule`
  - File: `goc-router-agent/src/router/router.module.ts`

**Verify Step 4**:
- `POST /route { "userMessage": "Who is the Master?" }` returns 200 with route/confidence
- `POST /route {}` returns 400 validation error
- `POST /route { "userMessage": "" }` returns 400
- `npm test` passes

### Step 5: Integration Test (Full POST /route Flow)

- [ ] T013 Write integration test for full POST /route pipeline per Step 5
  - Create `src/router/router.integration.spec.ts`
  - Use real `RouterModule`, mock `ChatOpenAI` via `jest.mock`
  - Test full pipeline: HTTP request → controller → service → LLM mock → response
  - Test fallback path: LLM error → HTTP 200 with `{ route: "GENERAL_CHAT", confidence: 0 }`
  - File: `goc-router-agent/src/router/router.integration.spec.ts`

**Verify Step 5**:
- Full pipeline returns valid `RouteResponseDto`
- LLM error → HTTP 200 with fallback (not 500)
- `npm test` passes

### Step 6: Labeled Routing Test Suite (30+ examples, >= 90% accuracy)

- [ ] T014 Build labeled routing accuracy test suite per Step 6
  - Create `src/router/routing-accuracy.spec.ts`
  - Include >= 30 labeled `{ input, expectedRoute }` entries covering all four routes
  - Minimum 5 examples per route category (LORE, RECOMMENDATION, HARDWARE, GENERAL_CHAT)
  - Mock `ChatOpenAI.invoke` to return expected JSON for each input
  - Assert accuracy (correct / total) >= 0.9; log mismatches before throwing
  - File: `goc-router-agent/src/router/routing-accuracy.spec.ts`

**Verify Step 6**:
- `npm test` passes with labeled suite
- Accuracy assertion (>= 90%) passes
- All four route categories have >= 5 examples each
- No test makes real HTTP call

---

## Phase 3: Advanced Features

### Step 7: WebSocket Gateway

- [ ] T015 Install WebSocket dependencies per Step 7
  - `npm install @nestjs/websockets socket.io`
  - File: `goc-router-agent/package.json`

- [ ] T016 Create WebSocket gateway module per Step 7
  - Create `src/gateway/gateway.module.ts` and `src/gateway/chat.gateway.ts`
  - Use `@WebSocketGateway({ cors: true })` decorator
  - Endpoint: `WS /ws` with session_id from handshake query or auth
  - File: `goc-router-agent/src/gateway/chat.gateway.ts`

- [ ] T017 Implement message handler and response events per Step 7
  - `@SubscribeMessage('message')` handler accepts `{ content: string }` payload
  - Extract `session_id` from handshake and store in `socket.data.session_id`
  - Call `RouterService.classify({ userMessage: content, conversationHistory: ... })`
  - On success: emit `response` with `{ content, agent_used, sources }`
  - On error: emit `error` with `{ message }`
  - On confidence < 0.7: emit `clarification` with `{ message }`
  - Handle `disconnect` event: cleanup session state
  - File: `goc-router-agent/src/gateway/chat.gateway.ts`

- [ ] T018 Write WebSocket gateway tests per Step 7
  - Create `src/gateway/chat.gateway.spec.ts`
  - Mock `RouterService.classify`
  - Test connection success, message trigger classification, LLM error handling, low-confidence clarification
  - File: `goc-router-agent/src/gateway/chat.gateway.spec.ts`

- [ ] T019 Wire gateway into AppModule per Step 7
  - Import `GatewayModule` into `AppModule`
  - File: `goc-router-agent/src/app.module.ts`

**Verify Step 7**:
- WebSocket client connects to `ws://localhost:3004/socket.io/?session_id=test-123`
- Send `{ content: "hello" }` via `message` event
- Receive `response` event with `{ content: "...", agent_used: "GENERAL_CHAT" }`
- Receive `clarification` event when confidence < 0.7
- `npm test` passes

### Step 8: Session Memory (Per-Session Conversation History)

- [ ] T020 Create session memory service per Step 8
  - Create `src/session/session.service.ts` (`@Injectable()`)
  - In-memory store keyed by `session_id`: `{ messages, createdAt, lastAccessedAt }`
  - Method `getSession(session_id)`: create new if missing
  - Method `addMessage(session_id, role, content)`: append to history
  - Method `getHistory(session_id, maxTurns = 10)`: return last N turns chronologically
  - Method `cleanupIdleSessions(idleTimeMs)`: remove inactive sessions
  - File: `goc-router-agent/src/session/session.service.ts`

- [ ] T021 Create session module and wire into app per Step 8
  - Create `src/session/session.module.ts`
  - Import and export `SessionService`
  - Wire into `AppModule`
  - File: `goc-router-agent/src/session/session.module.ts`

- [ ] T022 Update gateway to use session history per Step 8
  - Before `RouterService.classify`, fetch history via `SessionService.getHistory(session_id)`
  - Pass `conversationHistory` to `classify()`
  - After classify + response, call `SessionService.addMessage` for user and assistant
  - File: `goc-router-agent/src/gateway/chat.gateway.ts`

- [ ] T023 Write session service tests per Step 8
  - Create `src/session/session.service.spec.ts`
  - Test new session creation, message append, history retrieval, idle cleanup
  - File: `goc-router-agent/src/session/session.service.spec.ts`

**Verify Step 8**:
- Connect and send two messages; second message includes prior context in classification
- Idle session cleanup removes sessions inactive > 30 min
- `npm test` passes

### Step 9: API Key Authentication & Rate Limiting

- [ ] T024 Create API key strategy per Step 9
  - Create `src/auth/api-key.strategy.ts` (NestJS Passport strategy)
  - Extract API key from HTTP `Authorization: Bearer <key>` header or WebSocket `auth.token`
  - Validate against env `VALID_API_KEYS` (comma-separated)
  - Throw `UnauthorizedException` if invalid
  - File: `goc-router-agent/src/auth/api-key.strategy.ts`

- [ ] T025 Create API key guard per Step 9
  - Create `src/auth/api-key.guard.ts` (NestJS `CanActivate` guard)
  - Protects HTTP endpoints (`POST /route`, `GET /health`)
  - Returns 401 if key invalid
  - File: `goc-router-agent/src/auth/api-key.guard.ts`

- [ ] T026 Create rate limit service per Step 9
  - Create `src/rate-limit/rate-limit.service.ts`
  - In-memory sliding-window rate limiter per `session_id`
  - Method `isAllowed(session_id, limit = 10, windowMs = 60000)`: true if requests < limit
  - Method `recordRequest(session_id)`: append timestamp
  - Prune old timestamps
  - File: `goc-router-agent/src/rate-limit/rate-limit.service.ts`

- [ ] T027 Update gateway to validate auth and enforce rate limits per Step 9
  - `@OnGatewayConnection`: validate API key from `socket.handshake.auth.token`, reject if missing/invalid
  - `@SubscribeMessage('message')`: check rate limit, emit `error` if exceeded
  - File: `goc-router-agent/src/gateway/chat.gateway.ts`

- [ ] T028 Protect HTTP controllers with API key guard per Step 9
  - Add `@UseGuards(ApiKeyGuard)` to `RouterController` and `HealthController`
  - File: `goc-router-agent/src/router/router.controller.ts`, `src/health/health.controller.ts`

- [ ] T029 Write auth and rate limit tests per Step 9
  - Create `src/auth/api-key.guard.spec.ts` and `src/rate-limit/rate-limit.service.spec.ts`
  - Test valid/invalid keys, rate limit enforcement, 429 response
  - File: `goc-router-agent/src/auth/api-key.guard.spec.ts`

**Verify Step 9**:
- `POST /route` without API key → 401
- `POST /route` with invalid key → 401
- `POST /route` with valid key → 200
- WebSocket without key → disconnect
- WebSocket with valid key → connect
- Send 11 messages in 1 second (limit 10/60s) → 11th triggers `error` with `retryAfter`
- `npm test` passes

### Step 10: Health Check with Downstream Service Probes

- [ ] T030 Create health check service per Step 10
  - Create `src/health/health.service.ts` (`@Injectable()`)
  - Probe downstream services: Lore Keeper (`HEAD /health`), Retriever, Reranker, Postgres
  - Method `checkHealth()`: parallel probe all services
  - Return `{ status, services: { lore_keeper, retriever, reranker, postgres } }`
  - Status rule: `"ok"` if all respond, `"degraded"` if optional service down, `"error"` if critical service down
  - HTTP 200 if `"ok"` or `"degraded"`, HTTP 503 if `"error"`
  - File: `goc-router-agent/src/health/health.service.ts`

- [ ] T031 Add circuit breaker with retries per Step 10
  - Use Opossum circuit breaker for each downstream call
  - 5s timeout, 3 retries per call
  - File: `goc-router-agent/src/health/health.service.ts`

- [ ] T032 Update health controller to call health service per Step 10
  - Update `src/health/health.controller.ts` to use `HealthService`
  - Return aggregated health status
  - File: `goc-router-agent/src/health/health.controller.ts`

- [ ] T033 Write health service tests per Step 10
  - Create `src/health/health.service.spec.ts`
  - Mock downstream services
  - Test all healthy → status "ok" with 200
  - Test optional service down → status "degraded" with 200
  - Test critical service down → status "error" with 503
  - File: `goc-router-agent/src/health/health.service.spec.ts`

**Verify Step 10**:
- All services running: `GET /health` → 200 with status "ok"
- Kill optional service: `GET /health` → 200 with status "degraded"
- Kill Postgres: `GET /health` → 503 with status "error"
- Timeout after 5s marked gracefully down
- `npm test` passes

### Step 11: Structured Logging (JSON + Session Context)

- [ ] T034 Create custom logger service per Step 11
  - Create `src/logging/logger.service.ts`
  - Extend NestJS `ConsoleLogger`
  - Override `log`, `error`, `warn` to output JSON
  - Format: `{ "timestamp": "...", "level": "...", "message": "...", "context": "...", "session_id": "...", ...metadata }`
  - Single line per log, parseable by `jq`
  - File: `goc-router-agent/src/logging/logger.service.ts`

- [ ] T035 Integrate logger into services per Step 11
  - Inject `LoggerService` into `RouterService`, `ChatGateway`, `SessionService`, `RateLimitService`
  - Log key events: routing decision, message received, rate limit exceeded, agent dispatch, error
  - Include `session_id`, `route`, `confidence`, `latency_ms`, `tokens_used` as metadata
  - File: `goc-router-agent/src/router/router.service.ts`, `src/gateway/chat.gateway.ts`, etc.

- [ ] T036 Write logger test per Step 11
  - Create `src/logging/logger.service.spec.ts`
  - Verify JSON output format with session_id and metadata
  - File: `goc-router-agent/src/logging/logger.service.spec.ts`

**Verify Step 11**:
- Send message via WebSocket, check stdout for JSON logs
- Each log contains `session_id`, `timestamp`, metadata
- Logs parseable by `jq`
- `npm test` passes

---

## Phase 4: Deployment & Polish

### Step 12: Dockerfile, Docker Compose, .env

- [ ] T037 Create Dockerfile per Step 12
  - Multi-stage: `build` stage with `npm run build`, `production` stage on `node:24-alpine`
  - `EXPOSE 3004`, `CMD ["node", "dist/main"]`
  - File: `goc-router-agent/Dockerfile`

- [ ] T038 Create .dockerignore per Step 12
  - Exclude `node_modules`, `dist`, `.env`, `.git`, `specs`, `.idea`
  - File: `goc-router-agent/.dockerignore`

- [ ] T039 Create .env.example per Step 12
  - `PORT=3004`
  - `OPENAI_API_KEY=sk-...`
  - `VALID_API_KEYS=dev-key-123,dev-key-456`
  - `RATE_LIMIT_REQUESTS=10`
  - `RATE_LIMIT_WINDOW_MS=60000`
  - `SESSION_IDLE_TIMEOUT_MS=1800000`
  - `SESSION_HISTORY_WINDOW=10`
  - File: `goc-router-agent/.env.example`

- [ ] T040 Create app configuration module per Step 12
  - Create `src/config/app.config.ts`
  - Export config object with all env vars and sensible defaults
  - File: `goc-router-agent/src/config/app.config.ts`

- [ ] T041 Update docker-compose.yml with router service per Step 12
  - Add `goc-router-agent` service to `../goc-dev-env/docker-compose.yml`
  - `build: ../goc-router-agent`, `container_name: gamerchat-router-agent`
  - `ports: ["3004:3004"]`
  - Environment variables: all from .env.example
  - Healthcheck: `["CMD", "wget", "-qO-", "http://localhost:3004/health"]`
  - `depends_on` with health check conditions for downstream services
  - File: `goc-dev-env/docker-compose.yml`

**Verify Step 12**:
- `docker compose config` parses with no errors
- `docker compose build goc-router-agent` completes
- `docker compose up -d goc-router-agent` brings to healthy state
- `wget -qO- http://localhost:3004/health` from host returns 200
- WebSocket connection requires valid API key
- `npm test` passes (no regressions)

---

## Phase 5: Final Verification & Integration

- [ ] T042 Run full test suite and verify 100% pass
  - Execute `npm test` from `goc-router-agent/` directory
  - All unit, integration, and accuracy tests pass
  - Coverage report generated (if configured)
  - File: `goc-router-agent/`

- [ ] T043 Verify requirements compliance
  - Confirm all structural checks from requirements.md are met
  - Verify no hardcoded secrets or API keys
  - Verify `.env` in `.gitignore`
  - File: `goc-router-agent/.gitignore`

- [ ] T044 Run manual smoke test (requires OPENAI_API_KEY)
  - Execute LORE, HARDWARE, RECOMMENDATION, GENERAL_CHAT classification tests
  - Verify correct routing and confidence values
  - File: `goc-router-agent/`

- [ ] T045 Run fallback smoke test
  - Verify `{ route: "GENERAL_CHAT", confidence: 0 }` fallback with invalid key
  - File: `goc-router-agent/`

- [ ] T046 Verify accuracy gate
  - Confirm >= 90% accuracy on labeled routing test suite (>= 27 / 30 correct)
  - If misclassifications exist, document defensible reclassifications
  - File: `goc-router-agent/src/router/routing-accuracy.spec.ts`

---

## Dependencies & Execution Order

**Critical Path** (must complete in order):
1. T001–T002 (Phase 1 Setup)
2. T003–T006 (DTOs & Constants)
3. T007–T009 (RouterService)
4. T010–T012 (RouterController)
5. T013–T014 (Integration & Accuracy)

**Parallel Tracks** (can run after Step 1):
- Track A: T015–T019 (WebSocket Gateway)
- Track B: T020–T023 (Session Memory)
- Track C: T024–T029 (Auth & Rate Limiting)
- Track D: T030–T033 (Health Checks)
- Track E: T034–T036 (Logging)

**Merge Point**: After Phase 3 complete, T037–T045 (Deployment & Verification) must run sequentially.

---

## Parallel Execution Example

After T001–T002 are complete, the following teams/agents can work in parallel:

```
Agent A (Routing):     T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012
Agent B (WebSocket):   T015 → T016 → T017 → T018 → T019
Agent C (Session):     T020 → T021 → T022 → T023
Agent D (Auth/Rate):   T024 → T025 → T026 → T027 → T028 → T029
Agent E (Health):      T030 → T031 → T032 → T033
Agent F (Logging):     T034 → T035 → T036

After all agents complete T013–T014 and Phase 3 is green:
Agent A (Deployment):  T037 → T038 → T039 → T040 → T041 → T042 → T043 → T044 → T045 → T046
```

---

## Summary

**Total Tasks**: 46

**Task Breakdown by Phase**:
- Phase 1 (Setup): 2 tasks
- Phase 2 (Core Routing): 12 tasks
- Phase 3 (Advanced Features): 19 tasks
- Phase 4 (Deployment): 5 tasks
- Phase 5 (Verification): 5 tasks

**Implementation Strategy**:
- **MVP Scope**: Complete Phase 1 + Phase 2 (T001–T014) for a working `POST /route` endpoint with >= 90% accuracy
- **Milestone 2 Complete**: Add Phase 3 (WebSocket, Session Memory, Auth, Health, Logging)
- **Production Ready**: Add Phase 4 + Phase 5 (Docker, Verification)

**Test Coverage**: >= 40 `expect(...)` calls across unit, integration, and accuracy tests. All 12 execution steps from plan.md have explicit test tasks.

**Success Criteria** (Definition of Done):
- ✅ `npm test` exits 0 with all tests passing
- ✅ `POST /route` classifies with >= 90% accuracy (>= 27 / 30 correct)
- ✅ `WS /ws?session_id=<id>` WebSocket gateway operational with session history
- ✅ API key authentication and per-session rate limiting enforced
- ✅ Health checks probe downstream services
- ✅ Structured JSON logs with session context
- ✅ Docker Compose integration complete
- ✅ All structural checks from requirements.md pass
- ✅ Ready for CLI client integration