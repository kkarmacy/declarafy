const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('AI coordinator is opt-in and has bounded planning limits', () => {
  const source = read('api/ai/AgentCoordinator.php');
  assert.match(source, /DECLARAFY_AI_AGENTS_ENABLED/);
  assert.match(source, /FILTER_VALIDATE_BOOLEAN/);
  assert.match(source, /\?:\s*'false'/);
  assert.match(source, /MAX_INPUT_CHARS\s*=\s*12000/);
  assert.match(source, /MAX_STEPS\s*=\s*3/);
  assert.match(source, /array_slice\(\$steps, 0, self::MAX_STEPS\)/);
});

test('tax calculator rejects non-finite values and out-of-range rates', () => {
  const source = read('api/ai/TaxCalculator.php');
  assert.match(source, /!is_finite\(\$amount\)/);
  assert.match(source, /!is_finite\(\$ratePercent\)/);
  assert.match(source, /\$ratePercent < 0 \|\| \$ratePercent > 100/);
  assert.match(source, /Only the latest user message can authorize the rate/);
  assert.match(source, /count\(\$explicitRates\) !== 1/);
});

test('SUNAT source retrieval is allowlisted and bounded', () => {
  const source = read('api/ai/SunatSourceRegistry.php');
  assert.match(source, /isset\(self::SOURCES\[\$id\]\)/);
  assert.match(source, /parse_url\(\$url, PHP_URL_SCHEME\) !== 'https'/);
  assert.match(source, /orientacion\.sunat\.gob\.pe/);
  assert.match(source, /CURLOPT_FOLLOWLOCATION\s*=>\s*false/);
  assert.match(source, /CURLOPT_SSL_VERIFYPEER\s*=>\s*true/);
  assert.match(source, /MAX_RESPONSE_BYTES\s*=\s*1_000_000/);
  assert.match(source, /MAX_TEXT_CHARS\s*=\s*15_000/);
});

test('coordinator tool execution remains behind the feature flag and validates tool input', () => {
  const source = read('api/index.php');
  assert.match(source, /if \(\$agentStatus\['enabled'\]\)/);
  assert.match(source, /calculate_tax_amount/);
  assert.match(source, /\$inputKeys !== \['amount', 'rate_percent', 'tax_included'\]/);
  assert.match(source, /rateWasExplicitlyProvided/);
  assert.match(source, /Only one tool invocation is allowed per user turn/);
  assert.match(source, /DeclarafyAgentCoordinator::validateAnswer\(\$answerText\)/);
  assert.match(source, /ai\/invalid-answer/);
});
