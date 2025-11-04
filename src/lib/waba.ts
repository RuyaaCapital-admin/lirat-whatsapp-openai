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

export async function sendWhatsApp(to: string, body: string): Promise<void> {
  await sendText(to, body);
}

// --- Media helpers (WhatsApp Cloud API) ---
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media/

type MediaMeta = { url: string; mimeType: string; sha256?: string };

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMediaMeta(mediaId: string): Promise<MediaMeta> {
  const id = String(mediaId || "").trim();
  if (!id) throw new Error("invalid_media_id");
  const url = `${baseUrl}/${id}`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error: any = new Error(`media_meta_error:${res.status}`);
    error.status = res.status;
    error.responseBody = text;
    throw error;
  }
  const data: any = await res.json();
  const directUrl = data?.url;
  const mime = data?.mime_type;
  if (typeof directUrl !== 'string' || !directUrl || typeof mime !== 'string' || !mime) {
    throw new Error('invalid_media_meta');
  }
  const out: MediaMeta = { url: directUrl, mimeType: mime };
  if (typeof data?.sha256 === 'string' && data.sha256) out.sha256 = data.sha256;
  return out;
}

const DEFAULT_ALLOWED_MIME = (process.env.WABA_MEDIA_ALLOWED_MIME || 'image/jpeg,image/png,image/webp')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export async function downloadMediaBase64(mediaId: string, maxBytes = Number(process.env.WABA_MEDIA_MAX_BYTES || 8_000_000)) {
  const meta = await getMediaMeta(mediaId);
  if (!DEFAULT_ALLOWED_MIME.includes(meta.mimeType)) {
    throw new Error(`unsupported_mime:${meta.mimeType}`);
  }

  const res = await fetchWithTimeout(meta.url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error: any = new Error(`media_download_error:${res.status}`);
    error.status = res.status;
    error.responseBody = text;
    throw error;
  }
  const lenHeader = res.headers.get('content-length');
  if (lenHeader && Number(lenHeader) > 0 && Number(lenHeader) > maxBytes) {
    throw new Error('media_too_large');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error('media_too_large');
  }
  const base64 = buffer.toString('base64');
  return { base64, mimeType: meta.mimeType } as const;
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
