import assert from "node:assert";

const originalEnv = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  WHATSAPP_VERSION: process.env.WHATSAPP_VERSION,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
};

process.env.VERIFY_TOKEN = "test-verify";
process.env.WHATSAPP_VERSION = "v99.0";
process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
process.env.WHATSAPP_TOKEN = "test-token";

const { GET, POST } = await import("../app/api/webhook/route");

const originalFetch = globalThis.fetch;

try {
  {
    const req = new Request(
      "https://example.com/api/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=ping"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "ping");
  }

  {
    const req = new Request(
      "https://example.com/api/webhook?hub.mode=subscribe&hub.verify_token=wrong"
    );
    const res = await GET(req);
    assert.strictEqual(res.status, 403);
  }

  {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: typeof url === "string" ? url : url.toString(), init: init ?? {} });
      return new Response("{}", { status: 200 });
    };

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
    assert.deepStrictEqual(await res.json(), { received: true });

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.strictEqual(calls.length, 3);
    assert.ok(calls.every((call) => call.url.includes("graph.facebook.com")));

    const [markRead, typing, text] = calls;
    const markReadBody = JSON.parse((markRead.init.body as string) || "{}");
    assert.strictEqual(markReadBody.status, "read");
    assert.strictEqual(markReadBody.messaging_product, "whatsapp");

    const typingBody = JSON.parse((typing.init.body as string) || "{}");
    assert.strictEqual(typingBody.typing.status, "typing");

    const textBody = JSON.parse((text.init.body as string) || "{}");
    assert.strictEqual(textBody.text.body, "Echo: hello");
  }

  console.log("Webhook route tests passed");
} finally {
  globalThis.fetch = originalFetch;
  process.env.VERIFY_TOKEN = originalEnv.VERIFY_TOKEN;
  process.env.WHATSAPP_VERSION = originalEnv.WHATSAPP_VERSION;
  process.env.WHATSAPP_PHONE_NUMBER_ID = originalEnv.WHATSAPP_PHONE_NUMBER_ID;
  process.env.WHATSAPP_TOKEN = originalEnv.WHATSAPP_TOKEN;
}
