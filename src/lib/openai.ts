// src/lib/openai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const project = process.env.OPENAI_PROJECT;
if (!project) {
  throw new Error("Missing OPENAI_PROJECT");
}

const config: Record<string, any> = {
  apiKey: process.env.OPENAI_API_KEY!,
  project,
};

// Organization is optional; include if provided
if (process.env.OPENAI_ORG) {
  config.organization = process.env.OPENAI_ORG;
}

export const openai = new OpenAI(config);
