const baseUrl = process.env.TURF_BASE_URL || 'http://127.0.0.1:5174';
const email = process.env.TURF_SEED_EMAIL;
const password = process.env.TURF_SEED_PASSWORD;

if (!email || !password){
  console.error('Set TURF_SEED_EMAIL and TURF_SEED_PASSWORD to an owner or operator account.');
  process.exit(1);
}

const localIso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = new Date();
const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
const weekKey = localIso(monday);
const nowMinute = today.getHours() * 60 + today.getMinutes();
const todayIso = localIso(today);

async function jsonRequest(path, options = {}){
  const response = await fetch(baseUrl + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok){
    const error = new Error(data.error?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.details = data.error?.details;
    throw error;
  }
  return { response, data };
}

const login = await jsonRequest('/api/auth/login', {
  method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email, password }),
});
const cookie = (login.response.headers.getSetCookie?.()[0] || login.response.headers.get('set-cookie') || '').split(';')[0];
const csrf = login.data.csrfToken;
const headers = { 'Content-Type':'application/json', Cookie:cookie, 'X-CSRF-Token':csrf };
const get = path => jsonRequest(path, { headers:{ Cookie:cookie } }).then(result => result.data);
const post = (path, body) => jsonRequest(path, { method:'POST', headers, body:JSON.stringify(body) }).then(result => result.data);

const teamSets = [
  ['Sunrise Strikers','Academy Skills Batch','Orbit Tech League'],
  ['Koramangala United','Goalkeeper Workshop','Southside Social Club'],
  ['Falcons FC','Junior Coaching Camp','BluePeak Corporate Cup'],
  ['Thursday Titans','Women’s Training Squad','Night Owls League'],
  ['Friday Five','Personal Coaching Session','Fintech Founders Cup'],
  ['Weekend Warriors','Birthday Football Party','Bengaluru Community League'],
  ['Sunday Saints','Kids Development Clinic','Hospitality Staff Tournament'],
];
const groupTypes = ['Corporate','Group','Corporate','Group','Corporate','Group','Corporate'];
const customDurations = [90,120,60,90,120,90,60];
const standardStarts = [420,480,540,450,510,570,480];
const customStarts = [630,660,690,720,630,750,660];
const eveningStarts = [1080,1110,1140,Math.max(1080,Math.min(1230,Math.floor(nowMinute / 30) * 30 - 30)),1110,1170,1080];

const planned = [];
for (let dayIndex = 0; dayIndex < 7; dayIndex++){
  const date = new Date(monday); date.setDate(date.getDate() + dayIndex);
  const iso = localIso(date), teams = teamSets[dayIndex];
  planned.push({
    date:iso, pitch:dayIndex % 3, start:standardStarts[dayIndex], end:standardStarts[dayIndex] + 60,
    team:teams[0], contact:`90000010${dayIndex}`, notes:`demo:${weekKey}:${dayIndex}:standard · App-origin standard booking`,
    kind:'standard', source:dayIndex % 2 ? 'counter' : 'app',
  });
  planned.push({
    date:iso, pitch:(dayIndex + 1) % 3, start:customStarts[dayIndex], end:customStarts[dayIndex] + customDurations[dayIndex],
    team:teams[1], contact:`90000020${dayIndex}`, notes:`demo:${weekKey}:${dayIndex}:custom · Custom-duration counter booking`,
    kind:'custom', source:'counter',
  });
  planned.push({
    date:iso, pitch:(dayIndex + 2) % 3, start:eveningStarts[dayIndex], end:eveningStarts[dayIndex] + 90,
    team:teams[2], contact:`90000030${dayIndex}`, notes:`demo:${weekKey}:${dayIndex}:group · Organised multi-session booking`,
    kind:'group', source:'counter', groupType:groupTypes[dayIndex], groupId:`demo-${weekKey}-${groupTypes[dayIndex].toLowerCase()}`,
  });
}

const state = await get(`/api/state?from=${localIso(monday)}&to=${localIso(sunday)}`);
const existingMarkers = new Set(state.bookings.map(booking => booking.notes?.match(/demo:[^ ·]+/)?.[0]).filter(Boolean));
const missing = planned.filter(booking => !existingMarkers.has(booking.notes.split(' · ')[0]));

let created = [];
if (missing.length) created = (await post('/api/bookings/batch', { bookings:missing })).bookings;

for (let index = 0; index < created.length; index++){
  let booking = created[index];
  const dayIndex = Math.round((new Date(`${booking.date}T00:00:00`) - new Date(`${weekKey}T00:00:00`)) / 86400000);
  const nature = booking.notes.match(/:(standard|custom|group)/)?.[1];
  const past = booking.date < todayIso, current = booking.date === todayIso;

  if (past && nature === 'group' && dayIndex % 2 === 0){
    booking = (await post(`/api/bookings/${booking.id}/status`, {
      status:'noshow', reason:'Demo customer did not arrive', atMinute:booking.start,
    })).booking;
  } else if (past || (current && nature !== 'group')){
    booking = (await post(`/api/bookings/${booking.id}/status`, { status:'running', atMinute:booking.start })).booking;
    booking = (await post(`/api/bookings/${booking.id}/status`, { status:'done', atMinute:booking.end })).booking;
  } else if (current && nature === 'group'){
    booking = (await post(`/api/bookings/${booking.id}/status`, { status:'running', atMinute:booking.start })).booking;
  }

  if (booking.status !== 'noshow'){
    const paymentPattern = (dayIndex + ['standard','custom','group'].indexOf(nature)) % 3;
    if (paymentPattern === 0){
      await post(`/api/bookings/${booking.id}/payments`, { amount:booking.amount, mode:'UPI', settle:true });
    } else if (paymentPattern === 1){
      await post(`/api/bookings/${booking.id}/payments`, { amount:Math.min(500, booking.amount), mode:'Cash', settle:false });
    }
  }
}

const finalState = await get(`/api/state?from=${localIso(monday)}&to=${localIso(sunday)}`);
const seeded = finalState.bookings.filter(booking => booking.notes?.startsWith(`demo:${weekKey}:`));
const summary = seeded.reduce((result, booking) => {
  result.byDate[booking.date] = (result.byDate[booking.date] || 0) + 1;
  result.byKind[booking.kind] = (result.byKind[booking.kind] || 0) + 1;
  result.byPayment[booking.pay] = (result.byPayment[booking.pay] || 0) + 1;
  result.byStatus[booking.status] = (result.byStatus[booking.status] || 0) + 1;
  return result;
}, { byDate:{}, byKind:{}, byPayment:{}, byStatus:{} });

console.log(JSON.stringify({ week:`${localIso(monday)} to ${localIso(sunday)}`, created:created.length, total:seeded.length, ...summary }, null, 2));
