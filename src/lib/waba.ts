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

      const text = await response.text();
      let parsed: any = text;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        void err;
      }
      const error: any = new Error(`WhatsApp API error: ${response.status}`);
      error.status = response.status;
      error.responseBody = parsed;
      throw error;
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

export async function sendText(to: string, body: string): Promise<void> {
  const recipient = (to ?? '').trim();
  if (!recipient) {
    console.warn('[WABA] skipped send: empty recipient');
    return;
  }
  let messageBody = typeof body === 'string' ? body : '';
  if (!messageBody.trim()) {
    const fallbackAr = 'البيانات غير متاحة حالياً.';
    const fallbackEn = 'Data unavailable right now.';
    const hasArabic = /[\u0600-\u06FF]/.test(body ?? '');
    messageBody = hasArabic ? fallbackAr : fallbackEn;
  }
  const payload = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'text',
    text: { body: messageBody }
  };

  const preview = messageBody.slice(0, 60);
  try {
    await makeRequest('messages', payload);
    console.log('[WABA] reply sent', { to: recipient, kind: 'text' });
  } catch (error) {
    const err: any = error;
    if (err?.status === 400) {
      console.warn('[WABA] sendText 400', { to: recipient, preview, error: err.responseBody ?? err.message });
      return;
    }
    throw error;
  }
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
