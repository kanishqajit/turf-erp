import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import './build-frontend.mjs';

await mkdir('.wrangler',{recursive:true});
const path='.wrangler/futly-worker.bundle';
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','pages','functions','build','--outfile='+path],{stdio:'inherit'});
if(result.status!==0)throw new Error('Pages proxy compilation failed.');
// Wrangler's outfile is a multipart Worker bundle, rather than plain JS.
// Extract its single compiled module for Pages advanced-mode deployment.
const buffer=await readFile(path);
const boundary=buffer.toString('utf8').split('\r\n',1)[0].slice(2);
const form=await new Response(buffer,{headers:{'Content-Type':'multipart/form-data; boundary='+boundary}}).formData();
const metadata=JSON.parse(String(form.get('metadata')));
const module=form.get(metadata.main_module);
if(!module||typeof module==='string')throw new Error('Compiled Pages module is missing.');
await writeFile('dist/_worker.js',await module.text());
console.log('Pages advanced-mode frontend and API proxy built.');
