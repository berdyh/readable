import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyMessage } from "../routing/failover-classifier";
import { OpenRouterProvider } from "./openrouter";

const fetchMock = vi.fn();

const completionResponse = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const request = {
  systemPrompt: "You are a test assistant.",
  userPrompt: "Answer the question.",
  schema: { type: "object" },
};

function provider(): OpenRouterProvider {
  return new OpenRouterProvider({
    provider: "openrouter",
    apiKey: "test-key",
    model: "test/model",
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouterProvider.generateJson", () => {
  it("pins the anti-truncation request shape: provider constraints and transforms", async () => {
    fetchMock.mockResolvedValue(completionResponse('{"answer":"ok"}'));

    await provider().generateJson(request);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Route only to upstreams honouring response_format, and never let
    // OpenRouter silently compress the prompt (observed: DeepInfra cut
    // the prompt to 2048 tokens and the model answered "{}").
    expect(body.provider).toEqual({ require_parameters: true, ignore: ["DeepInfra"] });
    expect(body.transforms).toEqual([]);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("rejects a 200 whose content is a degenerate empty JSON payload", async () => {
    fetchMock.mockResolvedValue(completionResponse("{}"));

    await expect(provider().generateJson(request)).rejects.toThrow(/empty response/i);
  });

  it("rejects degenerate empty arrays too", async () => {
    fetchMock.mockResolvedValue(completionResponse("[]"));

    await expect(provider().generateJson(request)).rejects.toThrow(/empty response/i);
  });

  it("throws a message the failover classifier reads as empty_response", async () => {
    fetchMock.mockResolvedValue(completionResponse("{}"));

    const error = await provider()
      .generateJson(request)
      .then(
        () => undefined,
        (thrown: Error) => thrown,
      );

    expect(error).toBeInstanceOf(Error);
    expect(classifyMessage(error!.message)).toBe("empty_response");
  });
});

describe("OpenRouterProvider.generateText", () => {
  it("does NOT reject a plain {} text answer — degenerate guard is JSON-path only", async () => {
    fetchMock.mockResolvedValue(completionResponse("{}"));

    await expect(
      provider().generateText({
        systemPrompt: "You are a test assistant.",
        userPrompt: "Reply with an empty JSON object literal.",
      }),
    ).resolves.toBe("{}");
  });
});
