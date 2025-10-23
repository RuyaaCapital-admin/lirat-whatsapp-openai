// src/lib/agent.ts
import OpenAI from 'openai';

const client = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  project: process.env.OPENAI_PROJECT 
});

export async function runAgent(agentId: string, userText: string): Promise<string> {
  try {
    console.log('[AGENT] Calling agent:', agentId);
    
    const response = await client.responses.create({
      agent_id: agentId,
      input: userText
    });

    if (!response || !response.output) {
      console.log('[AGENT] No output from agent');
      return 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';
    }

    // Clean up output - remove markdown and trim
    let output = response.output
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/#+\s*/g, '') // Remove headers
      .replace(/\n\s*\n/g, '\n') // Remove extra newlines
      .trim();

    console.log('[AGENT] Agent response:', output);
    return output || 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';
    
  } catch (error: any) {
    console.error('[AGENT] Agent error:', error.message);
    
    // Check if it's a vector store or knowledge base error
    if (error.message?.includes('Vector store') || 
        error.message?.includes('NotFoundError') ||
        error.message?.includes('not found')) {
      
      console.log('[AGENT] Knowledge base unavailable, using fallback');
      
      try {
        // Fallback to plain model
        const fallbackResponse = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are Liirat Assistant (مساعد ليرات), a trading assistant. Respond in Arabic (formal Syrian tone) or English based on user input. Be concise and helpful.'
            },
            {
              role: 'user',
              content: userText
            }
          ],
          max_tokens: 500,
          temperature: 0.7
        });

        const fallbackText = fallbackResponse.choices[0]?.message?.content || '';
        return `عذرًا، تعذر الوصول إلى قاعدة المعرفة حاليًا. سأجيب مباشرةً: ${fallbackText}`;
        
      } catch (fallbackError) {
        console.error('[AGENT] Fallback also failed:', fallbackError);
        return 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.';
      }
    }
    
    return 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.';
  }
}
