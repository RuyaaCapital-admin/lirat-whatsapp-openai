// lib/agent.ts
import { runWorkflow } from './agent';

export async function callAgent(text: string): Promise<string> {
  try {
    console.log('[AGENT] Calling workflow with text:', text);
    
    const result = await runWorkflow({ input_as_text: text });
    
    if (!result || !result.output_text) {
      console.log('[AGENT] No output from workflow');
      return 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';
    }

    // Clean up output - remove markdown and trim
    let output = result.output_text
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`([^`]+)`/g, '$1') // Remove inline code
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/#+\s*/g, '') // Remove headers
      .replace(/\n\s*\n/g, '\n') // Remove extra newlines
      .trim();

    console.log('[AGENT] Workflow response:', output);
    return output || 'عذراً، لم أتمكن من معالجة طلبك. يرجى المحاولة مرة أخرى.';
  } catch (error) {
    console.error('[AGENT] Error:', error);
    return 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.';
  }
}