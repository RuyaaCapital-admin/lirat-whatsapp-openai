# Required Environment Variables

## WhatsApp Configuration
- `VERIFY_TOKEN` - Webhook verification token (set to "liirat123")
- `WHATSAPP_VERSION` - WhatsApp API version (default: "v24.0")
- `WHATSAPP_PHONE_NUMBER_ID` - Your WhatsApp Business phone number ID
- `WHATSAPP_TOKEN` - Your WhatsApp Business API access token

## OpenAI Configuration  
- `OPENAI_API_KEY` - Your OpenAI API key (used by existing workflow)

## Price Data APIs
- `FCS_API_KEY` - FCS API key for live price data
- `FMP_API_KEY` - (Optional) Financial Modeling Prep API key
- `PRICE_API_KEY` - (Optional) Alternative price API key

## Test URLs
1. **Webhook Verification:** `https://lirat-whatsapp-openai.vercel.app/api/webhook?hub.mode=subscribe&hub.verify_token=liirat123&hub.challenge=123`
2. **Health Check:** `https://lirat-whatsapp-openai.vercel.app/api/ping`
3. **Test Commands:** `npm run curl:verify` and `npm run curl:post`
