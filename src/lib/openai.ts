// src/lib/openai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

export const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT  // Required for project-scoped workflows
});
