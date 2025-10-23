// app/api/webhook/route.ts
export async function GET(request: Request) {
  console.log('GET webhook hit', new Date().toISOString());
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log('Webhook verification successful');
    return new Response(challenge, { status: 200 });
  }
  
  console.log('Webhook verification failed');
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request) {
  console.log('POST webhook hit', new Date().toISOString());
  
  try {
    const body = await request.json();
    console.log('Webhook payload received:', JSON.stringify(body, null, 2));
    
    return new Response(JSON.stringify({ 
      received: true, 
      timestamp: new Date().toISOString() 
    }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}