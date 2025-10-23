// app/page.tsx
import Link from 'next/link';

export default function HomePage() {
  const webhookUrl = process.env.VERCEL_URL 
    ? `https://${process.env.VERCEL_URL}/api/webhook`
    : 'https://lirat-whatsapp-openai.vercel.app/api/webhook';

  return (
    <div style={{ 
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: '800px',
      margin: '0 auto',
      padding: '20px',
      lineHeight: '1.6'
    }}>
      <h1>🚨 WhatsApp Webhook Status</h1>
      
      <div style={{ 
        backgroundColor: '#f0f8ff', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #e0e0e0'
      }}>
        <h2>📡 Webhook Endpoint</h2>
        <p><strong>URL:</strong> <code>{webhookUrl}</code></p>
        <p><strong>Method:</strong> GET (verification) + POST (messages)</p>
        <p><strong>Verify Token:</strong> {process.env.VERIFY_TOKEN ? '✅ Set' : '❌ Missing'}</p>
      </div>

      <div style={{ 
        backgroundColor: '#fff3cd', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #ffeaa7'
      }}>
        <h2>🔧 Environment Variables</h2>
        <ul>
          <li>VERIFY_TOKEN: {process.env.VERIFY_TOKEN ? '✅ Set' : '❌ Missing'}</li>
          <li>WHATSAPP_PHONE_NUMBER_ID: {process.env.WHATSAPP_PHONE_NUMBER_ID ? '✅ Set' : '❌ Missing'}</li>
          <li>WHATSAPP_TOKEN: {process.env.WHATSAPP_TOKEN ? '✅ Set' : '❌ Missing'}</li>
          <li>OPENAI_API_KEY: {process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing'}</li>
          <li>FCS_API_KEY: {process.env.FCS_API_KEY ? '✅ Set' : '❌ Missing'}</li>
        </ul>
      </div>

      <div style={{ 
        backgroundColor: '#d1ecf1', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #bee5eb'
      }}>
        <h2>🧪 Test Links</h2>
        <p>
          <Link href={`/api/webhook?hub.mode=subscribe&hub.verify_token=${process.env.VERIFY_TOKEN}&hub.challenge=123`}>
            Test Webhook Verification
          </Link>
        </p>
        <p>
          <Link href="/api/ping">
            Test Ping Endpoint
          </Link>
        </p>
      </div>

      <div style={{ 
        backgroundColor: '#f8d7da', 
        padding: '20px', 
        borderRadius: '8px',
        border: '1px solid #f5c6cb'
      }}>
        <h2>⚠️ Debugging Info</h2>
        <p><strong>Deployment Time:</strong> {new Date().toISOString()}</p>
        <p><strong>Node Version:</strong> {process.version}</p>
        <p><strong>Environment:</strong> {process.env.NODE_ENV || 'production'}</p>
        <p><strong>Vercel URL:</strong> {process.env.VERCEL_URL || 'Not available'}</p>
      </div>
    </div>
  );
}
