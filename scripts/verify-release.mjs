import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const origin='https://futly-prototype.pages.dev';
const commit=process.env.GITHUB_SHA;
assert.match(commit||'',/^[a-f0-9]{40}$/,'A pushed Git commit is required.');
const expectedApp=await readFile(new URL('../customer/app.js',import.meta.url),'utf8');
let failure;
for(let attempt=0;attempt<6;attempt++){
  try{
    const [release,app,health,venues]=await Promise.all(['/release.json','/book/app.js','/api/health','/api/public/venues'].map(
      path=>fetch(origin+path+'?release='+commit,{cache:'no-store',signal:AbortSignal.timeout(25000)})));
    for(const response of [release,app,health,venues])assert.equal(response.status,200);
    assert.equal((await release.json()).commit,commit,'Cloudflare must serve the pushed commit.');
    assert.equal(await app.text(),expectedApp,'Customer app must match Git.');
    for(const response of [health,venues])assert.equal(response.headers.get('X-Futly-Commit'),commit,'Supabase must serve the pushed commit.');
    const state=await health.json();assert.equal(state.ok,true);assert.equal(state.persistence,'supabase');
    assert.ok(Array.isArray((await venues.json()).venues));
    console.log('Verified Git commit '+commit+' on Cloudflare and both Supabase functions.');
    process.exit(0);
  }catch(error){failure=error;if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));}
}
throw failure;
