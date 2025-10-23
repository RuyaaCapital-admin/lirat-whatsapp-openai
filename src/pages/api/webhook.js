// src/pages/api/webhook.js
import { runWorkflow } from '../../lib/agent';

// WhatsApp API configuration
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// WhatsApp API helper functions
async function sendWhatsAppMessage(to, message) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('WhatsApp configuration missing');
    return;
  }

  const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: {
      body: message
    }
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('WhatsApp API error:', response.status, error);
    } else {
      console.log('Message sent successfully to', to);
    }
  } catch (error) {
    console.error('Failed to send WhatsApp message:', error);
  }
}

async function markMessageAsRead(messageId) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    return;
  }

  const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${PHONE_NUMBER_ID}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  };

  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Failed to mark message as read:', error);
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
    console.error('Error extracting message:', error);
  }
  
  return null;
}

export default function handler(req, res) {
  console.log('Webhook received:', req.method, new Date().toISOString());

  // Handle webhook verification (GET request)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('Verification attempt:', { mode, token: token ? 'provided' : 'missing', challenge });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verification successful');
      return res.status(200).send(challenge);
    }

    console.log('Webhook verification failed');
    return res.status(403).send('Forbidden');
  }

  // Handle incoming messages (POST request)
  if (req.method === 'POST') {
    try {
      console.log('Webhook payload:', JSON.stringify(req.body, null, 2));
      
      const message = extractMessage(req.body);
      
      if (!message) {
        console.log('No valid message found in payload');
        return res.status(200).json({ received: true });
      }

      console.log('Processing message:', {
        id: message.id,
        from: message.from,
        text: message.text,
        contactName: message.contactName
      });

      // Mark message as read
      await markMessageAsRead(message.id);

      // Process message with agent
      if (message.text.trim()) {
        try {
          console.log('Sending to agent:', message.text);
          const agentResult = await runWorkflow({ input_as_text: message.text });
          
          if (agentResult && agentResult.output_text) {
            console.log('Agent response:', agentResult.output_text);
            await sendWhatsAppMessage(message.from, agentResult.output_text);
          } else {
            console.log('No response from agent');
            await sendWhatsAppMessage(message.from, 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.');
          }
        } catch (agentError) {
          console.error('Agent processing error:', agentError);
          await sendWhatsAppMessage(message.from, 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.');
        }
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Method not allowed
  return res.status(405).send('Method not allowed');
}
