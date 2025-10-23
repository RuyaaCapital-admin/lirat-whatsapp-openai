// src/pages/api/webhook.ts
import { sendText, sendTyping, markRead } from '../../lib/waba';
import { callAgent } from '../../lib/agent';
import { getLivePrice, hasPriceIntent } from '../../tools/livePrice';
import { NextApiRequest, NextApiResponse } from 'next';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('[WABA] webhook hit', new Date().toISOString());

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

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('[WABA] Webhook processing error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Method not allowed
  return res.status(405).send('Method not allowed');
}
