import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const PITCHES = [
  { name:'Pitch A', rate:1800 },
  { name:'Pitch B', rate:1200 },
  { name:'Main Ground', rate:3200 },
];
export const OPEN_MIN = 6 * 60;
export const CLOSE_MIN = 22 * 60;
const ROLES = { operator:1, manager:2, owner:3 };

export class ProductError extends Error {
  constructor(status, code, message, details = undefined){
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const fail = (status, code, message, details) => { throw new ProductError(status, code, message, details); };
const nowMs = () => Date.now();
const isoNow = () => new Date().toISOString();
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const clean = (value, max = 300) => String(value ?? '').trim().slice(0, max);
const validContact = value => {
  const text=clean(value,80),digits=text.replace(/\D/g,'');
  return digits.length >= 8 && digits.length <= 15 && /^[+\d][\d\s().-]*$/.test(text);
};
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};
const hasRole = (actor, role) => !!actor && (ROLES[actor.role] || 0) >= ROLES[role];
const requireRole = (actor, role) => {
  if (!hasRole(actor, role)) fail(403, 'forbidden', `${role} access is required.`);
};

function passwordRecord(password){
  if (String(password).length < 12 || String(password).length > 256)
    fail(400, 'weak_password', 'Password must contain between 12 and 256 characters.');
  const salt = randomBytes(24);
  const hash = scryptSync(String(password), salt, 64);
  return { salt:salt.toString('hex'), hash:hash.toString('hex') };
}

function passwordMatches(password, saltHex, hashHex){
  try {
    const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch (_) { return false; }
}

function validateWindow(input){
  const date = clean(input.date, 10);
  const pitch = Number(input.pitch);
  const start = Number(input.start);
  const end = Number(input.end);
  if (!validDate(date)) fail(400, 'invalid_date', 'A valid booking date is required.');
  if (!Number.isInteger(pitch) || !PITCHES[pitch]) fail(400, 'invalid_pitch', 'A valid pitch is required.');
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) fail(400, 'invalid_time', 'End time must be after start time.');
  if (start < OPEN_MIN || end > CLOSE_MIN) fail(409, 'outside_hours', 'The booking must stay within venue opening hours.');
  return { date, pitch, start, end };
}

function priceFor({ pitch, start, end }){
  return Math.round(PITCHES[pitch].rate * (end - start) / 60 + (end > 18 * 60 ? 300 : 0));
}

export function createStore({ filename = 'data/turf.sqlite', sessionIdleMs = 30 * 60 * 1000,
  timeZone = process.env.TURF_TIME_ZONE || 'Asia/Kolkata' } = {}){
  try { new Intl.DateTimeFormat('en', { timeZone }).format(new Date()); }
  catch (_) { fail(500, 'invalid_time_zone', 'TURF_TIME_ZONE must be a valid IANA time zone.'); }
  if (filename !== ':memory:'){
    mkdirSync(dirname(filename), { recursive:true, mode:0o700 });
    try { chmodSync(dirname(filename), 0o700); } catch (_) {}
  }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') for (const path of [filename, `${filename}-wal`, `${filename}-shm`])
    if (existsSync(path)) try { chmodSync(path, 0o600); } catch (_) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','manager','operator')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      password_changed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pitch INTEGER NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      team TEXT NOT NULL,
      contact TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'counter' CHECK(source IN ('counter','app')),
      kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind IN ('standard','custom','group')),
      group_type TEXT,
      group_id TEXT,
      status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming','running','done','noshow','cancelled')),
      started_at INTEGER,
      ended_at INTEGER,
      total_amount INTEGER NOT NULL,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL REFERENCES users(id),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_window_idx ON bookings(date,pitch,start,end,status);
    CREATE TABLE IF NOT EXISTS holds (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pitch INTEGER NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      team TEXT NOT NULL,
      contact TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      pay TEXT NOT NULL DEFAULT 'Payment at venue',
      expires_at INTEGER NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS holds_window_idx ON holds(date,pitch,start,end,expires_at);
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      pitch INTEGER NOT NULL,
      start INTEGER NOT NULL,
      end INTEGER NOT NULL,
      reason TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      released_at TEXT,
      released_by TEXT REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS blocks_window_idx ON blocks(date,pitch,start,end,active);
    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL REFERENCES bookings(id),
      amount INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('Cash','UPI','Card')),
      kind TEXT NOT NULL DEFAULT 'payment' CHECK(kind IN ('payment','refund')),
      reference TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS payments_booking_idx ON payment_events(booking_id,created_at);
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at DESC);
    CREATE TABLE IF NOT EXISTS venue_settings (
      key TEXT PRIMARY KEY,
      value_integer INTEGER NOT NULL,
      updated_by TEXT REFERENCES users(id),
      updated_at TEXT NOT NULL
    );
  `);
  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
  if (!userColumns.has('must_change_password')) db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
  if (!userColumns.has('password_changed_at')) db.exec('ALTER TABLE users ADD COLUMN password_changed_at TEXT');
  const paymentColumns = new Set(db.prepare('PRAGMA table_info(payment_events)').all().map(column => column.name));
  if (!paymentColumns.has('reference')) db.exec("ALTER TABLE payment_events ADD COLUMN reference TEXT NOT NULL DEFAULT ''");
  if (!paymentColumns.has('idempotency_key')) db.exec('ALTER TABLE payment_events ADD COLUMN idempotency_key TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_idx ON payment_events(idempotency_key) WHERE idempotency_key IS NOT NULL');
  db.prepare(`INSERT OR IGNORE INTO venue_settings (key,value_integer,updated_by,updated_at)
    VALUES ('deposit_amount',500,NULL,?)`).run(isoNow());

  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error){ db.exec('ROLLBACK'); throw error; }
  };
  const audit = (actor, action, entityType, entityId, before, after, reason = '') => {
    db.prepare(`INSERT INTO audit_events
      (actor_id,action,entity_type,entity_id,before_json,after_json,reason,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(actor.id, action, entityType, entityId,
      before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), clean(reason, 500), isoNow());
  };

  function createUser({ email, name, role = 'operator', password }, actor = null){
    email = clean(email, 200).toLowerCase(); name = clean(name, 120); role = clean(role, 20);
    if (!/^\S+@\S+\.\S+$/.test(email) || !name || !ROLES[role]) fail(400, 'invalid_user', 'Valid name, email and role are required.');
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) requireRole(actor, 'owner');
    const secret = passwordRecord(password);
    const mustChangePassword = actor ? 1 : 0;
    const user = { id:randomUUID(), email, name, role, mustChangePassword:!!mustChangePassword, created_at:isoNow() };
    try {
      db.prepare(`INSERT INTO users (id,email,name,role,password_salt,password_hash,must_change_password,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(user.id, email, name, role, secret.salt, secret.hash,mustChangePassword,user.created_at);
    } catch (error){
      if (String(error).includes('UNIQUE')) fail(409, 'email_exists', 'An account already uses this email.');
      throw error;
    }
    if (actor) audit(actor, 'user.created', 'user', user.id, null, user);
    return user;
  }

  function authenticate(email, password){
    if (typeof password !== 'string' || password.length > 256) fail(401, 'invalid_credentials', 'Email or password is incorrect.');
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(clean(email, 200).toLowerCase());
    const fallbackSalt = '00'.repeat(24), fallbackHash = '00'.repeat(64);
    const matched = passwordMatches(password, user?.password_salt || fallbackSalt, user?.password_hash || fallbackHash);
    if (!user || !matched) fail(401, 'invalid_credentials', 'Email or password is incorrect.');
    return { id:user.id, email:user.email, name:user.name, role:user.role, mustChangePassword:!!user.must_change_password };
  }

  function createSession(user, ttlMs = 12 * 60 * 60 * 1000){
    deleteExpired();
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const created = nowMs();
    db.prepare(`INSERT INTO sessions (id,user_id,token_hash,csrf_token,expires_at,created_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?)`).run(randomUUID(), user.id, tokenHash(token), csrf, created + ttlMs, created, created);
    return { token, csrf, expiresAt:created + ttlMs };
  }

  function sessionUser(token){
    if (!token) return null;
    const row = db.prepare(`SELECT s.id AS session_id,s.csrf_token,s.expires_at,u.id,u.email,u.name,u.role,u.must_change_password
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND s.last_seen_at>? AND u.active=1`).get(tokenHash(token), nowMs(), nowMs() - sessionIdleMs);
    if (!row) return null;
    db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(nowMs(), row.session_id);
    return row;
  }

  function deleteSession(token){ if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token)); }
  function deleteExpired(){
    db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?').run(nowMs(), nowMs() - sessionIdleMs);
    db.prepare('DELETE FROM holds WHERE expires_at<=?').run(nowMs());
  }

  function assertAvailable(window, { ignoreBookingId = null, ignoreHoldId = null } = {}){
    const conflict = db.prepare(`SELECT id,team,start,end FROM bookings
      WHERE date=? AND pitch=? AND status NOT IN ('cancelled','noshow') AND start<? AND end>?
        AND (? IS NULL OR id<>?) LIMIT 1`).get(window.date, window.pitch, window.end, window.start, ignoreBookingId, ignoreBookingId);
    if (conflict) fail(409, 'booking_conflict', 'This time overlaps another booking.', conflict);
    const hold = db.prepare(`SELECT id,start,end FROM holds
      WHERE date=? AND pitch=? AND expires_at>? AND start<? AND end>?
        AND (? IS NULL OR id<>?) LIMIT 1`).get(window.date, window.pitch, nowMs(), window.end, window.start, ignoreHoldId, ignoreHoldId);
    if (hold) fail(409, 'hold_conflict', 'This time overlaps an active hold.', hold);
    const block = db.prepare(`SELECT id,reason,start,end FROM blocks
      WHERE date=? AND pitch=? AND active=1 AND start<? AND end>? LIMIT 1`).get(window.date, window.pitch, window.end, window.start);
    if (block) fail(409, 'maintenance_conflict', 'This time overlaps maintenance.', block);
  }

  function normalizeBooking(input, actor){
    const window = validateWindow(input);
    const team = clean(input.team, 120), contact = clean(input.contact, 80);
    if (!team || !validContact(contact)) fail(400, 'invalid_customer', 'Name/team and a contact containing 8 to 15 digits are required.');
    const kind = ['standard','custom','group'].includes(input.kind) ? input.kind : 'standard';
    return { ...window, id:randomUUID(), team, contact, notes:clean(input.notes, 500),
      source:'counter', kind,
      groupType:kind === 'group' ? clean(input.groupType, 30) : null,
      groupId:kind === 'group' ? clean(input.groupId, 80) || randomUUID() : null,
      totalAmount:priceFor(window), createdBy:actor.id };
  }

  function insertBooking(b, actor){
    const stamp = isoNow();
    db.prepare(`INSERT INTO bookings
      (id,date,pitch,start,end,team,contact,notes,source,kind,group_type,group_id,status,total_amount,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.id,b.date,b.pitch,b.start,b.end,b.team,b.contact,b.notes,
      b.source,b.kind,b.groupType,b.groupId,'upcoming',b.totalAmount,b.createdBy,stamp,stamp);
    audit(actor, 'booking.created', 'booking', b.id, null, b);
  }

  function createBookings(inputs, actor){
    requireRole(actor, 'operator');
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 31) fail(400, 'invalid_batch', 'Supply between 1 and 31 bookings.');
    return tx(() => {
      const records = inputs.map(input => normalizeBooking(input, actor));
      for (const record of records){ assertAvailable(record); insertBooking(record, actor); }
      return records.map(record => getBooking(record.id));
    });
  }

  function bookingSelect(where = '1=1'){
    return `SELECT b.*,
      COALESCE((SELECT SUM(CASE kind WHEN 'refund' THEN -amount ELSE amount END) FROM payment_events p WHERE p.booking_id=b.id),0) AS collected,
      COALESCE((SELECT SUM(CASE kind WHEN 'refund' THEN -amount ELSE amount END) FROM payment_events p WHERE p.booking_id=b.id AND mode='Cash'),0) AS collected_cash,
      COALESCE((SELECT SUM(CASE kind WHEN 'refund' THEN -amount ELSE amount END) FROM payment_events p WHERE p.booking_id=b.id AND mode='UPI'),0) AS collected_upi,
      COALESCE((SELECT SUM(CASE kind WHEN 'refund' THEN -amount ELSE amount END) FROM payment_events p WHERE p.booking_id=b.id AND mode='Card'),0) AS collected_card
      FROM bookings b WHERE ${where}`;
  }
  function shapeBooking(row){
    if (!row) return null;
    const paid = Number(row.collected || 0), due = Math.max(0, row.total_amount - row.discount_amount - paid);
    return { id:row.id, date:row.date, pitch:row.pitch, start:row.start, end:row.end,
      team:row.team, contact:row.contact, notes:row.notes, source:row.source, kind:row.kind,
      groupType:row.group_type, groupId:row.group_id, status:row.status,
      startedAt:row.started_at, endedAt:row.ended_at, amount:row.total_amount,
      discount:row.discount_amount, collected:paid,
      collectedByMode:{ Cash:Number(row.collected_cash || 0), UPI:Number(row.collected_upi || 0), Card:Number(row.collected_card || 0) },
      advance:due > 0 ? paid : 0, pay:due === 0 ? 'Payment done' : paid > 0 ? 'Advance paid' : 'Payment at venue',
      version:row.version, createdAt:row.created_at, updatedAt:row.updated_at };
  }
  const getBooking = id => shapeBooking(db.prepare(bookingSelect('b.id=?')).get(id));
  function assertVersion(booking, expectedVersion){
    if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') return;
    if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== booking.version)
      fail(409, 'stale_booking', 'This booking changed on another console. Refresh and review the latest record before trying again.');
  }

  function listState(from, to){
    if (!validDate(from) || !validDate(to) || from > to) fail(400, 'invalid_range', 'A valid from/to date range is required.');
    if ((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000 > 62)
      fail(400, 'range_too_large', 'State queries are limited to 63 days.');
    deleteExpired();
    const bookings = db.prepare(bookingSelect(`b.date BETWEEN ? AND ? AND b.status<>'cancelled'`) + ' ORDER BY b.date,b.start,b.pitch').all(from, to).map(shapeBooking);
    const holds = db.prepare(`SELECT h.*,u.name AS created_by_name FROM holds h JOIN users u ON u.id=h.created_by
      WHERE h.date BETWEEN ? AND ? AND h.expires_at>? ORDER BY h.date,h.start`).all(from, to, nowMs()).map(row => ({
      id:row.id,date:row.date,pitch:row.pitch,start:row.start,end:row.end,team:row.team,contact:row.contact,
      notes:row.notes,pay:row.pay,expiresAt:row.expires_at,createdBy:row.created_by_name,
    }));
    const blocks = db.prepare(`SELECT b.*,u.name AS created_by_name FROM blocks b JOIN users u ON u.id=b.created_by
      WHERE b.date BETWEEN ? AND ? AND b.active=1 ORDER BY b.date,b.start`).all(from, to).map(row => ({
      id:row.id,date:row.date,pitch:row.pitch,start:row.start,end:row.end,reason:row.reason,
      createdBy:row.created_by_name,createdAt:row.created_at,
    }));
    return { bookings, holds, blocks, settings:getSettings(), serverTime:new Date().toISOString(), timeZone };
  }

  function listAccounts(from, to, actor){
    requireRole(actor, 'operator');
    if (!validDate(from) || !validDate(to) || from > to) fail(400, 'invalid_range', 'A valid from/to date range is required.');
    if ((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000 > 366)
      fail(400, 'range_too_large', 'Account queries are limited to 367 days.');
    const bookings = db.prepare(bookingSelect('b.date BETWEEN ? AND ?') + ' ORDER BY b.date DESC,b.start DESC,b.pitch').all(from,to).map(shapeBooking);
    const payments = db.prepare(`SELECT p.id,p.booking_id,p.amount,p.mode,p.kind,p.reference,p.reason,p.created_at,
      u.name AS created_by_name FROM payment_events p JOIN bookings b ON b.id=p.booking_id
      JOIN users u ON u.id=p.created_by WHERE b.date BETWEEN ? AND ? ORDER BY p.created_at DESC,p.rowid DESC`).all(from,to).map(row => ({
        id:row.id,bookingId:row.booking_id,amount:row.amount,mode:row.mode,kind:row.kind,reference:row.reference,
        reason:row.reason,createdAt:row.created_at,createdBy:row.created_by_name,
      }));
    return { bookings, payments };
  }

  function getSettings(){
    const deposit = db.prepare("SELECT value_integer FROM venue_settings WHERE key='deposit_amount'").get();
    return { depositAmount:Number(deposit?.value_integer ?? 500) };
  }

  function updateSettings(input, actor){
    requireRole(actor, 'manager');
    const depositAmount = Number(input.depositAmount);
    if (!Number.isInteger(depositAmount) || depositAmount < 0 || depositAmount > 50000)
      fail(400, 'invalid_deposit', 'Deposit must be a whole rupee amount between ₹0 and ₹50,000.');
    return tx(() => {
      const before = getSettings();
      db.prepare(`UPDATE venue_settings SET value_integer=?,updated_by=?,updated_at=? WHERE key='deposit_amount'`)
        .run(depositAmount, actor.id, isoNow());
      const after = getSettings();
      audit(actor, 'settings.deposit.updated', 'venue_setting', 'deposit_amount', before, after);
      return after;
    });
  }

  function createHold(input, actor){
    requireRole(actor, 'operator');
    const window = validateWindow(input);
    const team = clean(input.team, 120), contact = clean(input.contact, 80);
    if (!team || !validContact(contact)) fail(400, 'invalid_customer', 'Name/team and a contact containing 8 to 15 digits are required.');
    return tx(() => {
      assertAvailable(window);
      const hold = { id:randomUUID(), ...window, team, contact, notes:clean(input.notes,500),
        pay:clean(input.pay,50) || 'Payment at venue', expiresAt:nowMs() + 20 * 60 * 1000 };
      db.prepare(`INSERT INTO holds (id,date,pitch,start,end,team,contact,notes,pay,expires_at,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(hold.id,hold.date,hold.pitch,hold.start,hold.end,hold.team,hold.contact,
        hold.notes,hold.pay,hold.expiresAt,actor.id,isoNow());
      audit(actor, 'hold.created', 'hold', hold.id, null, hold);
      return hold;
    });
  }

  function confirmHold(id, actor){
    requireRole(actor, 'operator');
    return tx(() => {
      const hold = db.prepare('SELECT * FROM holds WHERE id=? AND expires_at>?').get(id, nowMs());
      if (!hold) fail(409, 'hold_expired', 'This hold has expired or was released.');
      assertAvailable(hold, { ignoreHoldId:id });
      const record = normalizeBooking({ ...hold, kind:'standard' }, actor);
      insertBooking(record, actor);
      db.prepare('DELETE FROM holds WHERE id=?').run(id);
      audit(actor, 'hold.confirmed', 'hold', id, hold, { bookingId:record.id });
      return getBooking(record.id);
    });
  }

  function releaseHold(id, actor, reason){
    requireRole(actor, 'operator'); reason = clean(reason,500);
    return tx(() => {
      const hold = db.prepare('SELECT * FROM holds WHERE id=?').get(id);
      if (!hold) fail(404, 'not_found', 'Hold not found.');
      db.prepare('DELETE FROM holds WHERE id=?').run(id);
      audit(actor, 'hold.released', 'hold', id, hold, null, reason);
    });
  }

  function createBlock(input, actor){
    requireRole(actor, 'manager');
    const window = validateWindow(input), reason = clean(input.reason, 500);
    if (reason.length < 15) fail(400, 'reason_required', 'A maintenance reason of at least 15 characters is required.');
    return tx(() => {
      assertAvailable(window);
      const block = { id:randomUUID(), ...window, reason, createdBy:actor.name, createdAt:isoNow() };
      db.prepare(`INSERT INTO blocks (id,date,pitch,start,end,reason,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(block.id,block.date,block.pitch,block.start,block.end,reason,actor.id,block.createdAt);
      audit(actor, 'block.created', 'block', block.id, null, block, reason);
      return block;
    });
  }

  function releaseBlock(id, actor, reason){
    requireRole(actor, 'manager'); reason = clean(reason,500);
    if (!reason) fail(400, 'reason_required', 'A reason is required to reopen maintenance.');
    return tx(() => {
      const before = db.prepare('SELECT * FROM blocks WHERE id=? AND active=1').get(id);
      if (!before) fail(404, 'not_found', 'Maintenance block not found.');
      db.prepare('UPDATE blocks SET active=0,released_at=?,released_by=? WHERE id=?').run(isoNow(),actor.id,id);
      audit(actor, 'block.released', 'block', id, before, null, reason);
    });
  }

  function releaseBooking(id, actor, reason, expectedVersion){
    requireRole(actor, 'manager'); reason = clean(reason,500);
    if (reason.length < 5) fail(400, 'reason_required', 'A release reason of at least 5 characters is required.');
    return tx(() => {
      const before = getBooking(id);
      if (!before || before.status === 'cancelled') fail(404, 'not_found', 'Booking not found.');
      assertVersion(before, expectedVersion);
      if (before.collected > 0)
        fail(409, 'payment_reconciliation_required', 'Clear recorded payments in Accounts before releasing this booking.');
      db.prepare(`UPDATE bookings SET status='cancelled',version=version+1,updated_at=? WHERE id=?`).run(isoNow(),id);
      audit(actor, 'booking.released', 'booking', id, before, getBooking(id), reason);
    });
  }

  function setStatus(id, status, actor, reason = '', atMinute = null, expectedVersion){
    requireRole(actor, 'operator'); status = clean(status,20); reason = clean(reason,500);
    const allowed = ['upcoming','running','done','noshow'];
    if (!allowed.includes(status)) fail(400, 'invalid_status', 'Unsupported session status.');
    return tx(() => {
      const before = getBooking(id);
      if (!before) fail(404, 'not_found', 'Booking not found.');
      assertVersion(before, expectedVersion);
      if (before.status === status) return before;
      const normal = (before.status === 'upcoming' && ['running','noshow'].includes(status))
        || (before.status === 'running' && status === 'done');
      /* Counter reality: whoever presses the button is standing in front of the
         customer and already knows what happened. Making them type a
         justification first only delays the record catching up with the pitch,
         so no status change asks for one. The audit row still records who
         changed what, when, and from which state — the part anyone reviewing
         it actually reads — and role is still checked on a reversal. */
      if (!normal) requireRole(actor, 'manager');
      const dateParts = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' })
        .formatToParts(new Date()).reduce((result,part) => (result[part.type]=part.value,result),{});
      const timeParts = new Intl.DateTimeFormat('en-GB', { timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
        .formatToParts(new Date()).reduce((result,part) => (result[part.type]=part.value,result),{});
      const today = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
      const currentMinute = Number(timeParts.hour) * 60 + Number(timeParts.minute);
      const manual = atMinute !== null && atMinute !== undefined && atMinute !== '';
      if (manual && !Number.isFinite(Number(atMinute))) fail(400, 'invalid_time', 'A valid session time is required.');
      const minute = manual ? Math.max(0, Math.min(1439, Math.round(Number(atMinute)))) : currentMinute;
      /* Saying when play actually began is not a time correction. A team that
         walks on at 7:07 for a 7:00 slot can be given the clock from either
         minute, and the operator at the counter is the only one who knows
         which — so a start stated inside the booking's own window, on the day
         it is booked for, is an ordinary operator action and needs no reason.
         It is still audited like any other. Anything outside that — another
         day, past the booked end, more than 15 minutes early — is a correction
         and keeps its manager and its reason.

         The window is the whole guard on purpose: it is bounded at both ends
         by the booking itself, so it needs no second opinion about what time
         it is now. An earlier version also required the minute to have already
         passed on the server, which compared the browser's clock against the
         venue timezone's and refused the start whenever the two disagreed —
         a different machine clock, or the dev clock override, turned an
         ordinary start into a correction demanding a manager and a reason. */
      const statedStart = manual && status === 'running' && before.date === today
        && minute >= before.start - 15 && minute < before.end;
      if (manual && !statedStart){
        /* An operator who overshot the window gets told what is wrong with the
           minute rather than that they lack a role they were never going to
           have. A manager may still correct it, so the bounds are explained
           only to the people the window actually binds. */
        if (!hasRole(actor, 'manager') && status === 'running' && before.date === today){
          if (minute < before.start - 15)
            fail(409, 'session_too_early', 'This session cannot start more than 15 minutes before its booked time.');
          if (minute >= before.end)
            fail(409, 'session_elapsed', 'This booking has already ended. Resolve it as a no-show or ask a manager to correct its time.');
        }
        requireRole(actor, 'manager');
      } else if (!manual && before.date !== today){
        fail(409, 'session_date_mismatch', 'Past or future sessions require a manager time correction with a reason.');
      }
      if (!manual && status === 'running' && minute < before.start - 15)
        fail(409, 'session_too_early', 'This session cannot start more than 15 minutes before its booked time.');
      if (!manual && status === 'running' && minute >= before.end)
        fail(409, 'session_elapsed', 'This booking has already ended. Resolve it as a no-show or ask a manager to correct its time.');
      const started = status === 'running' ? minute : before.startedAt;
      /* A clock that stops before it started is a skew artefact, not something
         the counter needs to be argued with about — the operator has already
         decided the session is over, and refusing the end strands it running
         with no way to close it. The end is held at the start instead, so the
         session records as zero length and every duration downstream stays
         non-negative. */
      const statedEnd = status === 'done' ? minute : before.endedAt;
      const ended = status === 'done' && started != null && statedEnd != null && statedEnd < started
        ? started : statedEnd;
      db.prepare(`UPDATE bookings SET status=?,started_at=?,ended_at=?,version=version+1,updated_at=? WHERE id=?`)
        .run(status, started, ended, isoNow(), id);
      const after = getBooking(id);
      audit(actor, `booking.status.${status}`, 'booking', id, before, after, reason);
      return after;
    });
  }

  function extendBooking(id, minutes, actor, expectedVersion){
    requireRole(actor, 'operator'); minutes = Number(minutes);
    if (![30,60].includes(minutes)) fail(400, 'invalid_extension', 'Extension must be 30 or 60 minutes.');
    return tx(() => {
      const before = getBooking(id);
      if (!before || !['upcoming','running'].includes(before.status)) fail(409, 'not_extendable', 'Only upcoming or running bookings can be extended.');
      assertVersion(before, expectedVersion);
      const window = validateWindow({ ...before, end:before.end + minutes });
      assertAvailable(window, { ignoreBookingId:id });
      const total = priceFor(window);
      db.prepare(`UPDATE bookings SET end=?,total_amount=?,version=version+1,updated_at=? WHERE id=?`)
        .run(window.end,total,isoNow(),id);
      const after = getBooking(id);
      audit(actor, 'booking.extended', 'booking', id, before, after, `${minutes} minutes`);
      return after;
    });
  }

  function recordPayment(id, input, actor){
    requireRole(actor, 'operator');
    const amount = Math.round(Number(input.amount)), mode = clean(input.mode,20), settle = !!input.settle;
    const reason = clean(input.reason,500), reference = clean(input.reference,120);
    const idempotencyKey = clean(input.idempotencyKey,80);
    if (!Number.isFinite(amount) || amount <= 0) fail(400, 'invalid_amount', 'Payment amount must be greater than zero.');
    if (!['Cash','UPI','Card'].includes(mode)) fail(400, 'invalid_mode', 'Payment mode must be Cash, UPI or Card.');
    if (idempotencyKey.length < 12) fail(400, 'idempotency_required', 'A valid payment idempotency key is required.');
    if (mode !== 'Cash' && reference.length < 4) fail(400, 'reference_required', `${mode} reference must contain at least 4 characters.`);
    return tx(() => {
      const prior = db.prepare('SELECT booking_id,amount,mode,kind FROM payment_events WHERE idempotency_key=?').get(idempotencyKey);
      if (prior){
        if (prior.booking_id === id && prior.amount === amount && prior.mode === mode && prior.kind === 'payment') return getBooking(id);
        fail(409, 'idempotency_conflict', 'This payment key was already used for a different account event.');
      }
      const before = getBooking(id);
      if (!before) fail(404, 'not_found', 'Booking not found.');
      assertVersion(before, input.version);
      const outstanding = Math.max(0, before.amount - before.discount - before.collected);
      if (amount > outstanding) fail(409, 'overpayment', 'Payment exceeds the outstanding balance.');
      let discount = 0;
      if (settle && amount < outstanding){
        requireRole(actor, 'manager');
        if (reason.length < 5) fail(400, 'reason_required', 'A discount reason is required.');
        discount = outstanding - amount;
        if (discount > before.amount * .2 && actor.role !== 'owner') fail(403, 'discount_limit', 'Discounts above 20% require owner approval.');
      }
      db.prepare(`INSERT INTO payment_events (id,booking_id,amount,mode,reference,idempotency_key,reason,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(),id,amount,mode,reference,idempotencyKey,reason,actor.id,isoNow());
      if (discount) db.prepare('UPDATE bookings SET discount_amount=discount_amount+?,version=version+1,updated_at=? WHERE id=?')
        .run(discount,isoNow(),id);
      else db.prepare('UPDATE bookings SET version=version+1,updated_at=? WHERE id=?').run(isoNow(),id);
      const after = getBooking(id);
      audit(actor, settle ? 'payment.settled' : 'payment.recorded', 'booking', id, before, after, reason);
      return after;
    });
  }

  function recordRefund(id, input, actor){
    requireRole(actor, 'manager');
    const amount = Math.round(Number(input.amount)), mode = clean(input.mode,20), reason = clean(input.reason,500);
    const reference = clean(input.reference,120), idempotencyKey = clean(input.idempotencyKey,80);
    if (!Number.isFinite(amount) || amount <= 0) fail(400, 'invalid_amount', 'Refund amount must be greater than zero.');
    if (!['Cash','UPI','Card'].includes(mode)) fail(400, 'invalid_mode', 'Refund mode must be Cash, UPI or Card.');
    if (reason.length < 5) fail(400, 'reason_required', 'A refund reason is required.');
    if (idempotencyKey.length < 12) fail(400, 'idempotency_required', 'A valid refund idempotency key is required.');
    if (mode !== 'Cash' && reference.length < 4) fail(400, 'reference_required', `${mode} reference must contain at least 4 characters.`);
    return tx(() => {
      const prior = db.prepare('SELECT booking_id,amount,mode,kind FROM payment_events WHERE idempotency_key=?').get(idempotencyKey);
      if (prior){
        if (prior.booking_id === id && prior.amount === amount && prior.mode === mode && prior.kind === 'refund') return getBooking(id);
        fail(409, 'idempotency_conflict', 'This refund key was already used for a different account event.');
      }
      const before = getBooking(id);
      if (!before) fail(404, 'not_found', 'Booking not found.');
      assertVersion(before, input.version);
      if (amount > before.collected) fail(409, 'refund_exceeds_collected', 'Refund cannot exceed the amount collected.');
      if (amount > Number(before.collectedByMode?.[mode] || 0))
        fail(409, 'refund_exceeds_mode', `Refund cannot exceed the ${mode} amount collected.`);
      db.prepare(`INSERT INTO payment_events (id,booking_id,amount,mode,kind,reference,idempotency_key,reason,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),id,amount,mode,'refund',reference,idempotencyKey,reason,actor.id,isoNow());
      db.prepare('UPDATE bookings SET version=version+1,updated_at=? WHERE id=?').run(isoNow(),id);
      const after = getBooking(id);
      audit(actor, 'payment.refunded', 'booking', id, before, after, reason);
      return after;
    });
  }

  function listAudit(limit = 100, actor){
    requireRole(actor, 'manager');
    limit = Math.max(1, Math.min(500, Number(limit) || 100));
    return db.prepare(`SELECT a.*,u.name AS actor_name,u.email AS actor_email
      FROM audit_events a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ?`).all(limit).map(row => ({
      id:row.id,actor:{ id:row.actor_id,name:row.actor_name,email:row.actor_email },action:row.action,
      entityType:row.entity_type,entityId:row.entity_id,before:row.before_json ? JSON.parse(row.before_json) : null,
      after:row.after_json ? JSON.parse(row.after_json) : null,reason:row.reason,createdAt:row.created_at,
    }));
  }

  function changePassword(actor, currentPassword, newPassword){
    const row = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(actor?.id);
    if (!row || !passwordMatches(currentPassword, row.password_salt, row.password_hash))
      fail(401, 'invalid_current_password', 'Current password is incorrect.');
    const secret = passwordRecord(newPassword);
    if (passwordMatches(newPassword, row.password_salt, row.password_hash))
      fail(400, 'password_reused', 'Choose a password different from the current password.');
    return tx(() => {
      db.prepare(`UPDATE users SET password_salt=?,password_hash=?,must_change_password=0,password_changed_at=? WHERE id=?`)
        .run(secret.salt,secret.hash,isoNow(),row.id);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(row.id, actor.session_id || '');
      const after = { id:row.id,email:row.email,name:row.name,role:row.role,active:true,mustChangePassword:false };
      audit(actor, 'user.password.changed', 'user', row.id, null, after);
      return after;
    });
  }

  function listUsers(actor){
    requireRole(actor, 'owner');
    return db.prepare(`SELECT id,email,name,role,active,must_change_password,created_at,password_changed_at
      FROM users ORDER BY active DESC,role DESC,name COLLATE NOCASE`).all().map(row => ({
        id:row.id,email:row.email,name:row.name,role:row.role,active:!!row.active,
        mustChangePassword:!!row.must_change_password,createdAt:row.created_at,passwordChangedAt:row.password_changed_at,
      }));
  }

  function setUserActive(id, active, actor, reason){
    requireRole(actor, 'owner'); reason = clean(reason,500);
    if (reason.length < 5) fail(400, 'reason_required', 'A reason is required for an account access change.');
    if (id === actor.id && !active) fail(409, 'self_deactivation', 'You cannot deactivate your own account.');
    return tx(() => {
      const row = db.prepare('SELECT id,email,name,role,active,must_change_password FROM users WHERE id=?').get(id);
      if (!row) fail(404, 'not_found', 'Staff account not found.');
      if (!active && row.role === 'owner'){
        const owners = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1").get().n;
        if (owners <= 1) fail(409, 'last_owner', 'The last active owner cannot be deactivated.');
      }
      db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0,id);
      if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      const before = { ...row,active:!!row.active,mustChangePassword:!!row.must_change_password };
      const after = { ...before,active:!!active };
      audit(actor, active ? 'user.activated' : 'user.deactivated', 'user', id, before, after, reason);
      return after;
    });
  }

  function revokeUserSessions(id, actor, reason){
    requireRole(actor, 'owner'); reason = clean(reason,500);
    if (reason.length < 5) fail(400, 'reason_required', 'A reason is required to revoke sessions.');
    const user = db.prepare('SELECT id,email,name,role FROM users WHERE id=?').get(id);
    if (!user) fail(404, 'not_found', 'Staff account not found.');
    const result = db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(id, id === actor.id ? actor.session_id || '' : '');
    audit(actor, 'user.sessions.revoked', 'user', id, null, { revoked:Number(result.changes || 0) }, reason);
    return { revoked:Number(result.changes || 0) };
  }

  function recordAuthEvent(actor, action){ audit(actor, action, 'session', actor.session_id || actor.id, null, { userId:actor.id }); }

  function bootstrapFromEnv(env){
    const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (count) return false;
    if (!env.TURF_BOOTSTRAP_EMAIL || !env.TURF_BOOTSTRAP_PASSWORD) return false;
    createUser({ email:env.TURF_BOOTSTRAP_EMAIL, password:env.TURF_BOOTSTRAP_PASSWORD,
      name:env.TURF_BOOTSTRAP_NAME || 'Owner', role:'owner' });
    return true;
  }

  return { db, close:() => db.close(), createUser, authenticate, createSession, sessionUser, deleteSession,
    deleteExpired, createBookings, getBooking, listState, listAccounts, createHold, confirmHold, releaseHold,
    createBlock, releaseBlock, releaseBooking, setStatus, extendBooking, recordPayment, recordRefund, listAudit,
    getSettings, updateSettings, changePassword, listUsers, setUserActive, revokeUserSessions, recordAuthEvent,
    bootstrapFromEnv, requireRole };
}
