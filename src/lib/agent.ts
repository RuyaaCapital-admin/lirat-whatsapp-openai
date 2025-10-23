// src/lib/agent.ts
const AGENT_ID = process.env.AGENT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!AGENT_ID || !OPENAI_API_KEY) {
  throw new Error('Missing required environment variables: AGENT_ID, OPENAI_API_KEY');
}

export async function callAgent(text: string): Promise<string> {
  try {
    // Using OpenAI Agent Builder API
    const response = await fetch(`https://api.openai.com/v1/agents/${AGENT_ID}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: text,
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[AGENT] API error:', response.status, error);
      throw new Error(`Agent API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Extract plain text from agent response
    let output = '';
    if (data.output) {
      output = typeof data.output === 'string' ? data.output : JSON.stringify(data.output);
    } else if (data.response) {
      output = typeof data.response === 'string' ? data.response : JSON.stringify(data.response);
    } else if (data.text) {
      output = data.text;
    }

    // Clean up output - remove markdown and trim
    output = output
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/#+\s*/g, '') // Remove headers
      .replace(/\n\s*\n/g, '\n') // Remove extra newlines
      .trim();

    return output || 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';
  } catch (error) {
    console.error('[AGENT] Error:', error);
    return 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.';
  }
}
