// Test the intent parsing
const { parseIntent } = require('./src/tools/symbol');

const testText = "عطيني صفقة عالدهب";
console.log('Test text:', testText);
console.log('Parsed intent:', parseIntent(testText));

const testText2 = "يا عيتي عطيني صفقة entry sl tp";
console.log('Test text 2:', testText2);
console.log('Parsed intent 2:', parseIntent(testText2));
