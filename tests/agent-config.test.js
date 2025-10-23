const assert = require('assert');
const { liiratAssistant } = require('../api/agent');

assert.ok(liiratAssistant, 'liiratAssistant should be exported');

const instructions = liiratAssistant.instructions;
assert.ok(instructions.startsWith('When a tool returns a field named text'), 'instructions must start with tool directive');
const lines = instructions.split('\n');
assert.strictEqual(lines[1], 'You are Liirat Assistant. Reply briefly (≤4 lines) in the user language. No links.');

const toolNames = (liiratAssistant.tools || []).map((tool) => tool.name || (tool.definition ? tool.definition.name : null));
assert.deepStrictEqual(toolNames, ['getPrice', 'getOhlc', 'computeTradingSignal', 'file_search']);

console.log('agent-config tests passed');
