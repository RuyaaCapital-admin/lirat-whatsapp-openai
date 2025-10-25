process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-token";

import "./formatters.test";
import "./ohlc.test";

(async () => {
  try {
    const { runWebhookGreetingTests } = await import("./webhook.greeting.test");
    await runWebhookGreetingTests();
    console.log("All tests passed");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
