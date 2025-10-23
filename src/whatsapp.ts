// WhatsApp API helpers using native fetch
const WA_VER = process.env.WHATSAPP_VERSION || 'v24.0';
const WA_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const TOKEN = process.env.WHATSAPP_TOKEN || '';
const GRAPH_URL = WA_ID ? `https://graph.facebook.com/${WA_VER}/${WA_ID}/messages` : '';

export async function markRead(messageId: string): Promise<void> {
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

export async function typing(to: string): Promise<void> {
  if (!GRAPH_URL || !TOKEN) return;
  
  try {
    const response = await fetch(GRAPH_URL, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${TOKEN}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'typing',
        typing: { status: 'typing' }
      })
    });
    
    if (response.status === 400) {
      console.warn('Typing indicator not supported for this number (400)');
      return;
    }
    
    if (!response.ok) {
      console.warn(`Typing indicator failed with status ${response.status}`);
    }
  } catch (error) {
    console.warn('Typing indicator error (non-critical):', error);
  }
}

export async function sendText(to: string, body: string): Promise<void> {
  if (!GRAPH_URL || !TOKEN) {
    throw new Error('WhatsApp configuration missing');
  }
  
  try {
    const response = await fetch(GRAPH_URL, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${TOKEN}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      })
    });
    
    if (!response.ok) {
      throw new Error(`WhatsApp API error: ${response.status}`);
    }
  } catch (error) {
    console.error('Failed to send message:', error);
    throw error;
  }
}