export const env = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  WABA_TOKEN: process.env.WHATSAPP_TOKEN!,
  WABA_PNID: process.env.WHATSAPP_PHONE_NUMBER_ID!,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN!,
  WABA_VER: process.env.WHATSAPP_VERSION || "v21.0",
  PRICE_KEY: process.env.PRICE_API_KEY!,
  OHLC_KEY: process.env.OHLC_API_KEY!,
};

Object.entries(env).forEach(([key, value]) => {
  if (!value) {
    console.warn(`[env] ${key} is not set`);
  }
});
