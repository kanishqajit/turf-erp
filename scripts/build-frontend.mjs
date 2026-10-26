import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'dist');
// Explicit public assets only: never copy server sources, ledgers, or secrets.
const files=['index.html','app.js','styles.css','mobile.html','mobile.js','mobile.css','manifest.webmanifest'];
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'book'),{recursive:true});
await writeFile(join(output,'release.json'),JSON.stringify({commit:process.env.GITHUB_SHA || 'local'})+'\n');
for(const file of files)await cp(join(root,file),join(output,file));
for(const directory of ['client','icons'])await cp(join(root,directory),join(output,directory),{recursive:true});
for(const file of ['index.html','app.js','art.js','styles.css','privacy.html'])await cp(join(root,'customer',file),join(output,'book',file));
await writeFile(join(output,'_redirects'),'/m /mobile.html 200\n/book /book/ 301\n');
await writeFile(join(output,'_routes.json'),JSON.stringify({version:1,include:['/api/*'],exclude:[]},null,2)+'\n');
await writeFile(join(output,'_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:
`);
const customer=await readFile(join(output,'book','index.html'),'utf8');
if(!customer.includes('app.js')||!customer.includes('art.js'))throw new Error('Customer entry point is incomplete.');
console.log('Public frontend packaged in dist: /, /m, /book/. API deployment is required before publishing.');
