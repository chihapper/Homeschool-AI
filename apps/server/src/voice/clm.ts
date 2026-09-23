/**
 * Hume EVI "Custom Language Model" bridge.
 *
 * Hume calls `POST /clm/chat/completions?custom_session_id=<our session id>` with an OpenAI-style
 * `{ messages: [...] }` body and expects an SSE stream of `chat.completion.chunk` objects ending
 * with `data: [DONE]`. We ignore Hume's copy of the history (our orchestrator owns it) and only use
 * the last user message plus any expression scores Hume attached to it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { respond } from "../orchestrator/session.js";

export interface ClmMessage {
  role: string;
  content: string | Array<{ type?: string; text?: string }> | null;
  /** Hume attaches expression-measurement results on user messages. */
  models?: { prosody?: { scores?: Record<string, number> } };
  time?: { begin?: number; end?: number };
}

export interface ClmRequestBody {
  messages?: ClmMessage[];
  custom_session_id?: string;
}

export function contentText(c: ClmMessage["content"]): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  return c.map((p) => p.text ?? "").join("");
}

/** Top-N expression labels from Hume prosody scores, e.g. ["Interest", "Confusion"]. */
export function topExpressions(scores: Record<string, number> | undefined, n = 3, min = 0.15): string[] {
  if (!scores) return [];
  return Object.entries(scores)
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

/** Hume sometimes embeds expression text inline: "hello {confusion, interest}". Strip it if present. */
export function stripInlineExpressions(text: string): { text: string; expressions: string[] } {
  const m = text.match(/\s*\{([^{}]{0,200})\}\s*$/);
  if (!m) return { text, expressions: [] };
  const expressions = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  return { text: text.slice(0, m.index).trim(), expressions };
}

export function lastUserTurn(messages: ClmMessage[]): { text: string; expressions: string[] } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const raw = contentText(m.content);
    const inline = stripInlineExpressions(raw);
    const fromScores = topExpressions(m.models?.prosody?.scores);
    return { text: inline.text, expressions: fromScores.length ? fromScores : inline.expressions };
  }
  return { text: "", expressions: [] };
}

export function sseChunk(id: string, sessionId: string | undefined, delta: string | null, finish: "stop" | null): string {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "homeschool-ai-tutor",
    ...(sessionId ? { system_fingerprint: sessionId } : {}),
    choices: [{ index: 0, delta: delta === null ? {} : { role: "assistant", content: delta }, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function authorized(req: FastifyRequest): boolean {
  const secret = config.hume.clmSecret;
  if (!secret) return true;
  const header = req.headers.authorization ?? "";
  return header === `Bearer ${secret}`;
}

export function registerClmRoutes(app: FastifyInstance): void {
  app.post("/clm/chat/completions", async (req: FastifyRequest<{ Body: ClmRequestBody; Querystring: { custom_session_id?: string } }>, reply: FastifyReply) => {
    if (!authorized(req)) return reply.code(401).send({ error: "unauthorized" });
    const sessionId = req.query.custom_session_id ?? req.body?.custom_session_id;
    const id = `chatcmpl-${Date.now().toString(36)}`;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const write = (s: string): void => {
      reply.raw.write(s);
    };

    if (!sessionId) {
      write(sseChunk(id, undefined, "I can't find your lesson session. Please restart from the app.", null));
      write(sseChunk(id, undefined, null, "stop"));
      write("data: [DONE]\n\n");
      reply.raw.end();
      return reply;
    }

    const { text, expressions } = lastUserTurn(req.body?.messages ?? []);
    const abort = new AbortController();
    reply.raw.on("close", () => abort.abort()); // response close = Hume dropped the request (req "close" fires as soon as the body is read on Node 16+)
    try {
      const gen = respond(sessionId, text, expressions, abort.signal);
      let r = await gen.next();
      while (!r.done) {
        write(sseChunk(id, sessionId, r.value, null));
        r = await gen.next();
      }
      // Hume is already speaking; the tutor's notes and phase change settle in the background and are
      // awaited at the start of the next turn (see settleReflection in the orchestrator).
    } catch (err) {
      req.log.error({ err }, "CLM turn failed");
      if (!abort.signal.aborted) write(sseChunk(id, sessionId, "Sorry, I lost my train of thought. Could you say that again?", null));
    }
    write(sseChunk(id, sessionId, null, "stop"));
    write("data: [DONE]\n\n");
    reply.raw.end();
    return reply;
  });
}
