// src/lib/openai.ts
import OpenAI from "openai";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY");
}

const config: Record<string, any> = {
  apiKey: process.env.OPENAI_API_KEY!,
};

// Organization is optional; include if provided
if (process.env.OPENAI_ORG) {
  config.organization = process.env.OPENAI_ORG;
}

// IMPORTANT: Do NOT set project by default — misconfigured project causes 401 invalid_project
// If you need to force project-based routing, set OPENAI_USE_PROJECT=true explicitly
if (process.env.OPENAI_USE_PROJECT === "true" && process.env.OPENAI_PROJECT) {
  config.project = process.env.OPENAI_PROJECT;
}

export const openai = new OpenAI(config);
