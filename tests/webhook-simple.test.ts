import assert from "node:assert";

const originalEnv = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  WHATSAPP_VERSION: process.env.WHATSAPP_VERSION,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

// Set test environment
process.env.VERIFY_TOKEN = "test-verify";
process.env.WHATSAPP_VERSION = "v24.0";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.OPENAI_API_KEY = "test-openai-key";

const { GET, POST } = await import("../app/api/webhook/route.js");

try {
  console.log("Testing webhook verification...");
  
  // Test successful verification
  {
    const req = new Request(
      "https://example.com/api/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=ping"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "ping");
    console.log("✓ Webhook verification works");
  }

  // Test failed verification
  {
    const req = new Request(
      "https://example.com/api/webhook?hub.mode=subscribe&hub.verify_token=wrong"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 403);
    console.log("✓ Webhook verification rejects invalid token");
  }

  // Test webhook payload processing (without external API calls)
  {
    const payload = {
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              value: {
                messages: [
                  {
                    id: "wamid.HBgM",
                    from: "15551234567",
                    timestamp: `${Date.now()}`,
                    type: "text",
                    text: { body: "hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await POST(
      new Request("https://example.com/api/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    
    assert.strictEqual(res.status, 200);
    const responseData = await res.json();
    assert.deepStrictEqual(responseData, { received: true });
    console.log("✓ Webhook processes messages correctly");
  }

  // Test webhook with no messages
  {
    const payload = {
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              value: {
                statuses: [
                  {
                    id: "wamid.HBgM",
                    status: "delivered",
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await POST(
      new Request("https://example.com/api/webhook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    
    assert.strictEqual(res.status, 200);
    const responseData = await res.json();
    assert.deepStrictEqual(responseData, { received: true });
    console.log("✓ Webhook handles status updates correctly");
  }

  console.log("All webhook tests passed! ✅");

} catch (error) {
  console.error("Test failed:", error);
  process.exit(1);
} finally {
  // Restore original environment
  process.env.VERIFY_TOKEN = originalEnv.VERIFY_TOKEN;
  process.env.WHATSAPP_VERSION = originalEnv.WHATSAPP_VERSION;
  process.env.WHATSAPP_PHONE_NUMBER_ID = originalEnv.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = originalEnv.WHATSAPP_TOKEN;
  process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
}