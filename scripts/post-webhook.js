// scripts/post-webhook.js
const payload = {
  entry: [{
    changes: [{
      value: {
        contacts: [{
          wa_id: "+15551234567"
        }],
        messages: [{
          id: "test_message_123",
          from: "+15551234567",
          text: {
            body: "ping"
          },
          timestamp: Math.floor(Date.now() / 1000)
        }]
      }
    }]
  }]
};

fetch('https://lirat-whatsapp-openai.vercel.app/api/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
})
.then(response => response.text())
.then(data => console.log('Response:', data))
.catch(error => console.error('Error:', error));
