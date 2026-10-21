import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  DetectModerationLabelsCommand,
  RekognitionClient,
} from "@aws-sdk/client-rekognition";
import { type AnyEvaluateAdapter, decide } from "@tanstack/ai";
import { createCloudflareDecider } from "@tanstack/ai-cloudflare";
import { createOpenRouterDecider } from "@tanstack/ai-openrouter";
import { z } from "zod";
import { CATEGORY_IDS, type Category } from "./categories.ts";
import { CHAT_PROMPT, decisionQuestions, STATE } from "./prompts.ts";

/** Models under test. Prices are USD per million tokens. */
export const MODELS = {
  "clef-flash": {
    label: "Cloudflare clef-flash",
    provider: "Cloudflare Workers AI",
    id: "@cf/cloudflare/clef-flash",
    usdPerMillion: { input: 0.038, output: 0 },
    minSide: 0,
  },
  jev: {
    label: "TypeSafe Jev 1.14",
    provider: "OpenRouter (Decisions API)",
    // Pinned: jev-latest moves between releases.
    id: "typesafe/jev-1.14",
    usdPerMillion: { input: 0.042, output: 0 },
    // Jev rejects sides under 280px rather than scaling them.
    minSide: 280,
  },
  "haiku-5.5": {
    label: "Claude Haiku 5.5",
    provider: "Anthropic API",
    id: "claude-haiku-5-5",
    usdPerMillion: { input: 0.1, output: 0.5 },
    minSide: 0,
  },
  rekognition: {
    label: "Amazon Rekognition",
    provider: "AWS (DetectModerationLabels)",
    id: "DetectModerationLabels",
    // Billed per image ($0.001 for the first 1M a month), not per token.
    usdPerImage: 0.001,
    minSide: 0,
  },
} as const;

export type ModelName = keyof typeof MODELS;

export function isModelName(name: string): name is ModelName {
  return name in MODELS;
}

export interface Credentials {
  cloudflare?: { accountId: string; apiKey: string };
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  /** Rekognition reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY itself. */
  awsRegion?: string;
}

export interface Moderation {
  /** Missing when the model refused to answer. */
  category?: Category;
  /** P(unsafe), used to rank images. */
  unsafeProbability: number;
  /** The model's own hard call, where it gives one. */
  verdict?: "safe" | "unsafe";
  /** Claude declined to classify; counted as unsafe, as in the paper. */
  refused?: boolean;
  /** Rekognition's highest-confidence moderation label, for reference. */
  topLabel?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * The TanStack Cloudflare decider only sends `{ state, questions }`. Clef also
 * needs `model` in the body, and images ride alongside the state, so this
 * fetch adds both before the request leaves.
 */
export function clefFetch(
  images: string[],
  base: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return base(input, {
      ...init,
      body: JSON.stringify({ ...body, model: "clef-flash", images }),
    });
  };
}

function cost(
  model: Exclude<ModelName, "rekognition">,
  input: number,
  output: number,
) {
  const price = MODELS[model].usdPerMillion;
  return (input * price.input + output * price.output) / 1_000_000;
}

const rekognitionClients = new Map<string, RekognitionClient>();

/**
 * Rekognition has its own taxonomy and no prompt, so it can't answer the
 * category question. Its score is the highest confidence of any moderation
 * label (MinConfidence 0 returns them all); its own verdict is the API's
 * default rule, any label at 50% or more.
 */
async function rekognition(
  dataUrl: string,
  credentials: Credentials,
): Promise<Omit<Moderation, "latencyMs">> {
  const region = credentials.awsRegion;
  if (!region) throw new Error("rekognition needs AWS_REGION");
  let client = rekognitionClients.get(region);
  if (!client) {
    client = new RekognitionClient({ region, maxAttempts: 8 });
    rekognitionClients.set(region, client);
  }
  const response = await client.send(
    new DetectModerationLabelsCommand({
      Image: {
        Bytes: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
      },
      MinConfidence: 0,
    }),
  );
  const labels = response.ModerationLabels ?? [];
  const top = labels.reduce<(typeof labels)[number] | undefined>(
    (best, l) => ((l.Confidence ?? 0) > (best?.Confidence ?? -1) ? l : best),
    undefined,
  );
  const confidence = (top?.Confidence ?? 0) / 100;
  return {
    unsafeProbability: confidence,
    verdict: confidence >= 0.5 ? "unsafe" : "safe",
    topLabel: top?.Name,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: MODELS.rekognition.usdPerImage,
  };
}

async function decisionModel(
  model: "clef-flash" | "jev",
  dataUrl: string,
  credentials: Credentials,
  base: typeof fetch,
): Promise<Omit<Moderation, "latencyMs">> {
  let adapter: AnyEvaluateAdapter;
  let state: unknown = STATE;
  if (model === "jev") {
    if (!credentials.openRouterApiKey) {
      throw new Error("jev needs OPENROUTER_API_KEY");
    }
    adapter = createOpenRouterDecider(
      MODELS.jev.id,
      credentials.openRouterApiKey,
    );
    // OpenRouter reads images as image_url parts anywhere in `state`.
    state = [STATE, { type: "image_url", image_url: { url: dataUrl } }];
  } else {
    if (!credentials.cloudflare) {
      throw new Error("clef-flash needs CLOUDFLARE_ACCOUNT_ID/API_TOKEN");
    }
    adapter = createCloudflareDecider(MODELS["clef-flash"].id, {
      ...credentials.cloudflare,
      fetch: clefFetch([dataUrl], base),
    });
  }
  const { meta, category, verdict } = await decide({
    adapter,
    state: state as string,
    questions: decisionQuestions,
  });
  const input = meta.usage.promptTokens;
  const output = meta.usage.completionTokens;
  return {
    category: category.value,
    unsafeProbability: verdict.probabilities.unsafe ?? 0,
    verdict: verdict.value,
    inputTokens: input,
    outputTokens: output,
    costUsd: cost(model, input, output),
  };
}

const ChatAnswer = z.object({
  category: z.enum(CATEGORY_IDS as [Category, ...Category[]]),
  verdict: z.enum(["safe", "unsafe"]),
  unsafe_probability: z.number(),
});

/** One client per fetch implementation, so connections are reused. */
const anthropicClients = new WeakMap<typeof fetch, Anthropic>();

async function haiku(
  dataUrl: string,
  credentials: Credentials,
  base: typeof fetch,
): Promise<Omit<Moderation, "latencyMs">> {
  if (!credentials.anthropicApiKey) {
    throw new Error("haiku-5.5 needs ANTHROPIC_API_KEY");
  }
  let anthropic = anthropicClients.get(base);
  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: credentials.anthropicApiKey,
      maxRetries: 6,
      fetch: base,
    });
    anthropicClients.set(base, anthropic);
  }
  const response = await anthropic.messages.parse({
    model: MODELS["haiku-5.5"].id,
    max_tokens: 256,
    // A single-pass classifier, like the decision models: no thinking.
    thinking: { type: "disabled" },
    output_config: { effort: "low", format: zodOutputFormat(ChatAnswer) },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: dataUrl.slice(dataUrl.indexOf(",") + 1),
            },
          },
          { type: "text", text: CHAT_PROMPT },
        ],
      },
    ],
  });
  const input = response.usage.input_tokens;
  const output = response.usage.output_tokens;
  const usage = {
    inputTokens: input,
    outputTokens: output,
    costUsd: cost("haiku-5.5", input, output),
  };
  const answer = response.parsed_output;
  if (response.stop_reason === "refusal" || !answer) {
    return { ...usage, unsafeProbability: 1, verdict: "unsafe", refused: true };
  }
  return {
    ...usage,
    category: answer.category,
    unsafeProbability: Math.min(1, Math.max(0, answer.unsafe_probability)),
    verdict: answer.verdict,
  };
}

/** Asks one model for the image's category and P(unsafe), timing the call. */
export async function moderateImage(
  dataUrl: string,
  credentials: Credentials,
  model: ModelName,
  base: typeof fetch = fetch,
): Promise<Moderation> {
  const started = performance.now();
  const result =
    model === "haiku-5.5"
      ? await haiku(dataUrl, credentials, base)
      : model === "rekognition"
        ? await rekognition(dataUrl, credentials)
        : await decisionModel(model, dataUrl, credentials, base);
  return { ...result, latencyMs: performance.now() - started };
}
