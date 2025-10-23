// Alternative typing indicator implementation
import axios from "axios";

const DEFAULT_WA_VERSION = "v24.0";

function getBaseUrl() {
  const version = process.env.WHATSAPP_VERSION || DEFAULT_WA_VERSION;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId) {
    throw new Error("WHATSAPP_PHONE_NUMBER_ID is not set");
  }
  return `https://graph.facebook.com/${version}/${phoneNumberId}`;
}

function getHeaders() {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) {
    throw new Error("WHATSAPP_TOKEN is not set");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  } as const;
}

// Alternative typing indicator with better error handling
export async function wabaTypingAlternative(phone: string, on: boolean) {
  try {
    // Clean phone number (remove any non-digits)
    const cleanPhone = phone.replace(/\D/g, '');
    
    const body = {
      messaging_product: "whatsapp",
      to: cleanPhone,
      type: "typing",
      typing: { 
        status: on ? "typing" : "paused" 
      },
    };
    
    const baseUrl = getBaseUrl();
    const response = await axios.post(`${baseUrl}/messages`, body, { 
      headers: getHeaders(),
      timeout: 10000 // 10 second timeout
    });
    
    console.log(`Typing indicator (${on ? 'ON' : 'OFF'}) sent to ${cleanPhone}:`, response.status);
    return response.data;
    
  } catch (error: any) {
    console.error(`Failed to send typing indicator to ${phone}:`, {
      status: error.response?.status,
      error: error.response?.data || error.message,
      phone: phone
    });
    
    // Don't throw error - typing indicator is not critical
    return null;
  }
}

// Fallback: Send a simple text message instead of typing indicator
export async function wabaTypingFallback(phone: string, on: boolean) {
  if (on) {
    // Send a simple "..." message as typing indicator
    try {
      await wabaText(phone, "...");
    } catch (error) {
      console.error('Fallback typing indicator failed:', error);
    }
  }
  // For "off", we don't need to do anything
}

// Import the text function
import { wabaText } from './waba';