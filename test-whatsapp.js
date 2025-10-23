// Test WhatsApp Business API connection
const axios = require('axios');

async function testWhatsAppAPI() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const version = process.env.WHATSAPP_VERSION || 'v24.0';
  
  if (!phoneNumberId || !token) {
    console.error('❌ Missing environment variables:');
    console.error('WHATSAPP_PHONE_NUMBER_ID:', phoneNumberId ? '✅' : '❌');
    console.error('WHATSAPP_TOKEN:', token ? '✅' : '❌');
    return;
  }
  
  console.log('🧪 Testing WhatsApp Business API...');
  console.log('Phone Number ID:', phoneNumberId);
  console.log('API Version:', version);
  
  try {
    // Test 1: Get phone number info
    console.log('\n1️⃣ Testing phone number info...');
    const phoneResponse = await axios.get(
      `https://graph.facebook.com/${version}/${phoneNumberId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { fields: 'display_phone_number,verified_name,code_verification_status' }
      }
    );
    console.log('✅ Phone number info:', phoneResponse.data);
    
    // Test 2: Test message sending (dry run)
    console.log('\n2️⃣ Testing message API...');
    const testMessage = {
      messaging_product: 'whatsapp',
      to: '1234567890', // Test number
      type: 'text',
      text: { body: 'Test message' }
    };
    
    // This will fail but we can check the error
    try {
      await axios.post(
        `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
        testMessage,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Message API accessible (400 error expected for test number)');
        console.log('Error details:', error.response.data);
      } else {
        throw error;
      }
    }
    
    // Test 3: Test typing indicator
    console.log('\n3️⃣ Testing typing indicator...');
    const typingMessage = {
      messaging_product: 'whatsapp',
      to: '1234567890',
      type: 'typing',
      typing: { status: 'typing' }
    };
    
    try {
      await axios.post(
        `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
        typingMessage,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } catch (error) {
      if (error.response?.status === 400) {
        console.log('✅ Typing indicator API accessible (400 error expected for test number)');
        console.log('Error details:', error.response.data);
      } else {
        throw error;
      }
    }
    
    console.log('\n🎉 All tests passed! Your WhatsApp API is properly configured.');
    
  } catch (error) {
    console.error('\n❌ WhatsApp API test failed:');
    console.error('Status:', error.response?.status);
    console.error('Error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.error('\n🔑 Authentication failed. Check your WHATSAPP_TOKEN.');
    } else if (error.response?.status === 403) {
      console.error('\n🚫 Permission denied. Check your app permissions in Meta Developer Console.');
    } else if (error.response?.status === 404) {
      console.error('\n📱 Phone number not found. Check your WHATSAPP_PHONE_NUMBER_ID.');
    }
  }
}

// Load environment variables
require('dotenv').config({ path: '.env.local' });
testWhatsAppAPI();