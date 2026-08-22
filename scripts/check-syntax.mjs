/* Syntax-check every source file.

   This replaces a `for file in ...; do` shell loop in package.json, which npm
   runs through cmd.exe on Windows — where it fails outright with "file was
   unexpected at this time", so `npm run check` could not be run at all on a
   Windows machine. Node globs and spawns identically everywhere. */

import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';

const files = [
  'app.js', 'server.mjs', 'server/store.mjs',
  ...globSync('client/*.js'), ...globSync('client/views/*.js'), ...globSync('scripts/*.mjs'),
].sort();

let bad = 0;
for (const file of files){
  try { execFileSync(process.execPath, ['--check', file], { stdio:['ignore','ignore','pipe'] }); }
  catch (error){ bad++; console.error(`✖ ${file}\n${error.stderr?.toString().trim()}`); }
}
console.log(`${files.length - bad}/${files.length} files parse`);
if (bad) process.exit(1);
