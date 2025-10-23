// src/pages/api/ping.js
// Environment verification endpoint
import { openai } from '../../lib/openai';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const envStatus = {
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    OPENAI_WORKFLOW_ID: Boolean(process.env.OPENAI_WORKFLOW_ID),
    WHATSAPP_TOKEN: Boolean(process.env.WHATSAPP_TOKEN),
    WHATSAPP_PHONE_NUMBER_ID: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
    VERIFY_TOKEN: Boolean(process.env.VERIFY_TOKEN),
    FCS_API_KEY: Boolean(process.env.FCS_API_KEY),
    FMP_API_KEY: Boolean(process.env.FMP_API_KEY)
  };

  // Show actual values for debugging (but mask sensitive data)
  const envValues = {
    OPENAI_WORKFLOW_ID: process.env.OPENAI_WORKFLOW_ID ? 
      (process.env.OPENAI_WORKFLOW_ID.startsWith('wf_') ? 'SET (wf_...)' : `SET (${process.env.OPENAI_WORKFLOW_ID})`) : 
      'MISSING',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'SET' : 'MISSING',
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN ? 'SET' : 'MISSING',
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ? 'SET' : 'MISSING',
    VERIFY_TOKEN: process.env.VERIFY_TOKEN ? 'SET' : 'MISSING',
    FCS_API_KEY: process.env.FCS_API_KEY ? 'SET' : 'MISSING',
    FMP_API_KEY: process.env.FMP_API_KEY ? 'SET' : 'MISSING'
  };

  // Test OpenAI connection
  let openaiTest = { ok: false, error: null };
  try {
    await openai.responses.create({ 
      model: "gpt-4o-mini", 
      input: [{ role: "user", content: "ping" }] 
    });
    openaiTest = { ok: true, error: null };
  } catch (error) {
    openaiTest = { ok: false, error: error.message };
  }

  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: envStatus,
    values: envValues,
    openaiTest,
    message: 'Environment verification endpoint'
  });
}
