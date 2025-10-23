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
const WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID || '';
const USE_WORKFLOW = (process.env.USE_WORKFLOW || '').toLowerCase() === 'true';
const AGENT_ID = process.env.AGENT_ID || '';
const OPENAI_PROJECT = process.env.OPENAI_PROJECT;

if (!OPENAI_PROJECT) throw new Error('Missing env: OPENAI_PROJECT');
if (!AGENT_ID && !(USE_WORKFLOW && WORKFLOW_ID)) {
  console.warn('[CFG] Neither AGENT_ID nor WORKFLOW_ID active; will use plain model');
}

// create OpenAI client once
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, project: OPENAI_PROJECT });

// Conversational fallback (no workflow)
async function runConversational(text) {
  // Prefer Agent if set
  if (AGENT_ID) {
    try {
      const r = await client.responses.create({ agent: AGENT_ID, input: text });
      return r.output_text || 'تم.';
    } catch (error) {
      console.warn('[AGENT] Agent failed, using model fallback:', error.message);
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
            let answer;
            try {
              // if you really want workflow later, guard it:
              if (USE_WORKFLOW && WORKFLOW_ID) {
                // TODO: only re-enable after you align input schema with the workflow
                // const r = await client.responses.create({ workflow: { id: WORKFLOW_ID }, input: { text } });
                // answer = r.output_text;
                throw new Error('Workflow disabled until schema aligned');
              } else {
                answer = await runConversational(message.text);
              }
            } catch (e) {
              console.error('[AGENT] error', e?.message || e);
              // final safety fallback
              answer = 'عذرًا، حدث خطأ أثناء معالجة طلبك. هل يمكن إعادة الصياغة؟';
            }
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
