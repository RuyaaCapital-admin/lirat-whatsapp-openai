// Test script to debug intent parsing
const { parseIntent } = require('./src/tools/symbol.ts');

console.log('🧪 Testing Intent Parsing...\n');

// Test the exact message from the logs
const testMessage = 'عطيني صفقة عالدهب عالدقيقة';
console.log('📝 Test message:', testMessage);

try {
  const result = parseIntent(testMessage);
  console.log('\n✅ Parsing result:', result);
} catch (error) {
  console.error('❌ Error:', error);
}
