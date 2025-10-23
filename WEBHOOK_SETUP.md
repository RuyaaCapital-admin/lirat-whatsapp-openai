# WhatsApp Webhook Setup Guide

## Prerequisites

1. **WhatsApp Business API Account**: You need a verified WhatsApp Business API account
2. **Phone Number**: A verified phone number for your WhatsApp Business account
3. **OpenAI API Key**: For the trading agent functionality

## Environment Variables

Create a `.env.local` file in the project root with the following variables:

```env
# WhatsApp Business API Configuration
WHATSAPP_VERSION=v24.0
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_TOKEN=your_whatsapp_token
VERIFY_TOKEN=your_webhook_verify_token

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
```

## Getting WhatsApp Credentials

### 1. Phone Number ID
- Go to [Facebook Developers](https://developers.facebook.com/)
- Navigate to your WhatsApp Business API app
- Go to WhatsApp > API Setup
- Copy the Phone Number ID

### 2. Access Token
- In the same API Setup page
- Generate a permanent access token
- Copy the token (keep it secure)

### 3. Verify Token
- Create a random string (e.g., `my-secure-verify-token-123`)
- This will be used to verify your webhook

## Webhook Configuration

### 1. Deploy Your Application
Deploy your Next.js application to a platform like Vercel, Netlify, or your own server.

### 2. Set Webhook URL
- Go to your WhatsApp Business API app in Facebook Developers
- Navigate to WhatsApp > Configuration
- Set the webhook URL to: `https://your-domain.com/api/webhook`
- Set the verify token to match your `VERIFY_TOKEN` environment variable
- Subscribe to `messages` events

### 3. Test the Webhook
1. Send a message to your WhatsApp Business number
2. Check your application logs for incoming webhook calls
3. Verify that you receive a response

## Features

The webhook now includes:

- ✅ **Proper message validation**
- ✅ **Trading agent integration**
- ✅ **Error handling and logging**
- ✅ **Typing indicators**
- ✅ **Message read receipts**
- ✅ **Support for text messages**
- ✅ **Arabic language support**

## Supported Commands

The webhook integrates with the Liirat Trading Agent and supports:

- **Price queries**: "سعر الذهب" or "price XAU/USD"
- **Trading signals**: "إشارة الذهب" or "signal XAUUSD 15m"
- **General trading questions** in Arabic or English

## Troubleshooting

### Common Issues

1. **Webhook verification fails**
   - Check that your `VERIFY_TOKEN` matches exactly
   - Ensure your webhook URL is accessible via HTTPS
   - Verify the URL returns the challenge parameter

2. **Messages not being processed**
   - Check your environment variables are set correctly
   - Verify your WhatsApp token has the correct permissions
   - Check application logs for errors

3. **Agent not responding**
   - Verify your OpenAI API key is valid
   - Check that the agent configuration is correct
   - Review logs for agent processing errors

### Debug Mode

To enable detailed logging, set `NODE_ENV=development` in your environment variables.

## Security Notes

- Keep your access tokens secure
- Use HTTPS for your webhook URL
- Regularly rotate your tokens
- Monitor webhook usage for abuse
- Implement rate limiting if needed

## Support

For issues with this webhook implementation, check the logs and ensure all environment variables are correctly configured.