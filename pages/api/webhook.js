// pages/api/webhook.js
export default function handler(req, res) {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('Webhook verification successful');
      return res.status(200).send(challenge);
    }
    
    console.log('Webhook verification failed');
    return res.status(403).send('Forbidden');
  }
  
  if (req.method === 'POST') {
    console.log('WABA webhook hit', new Date().toISOString());
    console.log('Webhook payload:', JSON.stringify(req.body, null, 2));
    return res.status(200).json({ received: true });
  }
  
  return res.status(405).send('Method not allowed');
}
