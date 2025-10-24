// Debug endpoint to check SDK version and environment
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check OpenAI SDK version
    const openaiPackage = await import('openai/package.json');
    const sdkVersion = openaiPackage.version;

    // Check if workflows are available
    const { openai } = await import('../../lib/openai');
    const hasWorkflows = !!openai.workflows?.runs?.create;

    // Environment check
    const envStatus = {
      OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
      OPENAI_PROJECT: !!process.env.OPENAI_PROJECT,
      OPENAI_WORKFLOW_ID: !!process.env.OPENAI_WORKFLOW_ID,
      FCS_API_KEY: !!process.env.FCS_API_KEY,
      FMP_API_KEY: !!process.env.FMP_API_KEY,
      WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: !!process.env.WHATSAPP_PHONE_NUMBER_ID,
      VERIFY_TOKEN: !!process.env.VERIFY_TOKEN,
    };

    res.status(200).json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      sdk_version: sdkVersion,
      has_workflows_support: hasWorkflows,
      environment: envStatus,
      node_version: process.version,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Debug check failed',
      message: error.message,
      stack: error.stack,
    });
  }
}
