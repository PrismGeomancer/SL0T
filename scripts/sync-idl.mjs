#!/usr/bin/env node
// After `anchor build`: copy the compiler's IDL (the source of truth) to every consumer.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'target/idl/sl0t.json');
if (!existsSync(src)) {
  console.error('target/idl/sl0t.json not found. Run `anchor build` first.');
  process.exit(1);
}
for (const p of ['app/src/idl/sl0t.json', 'keeper/src/idl/sl0t.json', 'tests/idl/sl0t.json']) {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  copyFileSync(src, join(root, p));
}
console.log('IDL synced from target/idl/sl0t.json');
