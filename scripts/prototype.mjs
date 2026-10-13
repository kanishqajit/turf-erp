import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const customerRoot=process.env.TURF_CUSTOMER_APP_DIR || join(root,'..','Turf-app');
for(const file of ['index.html','app.js','art.js','styles.css']){
  if(!existsSync(join(customerRoot,file)))throw new Error(`Missing customer app ${file}. Set TURF_CUSTOMER_APP_DIR to the Turf-app checkout.`);
}
// Use a separate demo ledger so presenting the prototype preserves operational data.
process.env.TURF_DATABASE_PATH ||= join(root,'data','prototype.sqlite');
process.env.TURF_BOOTSTRAP_EMAIL ||= 'demo@turf.test';
process.env.TURF_BOOTSTRAP_PASSWORD ||= 'PrototypeDemo2026!';
process.env.TURF_BOOTSTRAP_NAME ||= 'Demo Owner';
const origin=`http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5174}`;
console.log(`Customer: ${origin}/book/\nDesktop ERP: ${origin}/\nStaff phone: ${origin}/m`);
console.log('Local demo sign-in: demo@turf.test / PrototypeDemo2026! (unless overridden or changed).');
await import('../server.mjs');
