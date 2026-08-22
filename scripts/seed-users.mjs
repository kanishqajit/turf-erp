/* Test accounts for local development.

   Creates one account per role and prints the credentials once, to your
   terminal. Passwords are generated here by randomBytes and are never written
   anywhere but stdout — nothing in this file chooses them, and there is no way
   to recover one afterwards, because store.createUser() hashes with scrypt and
   a random salt like every other account. Lose the output and reseed.

   This talks to the store directly rather than to the API, so it works before
   any user exists — which is the case the HTTP path cannot serve, since
   POST /api/users requires an owner actor once the table is non-empty.

   Local only. It refuses to run against NODE_ENV=production. */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/store.mjs';

if (process.env.NODE_ENV === 'production'){
  console.error('Refusing to seed test accounts in production.');
  process.exit(1);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATABASE_PATH = process.env.TURF_DATABASE_PATH || join(ROOT, 'data', 'turf.sqlite');
const DOMAIN = process.env.TURF_SEED_DOMAIN || 'turf.test';

/* 24 base64url characters, comfortably past the 12-character floor in
   passwordRecord(). */
const newPassword = () => randomBytes(18).toString('base64url');

const accounts = [
  { role:'owner',    name:'Test Owner',    email:`owner@${DOMAIN}` },
  { role:'manager',  name:'Test Manager',  email:`manager@${DOMAIN}` },
  { role:'operator', name:'Test Operator', email:`operator@${DOMAIN}` },
];

const store = createStore({ filename:DATABASE_PATH, sessionIdleMs:30 * 60 * 1000 });

try {
  const existing = store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (existing) console.warn(`Note: ${existing} account(s) already exist. Seeding alongside them.\n`);

  /* The first account is created with no actor, which is the only path
     store.createUser() allows into an empty table — and it also leaves
     must_change_password at 0. Every later account needs an owner actor.

     If the table isn't empty, an owner may already exist (bootstrap env vars,
     Codex, a previous seed). Adopt one as the actor rather than trying the
     null-actor path, which requireRole would then reject. */
  const created = [];
  let owner = null;
  if (existing){
    const row = store.db.prepare(`SELECT id,email,name,role FROM users
      WHERE role='owner' AND active=1 LIMIT 1`).get();
    if (row){ owner = row; console.log(`Using existing owner ${row.email} as the creating actor.\n`); }
  }

  for (const account of accounts){
    const password = newPassword();
    try {
      const user = store.createUser({ ...account, password }, owner);
      if (!owner && user.role === 'owner') owner = user;
      /* Accounts made by an actor are flagged for a forced password change on
         first login. These are throwaway test logins, so clear it — otherwise
         every one of them stops at the change-password screen. */
      if (user.mustChangePassword)
        store.db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(user.id);
      created.push({ ...account, password });
    } catch (error){
      if (error.code === 'email_exists'){ console.warn(`Skipped ${account.email} — already exists.`); continue; }
      throw error;
    }
  }

  if (!created.length){
    console.log('Nothing to create.');
  } else {
    console.log('Test accounts created. These are printed once:\n');
    for (const account of created)
      console.log(`  ${account.role.padEnd(8)}  ${account.email.padEnd(24)}  ${account.password}`);
    console.log(`\nDatabase: ${DATABASE_PATH}`);
    console.log('Delete that file to start over.');
  }
} finally {
  store.close();
}
