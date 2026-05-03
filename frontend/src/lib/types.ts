export interface SentimentResult {
  label: string;
  confidence: number;
  scores: Record<string, number>;
  latency_ms: number;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  sentiment?: SentimentResult;
  ragSources?: string[];
  toolResult?: string;
  tokens?: number;
  tps?: number;
  ttft?: number;
  totalS?: number;
  cached?: boolean;
  timestamp: number;
  attachments?: Attachment[];
  autoProfile?: string;
  skillUsed?: string;
  reasoning?: Record<string, string>;
  stageLabel?: string;
  webResults?: {title:string;url:string;snippet:string}[];
  webSuggest?: boolean;
  knowledgeGap?: { message: string; suggested_pack?: { id: string; name: string; description: string; category: string } | null };
}

export interface Attachment {
  type: "image" | "file";
  name: string;
  size: number;
  url?: string; // object URL for preview
  file: File;
}

export interface HealthStatus {
  status: string;
  fast_path: boolean;
  compute_path: boolean;
  rag_chunks: number;
  cache_entries: number;
  model: string | null;
  uptime_s: number;
}

export interface ChatResponse {
  response: string;
  sentiment: SentimentResult;
  tool_result: string | null;
  rag_sources: string[];
  tokens: number;
  tps: number;
  ttft_s: number;
  total_s: number;
  cached: boolean;
  session_id: string;
  auto_profile: string | null;
  skill_used: string | null;
}

export interface Section {
  id: string;
  title: string;
  timestamp: number;
  messageIndex: number;
  messageCount: number;
}
