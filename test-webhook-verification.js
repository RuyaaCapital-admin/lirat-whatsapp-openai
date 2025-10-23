// Test webhook verification endpoint
const https = require('https');

// Replace with your actual Vercel app URL
const WEBHOOK_URL = 'https://your-app-name.vercel.app/api/webhook';
const VERIFY_TOKEN = 'your_verify_token_here'; // Replace with your actual verify token

function testWebhookVerification() {
  const params = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': VERIFY_TOKEN,
    'hub.challenge': 'test_challenge_123'
  });
  
  const url = `${WEBHOOK_URL}?${params}`;
  
  console.log('Testing webhook verification...');
  console.log('URL:', url);
  
  https.get(url, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Response:', data);
      
      if (res.statusCode === 200 && data === 'test_challenge_123') {
        console.log('✅ Webhook verification SUCCESSFUL!');
      } else {
        console.log('❌ Webhook verification FAILED!');
        console.log('Expected: test_challenge_123');
        console.log('Received:', data);
      }
    });
  }).on('error', (err) => {
    console.error('❌ Request failed:', err.message);
  });
}

// Run the test
testWebhookVerification();
