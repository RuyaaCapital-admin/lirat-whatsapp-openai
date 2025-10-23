import axios from "axios";
import { env } from "./env";

const base = `https://graph.facebook.com/${env.WABA_VER}/${env.WABA_PNID}`;

const gh = () => ({
  Authorization: `Bearer ${env.WABA_TOKEN}`,
  "Content-Type": "application/json",
});

export async function wabaTyping(phone: string, on: boolean) {
  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "typing",
    typing: { status: on ? "typing" : "paused" },
  } as const;
  await axios.post(`${base}/messages`, body, { headers: gh() });
}

export async function wabaText(phone: string, text: string) {
  const body = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: text },
  } as const;
  await axios.post(`${base}/messages`, body, { headers: gh() });
}
