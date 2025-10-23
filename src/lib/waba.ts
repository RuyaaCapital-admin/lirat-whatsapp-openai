// src/lib/waba.ts
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_TOKEN;

if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
  throw new Error('Missing required WhatsApp environment variables: WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TOKEN');
}

const baseUrl = `https://graph.facebook.com/${WHATSAPP_VERSION}`;

async function makeRequest(endpoint: string, payload: any, retries = 1): Promise<any> {
  const url = `${baseUrl}/${PHONE_NUMBER_ID}/${endpoint}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        return await response.json();
      }

      // Retry on 5xx errors
      if (response.status >= 500 && attempt < retries) {
        console.log(`[WABA] Retrying request (attempt ${attempt + 1})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      const error = await response.text();
      console.error(`[WABA] API error: ${response.status} ${error}`);
      throw new Error(`WhatsApp API error: ${response.status}`);
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export async function sendText(to: string, body: string): Promise<void> {
  const payload = {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body }
  };

  await makeRequest('messages', payload);
  console.log('[WABA] reply sent', { to, kind: 'text' });
}

export async function sendTyping(messageId: string): Promise<void> {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: {
        type: 'text'
      }
    };

    await makeRequest('messages', payload);
    console.log('[WABA] typing indicator sent for message:', messageId);
  } catch (error) {
    console.warn('[WABA] typing indicator failed (ignored):', error);
  }
}

export async function markReadAndShowTyping(messageId: string): Promise<void> {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
      typing_indicator: {
        type: 'text'
      }
    };

    await makeRequest('messages', payload);
    console.log('[WABA] message marked as read and typing indicator sent:', messageId);
  } catch (error) {
    console.warn('[WABA] mark read + typing failed (ignored):', error);
  }
}
