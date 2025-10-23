// src/pages/api/webhook.js
import { sendText, sendTyping, markRead } from '../../lib/waba';
import { getLivePrice } from '../../tools/livePrice';

// Environment validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FCS_API_KEY = process.env.FCS_API_KEY;
const WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID || process.env.WORKFLOW_ID || '';
const USE_WORKFLOW = (process.env.USE_WORKFLOW || 'true').toLowerCase() === 'true'; // Default to true since we have workflow
const OPENAI_PROJECT = process.env.OPENAI_PROJECT_ID || process.env.OPENAI_PROJECT;

// Debug environment variables
console.log('[ENV DEBUG] Available env vars:', {
  OPENAI_PROJECT: OPENAI_PROJECT ? 'SET' : 'MISSING',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'SET' : 'MISSING',
  OPENAI_WORKFLOW_ID: process.env.OPENAI_WORKFLOW_ID ? 'SET' : 'MISSING',
  VERIFY_TOKEN: process.env.VERIFY_TOKEN ? 'SET' : 'MISSING'
});

if (!OPENAI_PROJECT) throw new Error('Missing env: OPENAI_PROJECT');
if (!WORKFLOW_ID) {
  console.warn('[CFG] No WORKFLOW_ID set; will use plain model');
}

// create OpenAI client once
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, project: OPENAI_PROJECT });

// Conversational function using workflow
async function runConversational(text) {
  // Use Workflow if available
  if (WORKFLOW_ID && USE_WORKFLOW) {
    try {
      console.log('[WORKFLOW] Calling workflow:', WORKFLOW_ID);
      // Use the correct OpenAI SDK method for workflows
      const r = await client.beta.workflows.runs.create({
        workflow_id: WORKFLOW_ID,
        input: text
      });
      
      // Wait for completion and get result
      const result = await client.beta.workflows.runs.retrieve(r.id);
      return result.output || 'تم.';
    } catch (error) {
      console.warn('[WORKFLOW] Workflow failed, using model fallback:', error.message);
    }
  }
  
  // Plain model fallback (conversational, bilingual)
  const sys = `أنت مساعد محادثي لِـ Lirat: افهم نية المستخدم (سعر/رمز/تداول أو أسئلة عامة عن Lirat).
- إذا كان السؤال عن رمز أو تداول، لا تكتب كود؛ فقط اطلب الرمز/الإطار الزمني أو استخدم البيانات المتاحة.
- إذا كان سؤالًا عامًا، أجب بإيجاز ووضوح بالعربية.
- كن محادثي وودود، لا آلي.`;
  
  const r = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ],
    max_tokens: 500,
    temperature: 0.7
  });
  
  return r.choices[0]?.message?.content || 'تم.';
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

// Detect price intent
function hasPriceIntent(text) {
  const priceKeywords = [
    'price', 'سعر', 'gold', 'silver', 'oil', 'btc', 'eth', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud', 'nzd',
    'xau', 'xag', 'ذهب', 'فضة', 'نفط', 'بيتكوين', 'إيثيريوم', 'يورو', 'ين', 'فرنك', 'جنيه', 'دولار'
  ];
  const lowerText = text.toLowerCase();
  return priceKeywords.some(keyword => lowerText.includes(keyword));
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

      // Process message
      if (message.text.trim()) {
        try {
          let responseText = '';

          // Check if it's a price intent
          if (hasPriceIntent(message.text)) {
            console.log('[WABA] price intent detected');
            
            // Extract symbol from text
            const words = message.text.toLowerCase().split(/\s+/);
            const symbolCandidates = words.filter(word => 
              word.match(/^[a-z]{3,6}$/) || 
              ['gold', 'silver', 'oil', 'btc', 'eth', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud', 'nzd', 'xau', 'xag'].includes(word)
            );
            
            const symbol = symbolCandidates[0] || 'XAUUSD'; // Default to gold
            
            const priceData = await getLivePrice(symbol);
            
            if (priceData) {
              responseText = `Time (UTC): ${priceData.timeUtc}\nSymbol: ${priceData.symbol}\nPrice: ${priceData.price}\nSource: ${priceData.source}`;
              console.log('[WABA] price', { symbol: priceData.symbol, source: priceData.source, timeUtc: priceData.timeUtc });
              console.log('[WABA] reply sent', { to: message.from, kind: 'price' });
            } else {
              responseText = 'عذراً، لم أتمكن من الحصول على السعر حالياً. يرجى المحاولة مرة أخرى.';
            }
          } else {
            // Use conversational agent for non-price requests
            console.log('[WABA] agent intent detected');
            const answer = await runConversational(message.text);
            responseText = answer;
            console.log('[WABA] agent');
            console.log('[WABA] reply sent', { to: message.from, kind: 'agent' });
          }

          // Send response
          await sendText(message.from, responseText);
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
