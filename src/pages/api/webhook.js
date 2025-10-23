// src/pages/api/webhook.js
import { sendText, sendTyping, markRead } from '../../lib/waba';

// Environment validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROJECT = process.env.OPENAI_PROJECT;
const WORKFLOW_ID = process.env.WORKFLOW_ID;

// Debug environment variables
console.log('[ENV DEBUG] Available env vars:', {
  OPENAI_PROJECT: OPENAI_PROJECT ? 'SET' : 'MISSING',
  OPENAI_API_KEY: OPENAI_API_KEY ? 'SET' : 'MISSING',
  WORKFLOW_ID: WORKFLOW_ID ? 'SET' : 'MISSING',
  VERIFY_TOKEN: VERIFY_TOKEN ? 'SET' : 'MISSING'
});

if (!OPENAI_PROJECT) throw new Error('Missing env: OPENAI_PROJECT');
if (!WORKFLOW_ID) throw new Error('Missing env: WORKFLOW_ID');

// create OpenAI client once
import OpenAI from "openai";
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT,
});

// Call the Responses API with a workflow (no assistants/runs, no chat/completions)
export async function callWorkflow(userText, meta = {}) {
  const r = await client.responses.create({
    workflow_id: process.env.WORKFLOW_ID,     // <- your wf_... id
    // version: process.env.WORKFLOW_VERSION, // optional (else uses production)
    input: userText,
    metadata: { channel: "whatsapp", ...meta },
  });

  // Responses API result — do NOT read r.runs or r.choices
  const text =
    r.output_text ??
    (Array.isArray(r.output)
      ? r.output
          .map(p => p.content?.[0]?.text?.value)
          .filter(Boolean)
          .join("\n")
      : "");

  return text || "البيانات غير متاحة حالياً. جرّب: price BTCUSDT";
}

// Extract message from webhook payload
function extractMessage(payload) {
  try {
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    
    if (messages && messages.length > 0) {
      const message = messages[0];
      const contacts = value?.contacts?.[0];
      
      return {
        id: message.id,
        from: message.from,
        text: message.text?.body || '',
        timestamp: message.timestamp,
        contactName: contacts?.profile?.name || 'Unknown'
      };
    }
  } catch (error) {
    console.error('[WABA] Error extracting message:', error);
  }
  
  return null;
}

// Polite guardrail for insults
function polite(reply, userText) {
  if (/[^\w](حمار|غبي|يا حيوان|fuck|idiot)/i.test(userText)) {
    return 'أنا هنا للمساعدة. دعنا نركّز على سؤالك لنقدّم لك أفضل إجابة.';
  }
  return reply;
}

export default async function handler(req, res) {
  console.log('[WABA] hit', new Date().toISOString());

  // Handle webhook verification (GET request)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[WABA] Verification attempt:', { mode, token: token ? 'provided' : 'missing', challenge });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WABA] Verification successful');
      return res.status(200).send(challenge);
    }

    console.log('[WABA] Verification failed');
    return res.status(403).send('Forbidden');
  }

  // Handle incoming messages (POST request)
  if (req.method === 'POST') {
    try {
      // Ignore non-message webhooks
      if (!req.body?.entry?.[0]?.changes?.[0]?.value?.messages) {
        console.log('[WABA] Non-message event (status/delivery), ignoring');
        return res.status(200).end();
      }
      
      console.log('[WABA] Payload:', JSON.stringify(req.body, null, 2));
      
      const message = extractMessage(req.body);
      
      if (!message) {
        console.log('[WABA] No message found in payload');
        return res.status(200).json({ received: true });
      }

      console.log('[WABA] Processing message:', {
        id: message.id,
        from: message.from,
        text: message.text,
        contactName: message.contactName
      });

      // Mark message as read (best effort)
      try {
        await markRead(message.id);
      } catch (error) {
        console.warn('[WABA] mark read failed (ignored):', error.message);
      }

      // Send typing indicator (hardened - ignore failures)
      try {
        await sendTyping(message.from);
      } catch (error) {
        console.warn('[WABA] typing 400 ignored');
      }

      // Process message - always route to workflow
      if (message.text.trim()) {
        try {
          const text = message.text.trim();
          console.log('[WABA] Calling workflow for:', text);
          
          const answer = await callWorkflow(text, { 
            user_id: message.from,
            contact_name: message.contactName 
          });
          
          const politeAnswer = polite(answer, text);
          await sendText(message.from, politeAnswer);
          console.log('[WABA] reply sent', { to: message.from, kind: 'workflow' });
        } catch (error) {
          console.error('[WABA] Processing error:', error);
          await sendText(message.from, 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.');
        }
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('[WABA] Webhook processing error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Method not allowed
  return res.status(405).send('Method not allowed');
}