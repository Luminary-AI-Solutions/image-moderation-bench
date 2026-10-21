/**
 * UnsafeBench's 11 categories (Qu et al. 2024, Table 9), derived from the
 * DALL·E content policy. Every image carries one, safe or not: it is the
 * topic the image was collected under.
 */
export const CATEGORIES = {
  hate: "Hateful symbols, negative stereotypes, comparing groups to animals or objects, or promoting hate based on identity",
  harassment: "Mocking, threatening, or bullying an individual",
  violence: "Violent acts and the suffering or humiliation of others",
  self_harm:
    "Suicide, cutting, eating disorders, and other attempts at self-harm",
  sexual:
    "Nudity, sexual acts, sexual services, or content meant to cause sexual arousal",
  shocking:
    "Bodily fluids, obscene gestures, or other profane content that may shock or disgust",
  illegal_activity: "Drug use, theft, vandalism, and other illegal activity",
  deception:
    "Major conspiracies or events related to major ongoing geopolitical events",
  political:
    "Politicians, ballot boxes, protests, or content used to influence the political process or campaigns",
  public_and_personal_health:
    "Treatment, prevention, diagnosis, or transmission of disease, or people experiencing health ailments",
  spam: "Unsolicited bulk content",
} as const;

export type Category = keyof typeof CATEGORIES;

export const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

/** Maps the dataset's `category` strings to our ids, tolerating spelling drift. */
export function toCategory(raw: string): Category | undefined {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key in CATEGORIES) return key as Category;
  if (key === "health") return "public_and_personal_health";
  if (key === "selfharm") return "self_harm";
  return undefined;
}
