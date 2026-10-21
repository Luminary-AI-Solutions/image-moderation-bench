import { afterEach, describe, expect, it, vi } from "vitest";
import { moderateImage } from "./models.ts";
import { STATE } from "./prompts.ts";

const IMAGE = "data:image/jpeg;base64,AAAA";

const decisionAnswers = {
  category: {
    type: "choice",
    choice: "sexual",
    probabilities: { sexual: 0.8, shocking: 0.2 },
    confidence: 0.8,
  },
  verdict: {
    type: "choice",
    choice: "unsafe",
    probabilities: { safe: 0.07, unsafe: 0.93 },
    confidence: 0.93,
  },
};

// biome-ignore lint/suspicious/noExplicitAny: request bodies are read loosely in assertions
type Request = { url: string; headers: Headers; body: Record<string, any> };

function recordingFetch(respond: (req: Request) => Response) {
  const requests: Request[] = [];
  const fetch = (async (
    input: string | URL | globalThis.Request,
    init?: RequestInit,
  ) => {
    const req = {
      url: String(input instanceof globalThis.Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    };
    requests.push(req);
    return respond(req);
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

afterEach(() => vi.unstubAllGlobals());

describe("clef-flash", () => {
  it("sends the model id and image Clef needs next to TanStack's questions", async () => {
    const { fetch, requests } = recordingFetch(() =>
      Response.json({
        success: true,
        result: {
          model: "clef-flash",
          answers: decisionAnswers,
          usage: { input_tokens: 1000, output_tokens: 0 },
        },
      }),
    );
    const result = await moderateImage(
      IMAGE,
      { cloudflare: { accountId: "acct", apiKey: "token" } },
      "clef-flash",
      fetch,
    );
    expect(requests[0].url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash",
    );
    expect(requests[0].body).toMatchObject({
      model: "clef-flash",
      images: [IMAGE],
      state: STATE,
    });
    expect(Object.keys(requests[0].body.questions)).toEqual([
      "category",
      "verdict",
    ]);
    expect(result).toMatchObject({
      category: "sexual",
      unsafeProbability: 0.93,
      verdict: "unsafe",
      costUsd: 0.000038,
    });
  });
});

describe("jev", () => {
  it("puts the image in state as an image_url part", async () => {
    const { fetch, requests } = recordingFetch(() =>
      Response.json({
        model: "typesafe/jev-1.14-20261014",
        answers: decisionAnswers,
        usage: { input_tokens: 2000, output_tokens: 140 },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await moderateImage(
      IMAGE,
      { openRouterApiKey: "sk-or" },
      "jev",
    );
    expect(requests[0].url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(requests[0].body).toMatchObject({
      model: "typesafe/jev-1.14",
      state: [STATE, { type: "image_url", image_url: { url: IMAGE } }],
    });
    // Jev bills input tokens only.
    expect(result.costUsd).toBeCloseTo(0.000084);
  });
});

describe("haiku-5.5", () => {
  const message = (content: unknown[], stop_reason = "end_turn") =>
    Response.json({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 1500, output_tokens: 30 },
    });

  it("sends the image with the shared prompt and reads the structured answer", async () => {
    const { fetch, requests } = recordingFetch(() =>
      message([
        {
          type: "text",
          text: JSON.stringify({
            category: "violence",
            verdict: "unsafe",
            unsafe_probability: 0.85,
          }),
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await moderateImage(
      IMAGE,
      { anthropicApiKey: "sk-ant" },
      "haiku-5.5",
    );
    const content = requests[0].body.messages[0].content;
    expect(requests[0].body.model).toBe("claude-haiku-5-5");
    expect(content[0]).toMatchObject({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    expect(content[1].text).toContain(STATE);
    expect(result).toMatchObject({
      category: "violence",
      unsafeProbability: 0.85,
      verdict: "unsafe",
    });
    expect(result.costUsd).toBeCloseTo((1500 * 0.1 + 30 * 0.5) / 1e6);
  });

  it("counts a refusal as unsafe, as the UnsafeBench paper does", async () => {
    const { fetch } = recordingFetch(() => message([], "refusal"));
    vi.stubGlobal("fetch", fetch);
    const result = await moderateImage(
      IMAGE,
      { anthropicApiKey: "sk-ant" },
      "haiku-5.5",
    );
    expect(result).toMatchObject({
      refused: true,
      unsafeProbability: 1,
      verdict: "unsafe",
    });
    expect(result.category).toBeUndefined();
  });
});

describe("rekognition", () => {
  it("scores by the highest-confidence label and applies the API's 50% rule", async () => {
    const { RekognitionClient } = await import("@aws-sdk/client-rekognition");
    const send = vi
      .spyOn(RekognitionClient.prototype, "send")
      .mockResolvedValue({
        ModerationLabels: [
          { Name: "Swimwear or Underwear", Confidence: 42 },
          { Name: "Explicit", Confidence: 97.5 },
        ],
      } as never);
    const result = await moderateImage(
      IMAGE,
      { awsRegion: "us-east-1" },
      "rekognition",
    );
    const command = send.mock.calls[0][0] as {
      input: { MinConfidence: number };
    };
    expect(command.input.MinConfidence).toBe(0);
    expect(result).toMatchObject({
      unsafeProbability: 0.975,
      verdict: "unsafe",
      topLabel: "Explicit",
      costUsd: 0.001,
    });
    expect(result.category).toBeUndefined();
    send.mockRestore();
  });
});
