# EdgeWord NLP — UI Implementation Plan

**Spec:** `docs/UI_SPEC.md`  
**Design system:** `Design.md` (Strand)  
**Date:** 2026-05-01

---

## Phase 0: Project Scaffold (Day 1)

### 0.1 Initialize Next.js project
- `pnpm create next-app@latest frontend --typescript --tailwind --app --src-dir`
- Inside `edgeword_nlp/frontend/`
- Configure `tailwind.config.ts` with all Strand design tokens (colors, fonts, spacing)
- Install Inter + JetBrains Mono via `next/font`
- Set up base CSS with `bg` page background, default text `ink`

### 0.2 API client layer
- Create `src/lib/api.ts` — typed fetch wrapper for all EdgeWord endpoints
- API key stored in `localStorage`, configurable in settings
- Base URL configurable (default `http://localhost:8000`)
- Type definitions for all request/response models

### 0.3 Global layout
- `src/app/layout.tsx` — page shell, font loading, Tailwind globals
- `src/app/page.tsx` — single page app (conversation view)
- No routing needed — it's a single-page conversation interface

**Deliverable:** Empty page with Strand styling, fonts loaded, API client ready.

---

## Phase 1: Conversation Thread (Day 2-3)

### 1.1 Message components
- `src/components/UserMessage.tsx` — user message bubble with copy/re-run actions
- `src/components/AIResponse.tsx` — AI response with sentiment pill, RAG chips, tool results, metadata, actions
- `src/components/ThinkingIndicator.tsx` — animated dots + streaming text + live token counter
- `src/components/SentimentPill.tsx` — inline state badge (POSITIVE green / NEGATIVE red)
- `src/components/RAGChip.tsx` — source filename chip
- `src/components/ToolResult.tsx` — tool output with violet left border
- `src/components/MessageActions.tsx` — hover action bar (copy, re-run, speak)

### 1.2 Conversation state
- `src/hooks/useConversation.ts` — React hook managing message array
- Message type: `{ id, role, text, sentiment, ragSources, toolResult, tokens, tps, ttft, cached, timestamp }`
- Append-only array (single thread, stacking upward)
- Auto-scroll to bottom on new message

### 1.3 Streaming
- `src/lib/stream.ts` — SSE/fetch streaming handler
- Parse partial JSON from `/v1/chat` (or add SSE endpoint to API)
- Update thinking indicator in real-time as tokens arrive
- Transition from thinking to final response on completion

**Deliverable:** Working conversation thread with static test messages, proper Strand styling.

---

## Phase 2: Prompt Bar (Day 3-4)

### 2.1 Core input
- `src/components/PromptBar.tsx` — main component
- Auto-growing textarea (1-6 lines)
- `Cmd+Enter` / `Ctrl+Enter` to send
- Placeholder: "Type a message..."
- Focus ring: violet-400

### 2.2 Action icons (left side)
- `src/components/prompt/MicButton.tsx` — microphone toggle with recording state
- `src/components/prompt/UploadButton.tsx` — file picker (txt, md, py, json, csv)
- `src/components/prompt/ImageButton.tsx` — image picker with thumbnail preview
- All icons: 16px inline SVG, stroke 1.5, `text-ink-3 hover:text-violet-500`

### 2.3 Send / Stop button (right side)
- `src/components/prompt/SendButton.tsx`
- Arrow-up icon in violet circle when input non-empty
- Disabled state when empty
- Transforms to red stop button during generation

### 2.4 Status bar
- `src/components/PromptStatusBar.tsx` — model name, TPS, turns, cache count
- Updates from `/v1/health` polling (every 30s)

### 2.5 Attachment previews
- `src/components/prompt/AttachmentPreview.tsx` — inline chips above textarea
- Image: thumbnail 64x64 with remove button
- File: icon + filename + size with remove button

**Deliverable:** Fully functional prompt bar with all icons, auto-grow, keyboard shortcuts.

---

## Phase 3: Voice & Media (Day 5)

### 3.1 Voice recording
- `src/hooks/useVoiceRecording.ts` — Web Audio API MediaRecorder
- Records to WAV format
- Visual feedback: red pulse on mic icon, waveform visualization optional
- Auto-stop after 30s silence
- On stop: send to `/v1/transcribe`, insert result into prompt bar

### 3.2 Audio playback (TTS)
- `src/components/AudioPlayer.tsx` — inline player for TTS responses
- Play/pause button, progress bar (spec bar pattern), time display
- Triggered by "speak" action on AI responses
- Fetches WAV from `/v1/speak`, plays via Web Audio API

### 3.3 Image handling
- On image upload: show thumbnail in attachment preview
- On send: call `/v1/ocr` to extract text, then `/v1/chat` with extracted text
- Or call `/v1/ocr/chat` directly
- Show OCR result in AI response

**Deliverable:** Full voice input/output loop, image OCR integration.

---

## Phase 4: Settings Panel (Day 6)

### 4.1 Panel component
- `src/components/SettingsPanel.tsx` — slide-in from right
- Backdrop with blur
- Sections: Model, Features, API Keys, Session, System

### 4.2 Model configuration
- Model name display (from `/v1/health`)
- Thread count, max tokens, temperature — stored in localStorage, sent with each request

### 4.3 Feature toggles
- RAG on/off (maps to `use_rag` in API)
- Cache on/off (maps to `use_cache`)
- Tools on/off (maps to `use_tools`)
- Show chunk count, cache size from health endpoint

### 4.4 API key management
- List keys (call API or local state)
- Create new key (inline form)
- Revoke key (destructive action with confirmation modal)
- Show usage per key

### 4.5 Session management
- Turn count display
- "Clear conversation" button — clears local state + calls `DELETE /v1/sessions/{id}`
- "Clear cache" button — future admin endpoint or note to use CLI

### 4.6 System info
- CPU, RAM, uptime from `/v1/health`

**Deliverable:** Complete settings panel with all configuration options.

---

## Phase 5: Empty State & Polish (Day 7)

### 5.1 Empty state
- `src/components/EmptyState.tsx`
- Brand mark, title, description
- Three suggestion chips that pre-fill the prompt
- Disappears after first message

### 5.2 Animations & transitions
- Message entrance: `animate-in slide-in-from-bottom-2 duration-200`
- Settings panel: `transition-transform duration-300`
- Thinking dots: staggered pulse
- Streaming cursor: `animate-pulse border-r-2 border-violet-500`

### 5.3 Error handling
- Network error: toast notification at top
- Rate limit: amber warning with retry countdown
- Model unavailable: red banner with explanation

### 5.4 Keyboard shortcuts
- `Cmd+Enter` — send message
- `Cmd+K` — focus prompt bar
- `Cmd+,` — open settings
- `Cmd+Shift+Backspace` — clear conversation
- `Escape` — close settings / stop generation

### 5.5 Responsive
- Mobile prompt bar: icons collapse into `[+]` overflow menu
- Mobile settings: full-screen modal instead of side panel
- Touch targets: minimum 44px on mobile

**Deliverable:** Polished, production-ready UI.

---

## Phase 6: API Enhancements (Day 7-8)

### 6.1 Streaming endpoint
- Add `POST /v1/chat/stream` to `api.py`
- Returns Server-Sent Events (SSE)
- Events: `thinking`, `token`, `sentiment`, `tool`, `rag`, `done`
- Enables real-time token streaming in the UI

### 6.2 Admin endpoints (for settings panel)
- `GET /v1/config` — returns current model, features, stats
- `POST /v1/keys` — create API key via API (not just CLI)
- `GET /v1/keys` — list keys
- `DELETE /v1/keys/{id}` — revoke key

**Deliverable:** Full API support for all UI features.

---

## File Structure

```
frontend/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Shell, fonts, globals
│   │   ├── page.tsx            # Single page — conversation view
│   │   └── globals.css         # Strand base styles
│   ├── components/
│   │   ├── TopBar.tsx
│   │   ├── ConversationThread.tsx
│   │   ├── UserMessage.tsx
│   │   ├── AIResponse.tsx
│   │   ├── ThinkingIndicator.tsx
│   │   ├── SentimentPill.tsx
│   │   ├── RAGChip.tsx
│   │   ├── ToolResult.tsx
│   │   ├── MessageActions.tsx
│   │   ├── PromptBar.tsx
│   │   ├── PromptStatusBar.tsx
│   │   ├── AudioPlayer.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── EmptyState.tsx
│   │   └── prompt/
│   │       ├── MicButton.tsx
│   │       ├── UploadButton.tsx
│   │       ├── ImageButton.tsx
│   │       ├── SendButton.tsx
│   │       └── AttachmentPreview.tsx
│   ├── hooks/
│   │   ├── useConversation.ts
│   │   ├── useVoiceRecording.ts
│   │   ├── useHealth.ts
│   │   └── useSettings.ts
│   ├── lib/
│   │   ├── api.ts              # Typed API client
│   │   ├── stream.ts           # SSE streaming handler
│   │   ├── types.ts            # Shared type definitions
│   │   └── icons.tsx           # All inline SVG icons
│   └── styles/
│       └── strand-tokens.ts    # Design system token constants
├── tailwind.config.ts          # Strand design tokens
├── tsconfig.json
├── package.json
└── next.config.ts
```

---

## Dependencies

```json
{
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "typescript": "^5",
    "tailwindcss": "^4",
    "@tailwindcss/postcss": "^4",
    "postcss": "^8"
  }
}
```

No component libraries. No icon libraries. No state management libraries. Just React + Next.js + Tailwind + Strand.

---

## Timeline Summary

| Phase | Scope | Days |
|---|---|---|
| 0 | Scaffold, tokens, API client | 1 |
| 1 | Conversation thread + messages | 2 |
| 2 | Prompt bar + icons + keyboard | 1.5 |
| 3 | Voice recording + TTS + image | 1 |
| 4 | Settings panel | 1 |
| 5 | Empty state, polish, responsive | 1 |
| 6 | API streaming + admin endpoints | 1 |
| **Total** | | **~8 days** |
