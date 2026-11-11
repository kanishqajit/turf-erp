/* The whole ERP, with nothing behind it.

   mobile.js is an API client: every read and every write goes through
   fetch(). This replaces fetch for the demonstration build, so the same
   untouched app runs against an object in memory instead of a server.

   Why: on a turf, over a phone hotspot, every tap costs a round trip to
   Cloudflare and back. That latency is the whole impression an owner forms of
   whether the thing is quick. Here a tap is a function call, so the board
   answers in the same frame.

   Nothing is persisted and nothing syncs. A reload is a factory reset, which
   is the behaviour you want from a demonstration: if a tap goes wrong in front
   of an owner, pull down and the board is perfect again.

   The seed is built relative to the clock at load, so the live match is always
   live — whatever hour you walk in. */

(function(){
  'use strict';

  const PITCHES = [
    { name:'Pitch A', rate:1800 },
    { name:'Pitch B', rate:1200 },
    { name:'Main Ground', rate:3200 },
  ];
  const FLOODLIGHT_FROM = 18 * 60, FLOODLIGHT_FEE = 300;
  /* The server's own arithmetic. If this drifts the demo quotes one price and
     the real app bills another, which is the one lie an owner would catch. */
  const priceFor = (pitch, start, end) => Math.round(
    PITCHES[pitch].rate * (end - start) / 60 + (end > FLOODLIGHT_FROM ? FLOODLIGHT_FEE : 0));

  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const dayAt = off => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + off); return d; };
  const dateFor = off => isoOf(dayAt(off));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  const USER = { id:'demo-owner', name:'R. Kumar', email:'owner@futly.app',
    role:'owner', mustChangePassword:false };

  const DB = { bookings:[], holds:[], blocks:[], payments:[], settings:{ depositAmount:500 } };

  /* ── seed ─────────────────────────────────────────────── */
  const LIVE_TEAM = ['Falcon FC', '9847112233'];
  const OWED_TEAM = ['Kakkanad Strikers', '9847709962'];
  const TEAMS = [
    ['Kaloor Kings','9995640182'],     ['Edappally Eagles','8086774510'],
    ['Vyttila Warriors','9744328815'], ['Panampilly FC','9846051127'],
    ['Thrikkakara XI','9633870244'],   ['Marine Drive FC','9961245508'],
    ['Palarivattom FC','9048336721'],  ['Nellikka Boys','9895412067'],
    ['MG Road United','7593008841'],   ['Kadavanthra Lions','9567120934'],
    ['Aluva Athletic','9605778213'],   ['Office Team','9847665031'],
    ['Sunday Regulars','9388221470'],  ['Infopark XI','9496550318'],
    ['Thevara Titans','9847330116'],   ['Cheranalloor FC','9846772204'],
  ];
  let cast = 0;
  const nextTeam = () => TEAMS[cast++ % TEAMS.length];

  /* Mornings are the fitness crowd, the middle of the day is dead, the evening
     is the business. A board that is evenly busy all day looks invented. */
  const DEMAND = {
    6:[1,1,0], 7:[1,1,0], 8:[1,0,0], 15:[0,0,1], 16:[1,0,1], 17:[1,1,1],
    18:[1,1,1], 19:[1,1,1], 20:[1,1,1], 21:[1,1,1], 22:[1,0,0], 23:[1,0,0],
  };
  /* Gaps held open on purpose: a demo needs a free slot to tap. */
  const KEEP_OPEN = { 0:[[0,21],[1,19],[2,17]], 1:[[0,20],[1,18],[2,19],[0,7]], 2:[[1,20],[2,18]] };

  function makeBooking(date, pitch, start, end, team, contact, source){
    return { id:uid(), date, pitch, start, end, team, contact,
      source:source || 'counter', kind:'standard', status:'upcoming',
      startedAt:null, endedAt:null, checkedInAt:null,
      pausedAt:null, pausedMilliseconds:0,
      amount:priceFor(pitch, start, end), discount:0,
      collected:0, collectedByMode:{ Cash:0, UPI:0, Card:0 },
      advance:0, pay:'Payment at venue', version:1,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  }

  const free = (date, pitch, start, end) => !DB.bookings.some(b =>
    b.date === date && b.pitch === pitch && b.status !== 'cancelled'
    && b.start < end && b.end > start);

  function pay(booking, amount, mode, reference, kind){
    const value = Math.round(amount);
    if (!(value > 0)) return;
    DB.payments.push({ id:uid(), bookingId:booking.id, amount:value, mode,
      kind:kind || 'payment', reference:reference || '',
      reason:'', by:USER.name, createdAt:new Date().toISOString() });
    booking.collected = Math.round((booking.collected || 0) + value);
    booking.collectedByMode[mode] = Math.round((booking.collectedByMode[mode] || 0) + value);
  }

  function seedDay(offset){
    const date = dateFor(offset);
    const open = KEEP_OPEN[offset] || [];
    Object.keys(DEMAND).map(Number).forEach(hour => {
      DEMAND[hour].forEach((wanted, pitch) => {
        if (!wanted) return;
        if (open.some(o => o[0] === pitch && o[1] === hour)) return;
        const start = hour * 60, end = start + 60;
        if (!free(date, pitch, start, end)) return;
        const t = nextTeam();
        DB.bookings.push(makeBooking(date, pitch, start, end, t[0], t[1],
          (pitch + hour) % 3 === 0 ? 'app' : 'counter'));
      });
    });
  }

  function seedHistory(){
    /* Enough settled history that Money and Accounts have something to open. */
    const MODES = ['UPI','Cash','UPI','Card','Cash'];
    let n = 0;
    for (let back = 2; back <= 21; back++){
      const date = dateFor(-back);
      [17,18,19,20,21].forEach((hour, i) => {
        const pitch = (back + i) % 3;
        const t = nextTeam();
        const b = makeBooking(date, pitch, hour * 60, hour * 60 + 60, t[0], t[1],
          (back + i) % 3 === 0 ? 'app' : 'counter');
        b.status = 'done';
        b.startedAt = hour * 60 + 2;
        b.endedAt = hour * 60 + 60;
        DB.bookings.push(b);
        if (n % 9 !== 8){
          const mode = MODES[n % MODES.length];
          pay(b, b.amount, mode, mode === 'Cash' ? '' : 'UTR' + (400000 + n * 13));
        }
        n++;
      });
    }
  }

  function seed(){
    seedHistory();
    [0, 1, 2].forEach(seedDay);

    const NOW = nowMin();
    const today = dateFor(0);
    const liveHour = Math.min(23, Math.max(6, Math.floor(NOW / 60)));
    const liveStart = liveHour * 60;

    /* The match on the clock right now — the single most convincing card on
       the board, so it is placed rather than left to chance. */
    DB.bookings = DB.bookings.filter(b =>
      !(b.date === today && b.pitch === 0 && b.start === liveStart));
    const live = makeBooking(today, 0, liveStart, liveStart + 60, LIVE_TEAM[0], LIVE_TEAM[1], 'app');
    live.status = 'running';
    live.startedAt = Math.max(live.start, Math.min(NOW - 22, live.end - 5));
    live.checkedInAt = new Date().toISOString();
    DB.bookings.push(live);

    /* And one that finished in the last hour without paying, so "still to
       collect" is a real number. */
    const owedStart = Math.max(6 * 60, liveStart - 60);
    if (owedStart < liveStart){
      DB.bookings = DB.bookings.filter(b =>
        !(b.date === today && b.pitch === 2 && b.start === owedStart));
      const owed = makeBooking(today, 2, owedStart, owedStart + 60, OWED_TEAM[0], OWED_TEAM[1], 'counter');
      owed.status = 'done';
      owed.startedAt = owed.start + 3;
      owed.endedAt = owed.end;
      DB.bookings.push(owed);
    }

    /* Everything on today that has already finished gets a life. */
    const MODES = ['UPI','Cash','UPI','Card','Cash','UPI'];
    let settled = 0;
    DB.bookings.filter(b => b.date === today && b.status === 'upcoming').forEach(b => {
      if (b.end <= NOW){
        b.status = 'done';
        b.startedAt = b.start + (b.pitch % 3);
        b.endedAt = b.end;
        if (settled % 6 !== 5){
          const mode = MODES[settled % MODES.length];
          pay(b, b.amount, mode, mode === 'Cash' ? '' : 'UTR' + (100000 + settled * 37));
        }
        settled++;
        return;
      }
      if (b.start > NOW && b.start <= NOW + 25) b.checkedInAt = new Date().toISOString();
      else if ((b.pitch + b.start) % 4 === 0) pay(b, 500, 'UPI', 'UTR' + (500000 + b.start));
    });

    /* A hold about to lapse, and a pitch closed for repair tomorrow. */
    for (let hour = Math.floor(NOW / 60) + 1; hour <= 22; hour++){
      let placed = false;
      [1, 0, 2].forEach(pitch => {
        if (placed || !free(today, pitch, hour * 60, hour * 60 + 60)) return;
        DB.holds.push({ id:uid(), date:today, pitch, start:hour * 60, end:hour * 60 + 60,
          team:'Sunday Regulars', contact:'9388221470', pay:'Payment at venue',
          expiresAt:new Date(Date.now() + 11 * 60000).toISOString(),
          createdBy:USER.name, createdAt:new Date().toISOString() });
        placed = true;
      });
      if (placed) break;
    }
    DB.blocks.push({ id:uid(), date:dateFor(1), pitch:1, start:15 * 60, end:16 * 60,
      reason:'Net repair and line marking', active:1,
      createdBy:USER.name, createdAt:new Date().toISOString() });
  }

  seed();

  /* ── the fake wire ────────────────────────────────────── */
  const ok = body => new Response(JSON.stringify(body),
    { status:200, headers:{ 'Content-Type':'application/json' } });
  const bad = (status, code, message) => new Response(
    JSON.stringify({ error:{ code, message } }),
    { status, headers:{ 'Content-Type':'application/json' } });

  const byId = id => DB.bookings.find(b => b.id === id);
  const touch = b => { b.version++; b.updatedAt = new Date().toISOString(); return b; };

  function tillFor(date){
    const by = { Cash:0, UPI:0, Card:0 };
    DB.bookings.filter(b => b.date === date).forEach(b =>
      Object.keys(by).forEach(m => { by[m] += (b.collectedByMode || {})[m] || 0; }));
    return { by, total:by.Cash + by.UPI + by.Card };
  }

  function stateBetween(from, to){
    const within = d => (!from || d >= from) && (!to || d <= to);
    return {
      bookings:DB.bookings.filter(b => within(b.date)),
      holds:DB.holds.filter(h => within(h.date)
        && new Date(h.expiresAt).getTime() > Date.now()),
      blocks:DB.blocks.filter(b => within(b.date) && b.active),
      settings:DB.settings,
      till:tillFor(dateFor(0)),
      serverTime:new Date().toISOString(),
      timeZone:'Asia/Kolkata',
    };
  }

  const real = window.fetch.bind(window);

  window.fetch = function(input, init){
    const url = String(input && input.url ? input.url : input);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/api/')) return real(input, init);

    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (_) {}
    const query = new URLSearchParams((path.split('?')[1] || ''));
    const route = path.split('?')[0];

    try { return Promise.resolve(handle(route, method, body, query)); }
    catch (error){ return Promise.resolve(bad(400, 'demo_error', error.message)); }
  };

  function handle(route, method, body, query){
    /* — session — */
    if (route === '/api/auth/me') return ok({ user:USER, csrfToken:'demo' });
    if (route === '/api/auth/login') return ok({ user:USER, csrfToken:'demo' });
    if (route === '/api/auth/logout') return ok({ ok:true });
    if (route === '/api/health') return ok({ ok:true });

    /* — reads — */
    if (route === '/api/state') return ok(stateBetween(query.get('from'), query.get('to')));
    if (route === '/api/accounts'){
      const from = query.get('from'), to = query.get('to');
      const within = d => (!from || d >= from) && (!to || d <= to);
      return ok({ bookings:DB.bookings.filter(b => within(b.date)), payments:DB.payments });
    }
    if (route === '/api/audit') return ok({ events:[] });
    if (route === '/api/settings' && method === 'GET') return ok({ settings:DB.settings });

    /* — settings — */
    if (route === '/api/settings'){
      const amount = Math.round(Number(body.depositAmount));
      if (!(amount >= 0 && amount <= 50000)) return bad(400, 'invalid_deposit', 'Deposit must be between ₹0 and ₹50,000.');
      DB.settings = { depositAmount:amount };
      return ok({ settings:DB.settings });
    }

    /* — bookings — */
    if (route === '/api/bookings' && method === 'POST'){
      const made = createOne(body);
      return made.error ? made.error : ok({ bookings:[made.booking] });
    }
    if (route === '/api/bookings/batch' && method === 'POST'){
      const out = [];
      for (const input of (body.bookings || [])){
        const made = createOne(input);
        if (made.error) return made.error;
        out.push(made.booking);
      }
      return ok({ bookings:out });
    }

    let m;
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/status$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      const next = body.status;
      if (next === 'running'){
        /* One match per pitch, exactly as the server refuses it. */
        const busy = DB.bookings.find(x => x.id !== b.id && x.date === b.date
          && x.pitch === b.pitch && x.status === 'running');
        if (busy) return bad(409, 'pitch_busy',
          PITCHES[b.pitch].name + ' still has ' + busy.team + ' in play. End that session first.');
        b.startedAt = body.atMinute == null ? nowMin() : Math.round(body.atMinute);
        b.endedAt = null;
      }
      if (next === 'done') b.endedAt = Math.round(nowMin());
      if (next === 'upcoming'){ b.startedAt = null; b.endedAt = null; b.pausedAt = null; b.pausedMilliseconds = 0; }
      b.status = next;
      return ok({ booking:touch(b) });
    }
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/check-in$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      b.checkedInAt = body.checked ? new Date().toISOString() : null;
      return ok({ booking:touch(b) });
    }
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/clock$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      if (b.status !== 'running') return bad(409, 'clock_not_running', 'Start the session before changing its clock.');
      if (body.action === 'pause'){ if (!b.pausedAt) b.pausedAt = Date.now(); }
      else if (body.action === 'resume' && b.pausedAt){
        b.pausedMilliseconds = (b.pausedMilliseconds || 0) + Math.max(0, Date.now() - b.pausedAt);
        b.pausedAt = null;
      }
      return ok({ booking:touch(b) });
    }
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/payments$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      const amount = Math.round(Number(body.amount));
      if (!(amount > 0)) return bad(400, 'invalid_amount', 'Payment amount must be greater than zero.');
      if (!['Cash','UPI','Card'].includes(body.mode)) return bad(400, 'invalid_mode', 'Payment mode must be Cash, UPI or Card.');
      pay(b, amount, body.mode, body.reference);
      return ok({ booking:touch(b) });
    }
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/refunds$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      const amount = Math.round(Number(body.amount));
      if (!(amount > 0)) return bad(400, 'invalid_amount', 'Refund must be greater than zero.');
      DB.payments.push({ id:uid(), bookingId:b.id, amount, mode:body.mode || 'Cash',
        kind:'refund', reference:body.reference || '', reason:body.reason || '',
        by:USER.name, createdAt:new Date().toISOString() });
      b.collected = Math.round((b.collected || 0) - amount);
      b.collectedByMode[body.mode || 'Cash'] = Math.round((b.collectedByMode[body.mode || 'Cash'] || 0) - amount);
      return ok({ booking:touch(b) });
    }
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/extend$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      const minutes = Math.round(Number(body.minutes) || 0);
      b.end = Math.min(24 * 60, b.end + minutes);
      b.amount = priceFor(b.pitch, b.start, b.end);
      return ok({ booking:touch(b) });
    }
    if ((m = route.match(/^\/api\/bookings\/([^/]+)\/release$/)) && method === 'POST'){
      const b = byId(m[1]);
      if (!b) return bad(404, 'not_found', 'Booking not found.');
      b.status = 'cancelled';
      return ok({ ok:true });
    }

    /* — holds — */
    if (route === '/api/holds' && method === 'POST'){
      if (!free(body.date, body.pitch, body.start, body.end))
        return bad(409, 'slot_taken', 'This time overlaps another booking.');
      const hold = { id:uid(), date:body.date, pitch:body.pitch, start:body.start, end:body.end,
        team:body.team, contact:body.contact, pay:body.pay || 'Payment at venue',
        expiresAt:new Date(Date.now() + 15 * 60000).toISOString(),
        createdBy:USER.name, createdAt:new Date().toISOString() };
      DB.holds.push(hold);
      return ok({ hold });
    }
    if ((m = route.match(/^\/api\/holds\/([^/]+)\/confirm$/)) && method === 'POST'){
      const i = DB.holds.findIndex(h => h.id === m[1]);
      if (i < 0) return bad(404, 'not_found', 'Hold not found.');
      const h = DB.holds.splice(i, 1)[0];
      const b = makeBooking(h.date, h.pitch, h.start, h.end, h.team, h.contact, 'counter');
      b.pay = h.pay;
      DB.bookings.push(b);
      return ok({ booking:b });
    }
    if ((m = route.match(/^\/api\/holds\/([^/]+)\/release$/)) && method === 'POST'){
      DB.holds = DB.holds.filter(h => h.id !== m[1]);
      return ok({ ok:true });
    }

    /* — blocks — */
    if (route === '/api/blocks' && method === 'POST'){
      if (String(body.reason || '').trim().length < 15)
        return bad(400, 'invalid_reason', 'A maintenance reason of at least 15 characters is required.');
      if (!free(body.date, body.pitch, body.start, body.end))
        return bad(409, 'slot_taken', 'This time overlaps another booking.');
      const block = { id:uid(), date:body.date, pitch:body.pitch, start:body.start, end:body.end,
        reason:body.reason.trim(), active:1, createdBy:USER.name, createdAt:new Date().toISOString() };
      DB.blocks.push(block);
      return ok({ block });
    }
    if ((m = route.match(/^\/api\/blocks\/([^/]+)\/release$/)) && method === 'POST'){
      const block = DB.blocks.find(x => x.id === m[1]);
      if (block) block.active = 0;
      return ok({ ok:true });
    }

    return bad(404, 'not_found', 'The page could not be found');
  }

  function createOne(input){
    const start = Math.round(input.start), end = Math.round(input.end);
    if (!(end > start)) return { error:bad(400, 'invalid_window', 'The end must come after the start.') };
    if (end > 24 * 60) return { error:bad(400, 'closed', 'That runs past closing.') };
    if (!free(input.date, input.pitch, start, end))
      return { error:bad(409, 'slot_taken', 'That slot has already gone.') };
    const team = String(input.team || '').trim();
    const digits = String(input.contact || '').replace(/\D/g, '');
    if (team.length < 2 || digits.length < 8)
      return { error:bad(400, 'invalid_customer', 'Name/team and a contact containing 8 to 15 digits are required.') };
    const b = makeBooking(input.date, input.pitch, start, end, team, input.contact,
      input.source === 'app' ? 'app' : 'counter');
    if (input.pay) b.pay = input.pay;
    DB.bookings.push(b);
    return { booking:b };
  }

  /* A handle for the console, so a fumbled demonstration can be reset without
     a reload losing the page. */
  window.__demo = { DB, reseed(){ DB.bookings = []; DB.holds = []; DB.blocks = []; DB.payments = []; cast = 0; seed(); } };
})();
