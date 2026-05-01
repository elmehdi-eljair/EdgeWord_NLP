import { NextRequest } from "next/server";

const BACKEND = "http://localhost:8000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const auth = req.headers.get("authorization") || "";

  const backendRes = await fetch(`${BACKEND}/v1/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body,
  });

  if (!backendRes.ok || !backendRes.body) {
    return new Response(await backendRes.text(), { status: backendRes.status });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = backendRes.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
