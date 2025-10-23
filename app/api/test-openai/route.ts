// app/api/test-openai/route.ts
export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return Response.json({ error: 'OPENAI_API_KEY not set' }, { status: 500 });
    }
    
    // Test basic OpenAI API call
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const error = await response.text();
      return Response.json({ 
        error: 'OpenAI API test failed', 
        status: response.status,
        details: error 
      }, { status: 500 });
    }
    
    const models = await response.json();
    
    return Response.json({ 
      success: true, 
      apiKeyPrefix: apiKey.substring(0, 10) + '...',
      modelsCount: models.data?.length || 0
    });
    
  } catch (error) {
    return Response.json({ 
      error: 'Test failed', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
