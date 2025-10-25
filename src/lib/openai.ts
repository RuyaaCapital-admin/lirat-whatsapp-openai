// src/lib/openai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const config: Record<string, any> = {
  apiKey: process.env.OPENAI_API_KEY!,
};

// Use official project/organization wiring when available (required for Workflows)
if (process.env.OPENAI_ORG) {
  config.organization = process.env.OPENAI_ORG;
}
if (process.env.OPENAI_PROJECT) {
  config.project = process.env.OPENAI_PROJECT;
}

export const openai = new OpenAI(config);
