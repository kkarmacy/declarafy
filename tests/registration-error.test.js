'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const php = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.php'), 'utf8');

test('registration recovers an interrupted signup only when the existing password matches', () => {
  assert.match(
    php,
    /if \(\$existing && password_verify\(\$password, \(string\) \$existing\['password_hash'\]\)\) \{[\s\S]*?registrationRecovered' => true/
  );
});

test('registration only reports duplicate email when the email row exists', () => {
  assert.match(
    php,
    /if \(\$existing\) \{\s*fail_request\(\s*'auth\/email-already-in-use'/
  );
  assert.match(
    php,
    /Declarafy registration integrity constraint failed; SQLSTATE=23000; driver_code=/
  );
  assert.match(
    php,
    /fail_request\(\s*'server\/database-error',[\s\S]*?problem[a-zA-Z ]*datos/
  );
});
