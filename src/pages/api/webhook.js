// src/pages/api/webhook.js
import { sendText, markReadAndShowTyping } from '../../lib/waba';
import { openai } from '../../lib/openai';

// Environment validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID;

// Debug environment variables
console.log('[ENV DEBUG] Available env vars:', {
  OPENAI_WORKFLOW_ID: OPENAI_WORKFLOW_ID ? (OPENAI_WORKFLOW_ID.startsWith('wf_') ? 'SET (wf_...)' : `SET (${OPENAI_WORKFLOW_ID})`) : 'MISSING',
  VERIFY_TOKEN: VERIFY_TOKEN ? 'SET' : 'MISSING'
});

// System prompt for fallback
const SYSTEM_PROMPT = `أنت مساعد Lirat الذكي. أنت متخصص في:
1. أسعار العملات والمعادن (ذهب، فضة، فوركس، كريبتو)
2. إشارات التداول والتحليل الفني
3. معلومات عن شركة Lirat

عندما يطلب المستخدم سعر أو إشارة، استخدم الأدوات المتاحة.
للاستفسارات الأخرى عن Lirat، قدم معلومات مفيدة ومهنية.

أجب بالعربية دائماً.`;

// Use workflow ONLY - let AI understand naturally
async function smartReply(userText, meta = {}) {
  if (!OPENAI_WORKFLOW_ID) {
    console.error('[WORKFLOW] OPENAI_WORKFLOW_ID not set');
    return "عذراً، النظام غير متاح حالياً. يرجى المحاولة لاحقاً.";
  }

  try {
    console.log('[WORKFLOW] Calling workflow with input:', userText);
    
    // Try workflow first
    if (openai.workflows?.runs?.create) {
      console.log('[WORKFLOW] Using SDK workflow method');
      const run = await openai.workflows.runs.create({
        workflow_id: OPENAI_WORKFLOW_ID,
        input: userText,
        metadata: { channel: "whatsapp", ...meta }
      });
      
      console.log('[WORKFLOW] Run response:', JSON.stringify(run, null, 2));
      
      const text = run.output_text ?? 
                  (Array.isArray(run.output) ? 
                    run.output.map(p => p.content?.[0]?.text?.value).filter(Boolean).join("\n") : 
                    "");
      
      if (text) {
        console.log('[WORKFLOW] Success via SDK, response length:', text.length);
        return text;
      }
    }
    
    console.warn('[WORKFLOW] SDK workflow method not available');
    return "عذراً، النظام غير متاح حالياً. يرجى المحاولة لاحقاً.";
    
  } catch (err) {
    console.error('[WORKFLOW] Error:', err);
    
    // Tiny fallback for hard workflow failures (4xx/5xx)
    if (err.status >= 400) {
      console.log('[FALLBACK] Hard workflow failure, trying local tools');
      try {
        // Import tools dynamically to avoid circular deps
        const { hardMapSymbol, toTimeframe } = await import('../../tools/normalize');
        const { getCurrentPrice } = await import('../../tools/price');
        const { computeSignal } = await import('../../tools/compute_trading_signal');
        
        // Try to detect trading intent
        const symbol = hardMapSymbol(userText);
        if (symbol) {
          if (/price|سعر|كم/i.test(userText)) {
            const p = await getCurrentPrice(symbol);
            return `Time (UTC): ${new Date().toISOString().slice(11,16)}\nSymbol: ${symbol}\nPrice: ${p.price}\nNote: ${p.source}`;
          }
          if (/signal|إشارة|صفقة|تداول/i.test(userText)) {
            const tf = toTimeframe(userText);
            return await computeSignal(symbol, tf);
          }
        }
      } catch (fallbackErr) {
        console.error('[FALLBACK] Local tools also failed:', fallbackErr);
      }
    }
    
    return `عذراً، حدث خطأ في النظام: ${err.message}. يرجى المحاولة مرة أخرى.`;
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

      // Mark message as read and show typing indicator (single API call)
      try {
        await markReadAndShowTyping(message.id);
      } catch (error) {
        console.warn('[WABA] mark read + typing failed (ignored)');
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