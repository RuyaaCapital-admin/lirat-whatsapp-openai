// app/api/webhook/route.ts
import { runAgent } from '../../../lib/agent';
import { wabaText, wabaTyping } from '../../../src/waba';

const WA_VER = process.env.WHATSAPP_VERSION || 'v24.0';
const WA_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TOKEN = process.env.WHATSAPP_TOKEN || '';
const GRAPH_URL = WA_ID ? `https://graph.facebook.com/${WA_VER}/${WA_ID}/messages` : '';

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
}

interface WhatsAppWebhookPayload {
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messages?: WhatsAppMessage[];
        statuses?: Array<{
          id: string;
          status: string;
        }>;
      };
    }>;
  }>;
}

async function markMessageAsRead(messageId: string) {
  if (!GRAPH_URL || !TOKEN) return;
  
  try {
    await fetch(GRAPH_URL, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${TOKEN}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      })
    });
  } catch (error) {
    console.error('Failed to mark message as read:', error);
  }
}

function extractMessages(payload: WhatsAppWebhookPayload): WhatsAppMessage[] {
  const messages: WhatsAppMessage[] = [];
  
  if (!Array.isArray(payload?.entry)) return messages;
  
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    
    for (const change of entry.changes) {
      if (Array.isArray(change?.value?.messages)) {
        messages.push(...change.value.messages);
      }
    }
  }
  
  return messages;
}

function isValidMessage(message: any): message is WhatsAppMessage {
  return (
    message &&
    typeof message.id === 'string' &&
    typeof message.from === 'string' &&
    typeof message.timestamp === 'string' &&
    typeof message.type === 'string'
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const verifyToken = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    
    if (mode === 'subscribe' && verifyToken === process.env.VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      return new Response(challenge || '', { 
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    
    console.log('Webhook verification failed:', { mode, verifyToken: verifyToken ? '***' : 'missing' });
    return new Response('Forbidden', { status: 403 });
  } catch (error) {
    console.error('Webhook verification error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Parse the webhook payload
    const payload: WhatsAppWebhookPayload = await req.json();
    console.log('Received webhook payload:', JSON.stringify(payload, null, 2));
    
    // Extract messages from the payload
    const messages = extractMessages(payload);
    
    if (messages.length === 0) {
      console.log('No messages found in webhook payload');
      return new Response(JSON.stringify({ received: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Process each message
    for (const message of messages) {
      if (!isValidMessage(message)) {
        console.log('Invalid message format:', message);
        continue;
      }
      
      // Only process text messages
      if (message.type !== 'text' || !message.text?.body) {
        console.log('Skipping non-text message:', message.type);
        continue;
      }
      
      const userMessage = message.text.body.trim();
      const phoneNumber = message.from;
      
      console.log(`Processing message from ${phoneNumber}: ${userMessage}`);
      
      try {
        // Mark message as read
        await markMessageAsRead(message.id);
        
        // Show typing indicator
        await wabaTyping(phoneNumber, true);
        
        // Process message with the trading agent
        let response: string;
        try {
          response = await runAgent(userMessage);
        } catch (agentError) {
          console.error('Agent processing error:', agentError);
          response = 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.';
        }
        
        // Send response
        await wabaText(phoneNumber, response);
        
        // Hide typing indicator
        await wabaTyping(phoneNumber, false);
        
        console.log(`Response sent to ${phoneNumber}: ${response.substring(0, 100)}...`);
        
      } catch (error) {
        console.error(`Error processing message from ${phoneNumber}:`, error);
        
        // Send error message to user
        try {
          await wabaText(phoneNumber, 'عذراً، حدث خطأ في النظام. يرجى المحاولة لاحقاً.');
        } catch (sendError) {
          console.error('Failed to send error message:', sendError);
        }
      }
    }
    
    return new Response(JSON.stringify({ received: true }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
