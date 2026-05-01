# EdgeWord NLP — UI Specification

**Design system:** Strand (Design.md) — Dieter Rams clarity, Vignelli typographic order  
**Platform:** Web application (React + Next.js + Tailwind CSS)  
**Backend:** EdgeWord API (`localhost:8000`)  
**Date:** 2026-05-01

---

## 1. Design Philosophy

EdgeWord's UI is a single-purpose conversation interface. It is not a dashboard, not a multi-tab app. It is one continuous thread of thought between the user and the machine — stacking upward, accumulating context, never branching.

The prompt bar is the centrepiece. It should feel like an instrument — precise, responsive, beautiful. Every icon earns its place. The conversation thread is typography-first: the words are the interface.

### Strand Alignment
- **One accent:** Violet-500 (`#7B3FEE`) for all interactive elements. No other colors except state (green/amber/red).
- **Type does the work:** Message hierarchy through size and weight. User messages are `ink` weight 600. AI responses are `ink-2` weight 400. Metadata is `ink-4` at 11px.
- **No emoji, ever.** All icons are inline SVG, stroke 1.5px.
- **Compact by default.** Dense conversation, not chat-app bubbles with excessive padding.

---

## 2. Layout Structure

```
┌──────────────────────────────────────────────────────────┐
│  TOP BAR  h-12  sticky                                   │
│  [brand mark]  EdgeWord     [health pill]    [gear icon] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│                 CONVERSATION THREAD                       │
│                 max-w-[680px] mx-auto                     │
│                 flex-1 overflow-y-auto                    │
│                                                          │
│  ┌─ User message ─────────────────────────────────────┐  │
│  │ "Who created EdgeWord NLP?"                        │  │
│  │                            [copy] [re-run]  12:03  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ AI response ──────────────────────────────────────┐  │
│  │ [sentiment pill: NEGATIVE 99%]                     │  │
│  │                                                    │  │
│  │ EdgeWord NLP was created by El Mehdi El Jair...    │  │
│  │                                                    │  │
│  │ [rag: about_edgeword.txt]  [15 tok · 14.9 t/s]    │  │
│  │                      [copy] [re-run] [speak] 12:03 │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ Thinking indicator ───────────────────────────────┐  │
│  │ ● ● ●  Generating... 8 tokens · 14.2 t/s          │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  PROMPT BAR  sticky bottom-0                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │ [mic] [upload] [image]  │  Type a message...  [send]│  │
│  └────────────────────────────────────────────────────┘  │
│  Llama-3.2-1B · 14.9 t/s · 3 turns · cache: 5          │
└──────────────────────────────────────────────────────────┘
```

### Dimensions
- **Page background:** `bg` (`#FBFAFE`)
- **Conversation column:** `max-w-[680px] mx-auto` — Vignelli single-column focus
- **Top bar:** `h-12 border-b border-line bg-white sticky top-0 z-10`
- **Prompt bar container:** `sticky bottom-0 bg-white border-t border-line px-6 py-4`

---

## 3. Top Bar

### Left
- **Brand mark:** `w-5 h-5 rounded bg-grad-brand` (the violet-to-pink gradient square)
- **Title:** "EdgeWord" — `text-[14px] font-bold text-ink` with `letterSpacing: -0.01em`

### Centre (optional)
- Empty. The conversation is the content.

### Right
- **Health indicator:** Green pulsing dot + "Online" in `text-[11px] font-semibold text-green` — or amber "Loading" during model init
- **Settings gear icon:** 16px SVG, stroke 1.5, `text-ink-3 hover:text-ink`. Opens settings panel.

---

## 4. Conversation Thread

### 4.1 User Message

```
┌───────────────────────────────────────────────────┐
│ Who created EdgeWord NLP?                          │
│                                                    │
│                          [copy] [re-run]    12:03  │
└───────────────────────────────────────────────────┘
```

- **Container:** `bg-bg-2 rounded-xl px-4 py-3 ml-16` — left margin pushes user messages right
- **Text:** `text-[13px] font-medium text-ink` (Inter, weight 500)
- **Timestamp:** `text-[11px] text-ink-4` — right-aligned
- **Actions:** Appear on hover. Icons at 14px, `text-ink-4 hover:text-ink`. Inline row, right-aligned.
  - **Copy:** Clipboard icon. Copies message text.
  - **Re-run:** Refresh/arrow-clockwise icon. Re-sends this prompt.

### 4.2 AI Response

```
┌───────────────────────────────────────────────────┐
│ NEGATIVE  99.7%                                    │  ← sentiment pill
│                                                    │
│ EdgeWord NLP was created by El Mehdi El Jair.      │  ← response text
│ It is a CPU-native NLP pipeline with no GPU or     │
│ cloud dependencies...                              │
│                                                    │
│ ┌──────────────────┐                               │
│ │ about_edgeword.txt │  ← RAG source chip          │
│ └──────────────────┘                               │
│                                                    │
│ [tool: Calculator] 125 * 8 + 50 = 1050            │  ← tool result (if any)
│                                                    │
│ 15 tok · 14.9 t/s · TTFT 0.38s                    │  ← performance metadata
│                      [copy] [re-run] [speak] 12:03 │  ← actions
└───────────────────────────────────────────────────┘
```

- **Container:** `bg-white rounded-xl border border-line px-4 py-3 mr-16` — right margin pushes AI left
- **Sentiment pill:** Top of response. Uses state badge pattern:
  - POSITIVE: `bg-green-bg text-green`
  - NEGATIVE: `bg-red-bg text-red`
  - Format: `text-[11px] font-semibold uppercase` + dot + percentage
- **Response text:** `text-[13px] text-ink-2 leading-relaxed` (Inter, weight 400)
  - Code blocks inside responses: `bg-[#0E0C1A] text-slate-300 text-[12px] font-mono rounded-xl px-4 py-3`
- **RAG source chips:** `inline-flex bg-bg-2 text-ink-3 text-[11px] px-2 py-0.5 rounded-full gap-1` — document icon (14px) + filename
- **Tool results:** `bg-bg-2 rounded-lg px-3 py-2 text-[12px] font-mono text-ink-3 border-l-[3px] border-violet-400`
- **Performance metadata:** `text-[11px] text-ink-4 font-mono` — tokens, t/s, TTFT
- **Actions (hover):** Same as user message, plus:
  - **Speak:** Speaker icon. Triggers TTS, plays audio.

### 4.3 Thinking Indicator (During Inference)

Shown while the model is generating. Streams tokens in real-time.

```
┌───────────────────────────────────────────────────┐
│ ● ● ●                                             │
│                                                    │
│ EdgeWord NLP was created by El Me█                 │  ← streaming cursor
│                                                    │
│ 8 tokens · 14.2 t/s                               │  ← live counter
└───────────────────────────────────────────────────┘
```

- **Three dots:** Animated. `w-1.5 h-1.5 rounded-full bg-violet-400` with staggered `animate-pulse` (0ms, 150ms, 300ms delay)
- **Streaming text:** Same styling as final response, but with a blinking cursor: `border-r-2 border-violet-500 animate-pulse` on the last character
- **Live counter:** `text-[11px] text-ink-4 font-mono` — updates every token

### 4.4 File/Image Attachments in Thread

When the user uploads a file or image, show it inline before the prompt:

```
┌───────────────────────────────────────────────────┐
│ ┌─────────────────┐                                │
│ │ screenshot.png   │  ← image thumbnail (80x80)    │
│ │ 400x300 · 45 KB  │                                │
│ └─────────────────┘                                │
│ What does this image say?                          │
└───────────────────────────────────────────────────┘
```

- **Image thumbnail:** `w-20 h-20 rounded-lg object-cover border border-line`
- **File chip:** `bg-bg-2 rounded-lg px-3 py-2 text-[12px]` — file icon + name + size
- **Audio file:** Waveform icon + filename + duration

### 4.5 Audio Playback (TTS Response)

When the user clicks "speak" on a response:

```
┌───────────────────────────────────────────────────┐
│ ▶  ━━━━━━━━━━━━━━━━━━━━━━━━━━━  0:03 / 0:08       │
└───────────────────────────────────────────────────┘
```

- **Player:** Inline below the response. `bg-bg-2 rounded-lg px-3 py-2`
- **Play button:** Violet-500 circle, 28px, with triangle icon
- **Progress bar:** Spec bar pattern — `h-[3px] bg-bg-2 rounded-full` with violet fill
- **Time:** `text-[11px] font-mono text-ink-4`

---

## 5. Prompt Bar (The Centrepiece)

The prompt bar is a single elevated container at the bottom of the viewport.

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                                                    │  │
│  │  [mic] [upload] [image]  │  Type a message...      │  │
│  │                          │                    [send]│  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Llama-3.2-1B  ·  14.9 t/s  ·  3 turns  ·  cache: 5    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Container
```tsx
className="bg-white rounded-2xl border border-line shadow-lg mx-auto max-w-[680px]"
```
- Sits inside a `sticky bottom-0 bg-gradient-to-t from-bg via-bg to-transparent px-6 pb-4 pt-8` wrapper (fade effect at bottom)

### Input Area
- **Textarea:** Auto-growing, min 1 line, max 6 lines. `text-[13px] text-ink resize-none border-none outline-none bg-transparent w-full`
- **Placeholder:** "Type a message..." in `text-ink-4`
- **Submit:** `Cmd+Enter` or click send button

### Left Icon Group (Actions)
Separated from the text input by a `border-r border-line` divider. Icons are 16px, `text-ink-3 hover:text-violet-500 transition-colors`.

| Icon | Action | Behaviour |
|---|---|---|
| **Microphone** | Voice input | Click to start recording. Icon pulses red during recording. Audio sent to `/v1/transcribe`, text inserted into prompt. |
| **Paperclip** | Upload file | Opens file picker. Accepted: `.txt`, `.md`, `.py`, `.json`, `.csv`, `.pdf`. File content extracted and attached. |
| **Image** | Upload image | Opens file picker (images only). Shows thumbnail preview. Sent to `/v1/ocr` or `/v1/classify/image`. |

### Send Button (Right)
- **Default:** Arrow-up icon inside `w-8 h-8 rounded-lg bg-violet-500 text-white hover:bg-violet-600` — only visible when input is non-empty
- **Empty state:** `bg-line text-ink-4 cursor-not-allowed`
- **During generation:** Transforms to a **stop** button (square icon) — `bg-red text-white`

### Status Bar (Below Input)
`text-[11px] text-ink-4 font-mono` — separated by `·` dividers in `text-ink-5`

Shows: Model name, last TPS, conversation turn count, cache size. Updates live.

---

## 6. Settings Panel

Triggered by the gear icon in the top bar. Slides in from the right as a side panel.

```
┌──────────────────────────────────────────┐
│  SETTINGS                          [close]│
├──────────────────────────────────────────┤
│                                          │
│  MODEL                                   │  ← section label (11px uppercase)
│  ┌────────────────────────────────────┐  │
│  │ Llama-3.2-1B-Instruct-Q4_K_M     ▼│  │  ← dropdown (if multiple models)
│  └────────────────────────────────────┘  │
│  Threads: [4]    Max tokens: [256]       │
│  Temperature: [0.7]                      │
│                                          │
│  FEATURES                                │
│  [x] RAG (3 chunks indexed)              │
│  [x] Response cache (5 entries)          │
│  [x] Auto-tools                          │
│                                          │
│  API KEYS                                │
│  ┌────────────────────────────────────┐  │
│  │ my-app    ew_pYDb...   active      │  │
│  │           42 req · 1250 tok        │  │
│  │                       [revoke]     │  │
│  ├────────────────────────────────────┤  │
│  │ [+ Create new key]                │  │
│  └────────────────────────────────────┘  │
│                                          │
│  SESSION                                 │
│  Turn count: 3                           │
│  [Clear conversation]  [Clear cache]     │
│                                          │
│  SYSTEM                                  │
│  CPU: i7-4810MQ · 8 cores               │
│  RAM: 15.5 GB · 12.1 GB free            │
│  Uptime: 2h 14m                          │
│                                          │
└──────────────────────────────────────────┘
```

### Panel
- `fixed top-0 right-0 h-full w-[360px] bg-white border-l border-line shadow-xl z-40`
- Backdrop: `fixed inset-0 bg-black/20 backdrop-blur-sm z-30`
- Section labels: `text-[11px] font-semibold text-ink-3 uppercase tracking-widest mb-3`
- Form inputs: Standard Strand form input pattern
- Toggles: Custom toggle switches with violet-500 active state

### API Key Management
- List existing keys with prefix, name, status, usage count
- Create new key: opens inline form (name + rate limit)
- Revoke: destructive button pattern, with confirmation

---

## 7. Interaction States

### Voice Recording
1. User clicks microphone icon
2. Icon changes to red pulsing circle + "Recording..." label
3. User clicks again to stop (or auto-stop after 30s silence)
4. Audio sent to `/v1/transcribe`
5. Transcribed text inserted into prompt bar
6. User can edit before sending

### File Upload
1. User clicks paperclip or drags file onto prompt bar
2. File chip appears above the text input inside the prompt bar
3. On send, file content is extracted and appended to message context
4. For images: OCR is triggered, text injected into LLM context

### Streaming Response
1. User sends message
2. Send button transforms to stop button
3. Thinking indicator appears with animated dots
4. Tokens stream in real-time (SSE or WebSocket from API)
5. Live token counter updates
6. On completion: thinking indicator replaced with final response card
7. Sentiment pill, RAG sources, tool results, and metadata appear

### Cache Hit
When a cached response is returned:
- Response appears instantly (no thinking indicator)
- A subtle `[cached]` badge in `text-[11px] text-amber` appears in the metadata line

---

## 8. Empty State

When the conversation is empty (first load):

```
┌───────────────────────────────────────────────────┐
│                                                    │
│              [EdgeWord brand mark 28px]             │
│                                                    │
│              EdgeWord Assistant                    │
│              CPU-native NLP pipeline               │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Classify  │  │ Ask a    │  │ Upload   │        │
│  │ sentiment │  │ question │  │ an image │        │
│  └──────────┘  └──────────┘  └──────────┘        │
│                                                    │
│  Llama-3.2-1B · RAG: 3 docs · Cache: ready        │
│                                                    │
└───────────────────────────────────────────────────┘
```

- Centre-aligned, vertically centred in the conversation area
- **Suggestion chips:** `bg-white border border-line rounded-xl px-4 py-3 text-[13px] text-ink-3 hover:border-violet-200 hover:text-ink cursor-pointer`
- Each chip pre-fills the prompt bar with an example

---

## 9. Responsive Design

Three breakpoints. Every component adapts. The experience must feel purpose-built for each device — not a desktop UI crammed into a phone.

### Breakpoints

| Name | Range | Tailwind | Design intent |
|---|---|---|---|
| **Mobile** | 0–639px | `sm:` | Phone-first. Full-width, stacked, thumb-friendly. |
| **Tablet** | 640–1023px | `md:` | iPad/landscape. Slightly wider column, side panel available. |
| **Desktop** | 1024px+ | `lg:` | Full layout with 680px conversation column and side panel. |

---

### 9.1 Top Bar

| Element | Mobile | Tablet | Desktop |
|---|---|---|---|
| Height | `h-11` | `h-12` | `h-12` |
| Brand mark | `w-5 h-5` — always visible | same | same |
| Title text | Hidden (`hidden sm:block`) | "EdgeWord" visible | "EdgeWord" visible |
| Health pill | Dot only, no text | Dot + "Online" | Dot + "Online" |
| Settings icon | 20px, right edge | 16px | 16px |
| Padding | `px-4` | `px-5` | `px-6` |

---

### 9.2 Conversation Thread

| Element | Mobile | Tablet | Desktop |
|---|---|---|---|
| Column width | `w-full px-3` | `max-w-[600px] mx-auto px-4` | `max-w-[680px] mx-auto px-6` |
| User message margin | `ml-8` (subtle indent) | `ml-12` | `ml-16` |
| AI response margin | `mr-4` | `mr-8` | `mr-16` |
| Message padding | `px-3 py-2.5` | `px-3.5 py-3` | `px-4 py-3` |
| Font size (body) | `text-[14px]` (larger for readability) | `text-[13px]` | `text-[13px]` |
| Metadata font | `text-[10px]` | `text-[11px]` | `text-[11px]` |
| Actions visibility | Always visible (no hover on touch) | Always visible | Visible on hover |
| Action icon size | 18px (larger touch targets) | 16px | 14px |
| Action touch area | `min-w-[44px] min-h-[44px]` | `min-w-[36px]` | natural |
| Sentiment pill | Inline, `text-[10px]` | `text-[11px]` | `text-[11px]` |
| RAG chips | Stack vertically if multiple | Inline row | Inline row |
| Tool result | Full width, smaller padding | Same as desktop | `px-3 py-2` |

**Key mobile adaptations:**
- Message actions are always visible on mobile (no hover state on touch devices)
- Touch targets are minimum 44x44px per Apple HIG
- Body text is 14px on mobile for readability (not 13px)
- Messages use less horizontal margin to maximise reading width

---

### 9.3 Prompt Bar

This is the most critical responsive component. It must feel native on every device.

#### Mobile (< 640px)

```
┌──────────────────────────────────────┐
│ ┌──────────────────────────────────┐ │
│ │  Type a message...         [send]│ │
│ ├──────────────────────────────────┤ │
│ │  [mic]  [upload]  [image]        │ │
│ └──────────────────────────────────┘ │
│  Llama-3.2-1B · 14.9 t/s · 3 turns  │
└──────────────────────────────────────┘
```

- **Layout:** Icons move below the textarea into their own row
- **Container:** `rounded-xl` (not `rounded-2xl`), no horizontal margin — flush to screen edges with `mx-3`
- **Textarea:** Full width, `text-[15px]` (iOS prevents zoom below 16px — use 15px with viewport meta)
- **Send button:** `w-9 h-9` — larger touch target
- **Icon row:** `flex gap-4 px-3 py-2 border-t border-line` — icons at 20px, `min-h-[44px]` touch targets
- **Bottom safe area:** `pb-[env(safe-area-inset-bottom)]` for iPhone notch/gesture bar

#### Tablet (640–1023px)

```
┌──────────────────────────────────────────────┐
│ ┌────────────────────────────────────────────┐│
│ │ [mic][upload][image] │ Type a message [send]││
│ └────────────────────────────────────────────┘│
│  Llama-3.2-1B · 14.9 t/s                     │
└──────────────────────────────────────────────┘
```

- **Layout:** Same as desktop but wider column (`max-w-[600px]`)
- **Container:** `rounded-2xl mx-4`
- **Icons:** Inline left, 18px

#### Desktop (1024px+)

- Full layout as specified in Section 5
- `max-w-[680px] mx-auto`
- `rounded-2xl`

---

### 9.4 Settings Panel

| Element | Mobile | Tablet | Desktop |
|---|---|---|---|
| **Type** | Full-screen modal | Side panel `w-[320px]` | Side panel `w-[360px]` |
| **Entry** | Slides up from bottom | Slides from right | Slides from right |
| **Close** | Swipe down + close button at top | Close button | Close button |
| **Backdrop** | `bg-black/40` | `bg-black/20 backdrop-blur-sm` | `bg-black/20 backdrop-blur-sm` |
| **Scroll** | Full page scroll | Internal scroll | Internal scroll |
| **Title size** | `text-[16px]` | `text-[14px]` | `text-[14px]` |
| **Section labels** | `text-[12px]` | `text-[11px]` | `text-[11px]` |
| **Form inputs** | `py-3 text-[15px]` (larger) | `py-2.5 text-[13px]` | `py-2.5 text-[13px]` |
| **Buttons** | Full width, `py-3` | Auto width, `py-2` | Auto width, `py-2` |

**Mobile settings modal:**
```
┌──────────────────────────────────────┐
│  ━━━  (drag handle)                  │ ← 4px wide, 40px, centred, bg-line
├──────────────────────────────────────┤
│  SETTINGS                    [close] │
│                                      │
│  MODEL                               │
│  Llama-3.2-1B-Instruct              │
│  ...                                 │
│  (scrollable content)                │
│                                      │
└──────────────────────────────────────┘
```

- **Drag handle:** `w-10 h-1 bg-line rounded-full mx-auto mt-2 mb-4` — hints at swipe-to-dismiss
- **Container:** `fixed inset-x-0 bottom-0 rounded-t-2xl bg-white max-h-[85vh] overflow-y-auto`

---

### 9.5 Empty State

| Element | Mobile | Tablet/Desktop |
|---|---|---|
| Brand mark | `w-8 h-8` | `w-7 h-7` |
| Title | `text-[18px]` | `text-[18px]` |
| Subtitle | `text-[14px]` | `text-[13px]` |
| Suggestion chips | Stack vertically, full width | Inline row, auto width |
| Chip padding | `px-4 py-3.5` (larger touch) | `px-4 py-3` |

---

### 9.6 Thinking Indicator & Streaming

| Element | Mobile | Tablet/Desktop |
|---|---|---|
| Dots | Same animation, `w-2 h-2` | `w-1.5 h-1.5` |
| Streaming text | `text-[14px]` | `text-[13px]` |
| Live counter | `text-[10px]` | `text-[11px]` |

---

### 9.7 Audio Player (TTS)

| Element | Mobile | Tablet/Desktop |
|---|---|---|
| Play button | `w-10 h-10` (44px touch) | `w-7 h-7` |
| Progress bar height | `h-[4px]` (easier to tap) | `h-[3px]` |
| Time text | `text-[12px]` | `text-[11px]` |
| Container | Full message width | Inline within message |

---

### 9.8 Attachment Previews

| Element | Mobile | Tablet/Desktop |
|---|---|---|
| Image thumbnail | `w-16 h-16` | `w-20 h-20` |
| File chip | Full width, stacked | Inline |
| Remove button | `w-6 h-6` circle, top-right | `w-5 h-5` |

---

### 9.9 Touch Optimisations

- **Swipe gestures:** Swipe left on a message to reveal actions (re-run, copy, speak)
- **Long press:** On a message to show action menu (alternative to swipe)
- **Pull to refresh:** Not needed (single thread), but pull-down at top could show system status
- **Haptic feedback:** Trigger `navigator.vibrate(10)` on button taps if supported
- **Pinch to zoom:** Disabled on conversation (`user-scalable=no` or `touch-action: pan-y`) — text sizes are already readable
- **Viewport meta:** `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">`
- **Safe areas:** `padding-bottom: env(safe-area-inset-bottom)` on prompt bar for iPhone notch

---

### 9.10 Orientation

| Orientation | Behaviour |
|---|---|
| Portrait (phone) | Default mobile layout |
| Landscape (phone) | Prompt bar icons stay below textarea. Conversation column uses `max-w-[500px]`. Keyboard pushes content up correctly. |
| Portrait (tablet) | Tablet layout |
| Landscape (tablet) | Desktop layout activates (`lg:` breakpoint usually hit) |

---

### 9.11 CSS Architecture for Responsiveness

Use Tailwind's responsive prefixes consistently:

```tsx
// Example: Message container
className={`
  px-3 py-2.5                    // mobile
  sm:px-3.5 sm:py-3              // tablet  
  lg:px-4 lg:py-3                // desktop
  
  ml-8                           // mobile user indent
  sm:ml-12                       // tablet
  lg:ml-16                       // desktop
  
  text-[14px]                    // mobile (readable)
  sm:text-[13px]                 // tablet/desktop (compact)
`}
```

**Container queries (future):** For components rendered inside panels of varying width, use `@container` queries when Tailwind 4 support matures.

---

## 10. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS 4 + Strand design tokens |
| Fonts | Inter (sans) + JetBrains Mono (mono) |
| Icons | Inline SVG (no icon library) |
| State | React hooks + context (no Redux) |
| API Client | fetch + EventSource (SSE for streaming) |
| Audio | Web Audio API (recording + playback) |
| Build | pnpm + turbopack |

---

## 11. API Integration Map

| UI Action | API Endpoint | Response Handling |
|---|---|---|
| Send message | `POST /v1/chat` | Stream tokens via SSE or poll |
| Classify text | `POST /v1/classify` | Show sentiment pill |
| Upload image | `POST /v1/ocr` | Extract text, show in thread |
| Upload image (classify) | `POST /v1/classify/image` | Show labels in thread |
| Voice input | `POST /v1/transcribe` | Insert text into prompt |
| Speak response | `POST /v1/speak` | Play returned WAV |
| OCR + question | `POST /v1/ocr/chat` | Show OCR result + LLM response |
| Health check | `GET /v1/health` | Update status pill |
| Manage keys | `api_keys.py` CLI or future admin endpoint | Settings panel |
| Clear session | `DELETE /v1/sessions/{id}` | Reset conversation |

---

## 12. Accessibility

- All interactive elements have `aria-label`
- Keyboard navigation: `Tab` through prompt bar actions, `Enter` to send
- Focus ring: `ring-2 ring-violet-400` on all focusable elements
- Screen reader: Messages have `role="log"`, live region for streaming
- Colour contrast: All text/background combinations meet WCAG AA
- Reduced motion: Respect `prefers-reduced-motion` — disable pulse/shimmer animations
