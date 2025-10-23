// src/pages/index.js
export default function Home() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🤖 WhatsApp Webhook API</h1>
      <p>Serverless WhatsApp webhook with crypto price/signal commands and OpenAI Agent fallback</p>
      
      <h2>✅ API Status: Online</h2>
      <p>The WhatsApp webhook API is running and ready to process messages.</p>
      
      <h2>Available Endpoints</h2>
      <ul>
        <li><strong>GET /api/webhook</strong> - Webhook verification endpoint for WhatsApp Business API</li>
        <li><strong>POST /api/webhook</strong> - Main webhook endpoint for receiving and processing WhatsApp messages</li>
      </ul>
      
      <h2>Test Webhook Verification</h2>
      <p>Test URL: <code>/api/webhook?hub.mode=subscribe&hub.verify_token=liirat123&hub.challenge=123</code></p>
    </div>
  );
}
