// src/pages/api/webhook.js
import { sendText, sendTyping, markRead } from '../../lib/waba';
import OpenAI from 'openai';
import { parseIntent } from '../../src/tools/symbol';
import { get_price, get_ohlc, compute_trading_signal } from '../../src/tools/agentTools';

// Environment validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_PROJECT = process.env.OPENAI_PROJECT;
const OPENAI_WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID;

// Debug environment variables
console.log('[ENV DEBUG] Available env vars:', {
  OPENAI_PROJECT: OPENAI_PROJECT ? 'SET' : 'MISSING',
  OPENAI_WORKFLOW_ID: OPENAI_WORKFLOW_ID ? 'SET' : 'MISSING',
  OPENAI_API_KEY: OPENAI_API_KEY ? 'SET' : 'MISSING',
  VERIFY_TOKEN: VERIFY_TOKEN ? 'SET' : 'MISSING'
});

if (!OPENAI_API_KEY) throw new Error('Missing env: OPENAI_API_KEY');
if (!OPENAI_PROJECT) throw new Error('Missing env: OPENAI_PROJECT');

// Initialize OpenAI client
const client = new OpenAI({
  apiKey: OPENAI_API_KEY,
  project: OPENAI_PROJECT,
});

// System prompt for fallback
const SYSTEM_PROMPT = `أنت مساعد Lirat الذكي. أنت متخصص في:
1. أسعار العملات والمعادن (ذهب، فضة، فوركس، كريبتو)
2. إشارات التداول والتحليل الفني
3. معلومات عن شركة Lirat

عندما يطلب المستخدم سعر أو إشارة، استخدم الأدوات المتاحة.
للاستفسارات الأخرى عن Lirat، قدم معلومات مفيدة ومهنية.

أجب بالعربية دائماً.`;

// Try workflow first, then fallback to tools + model
async function smartReply(userText, meta = {}) {
  try {
    // Try workflow first if available
    if (OPENAI_WORKFLOW_ID && client.workflows?.runs?.create) {
      console.log('[WORKFLOW] Using SDK workflow method');
      const run = await client.workflows.runs.create({
        workflow_id: OPENAI_WORKFLOW_ID,
        input: userText,
        metadata: { channel: "whatsapp", ...meta }
      });
      
      const text = run.output_text ?? 
                  (Array.isArray(run.output) ? 
                    run.output.map(p => p.content?.[0]?.text?.value).filter(Boolean).join("\n") : 
                    "");
      
      if (text) {
        console.log('[WORKFLOW] Success via SDK');
        return text;
      }
    }
  } catch (err) {
    console.warn('[WORKFLOW] SDK method failed, trying fallback:', err?.message);
  }

  // Fallback: Use our tools directly
  console.log('[FALLBACK] Using direct tools + model');
  
  const intent = parseIntent(userText);
  console.log('[FALLBACK] Parsed intent:', intent);
  
  // Handle price requests
  if (intent.wantsPrice && intent.symbol) {
    try {
      const result = await get_price(intent.symbol, intent.timeframe);
      return result.text;
    } catch (error) {
      console.error('[FALLBACK] Price tool error:', error);
    }
  }
  
  // Handle signal requests
  if (intent.symbol && /signal|إشارة|تداول|trade/i.test(userText)) {
    try {
      const result = await compute_trading_signal(intent.symbol, intent.timeframe || '1hour');
      return result.text;
    } catch (error) {
      console.error('[FALLBACK] Signal tool error:', error);
    }
  }
  
  // Handle OHLC requests
  if (intent.symbol && intent.timeframe) {
    try {
      const result = await get_ohlc(intent.symbol, intent.timeframe);
      return result.text;
    } catch (error) {
      console.error('[FALLBACK] OHLC tool error:', error);
    }
  }
  
  // Final fallback: Use model directly
  try {
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText }
      ],
    });
    
    const text = resp.output_text ?? 
                (Array.isArray(resp.output) ? 
                  resp.output.map(p => p.content?.[0]?.text?.value).filter(Boolean).join("\n") : 
                  "");
    
    return text || "عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.";
  } catch (error) {
    console.error('[FALLBACK] Model error:', error);
    return "عذراً، حدث خطأ في النظام. يرجى المحاولة مرة أخرى.";
  }
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

      // Process message - use smart reply with fallbacks
      if (message.text.trim()) {
        try {
          const text = message.text.trim();
          console.log('[WABA] Processing message:', text);
          
          const answer = await smartReply(text, { 
            user_id: message.from,
            contact_name: message.contactName 
          });
          
          const politeAnswer = polite(answer, text);
          await sendText(message.from, politeAnswer);
          console.log('[WABA] Reply sent successfully');
        } catch (error) {
          console.error('[WABA] Processing error:', error);
          await sendText(message.from, `عذراً، حدث خطأ في معالجة طلبك: ${error.message}. يرجى المحاولة مرة أخرى.`);
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