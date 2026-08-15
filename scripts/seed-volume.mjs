const baseUrl = process.env.TURF_BASE_URL || 'http://127.0.0.1:5174';
const email = process.env.TURF_SEED_EMAIL;
const password = process.env.TURF_SEED_PASSWORD;
const days = Number(process.env.TURF_SEED_DAYS || 10);
const perDay = Number(process.env.TURF_SEED_PER_DAY || 15);

if (!email || !password){
  console.error('Set TURF_SEED_EMAIL and TURF_SEED_PASSWORD to an owner or manager account.');
  process.exit(1);
}
if (!Number.isInteger(days) || days < 1 || days > 31 || !Number.isInteger(perDay) || perDay < 1 || perDay > 30){
  console.error('TURF_SEED_DAYS must be 1–31 and TURF_SEED_PER_DAY must be 1–30.');
  process.exit(1);
}

const localIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date, amount) => { const copy = new Date(date); copy.setDate(copy.getDate() + amount); return copy; };
const today = new Date();
const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
startDate.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));
const endDate = addDays(startDate, days - 1);
const startKey = localIso(startDate), todayKey = localIso(today), nowMinute = today.getHours() * 60 + today.getMinutes();

async function request(path, options = {}){
  const response = await fetch(baseUrl + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Request failed (${response.status}).`);
  return { response, data };
}

const login = await request('/api/auth/login', {
  method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email, password }),
});
const cookie = (login.response.headers.getSetCookie?.()[0] || login.response.headers.get('set-cookie') || '').split(';')[0];
const csrf = login.data.csrfToken;
const get = path => request(path, { headers:{ Cookie:cookie } }).then(result => result.data);
const post = (path, body) => request(path, {
  method:'POST', headers:{ 'Content-Type':'application/json', Cookie:cookie, 'X-CSRF-Token':csrf },
  body:JSON.stringify(body),
}).then(result => result.data);

const initial = await get(`/api/state?from=${startKey}&to=${localIso(endDate)}`);
const occupied = new Map();
const addOccupied = (date, pitch, start, end) => {
  const key = `${date}|${pitch}`;
  occupied.set(key, (occupied.get(key) || []).concat({ start, end }));
};
initial.bookings.filter(booking => booking.status !== 'noshow').forEach(booking => addOccupied(booking.date,booking.pitch,booking.start,booking.end));
initial.holds.forEach(hold => addOccupied(hold.date,hold.pitch,hold.start,hold.end));
initial.blocks.forEach(block => addOccupied(block.date,block.pitch,block.start,block.end));

const markerOf = booking => booking.notes?.match(/volume:[^ ·]+/)?.[0];
const existingMarkers = new Set(initial.bookings.map(markerOf).filter(Boolean));
const kinds = ['standard','custom','group'];
const adjectives = ['Agile','Bold','City','Dynamic','Elite','Fast','Golden','Highland','Indigo','Junior','Kinetic','Lively','Metro','North','Open'];
const nouns = ['Athletics','Blazers','Comets','Dribblers','Eleven','Falcons','Guardians','Hawks','Invincibles','Jets','Kings','Lions','Mavericks','Nomads','Orbit'];
const plannedByDay = [];

function available(date, pitch, start, end){
  return !(occupied.get(`${date}|${pitch}`) || []).some(window => window.start < end && window.end > start);
}

function findWindow(date, preferredPitch, preferredStart, duration){
  const starts = [preferredStart, ...Array.from({ length:33 }, (_, index) => 360 + index * 30)]
    .filter((value,index,all) => value + duration <= 1320 && all.indexOf(value) === index);
  const pitches = [preferredPitch, ...[0,1,2].filter(pitch => pitch !== preferredPitch)];
  for (const start of starts){
    for (const pitch of pitches) if (available(date,pitch,start,start+duration)) return { pitch,start,end:start+duration };
  }
  throw new Error(`Could not find a free ${duration}-minute window on ${date}.`);
}

for (let dayIndex = 0; dayIndex < days; dayIndex++){
  const date = localIso(addDays(startDate,dayIndex)), bookings = [];
  for (let bookingIndex = 0; bookingIndex < perDay; bookingIndex++){
    const marker = `volume:${startKey}:${dayIndex}:${bookingIndex}`;
    if (existingMarkers.has(marker)) continue;
    const kind = kinds[bookingIndex % kinds.length];
    const duration = kind === 'standard' ? 60 : kind === 'custom' ? (bookingIndex % 2 ? 90 : 120) : 90;
    const preferredStart = 390 + Math.floor(bookingIndex / 3) * 180;
    const window = findWindow(date,(bookingIndex + dayIndex) % 3,preferredStart,duration);
    addOccupied(date,window.pitch,window.start,window.end);
    const team = `${adjectives[(dayIndex * 3 + bookingIndex) % adjectives.length]} ${nouns[(dayIndex * 5 + bookingIndex * 2) % nouns.length]}`;
    bookings.push({
      date,...window,team,contact:`91${String(dayIndex * 100 + bookingIndex).padStart(8,'0')}`,
      notes:`${marker} · Additional high-volume ${kind} booking`,kind,source:bookingIndex % 2 ? 'counter' : 'app',
      ...(kind === 'group' ? { groupType:bookingIndex % 2 ? 'Group' : 'Corporate', groupId:`volume-${startKey}-${dayIndex}-${bookingIndex % 3}` } : {}),
    });
  }
  plannedByDay.push({ date, bookings });
}

const created = [];
for (const day of plannedByDay){
  if (!day.bookings.length) continue;
  const result = await post('/api/bookings/batch', { bookings:day.bookings });
  created.push(...result.bookings);
}

for (const original of created){
  let booking = original;
  const marker = markerOf(booking), bookingIndex = Number(marker.split(':').at(-1));
  const past = booking.date < todayKey, current = booking.date === todayKey;
  if (past && bookingIndex % 8 === 0){
    booking = (await post(`/api/bookings/${booking.id}/status`, {
      status:'noshow', reason:'Volume seed simulated no-show', atMinute:booking.start,
    })).booking;
  } else if (past || (current && booking.end <= nowMinute)){
    booking = (await post(`/api/bookings/${booking.id}/status`, { status:'running', atMinute:booking.start,reason:'Volume seed time correction' })).booking;
    booking = (await post(`/api/bookings/${booking.id}/status`, { status:'done', atMinute:booking.end,reason:'Volume seed time correction' })).booking;
  } else if (current && booking.start <= nowMinute && booking.end > nowMinute){
    booking = (await post(`/api/bookings/${booking.id}/status`, { status:'running', atMinute:booking.start,reason:'Volume seed time correction' })).booking;
  }
  if (booking.status === 'noshow') continue;
  if (bookingIndex % 3 === 0){
    const mode=bookingIndex % 2 ? 'Card' : 'UPI';
    await post(`/api/bookings/${booking.id}/payments`, { amount:booking.amount, mode, settle:true,
      reference:`VOLUME-${booking.id.slice(0,12)}`,idempotencyKey:`volume-payment-${booking.id}` });
  } else if (bookingIndex % 3 === 1){
    const deposit = Math.min(initial.settings?.depositAmount || 500,booking.amount);
    if (deposit > 0) await post(`/api/bookings/${booking.id}/payments`, { amount:deposit, mode:'Cash', settle:false,
      idempotencyKey:`volume-payment-${booking.id}` });
  }
}

const final = await get(`/api/state?from=${startKey}&to=${localIso(endDate)}`);
const seeded = final.bookings.filter(booking => markerOf(booking)?.startsWith(`volume:${startKey}:`));
const summary = seeded.reduce((result,booking) => {
  result.seededByDate[booking.date] = (result.seededByDate[booking.date] || 0) + 1;
  result.byKind[booking.kind] = (result.byKind[booking.kind] || 0) + 1;
  result.bySource[booking.source] = (result.bySource[booking.source] || 0) + 1;
  result.byPayment[booking.pay] = (result.byPayment[booking.pay] || 0) + 1;
  result.byStatus[booking.status] = (result.byStatus[booking.status] || 0) + 1;
  return result;
}, { seededByDate:{},byKind:{},bySource:{},byPayment:{},byStatus:{} });
const totalByDate = final.bookings.reduce((counts,booking) => {
  counts[booking.date] = (counts[booking.date] || 0) + 1;
  return counts;
}, {});

console.log(JSON.stringify({ range:`${startKey} to ${localIso(endDate)}`, requestedPerDay:perDay,
  created:created.length,totalSeeded:seeded.length,totalByDate,...summary },null,2));
