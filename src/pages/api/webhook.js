// src/pages/api/webhook.js
import { sendText, sendTyping, markRead } from '../../lib/waba';

// Environment validation
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v24.0';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const FCS_API_KEY = process.env.FCS_API_KEY;
const WORKFLOW_ID = process.env.OPENAI_WORKFLOW_ID || process.env.WORKFLOW_ID || '';
const OPENAI_PROJECT = process.env.OPENAI_PROJECT_ID || process.env.OPENAI_PROJECT;

// Debug environment variables
console.log('[ENV DEBUG] Available env vars:', {
  OPENAI_PROJECT: OPENAI_PROJECT ? 'SET' : 'MISSING',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'SET' : 'MISSING',
  WORKFLOW_ID: WORKFLOW_ID ? 'SET' : 'MISSING',
  VERIFY_TOKEN: process.env.VERIFY_TOKEN ? 'SET' : 'MISSING'
});

if (!OPENAI_PROJECT) throw new Error('Missing env: OPENAI_PROJECT');
if (!WORKFLOW_ID) throw new Error('Missing env: WORKFLOW_ID');

// create OpenAI client once
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, project: OPENAI_PROJECT });

// Check what's available in the client
console.log('[DEBUG] OpenAI client keys:', Object.keys(client));
console.log('[DEBUG] OpenAI client beta:', client.beta);
console.log('[DEBUG] OpenAI client beta keys:', client.beta ? Object.keys(client.beta) : 'beta not available');
console.log('[DEBUG] OpenAI client beta.workflows:', client.beta?.workflows);

// Try alternative approach - use responses API if available
console.log('[DEBUG] OpenAI client responses:', client.responses);

// Workflow-only function (no model fallback)
async function askWorkflow(userText, meta = {}) {
  if (!WORKFLOW_ID) {
    throw new Error('WORKFLOW_ID not configured');
  }

  console.log('[WORKFLOW] Calling workflow:', WORKFLOW_ID);
  
  try {
    console.log('[WORKFLOW] Input:', userText);
    console.log('[WORKFLOW] Metadata:', meta);
    
    // Try multiple approaches
    let result;
    
    // Approach 1: Try responses API (if available)
    if (client.responses) {
      console.log('[WORKFLOW] Trying responses API...');
      try {
        result = await client.responses.create({
          workflow_id: WORKFLOW_ID,
          input: userText,
          metadata: { channel: "whatsapp", ...meta },
        });
        console.log('[WORKFLOW] Responses API result:', result);
        
        // Extract text from responses API
        const text = result.output_text || 
                    (Array.isArray(result.output) ? 
                      result.output.map(p => p.content?.[0]?.text?.value).filter(Boolean).join("\n") : 
                      "");
        return text || "البيانات غير متاحة حالياً. جرّب: price BTCUSDT";
      } catch (error) {
        console.log('[WORKFLOW] Responses API failed:', error.message);
      }
    }
    
    // Approach 2: Try beta.workflows API (if available)
    if (client.beta?.workflows) {
      console.log('[WORKFLOW] Trying beta.workflows API...');
      try {
        const run = await client.beta.workflows.runs.create({
          workflow_id: WORKFLOW_ID,
          input: userText,
          metadata: { channel: "whatsapp", ...meta },
        });

        console.log('[WORKFLOW] Run created:', run.id, 'Status:', run.status);

        // Wait for completion
        let workflowResult = await client.beta.workflows.runs.retrieve(run.id);
        console.log('[WORKFLOW] Initial result:', workflowResult.status);
        
        // Poll until completion (with timeout)
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds max
        
        while (workflowResult.status === 'in_progress' && attempts < maxAttempts) {
          console.log('[WORKFLOW] Polling attempt:', attempts + 1, 'Status:', workflowResult.status);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          workflowResult = await client.beta.workflows.runs.retrieve(run.id);
          attempts++;
        }

        console.log('[WORKFLOW] Final result:', workflowResult.status, 'Output:', workflowResult.output);

        if (workflowResult.status === 'completed') {
          // Extract text from the result
          const text = workflowResult.output?.text || 
                      (Array.isArray(workflowResult.output) ? 
                        workflowResult.output.map(p => p.content?.[0]?.text?.value).filter(Boolean).join("\n") : 
                        "");
          console.log('[WORKFLOW] Extracted text:', text);
          return text || "البيانات غير متاحة حالياً. جرّب: price BTCUSDT";
        } else {
          console.error('[WORKFLOW] Run failed:', workflowResult.status, workflowResult.error);
          return `Workflow failed with status: ${workflowResult.status}. Error: ${JSON.stringify(workflowResult.error)}`;
        }
      } catch (error) {
        console.log('[WORKFLOW] Beta workflows API failed:', error.message);
      }
    }
    
    // Approach 3: Fallback to plain chat completion
    console.log('[WORKFLOW] Falling back to plain chat completion...');
    const chatResult = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `أنت مساعد ليرات. استخدم المعرفة المرفقة للإجابة عن أسئلة ليرات. للأسعار، استخدم الأدوات المتاحة.` 
        },
        { role: 'user', content: userText }
      ],
      max_tokens: 500,
      temperature: 0.7
    });
    
    return chatResult.choices[0]?.message?.content || "عذراً، لا يمكنني معالجة طلبك حالياً.";
    
  } catch (error) {
    console.error('[WORKFLOW] All approaches failed:', error);
    console.error('[WORKFLOW] Error message:', error.message);
    console.error('[WORKFLOW] Error status:', error.status);
    console.error('[WORKFLOW] Error code:', error.code);
    return `Workflow error: ${error.message} (Status: ${error.status}, Code: ${error.code})`;
  }
}

// Extract message from webhook payload
function extractMessage(payload) {
  try {
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    
    if (messages && messages.length > 0) {
      const message = messages[0];
      const contacts = value?.contacts?.[0];
      
      return {
        id: message.id,
        from: message.from,
        text: message.text?.body || '',
        timestamp: message.timestamp,
        contactName: contacts?.profile?.name || 'Unknown'
      };
    }
  } catch (error) {
    console.error('[WABA] Error extracting message:', error);
  }
  
  return null;
}

// Polite guardrail for insults
function polite(reply, userText) {
  if (/[^\w](حمار|غبي|يا حيوان|fuck|idiot)/i.test(userText)) {
    return 'أنا هنا للمساعدة. دعنا نركّز على سؤالك لنقدّم لك أفضل إجابة.';
  }
  return reply;
}

export default async function handler(req, res) {
  console.log('[WABA] hit', new Date().toISOString());

  // Handle webhook verification (GET request)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('[WABA] Verification attempt:', { mode, token: token ? 'provided' : 'missing', challenge });

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WABA] Verification successful');
      return res.status(200).send(challenge);
    }

    console.log('[WABA] Verification failed');
    return res.status(403).send('Forbidden');
  }

  // Handle incoming messages (POST request)
  if (req.method === 'POST') {
    try {
      // Ignore WABA status webhooks (delivery/status pings)
      if (!req.body?.entry?.[0]?.changes?.[0]?.value?.messages) {
        console.log('[WABA] Non-message event (status/delivery), ignoring');
        return res.status(200).end();
      }
      
      console.log('[WABA] Payload:', JSON.stringify(req.body, null, 2));
      
      const message = extractMessage(req.body);
      
      if (!message) {
        console.log('[WABA] No message found in payload');
        return res.status(200).json({ received: true });
      }

      console.log('[WABA] Processing message:', {
        id: message.id,
        from: message.from,
        text: message.text,
        contactName: message.contactName
      });

      // Mark message as read (best effort)
      try {
        await markRead(message.id);
      } catch (error) {
        console.warn('[WABA] mark read failed (ignored):', error.message);
      }

      // Send typing indicator (hardened - ignore failures)
      try {
        await sendTyping(message.from);
      } catch (error) {
        console.warn('[WABA] typing 400 ignored');
      }

      // Process message - always use workflow
      if (message.text.trim()) {
        try {
          const text = message.text.trim();
          console.log('[WABA] Calling workflow for:', text);
          
          const answer = await askWorkflow(text, { 
            user_id: message.from,
            contact_name: message.contactName 
          });
          
          const politeAnswer = polite(answer, text);
          await sendText(message.from, politeAnswer);
          console.log('[WABA] reply sent', { to: message.from, kind: 'workflow' });
        } catch (error) {
          console.error('[WABA] Processing error:', error);
          await sendText(message.from, 'عذراً، حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.');
        }
      }

      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('[WABA] Webhook processing error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Method not allowed
  return res.status(405).send('Method not allowed');
}
