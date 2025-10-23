// app/api/webhook/route.ts - Simplified version for testing
export async function GET(req: Request) {
  console.log('GET webhook hit', new Date().toISOString());
  const p = new URL(req.url).searchParams;
  if (p.get('hub.mode')==='subscribe' && p.get('hub.verify_token')===process.env.VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  console.log('POST webhook hit', new Date().toISOString());
  
  try {
    const json = await req.json();
    console.log('Webhook payload received:', JSON.stringify(json, null, 2));
    
    // Simple response for now
    return new Response(JSON.stringify({ received: true, timestamp: new Date().toISOString() }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
}