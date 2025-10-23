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
      
      <h2>Features</h2>
      <ul>
        <li>Real-time crypto price tracking</li>
        <li>Technical analysis signals</li>
        <li>OpenAI Agent integration for natural language processing</li>
        <li>Arabic language support</li>
      </ul>
    </div>
  );
}
