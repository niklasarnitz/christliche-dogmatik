import {
  GoogleGenAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/genai";

/**
 * Create a configured Google AI instance
 * @param apiKey The Google AI API key
 * @returns Configured GoogleGenAI instance
 */
export function createGoogleAI(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

/**
 * Standard safety settings for Google AI
 */
export const STANDARD_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

/**
 * Validate that the Google AI API key is available
 * @throws Error if API key is not set
 */
export function validateGoogleAIKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is required.");
  }
  return apiKey;
}
