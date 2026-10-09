import { describe, expect, it } from "vitest";
import { fromResponse, toResponsesRequest } from "../src/llm/openai.js";
import { normalizeModelId, vendorOf } from "../src/llm/models.js";

const schema = { type: "object", properties: { level: { type: "integer" } }, required: ["level"], additionalProperties: false };

describe("a Claude-shaped request to the Responses API", () => {
  it("carries the system prompt, the message, the effort, the output cap and the strict schema, and stores nothing", () => {
    const req = toResponsesRequest({
      model: "gpt-6.1-sol",
      max_tokens: 32_000,
      system: [
        { type: "text", text: "You assess.", cache_control: { type: "ephemeral" } },
        { type: "text", text: "<learner>Sam</learner>" },
      ],
      output_config: { effort: "high", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: "Assess this." }],
    } as never);
    expect(req.model).toBe("gpt-6.1-sol");
    expect(req.instructions).toBe("You assess.\n\n<learner>Sam</learner>");
    expect(req.input).toEqual([{ role: "user", content: "Assess this." }]);
    expect(req.reasoning).toEqual({ effort: "high" });
    expect(req.max_output_tokens).toBe(32_000);
    expect(req.text).toEqual({ format: { type: "json_schema", name: "output", schema, strict: true } });
    expect(req.store).toBe(false);
  });

  it("refuses anything but text, since the report is text", () => {
    expect(() => toResponsesRequest({ model: "gpt-6.1-sol", max_tokens: 10, messages: [{ role: "user", content: [{ type: "image", source: {} }] }] } as never)).toThrow(/text only/);
  });
});

describe("a Responses API reply as a Claude message", () => {
  const base = { id: "resp_1", model: "gpt-6.1-sol", status: "completed", output: [], usage: { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 20 } } };

  it("parses the document and splits cached from uncached input", () => {
    const { message, parsed } = fromResponse({ ...base, output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text: '{"level": 2}', annotations: [] }] }] } as never);
    expect(message.stop_reason).toBe("end_turn");
    expect(parsed).toEqual({ level: 2 });
    expect(message.usage).toEqual({ input_tokens: 600, output_tokens: 50, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 });
  });

  it("reports a refusal the way the Claude API does, so assertNotRefused sees it", () => {
    const { message, parsed } = fromResponse({ ...base, output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "I can't help with that." }] }] } as never);
    expect(message.stop_reason).toBe("refusal");
    expect((message as { stop_details?: { explanation?: string } }).stop_details?.explanation).toBe("I can't help with that.");
    expect(parsed).toBeNull();
  });

  it("reports a reply cut off at the output cap as max_tokens, with nothing parsed", () => {
    const { message, parsed } = fromResponse({ ...base, status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "message", id: "m", role: "assistant", status: "incomplete", content: [{ type: "output_text", text: '{"level": ', annotations: [] }] }] } as never);
    expect(message.stop_reason).toBe("max_tokens");
    expect(parsed).toBeNull();
  });
});

describe("vendors", () => {
  it("tells an OpenAI id from a Claude id, and keeps the dots OpenAI uses", () => {
    expect(vendorOf("gpt-6.1-sol")).toBe("openai");
    expect(vendorOf("claude-sonnet-5-5")).toBe("anthropic");
    expect(normalizeModelId("GPT-6.1-Sol ")).toBe("gpt-6.1-sol"); // never "gpt-6-1-sol": that is not a model
    expect(normalizeModelId("claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
  });
});
