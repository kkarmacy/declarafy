const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'core-loader.js'), 'utf8');
const appended = [];
const events = [];
const context = {
  globalThis: {},
  document: {
    querySelector: () => null,
    createElement: () => ({ dataset: {} }),
    head: {
      appendChild(script) {
        appended.push(script.src);
        if (typeof script.onload === 'function') script.onload();
      }
    }
  },
  CustomEvent: function CustomEvent(type) { this.type = type; }
};
context.window = context;
context.dispatchEvent = event => events.push(event.type);
vm.createContext(context);
vm.runInContext(source, context);

assert.ok(context.DeclarafyCoreLoader, 'DeclarafyCoreLoader must be exposed');
assert.strictEqual(typeof context.DeclarafyCoreLoader.load, 'function');
assert.deepStrictEqual(Array.from(context.DeclarafyCoreLoader.scripts), [
  '/src/core/company-context.js',
  '/src/core/module-result.js',
  '/src/core/module-registry.js',
  '/src/modules/financial-analysis.js',
  '/src/modules/case-workflow.js',
  '/src/modules/regulatory-center.js'
]);

context.DeclarafyCoreLoader.load().then(result => {
  assert.strictEqual(result, true);
  assert.strictEqual(appended.length, 6);
  assert.deepStrictEqual(events, ['declarafy:core-ready']);
  console.log('core-loader.test.js: OK');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
