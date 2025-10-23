// src/lib/agent.ts
import OpenAI from 'openai';

const client = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT 
});

export async function runAgent(agentId: string, userText: string): Promise<string> {
  try {
    console.log('[AGENT] Calling agent:', agentId);
    
    // For now, use chat completions as fallback since agent API might not be available
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are Liirat Assistant (مساعد ليرات), a trading assistant. 
          
          Respond in Arabic (formal Syrian tone) or English based on user input. 
          Be concise and helpful. You can help with:
          - Trading questions
          - Market analysis
          - Price inquiries
          - General trading advice
          
          Always respond in the user's language.`
        },
        {
          role: 'user',
          content: userText
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const output = response.choices[0]?.message?.content || '';
    
    // Clean up output - remove markdown and trim
    let cleanOutput = output
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/#+\s*/g, '') // Remove headers
      .replace(/\n\s*\n/g, '\n') // Remove extra newlines
      .trim();

    console.log('[AGENT] Agent response:', cleanOutput);
    return cleanOutput || 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';
    
  } catch (error: any) {
    console.error('[AGENT] Agent error:', error.message);
    return 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.';
  }
}
