# Validation: Router Agent

## Definition of Done

The implementation is complete and mergeable when all of the following pass.

---

## Automated checks

```bash
cd goc-router-agent
npm install
npm test   # must exit 0, all tests green
```

Expected test files and what they verify:

| File | Minimum passing assertions |
|---|---|
| `tests/routing-result.test.js` | `ROUTES` exports all four constants; `isValidRoute` accepts valid, rejects invalid; `makeRoutingResult` clamps confidence; `makeFallbackResult` returns `GENERAL_CHAT` at `0` |
| `tests/router-client.test.js` | Valid JSON → correct `{ route, confidence }`; invalid route string → fallback; malformed JSON → fallback; thrown error → fallback; 429 error → fallback |
| `tests/create-router-agent.test.js` | Factory returns object with `.route` method; missing `openAiKey` throws; `.route` delegates to `RouterClient`; `conversationHistory` forwarded |
| `tests/routing-accuracy.test.js` | >= 30 labeled examples; >= 5 per route category; accuracy assertion >= 90% passes |

Total test count: >= 30 labeled routing tests plus unit assertions (expect >= 40 `expect(...)` calls total across all files).

---

## Structural checks

- [ ] `src/index.js` exports `createRouterAgent`
- [ ] `src/schema/routing-result.js` exports `ROUTES`, `isValidRoute`, `makeRoutingResult`, `makeFallbackResult`
- [ ] `src/router/router-client.js` exports `RouterClient` class with `classify` method
- [ ] `src/router/prompts.js` exports `ROUTER_SYSTEM_PROMPT` string constant
- [ ] `.env.example` committed with `OPENAI_API_KEY=` placeholder
- [ ] `.env` listed in `.gitignore` (no real secrets committed)
- [ ] No hardcoded API keys or URLs in any source file
- [ ] `package.json` has `"type": "commonjs"` and `"engines": { "node": ">=18" }`

---

## Manual smoke test

Requires a valid `OPENAI_API_KEY`.

```bash
cd goc-router-agent
cp .env.example .env
# fill in OPENAI_API_KEY

node -e "
  require('dotenv').config();
  const { createRouterAgent } = require('./src/index.js');
  const agent = createRouterAgent({ openAiKey: process.env.OPENAI_API_KEY });

  agent.route({ userMessage: 'Why did Malenia fight Radahn?' })
    .then(r => { console.log('LORE test:', r); console.assert(r.route === 'LORE', 'Expected LORE'); })

  agent.route({ userMessage: 'Can my RTX 3080 run Cyberpunk 2077?' })
    .then(r => { console.log('HARDWARE test:', r); console.assert(r.route === 'HARDWARE', 'Expected HARDWARE'); })

  agent.route({ userMessage: 'Recommend something like Dark Souls' })
    .then(r => { console.log('RECOMMENDATION test:', r); console.assert(r.route === 'RECOMMENDATION', 'Expected RECOMMENDATION'); })

  agent.route({ userMessage: 'Hello!' })
    .then(r => { console.log('GENERAL_CHAT test:', r); console.assert(r.route === 'GENERAL_CHAT', 'Expected GENERAL_CHAT'); })
"
```

Expected output: four lines, each showing the correct route and a confidence value.

---

## Fallback smoke test

Verifies the error fallback without a real API key:

```bash
cd goc-router-agent
node -e "
  const { createRouterAgent } = require('./src/index.js');
  const agent = createRouterAgent({ openAiKey: 'sk-invalid-key-for-fallback-test' });
  agent.route({ userMessage: 'test' })
    .then(r => {
      console.log('Fallback result:', r);
      console.assert(r.route === 'GENERAL_CHAT', 'Expected GENERAL_CHAT fallback');
      console.assert(r.confidence === 0, 'Expected confidence 0');
      console.log('Fallback test passed.');
    });
"
```

Expected: prints `Fallback result: { route: 'GENERAL_CHAT', confidence: 0 }` and `Fallback test passed.` — does not throw or hang.

---

## Accuracy gate

The labeled test suite in `tests/routing-accuracy.test.js` must pass its internal accuracy assertion. If it fails, the failure message will list which inputs were misclassified. Acceptable failure modes before the gate passes:

- Fewer than 3 misclassifications out of 30 (90% accuracy = 27 / 30 correct).
- A misclassification on a genuinely ambiguous input (e.g., "I want to know about Elden Ring" is debatable between LORE and RECOMMENDATION) may be reclassified in the dataset to match the model's output if the deviation is defensible. Update the dataset entry with a comment explaining the reclassification — do not simply remove the test case.

---

## Pre-merge checklist

- [ ] `npm test` exits 0 on a clean checkout with no `OPENAI_API_KEY` set (all LLM calls mocked)
- [ ] Manual smoke test passes with a real `OPENAI_API_KEY`
- [ ] Fallback smoke test passes without a valid key
- [ ] No test makes a real HTTP call (verified by running `npm test` with network disabled or with `OPENAI_API_KEY` unset)
- [ ] `npm install` produces no `WARN` about deprecated peer deps critical to the project
- [ ] All structural checks above are ticked
