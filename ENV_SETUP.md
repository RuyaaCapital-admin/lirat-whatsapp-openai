# Environment Variables Setup

## Required Environment Variables

Set these in your Vercel dashboard under Settings → Environment Variables:

### WhatsApp Configuration
- `VERIFY_TOKEN` - Your webhook verification token (e.g., "liirat123")
- `WHATSAPP_TOKEN` - Your WhatsApp Business API access token
- `WHATSAPP_PHONE_NUMBER_ID` - Your WhatsApp phone number ID
- `WHATSAPP_VERSION` - WhatsApp API version (default: "v24.0")

### OpenAI Configuration
- `OPENAI_API_KEY` - Your OpenAI API key
- `OPENAI_WORKFLOW_ID` - Your OpenAI Workflow ID (from Agent Builder)
- `OPENAI_PROJECT` - Your OpenAI project ID (optional but recommended)

### Price Data
- `FCS_API_KEY` - FCS API key for live price data

## OpenAI Project Setup

### Option 1: Use Existing Project (Recommended)
1. Go to [OpenAI Platform](https://platform.openai.com/projects)
2. Find the project that contains your Agent's vector store
3. Copy the project ID (starts with `proj_`)
4. Set `OPENAI_PROJECT` environment variable to this ID

### Option 2: Remove Knowledge Base from Agent
If you don't need the knowledge base:
1. Go to [OpenAI Agent Builder](https://platform.openai.com/agents)
2. Edit your agent
3. Remove or disable the Knowledge Base/Vector Store
4. Save the agent
5. The agent will work without `OPENAI_PROJECT` set

## Testing

After setting up environment variables:

1. **Test webhook verification:**
   ```
   GET https://your-domain.vercel.app/api/webhook?hub.mode=subscribe&hub.verify_token=liirat123&hub.challenge=123
   ```
   Should return: `123`

2. **Test price queries:**
   Send "xau" or "gold" in WhatsApp - should return live price

3. **Test agent queries:**
   Send "hello" or "مين انت" in WhatsApp - should get agent response

## Troubleshooting

- **Vector store errors:** Make sure `OPENAI_PROJECT` points to the correct project
- **Price errors:** Verify `FCS_API_KEY` is valid
- **WhatsApp errors:** Check `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID`