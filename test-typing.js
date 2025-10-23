// Test typing indicator specifically
const axios = require('axios');

async function testTypingIndicator() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const version = process.env.WHATSAPP_VERSION || 'v24.0';
  
  if (!phoneNumberId || !token) {
    console.error('❌ Missing environment variables');
    return;
  }
  
  console.log('🧪 Testing Typing Indicator...');
  console.log('Phone Number ID:', phoneNumberId);
  console.log('API Version:', version);
  
  const testPhoneNumber = '1234567890'; // Test number
  
  try {
    // Test 1: Show typing indicator
    console.log('\n1️⃣ Testing typing indicator ON...');
    const typingOnPayload = {
      messaging_product: 'whatsapp',
      to: testPhoneNumber,
      type: 'typing',
      typing: { status: 'typing' }
    };
    
    const response1 = await axios.post(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      typingOnPayload,
      { 
        headers: { 
          Authorization: `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        } 
      }
    );
    
    console.log('✅ Typing ON response:', response1.status, response1.data);
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 2: Hide typing indicator
    console.log('\n2️⃣ Testing typing indicator OFF...');
    const typingOffPayload = {
      messaging_product: 'whatsapp',
      to: testPhoneNumber,
      type: 'typing',
      typing: { status: 'paused' }
    };
    
    const response2 = await axios.post(
      `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
      typingOffPayload,
      { 
        headers: { 
          Authorization: `Bearer ${token}`, 
          'Content-Type': 'application/json' 
        } 
      }
    );
    
    console.log('✅ Typing OFF response:', response2.status, response2.data);
    
    console.log('\n🎉 Typing indicator test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Typing indicator test failed:');
    console.error('Status:', error.response?.status);
    console.error('Error:', error.response?.data || error.message);
    
    // Analyze the error
    if (error.response?.data) {
      const errorData = error.response.data;
      if (errorData.error) {
        console.error('\n🔍 Error Analysis:');
        console.error('Error Code:', errorData.error.code);
        console.error('Error Message:', errorData.error.message);
        console.error('Error Type:', errorData.error.type);
        
        if (errorData.error.code === 100) {
          console.error('\n💡 Solution: Invalid phone number format. Use international format (e.g., 1234567890)');
        } else if (errorData.error.code === 190) {
          console.error('\n💡 Solution: Invalid access token. Check your WHATSAPP_TOKEN');
        } else if (errorData.error.code === 368) {
          console.error('\n💡 Solution: App not approved for production. Check your app status in Meta Developer Console');
        } else if (errorData.error.code === 131026) {
          console.error('\n💡 Solution: Phone number not verified or missing messaging capabilities');
        }
      }
    }
  }
}

// Load environment variables
require('dotenv').config({ path: '.env.local' });
testTypingIndicator();