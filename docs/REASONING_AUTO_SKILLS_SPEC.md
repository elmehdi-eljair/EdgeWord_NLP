# EdgeWord — Reasoning, Auto-Mode, Skills: Technical Specification

**Date:** 2026-05-01  
**Status:** Proposal for review

---

## Current State

- **LLM:** Llama 3.2 1B via llama-cpp-python, single-shot completion
- **LangChain:** Installed (1.2.17) but only `HumanMessage`/`AIMessage` used as containers
- **RAG:** FAISS + ONNX embeddings, 3-chunk retrieval
- **Tools:** 4 deterministic regex tools (calc, datetime, sysinfo, file reader)
- **Streaming:** Server-side streaming exists (llama.cpp) but frontend waits for full response
- **Persistence:** SQLite messages table — no reasoning chain field yet

---

## 1. REASONING MODE

### Concept

When enabled, instead of a single LLM call, the system runs a **multi-stage reasoning chain** where the model:
1. **Analyses** the question — breaks it down, identifies what's needed
2. **Retrieves** — enhanced RAG with relevance scoring and re-ranking
3. **Reasons** — step-by-step thinking, self-critique, revision
4. **Synthesises** — produces the final answer grounded in the chain

Each stage streams its chain-of-thought to the frontend in real-time.

### Architecture

```
User Message
    │
    ▼
┌─────────────────────────────────────────┐
│ Stage 1: ANALYSE                         │
│ System: "Break down this question.       │
│ Identify what you need to answer it."    │
│ → Streams analysis to frontend           │
├─────────────────────────────────────────┤
│ Stage 2: RETRIEVE & REFLECT              │
│ Uses Stage 1 output to formulate         │
│ better RAG queries (query rewriting)     │
│ Retrieves chunks, scores relevance       │
│ → Streams retrieval reasoning            │
├─────────────────────────────────────────┤
│ Stage 3: REASON                          │
│ System: "Think step by step. Consider    │
│ the evidence. Challenge your reasoning." │
│ Uses analysis + retrieved context        │
│ → Streams chain-of-thought              │
├─────────────────────────────────────────┤
│ Stage 4: SYNTHESISE                      │
│ System: "Now write your final answer.    │
│ Be precise and well-structured."         │
│ Uses all previous stages                 │
│ → Streams final response                │
└─────────────────────────────────────────┘
```

### Implementation

**Backend — `reasoning.py` (new module)**

```python
class ReasoningEngine:
    """Multi-stage reasoning with chain-of-thought streaming."""
    
    def __init__(self, llm, rag_engine, tools):
        self.llm = llm
        self.rag = rag_engine
        self.tools = tools
        self.stages = [
            {"name": "analyse", "system": "Break down the user's question..."},
            {"name": "retrieve", "system": "Based on the analysis..."},
            {"name": "reason", "system": "Think step by step..."},
            {"name": "synthesise", "system": "Write your final answer..."},
        ]
    
    async def run(self, message, history, on_stage, on_token):
        """Run reasoning chain, calling on_stage and on_token callbacks."""
        context = {}
        for stage in self.stages:
            on_stage(stage["name"])
            # Build prompt with previous stage outputs
            prompt = self._build_stage_prompt(stage, message, history, context)
            stage_output = ""
            for token in self.llm.create_completion(prompt, stream=True, ...):
                text = token["choices"][0]["text"]
                stage_output += text
                on_token(stage["name"], text)
            context[stage["name"]] = stage_output
        return context
```

**Backend — New SSE endpoint `/v1/chat/stream`**

```python
@app.post("/v1/chat/stream")
async def chat_stream(req: ChatRequest):
    """Server-Sent Events endpoint for reasoning mode."""
    async def generate():
        # Yield stage transitions and tokens as SSE events
        yield f"data: {json.dumps({'type': 'stage', 'name': 'analyse'})}\n\n"
        for token in reasoning_chain:
            yield f"data: {json.dumps({'type': 'token', 'stage': 'analyse', 'text': token})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'reasoning': full_chain})}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")
```

**Frontend — Streaming display**

```
┌──────────────────────────────────────────────┐
│ EdgeWord · Reasoning                          │
│                                               │
│ ┌─ ANALYSE ─────────────────────────────────┐ │
│ │ The user is asking about X. I need to     │ │
│ │ consider Y and Z...                        │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│ ┌─ RETRIEVE ────────────────────────────────┐ │
│ │ Found 3 relevant documents. The most      │ │
│ │ relevant is about_edgeword.txt (0.72)     │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│ ┌─ REASON ──────────────────────────────────┐ │
│ │ Step 1: Based on the documents...         │ │
│ │ Step 2: However, I should also consider...│ │
│ │ Step 3: Therefore...                       │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│ ┌─ FINAL ANSWER ────────────────────────────┐ │
│ │ EdgeWord NLP was created by El Mehdi...   │ │
│ └───────────────────────────────────────────┘ │
│                                               │
│ ▸ View full reasoning chain (4 stages, 342 tok)│
└──────────────────────────────────────────────┘
```

Each stage is a collapsible section. Stages stream tokens in real-time.
The reasoning chain is stored in `messages.reasoning_json`.

**Toggle:** A chip button in the composer: `[Reasoning: ON/OFF]`

### Data Model

Add to `messages` table:
```sql
ALTER TABLE messages ADD COLUMN reasoning_json TEXT;
-- Stores: {"analyse": "...", "retrieve": "...", "reason": "...", "synthesise": "..."}
```

### Estimated Latency Impact

With a 1B model:
- Stage 1 (analyse): ~2s
- Stage 2 (retrieve): ~1s (RAG) + ~2s (reflect)
- Stage 3 (reason): ~3s
- Stage 4 (synthesise): ~2s
- **Total: ~10s** (vs ~2s for single-shot)

With streaming, the user sees progress immediately so it feels faster.

---

## 2. AUTO-MODE

### Concept

Instead of the user manually tuning temperature, top_p, top_k, max_tokens etc., the system **automatically selects optimal parameters** for each message based on what the user is asking.

### Architecture

```
User Message
    │
    ▼
┌─────────────────────────────────────────┐
│ Parameter Classifier (1 LLM call)        │
│                                          │
│ System: "Classify this user message      │
│ into one of these categories and         │
│ return the optimal parameters as JSON:   │
│                                          │
│ - factual_question → T:0.2, P:0.8       │
│ - creative_writing → T:1.0, P:0.95      │
│ - code_generation → T:0.15, P:0.8       │
│ - analysis → T:0.3, P:0.85              │
│ - casual_chat → T:0.7, P:0.9            │
│ - summarisation → T:0.3, P:0.85         │
│ "                                        │
│ → Returns JSON with params               │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ Main LLM Call (with auto-selected params)│
│ Uses the classified params               │
│ → Normal response                        │
└─────────────────────────────────────────┘
```

### Implementation

**Backend — `auto_mode.py` (new module)**

```python
PARAM_PROFILES = {
    "factual": {"temperature": 0.2, "top_p": 0.8, "top_k": 20, "max_tokens": 256},
    "creative": {"temperature": 1.0, "top_p": 0.95, "top_k": 80, "max_tokens": 1024},
    "code": {"temperature": 0.15, "top_p": 0.8, "top_k": 20, "max_tokens": 512},
    "analysis": {"temperature": 0.3, "top_p": 0.85, "top_k": 30, "max_tokens": 512},
    "chat": {"temperature": 0.7, "top_p": 0.9, "top_k": 40, "max_tokens": 256},
    "summary": {"temperature": 0.3, "top_p": 0.85, "top_k": 30, "max_tokens": 512},
}

class AutoMode:
    def classify(self, message: str, llm) -> dict:
        """Use LLM to classify message intent and return optimal params."""
        prompt = f"""Classify this message into exactly one category:
factual, creative, code, analysis, chat, summary

Message: {message}

Reply with ONLY the category name, nothing else."""
        
        result = llm.create_completion(prompt, max_tokens=10, temperature=0.0)
        category = result["choices"][0]["text"].strip().lower()
        return PARAM_PROFILES.get(category, PARAM_PROFILES["chat"])
```

**API — Add `auto_mode` flag to ChatRequest:**

```python
class ChatRequest(BaseModel):
    ...
    auto_mode: bool = Field(False, description="Auto-select optimal params")
```

When `auto_mode=True`, the endpoint calls `auto_mode.classify()` first, then uses those params for the main LLM call. The selected profile is returned in the response so the frontend can show which mode was chosen.

**Frontend — Toggle in composer**

A small toggle chip in the composer area or model tab:
```
[Auto-mode: ON] → shows which profile was selected per message
```

In each AI response, show a small tag: `auto: code` or `auto: creative`

### Latency Impact

- Classification call: ~0.5s (10 tokens max, temperature 0.0)
- Negligible compared to main response

---

## 3. SKILLS SYSTEM

### Concept

Skills are **domain-specific prompt templates + tool configurations** that augment the model's capabilities in specific areas. When the system detects a user message that matches a skill domain, it fetches the relevant skill and uses it to produce better results.

### Architecture

```
User Message
    │
    ▼
┌─────────────────────────────────────────┐
│ Skill Matcher                            │
│ Uses RAG embedding similarity to match   │
│ message against skill descriptions       │
│ Threshold: 0.5 cosine similarity         │
│ → Returns best matching skill (or none)  │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ Skill Application                        │
│ Injects skill's:                         │
│   - System prompt (domain expertise)     │
│   - Output format instructions           │
│   - Domain-specific tools/validators     │
│   - Few-shot examples                    │
│ → Enhanced prompt to LLM                 │
└─────────────────────────────────────────┘
```

### Skill Data Model

```python
class Skill:
    id: str                    # "python-debug"
    name: str                  # "Python Debugger"
    category: str              # "Coding"
    description: str           # "Helps debug Python code..."
    system_prompt: str         # Domain-expert system prompt
    output_format: str         # "structured" | "prose" | "code"
    few_shot_examples: list    # Example input/output pairs
    tools: list[str]           # Additional tools to enable
    keywords: list[str]        # For fallback matching
    embedding: np.ndarray      # Pre-computed embedding of description
```

### Built-in Skills (initial set)

| Skill | Category | Description |
|---|---|---|
| Python Debugger | Coding | Debug Python errors, suggest fixes |
| Code Reviewer | Coding | Review code for quality, security, performance |
| SQL Writer | Coding | Generate SQL queries from natural language |
| API Designer | Coding | Design REST API endpoints |
| Data Analyser | Analysis | Analyse datasets, suggest visualisations |
| Math Solver | Analysis | Step-by-step math problem solving |
| Writing Coach | Creative | Improve writing style, grammar, clarity |
| Email Drafter | Business | Draft professional emails |
| Meeting Summariser | Business | Summarise meeting notes into action items |
| Explainer | Education | Explain complex topics simply |

### Implementation

**Backend — `skills.py` (new module)**

```python
class SkillEngine:
    def __init__(self, embedder: ONNXEmbedder):
        self.embedder = embedder
        self.skills = self._load_built_in_skills()
        self._build_index()
    
    def _build_index(self):
        """Embed all skill descriptions into FAISS for matching."""
        texts = [s.description for s in self.skills]
        self.embeddings = self.embedder.embed(texts)
        self.index = faiss.IndexFlatIP(self.embeddings.shape[1])
        self.index.add(self.embeddings)
    
    def match(self, message: str, threshold=0.5) -> Skill | None:
        """Find the best matching skill for a message."""
        query = self.embedder.embed([message])
        scores, indices = self.index.search(query, 1)
        if scores[0][0] > threshold:
            return self.skills[indices[0][0]]
        return None
    
    def apply(self, skill: Skill, message: str, base_prompt: str) -> str:
        """Inject skill context into the prompt."""
        enhanced = f"{skill.system_prompt}\n\n"
        if skill.few_shot_examples:
            enhanced += "Examples:\n"
            for ex in skill.few_shot_examples[:2]:
                enhanced += f"User: {ex['input']}\nAssistant: {ex['output']}\n\n"
        if skill.output_format == "structured":
            enhanced += "Provide your response in a clear, structured format with headings.\n"
        elif skill.output_format == "code":
            enhanced += "Provide code with comments. Use proper formatting.\n"
        return enhanced + base_prompt
```

**Frontend — Skill indicator**

When a skill is activated, show it in the AI response:
```
┌──────────────────────────────────────┐
│ EdgeWord · using Python Debugger     │  ← skill badge
│                                      │
│ I found 3 issues in your code:       │
│ 1. Line 15: ...                      │
└──────────────────────────────────────┘
```

### Storage

Skills stored in `skills.json` or a SQLite table. Users can create custom skills via the Settings > Skills tab (future).

---

## Implementation Plan

### Phase 1: Foundation (Required for all three)
1. Add SSE streaming endpoint `/v1/chat/stream`
2. Add `EventSource` consumer in frontend `api.ts`
3. Add `reasoning_json` column to messages table
4. Add `auto_mode` and `skill_used` fields to ChatResponse

### Phase 2: Auto-Mode (Simplest, build first)
1. Create `auto_mode.py` with parameter profiles
2. Add `auto_mode` toggle to ChatRequest + API
3. Add toggle UI in composer
4. Show selected profile in response metadata

### Phase 3: Skills
1. Create `skills.py` with skill engine + built-in skills
2. Integrate into chat flow (match → apply → generate)
3. Add skill badge in frontend responses
4. Add Skills management in Settings

### Phase 4: Reasoning
1. Create `reasoning.py` with multi-stage chain
2. Build SSE streaming endpoint
3. Build frontend streaming consumer + stage display
4. Add reasoning toggle in composer
5. Persist reasoning chains

### Estimated Timeline
- Phase 1: 1 day
- Phase 2: 0.5 day
- Phase 3: 1 day
- Phase 4: 2 days
- **Total: ~4.5 days**

---

## Open Questions

1. **Reasoning on 1B model:** The 1B model may struggle with multi-stage reasoning. Each stage needs to be carefully prompted. Should we require a larger model (3B+) for reasoning mode?

2. **Auto-mode accuracy:** The classification call uses the same 1B model. It may misclassify. Should we use a simpler heuristic (keyword-based) as fallback?

3. **Skill matching threshold:** 0.5 cosine similarity may be too aggressive. Should we default to 0.6 and let users lower it?

4. **Streaming UX:** How should the frontend handle the user scrolling while reasoning streams? Pin to bottom? Allow free scroll?
