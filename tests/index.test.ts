process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test";
process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "test-phone";
process.env.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || "test-token";

import "./whatsapp-format.test";

(async () => {
  try {
    const { runWebhookBehaviourTests } = await import("./webhook-new.test");
    await runWebhookBehaviourTests();
    console.log("All tests passed");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
