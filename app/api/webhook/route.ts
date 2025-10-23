// app/api/webhook/route.ts
import { sendText, sendTyping, markRead } from '../../../lib/waba';
import { callAgent } from '../../../lib/agent-wrapper';
import { getLivePrice, hasPriceIntent } from '../../../src/tools/livePrice';

// Environment validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
if (!VERIFY_TOKEN) {
  throw new Error('Missing required environment variable: VERIFY_TOKEN');
}

// Extract message from webhook payload
function extractMessage(payload: any) {
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

export async function GET(req: Request) {
  console.log('[WABA] webhook hit', new Date().toISOString());
  
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  console.log('[WABA] Verification attempt:', { mode, token: token ? 'provided' : 'missing', challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[WABA] Verification successful');
    return new Response(challenge, { status: 200 });
  }

  console.log('[WABA] Verification failed');
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  console.log('[WABA] webhook hit', new Date().toISOString());
  
  try {
    const payload = await req.json();
    console.log('[WABA] Payload:', JSON.stringify(payload, null, 2));
    
    const message = extractMessage(payload);
    
    if (!message) {
      console.log('[WABA] No message found in payload');
      return Response.json({ received: true }, { status: 200 });
    }

    console.log('[WABA] Processing message:', {
      id: message.id,
      from: message.from,
      text: message.text,
      contactName: message.contactName
    });

    // Mark message as read (best effort)
    await markRead(message.id);

    // Send typing indicator (ignore failures)
    await sendTyping(message.from);

    // Process message
    if (message.text.trim()) {
      try {
        let responseText = '';

        // Check if it's a price intent
        if (hasPriceIntent(message.text)) {
          console.log('[WABA] Price intent detected');
          
          // Extract symbol from text
          const words = message.text.toLowerCase().split(/\s+/);
          const symbolCandidates = words.filter(word => 
            word.match(/^[a-z]{3,6}$/) || 
            ['gold', 'silver', 'oil', 'btc', 'eth', 'eur', 'gbp', 'jpy', 'chf', 'cad', 'aud', 'nzd'].includes(word)
          );
          
          const symbol = symbolCandidates[0] || 'XAUUSD'; // Default to gold
          
          const priceData = await getLivePrice(symbol);
          
          if (priceData) {
            responseText = `Time (UTC): ${priceData.timeUtc}\nSymbol: ${priceData.symbol}\nPrice: ${priceData.price}\nSource: ${priceData.source}`;
            console.log('[WABA] reply sent', { to: message.from, kind: 'price' });
          } else {
            responseText = 'عذراً، لم أتمكن من الحصول على السعر حالياً. يرجى المحاولة مرة أخرى.';
          }
        } else {
          // Use agent for non-price requests
          console.log('[WABA] Agent intent detected');
          responseText = await callAgent(message.text);
          console.log('[WABA] reply sent', { to: message.from, kind: 'agent' });
        }

        // Send response
        await sendText(message.from, responseText);
      } catch (error) {
        console.error('[WABA] Processing error:', error);
        await sendText(message.from, 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.');
      }
    }

    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('[WABA] Webhook processing error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
