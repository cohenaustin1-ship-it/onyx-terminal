#!/usr/bin/env node
// IMO Onyx Terminal — Missing-reference gate for CI
//
// Runs `tsc -p tsconfig.sweep.json --noEmit` and fails ONLY on
// "Cannot find name" errors (TS2304). All other error classes
// (type narrowing, implicit any, mutated objects, etc.) are
// suppressed because tsconfig.sweep.json with checkJs:true
// surfaces ~3,500 inference-level noise issues that aren't bugs.
//
// What this catches: the bug class that 3p.34 → 3p.37 hunted —
// extraction without re-threading imports. Functions defined in
// monolith but used in extracted modules without an import.
// Components used at JSX render sites without being declared in
// scope. Env-var IIFEs not duplicated when code is moved.
//
// At the end of 3p.37, this script reports 0 errors. Any
// regression (new extraction without imports) will fire here.
//
// Run: `npm run check:imports`
// CI: gate on exit code 0

const { spawnSync } = require('child_process');

const result = spawnSync(
  'npx',
  ['tsc', '-p', 'tsconfig.sweep.json', '--noEmit'],
  { encoding: 'utf8' }
);

// tsc prints errors to stdout (not stderr). Even though it exited
// non-zero, we want to filter and decide ourselves.
const allErrors = (result.stdout || '').split('\n');
const missingRefs = allErrors.filter(line => /error TS2304:/.test(line));

if (missingRefs.length === 0) {
  console.log('✓ no missing-reference bugs (TS2304) — sweep clean');
  process.exit(0);
}

console.error(`✗ ${missingRefs.length} missing-reference bug(s) found:`);
console.error('');
for (const err of missingRefs) {
  console.error('  ' + err);
}
console.error('');
console.error('Each of these is a runtime-crash waiting to happen.');
console.error('Either:');
console.error('  1. Add the missing import (most common fix)');
console.error('  2. Add the missing `export` keyword to the source');
console.error('  3. Move the symbol to a shared lib if both monolith');
console.error('     and an extracted module need it');
console.error('');
console.error('See deploy.ps1 for phases 3p.34-3p.37 for examples.');
process.exit(1);
