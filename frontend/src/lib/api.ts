import { ChatResponse, HealthStatus } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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
    sessionId?: string;
    useRag?: boolean;
    useTools?: boolean;
    useCache?: boolean;
  } = {}
): Promise<ChatResponse> {
  const res = await fetch(`${API_BASE}/v1/chat`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      message,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0.7,
      session_id: opts.sessionId ?? "web-ui",
      use_rag: opts.useRag ?? true,
      use_tools: opts.useTools ?? true,
      use_cache: opts.useCache ?? true,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `API error ${res.status}`);
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
