import { ChatResponse, HealthStatus } from "./types";

// Always use the proxy — works both locally and via ngrok
const API_BASE = "/api";

// SSE base — direct backend connection for streaming (bypasses proxy buffering)
// Set NEXT_PUBLIC_SSE_URL for remote deployments, or auto-detect on localhost
const SSE_BASE = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_SSE_URL
    || (window.location.hostname === "localhost" ? "http://localhost:8000" : "")
    || `${window.location.origin}/api`)
  : "http://localhost:8000";

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("edgeword_token") || "";
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout() {
  localStorage.removeItem("edgeword_token");
  localStorage.removeItem("edgeword_user");
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getToken()}`,
  };
}

export async function register(username: string, password: string, displayName = "") {
  const res = await fetch(`${API_BASE}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, display_name: displayName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Registration failed");
  localStorage.setItem("edgeword_token", data.token);
  localStorage.setItem("edgeword_user", JSON.stringify(data.user));
  return data;
}

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Login failed");
  localStorage.setItem("edgeword_token", data.token);
  return data;
}

export async function health(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/v1/health`);
  return res.json();
}

export async function chat(
  message: string,
  opts: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    repeatPenalty?: number;
    systemPrompt?: string;
    sessionId?: string;
    useRag?: boolean;
    useTools?: boolean;
    useCache?: boolean;
    autoMode?: boolean;
    useWeb?: boolean;
  } = {}
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      message,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
      top_p: opts.topP ?? 0.9,
      top_k: opts.topK ?? 40,
      repeat_penalty: opts.repeatPenalty ?? 1.1,
      system_prompt: opts.systemPrompt ?? "",
      session_id: opts.sessionId ?? "web-ui",
      use_rag: opts.useRag ?? true,
      use_tools: opts.useTools ?? true,
      use_cache: opts.useCache ?? true,
      auto_mode: opts.autoMode ?? false,
      use_web: opts.useWeb ?? false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = err.detail || "Unknown error";
    const errType = err.type || "";
    const path = err.path || "";
    throw new Error(`${detail}${errType ? ` (${errType})` : ""}${path ? ` — ${path}` : ""} [HTTP ${res.status}]`);
  }
  return res.json();
}

export async function classify(text: string) {
  const res = await fetch(`${API_BASE}/v1/classify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text }),
  });
  return res.json();
}

export async function summarize(messages: string): Promise<string> {
  try {
    const res = await chat(
      `Generate a very short title (max 6 words) that summarizes this conversation. Reply ONLY with the title, nothing else:\n\n${messages}`,
      { maxTokens: 20, temperature: 0.3, useRag: false, useTools: false, useCache: false }
    );
    return res.response.replace(/^["']|["']$/g, "").trim();
  } catch {
    return "Conversation";
  }
}

export async function transcribe(file: File, language?: string) {
  const form = new FormData();
  form.append("file", file);
  if (language) form.append("language", language);
  const res = await fetch(`${API_BASE}/v1/transcribe`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  return res.json();
}

export async function speak(text: string): Promise<Blob> {
  const form = new FormData();
  form.append("text", text);
  const res = await fetch(`${API_BASE}/v1/speak`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  return res.blob();
}

export async function ocr(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/ocr`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  return res.json();
}

export async function ocrChat(file: File, question: string, sessionId = "web-ui") {
  const form = new FormData();
  form.append("file", file);
  form.append("question", question);
  form.append("session_id", sessionId);
  const res = await fetch(`${API_BASE}/v1/ocr/chat`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });
  return res.json();
}

export async function clearSession(sessionId = "web-ui") {
  const res = await fetch(`${API_BASE}/v1/sessions/${sessionId}`, {
    method: "DELETE",
    headers: headers(),
  });
  return res.json();
}

export async function keyUsage() {
  const res = await fetch(`${API_BASE}/v1/keys/usage`, {
    method: "GET",
    headers: headers(),
  });
  return res.json();
}

// ── Conversation persistence ──

export async function loadConversation() {
  const res = await fetch(`${API_BASE}/v1/conversation`, { headers: headers() });
  if (!res.ok) return null;
  return res.json();
}

export async function saveMessage(msg: Record<string, any>) {
  fetch(`${API_BASE}/v1/conversation/message`, {
    method: "POST", headers: headers(), body: JSON.stringify(msg),
  }).catch(() => {});
}

export async function saveSection(section: Record<string, any>) {
  fetch(`${API_BASE}/v1/conversation/section`, {
    method: "POST", headers: headers(), body: JSON.stringify(section),
  }).catch(() => {});
}

export async function saveSettings(settings: Record<string, any>) {
  fetch(`${API_BASE}/v1/conversation/settings`, {
    method: "POST", headers: headers(), body: JSON.stringify(settings),
  }).catch(() => {});
}

export async function chatStream(
  message: string,
  onEvent: (event: any) => void,
  opts: {
    maxTokens?: number; temperature?: number; topP?: number; topK?: number;
    repeatPenalty?: number; systemPrompt?: string; autoMode?: boolean;
    useRag?: boolean; useTools?: boolean; useWeb?: boolean;
  } = {}
): Promise<void> {
  const res = await fetch(`${SSE_BASE}/v1/chat/stream`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      message,
      max_tokens: opts.maxTokens ?? 512,
      temperature: opts.temperature ?? 0.7,
      top_p: opts.topP ?? 0.9,
      top_k: opts.topK ?? 40,
      repeat_penalty: opts.repeatPenalty ?? 1.1,
      system_prompt: opts.systemPrompt ?? "",
      auto_mode: opts.autoMode ?? false,
      use_web: opts.useWeb ?? false,
      session_id: "web-ui",
      use_rag: opts.useRag ?? true,
      use_tools: opts.useTools ?? true,
      use_cache: false, // no cache for streaming
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try { onEvent(JSON.parse(line.slice(6))); } catch {}
      }
    }
  }
}

export async function chatReason(
  message: string,
  onEvent: (event: any) => void,
  opts: { useRag?: boolean } = {}
): Promise<void> {
  const res = await fetch(`${SSE_BASE}/v1/chat/reason`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      message,
      use_rag: opts.useRag ?? true,
      session_id: "web-ui",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event = JSON.parse(line.slice(6));
          onEvent(event);
        } catch {}
      }
    }
  }
}

export async function clearConversation() {
  const res = await fetch(`${API_BASE}/v1/conversation`, {
    method: "DELETE", headers: headers(),
  });
  return res.json();
}

// ── Profile ──

export async function getProfile() {
  const res = await fetch(`${API_BASE}/v1/profile`, { headers: headers() });
  return res.json();
}

export async function updateProfile(updates: Record<string, any>) {
  const res = await fetch(`${API_BASE}/v1/profile`, {
    method: "PUT", headers: headers(), body: JSON.stringify(updates),
  });
  return res.json();
}

// ── Knowledge ──

export async function listKnowledge() {
  const res = await fetch(`${API_BASE}/v1/knowledge`, { headers: headers() });
  return res.json();
}

export async function uploadKnowledge(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/v1/knowledge/upload`, {
    method: "POST", headers: authHeaders(), body: form,
  });
  return res.json();
}

export async function deleteKnowledge(filename: string) {
  const res = await fetch(`${API_BASE}/v1/knowledge/${filename}`, {
    method: "DELETE", headers: headers(),
  });
  return res.json();
}

// ── Notifications ──

export async function getNotifications() {
  const res = await fetch(`${API_BASE}/v1/notifications`, { headers: headers() });
  return res.json();
}

export async function markNotificationsRead() {
  const res = await fetch(`${API_BASE}/v1/notifications/read`, {
    method: "POST", headers: headers(),
  });
  return res.json();
}

export async function clearNotifications() {
  const res = await fetch(`${API_BASE}/v1/notifications`, {
    method: "DELETE", headers: headers(),
  });
  return res.json();
}

// ── Knowledge Gallery ──

export async function listGalleryPacks() {
  const res = await fetch(`${API_BASE}/v1/gallery`, { headers: headers() });
  return res.json();
}

export async function installGalleryPack(packId: string) {
  const res = await fetch(`${API_BASE}/v1/gallery/${packId}/install`, {
    method: "POST", headers: headers(),
  });
  return res.json();
}

export async function uninstallGalleryPack(packId: string) {
  const res = await fetch(`${API_BASE}/v1/gallery/${packId}`, {
    method: "DELETE", headers: headers(),
  });
  return res.json();
}

export async function toggleGalleryPack(packId: string, enabled: boolean) {
  const res = await fetch(`${API_BASE}/v1/gallery/${packId}/toggle`, {
    method: "POST", headers: headers(), body: JSON.stringify({ enabled }),
  });
  return res.json();
}

export async function galleryPackProgress(packId: string) {
  const res = await fetch(`${API_BASE}/v1/gallery/${packId}/progress`, { headers: headers() });
  return res.json();
}

// ── API Keys ──

export async function listApiKeys() {
  const res = await fetch(`${API_BASE}/v1/keys`, { headers: headers() });
  return res.json();
}

export async function createApiKey(name: string, rateLimit = 60) {
  const res = await fetch(`${API_BASE}/v1/keys`, {
    method: "POST", headers: headers(), body: JSON.stringify({ name, rate_limit: rateLimit }),
  });
  return res.json();
}

// ── Skills ──

export async function listSkills() {
  const res = await fetch(`${API_BASE}/v1/skills`, { headers: headers() });
  return res.json();
}

export async function createSkill(data: Record<string, any>) {
  const res = await fetch(`${API_BASE}/v1/skills`, {
    method: "POST", headers: headers(), body: JSON.stringify(data),
  });
  return res.json();
}

export async function updateSkill(skillId: string, data: Record<string, any>) {
  const res = await fetch(`${API_BASE}/v1/skills/${skillId}`, {
    method: "PUT", headers: headers(), body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteSkill(skillId: string) {
  const res = await fetch(`${API_BASE}/v1/skills/${skillId}`, {
    method: "DELETE", headers: headers(),
  });
  return res.json();
}

export async function toggleSkill(skillId: string, enabled: boolean) {
  const res = await fetch(`${API_BASE}/v1/skills/${skillId}/toggle`, {
    method: "POST", headers: headers(), body: JSON.stringify({ enabled }),
  });
  return res.json();
}

// ── Logs ──

export async function getLogs(opts: { after?: number; level?: string; source?: string; search?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (opts.after) params.set("after", String(opts.after));
  if (opts.level) params.set("level", opts.level);
  if (opts.source) params.set("source", opts.source);
  if (opts.search) params.set("search", opts.search);
  if (opts.limit) params.set("limit", String(opts.limit));
  const res = await fetch(`${API_BASE}/v1/logs?${params}`, { headers: headers() });
  return res.json();
}

// ── Embeddings ──

export async function listEmbeddingModels() {
  const res = await fetch(`${API_BASE}/v1/embeddings`, { headers: headers() });
  return res.json();
}

export async function reembedAll() {
  const res = await fetch(`${API_BASE}/v1/embeddings/reembed`, {
    method: "POST", headers: headers(),
  });
  return res.json();
}

export async function reembedProgress() {
  const res = await fetch(`${API_BASE}/v1/embeddings/reembed/progress`, { headers: headers() });
  return res.json();
}

export async function activateEmbeddingModel(modelId: string) {
  const res = await fetch(`${API_BASE}/v1/embeddings/${modelId}/activate`, {
    method: "POST", headers: headers(),
  });
  return res.json();
}

// ── Models ──

export async function listModels() {
  const res = await fetch(`${API_BASE}/v1/models`, { headers: headers() });
  return res.json();
}

export async function downloadModel(modelId: string) {
  const res = await fetch(`${API_BASE}/v1/models/${modelId}/download`, {
    method: "POST", headers: headers(),
  });
  return res.json();
}

export async function modelProgress(modelId: string) {
  const res = await fetch(`${API_BASE}/v1/models/${modelId}/progress`, { headers: headers() });
  return res.json();
}

export async function activateModel(modelId: string) {
  const res = await fetch(`${API_BASE}/v1/models/${modelId}/activate`, {
    method: "POST", headers: headers(),
  });
  return res.json();
}

export async function revokeApiKey(keyPrefix: string) {
  const res = await fetch(`${API_BASE}/v1/keys/${keyPrefix}`, {
    method: "DELETE", headers: headers(),
  });
  return res.json();
}
