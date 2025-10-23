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

export async function wabaTyping(phone: string, on: boolean) {
  try {
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "typing",
      typing: { status: on ? "typing" : "paused" },
    } as const;
    const baseUrl = getBaseUrl();
    const response = await axios.post(`${baseUrl}/messages`, body, { headers: getHeaders() });
    console.log(`Typing indicator sent to ${phone}:`, response.status);
  } catch (error) {
    console.error(`Failed to send typing indicator to ${phone}:`, error);
    throw error;
  }
}

export async function wabaText(phone: string, text: string) {
  try {
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: text },
    } as const;
    const baseUrl = getBaseUrl();
    const response = await axios.post(`${baseUrl}/messages`, body, { headers: getHeaders() });
    console.log(`Message sent to ${phone}:`, response.status);
  } catch (error) {
    console.error(`Failed to send message to ${phone}:`, error);
    throw error;
  }
}
