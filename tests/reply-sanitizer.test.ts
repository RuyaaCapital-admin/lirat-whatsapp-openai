import assert from "node:assert";
import {
  greetingResponse,
  isGreetingOnly,
  sanitizeAssistantReply,
  stripLeadingGreeting,
  _testNormalizeGreeting,
} from "../src/utils/replySanitizer";

function testGreetingDetection() {
  assert.strictEqual(isGreetingOnly("مرحبا", "ar"), true);
  assert.strictEqual(isGreetingOnly("مرحبا كيفك", "ar"), false);
  assert.strictEqual(isGreetingOnly("Hello", "en"), true);
  assert.strictEqual(isGreetingOnly("Hello price?", "en"), false);
}

function testLeadingRemoval() {
  assert.strictEqual(stripLeadingGreeting("مرحباً، السعر 123", "ar"), "السعر 123");
  assert.strictEqual(stripLeadingGreeting("Hello! Price is 123", "en"), "Price is 123");
  assert.strictEqual(stripLeadingGreeting("Hello", "en"), "Hello");
  assert.strictEqual(stripLeadingGreeting("مرحباً", "ar"), "مرحباً");
}

function testSanitizeAndResponses() {
  assert.strictEqual(sanitizeAssistantReply(" Hello! Price is 123 ", "en"), "Price is 123");
  assert.strictEqual(greetingResponse("ar"), "كيف فيني ساعدك؟");
  assert.strictEqual(greetingResponse("en"), "How can I help?");
}

function testNormalizeHelper() {
  assert.strictEqual(_testNormalizeGreeting("Hello!!!"), "hello");
}

function run() {
  testGreetingDetection();
  testLeadingRemoval();
  testSanitizeAndResponses();
  testNormalizeHelper();
  console.log("reply sanitizer tests passed");
}

run();
