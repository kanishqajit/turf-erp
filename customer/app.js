/* ═══════════════════════════════════════════════════════
   Futly — customer booking app.
   The UI stays deliberately lightweight; venues, availability,
   holds and pay-at-venue confirmations come from Futly VenueOS.
   ═══════════════════════════════════════════════════════ */

const TURFS = [];
const API_BASE = location.origin;
const venueArt = index => String(index % 5 + 1);
const venueBlurb = name => `${name} is bookable through Futly. Availability shown here is checked against the venue’s live operating ledger.`;

/* Opening windows, quantised into 30-minute blocks. */
const WINDOWS = [[6*60, 22*60]];
const HOUR_STARTS = [], BLOCKS = [];
for (const [a,b] of WINDOWS){
  for (let m = a; m < b; m += 60) HOUR_STARTS.push(m);
  for (let m = a; m < b; m += 30) BLOCKS.push(m);
}
const inOpen = m => WINDOWS.some(w => m >= w[0] && m < w[1]);

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const FEE = 0, CREDITS = 0;
const FRIENDS = [
  {id:'f1', name:'Aditya R.', initials:'AR', sub:'Paid last time'},
  {id:'f2', name:'Sameer K.', initials:'SK', sub:'Kora FC · keeper'},
  {id:'f3', name:'Nikhil M.', initials:'NM', sub:'Owes you ₹180'},
  {id:'f4', name:'Rohan D.',  initials:'RD', sub:'Kora FC · winger'},
  {id:'f5', name:'Tanvi S.',  initials:'TS', sub:'New to the squad'},
  {id:'f6', name:'Imran A.',  initials:'IA', sub:'Plays Sundays'},
];

const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const dateForDay = day => {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TURFS[0]?.timeZone||'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).reduce((a,p)=>(a[p.type]=p.value,a),{});
  const date=new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+day);
  return date.toISOString().slice(0,10);
};
const availabilityKey = (venueId,day) => `${venueId}:${dateForDay(day)}`;
const availabilityFor = (venueId,day) => S.availability[availabilityKey(venueId,day)] || null;
function isTaken(turfId, court, day, block){
  const availability=availabilityFor(turfId,day);
  if (!availability) return true;
  return availability.unavailable.some(item => String(item.resourceId)===String(court) && item.start < block + 30 && item.end > block);
}

/* ─── state ───────────────────────────────────────────── */
const S = {
  screen:'home', fmt:'all', turfId:'', court:'', day:0, start:null, dur:60,
  pay:'venue', tab:'about', bookTab:'upcoming', split:[], code:'',
  user:null,authMode:'login',authBusy:false,authEmail:'',authError:'',authMessage:'',authReturn:'',recovery:false,
  userName:'player', searching:false, q:'', csrf:'', bookings:[], requestKey:null, holdId:null, cancelAsk:null, notice:'',
  from:18*60, to:22*60,           // "Free between…" window, defaults 6 PM → 10 PM
  availability:{}, loadingVenues:true, loadingAvailability:false, loadingBookings:true, bookingsError:'', apiError:'',
  customerName:'', customerPhone:'', bookingBusy:false, latestBooking:null,
};

/* ─── derived ─────────────────────────────────────────── */
const turf      = () => TURFS.find(t => t.id === S.turfId) || TURFS[0] || null;
const matching  = t => S.fmt === 'all' ? (t.courts || []) : (t.courts || []).filter(c => c.kind === S.fmt);
const courtObj  = () => turf()?.courts.find(c => String(c.id) === String(S.court)) || turf()?.courts[0] || null;
const blockFree = m => inOpen(m) && !isTaken(turf().id, S.court, S.day, m);
const slotPrice = (venue, court, start, duration) => Math.round((court?.price || 0) * duration / 60) + (start != null && start + duration > (venue?.settings?.floodlightAfter ?? 1080) ? (venue?.settings?.floodlightFee ?? 300) : 0);
const base = () => slotPrice(turf(),courtObj(),S.start,S.dur);
const credits   = () => Math.min(CREDITS, 200);
const total     = () => base() + Math.round(base() * FEE) - credits();
const shareN    = () => total() / (S.split.length + 1);

/* Court-agnostic so the window search can test every court, not just the
   selected one. `fits` stays as the convenient wrapper for the detail screen. */
const blockFreeOn = (tid, court, day, m) => inOpen(m) && !isTaken(tid, court, day, m);
function fitsOn(tid, court, day, min, dur){
  if (min + dur > (TURFS.find(t=>t.id===tid)?.settings?.closeMinute ?? 1440)) return false;
  if (day===0 && min < venueMinute()) return false;
  for (let m = min; m < min + dur; m += 30) if (!blockFreeOn(tid, court, day, m)) return false;
  return true;
}
function fits(min, dur){
  return fitsOn(turf().id, S.court, S.day, min, dur || S.dur);
}

/* Every kick-off across every venue that fits inside [from, to] at the chosen
   duration. Deduped by clock time keeping the cheapest court, so a venue never
   lists 8:00 PM twice — all counts are of distinct kick-off times. */
function findResults(){
  const out = [];
  for (const t of TURFS){
    const byTime = new Map();
    for (const c of matching(t))
      for (const m of BLOCKS){
        if (m < S.from || m + S.dur > S.to) continue;
        if (!fitsOn(t.id, c.id, S.day, m, S.dur)) continue;
        const prev = byTime.get(m);
        if (!prev || c.price < prev.price) byTime.set(m, { court:c.id, price:c.price });
      }
    if (byTime.size)
      out.push({ t, times:[...byTime.entries()].sort((a,b) => a[0]-b[0]) });
  }
  return out.sort((a,b) => a.t.dist - b.t.dist);
}
const findTotal = () => findResults().reduce((n,r) => n + r.times.length, 0);

/* Steppers move in 30-minute steps; `to` is always at least `from + duration`,
   so nudging one pushes the other rather than producing an impossible window. */
const CLAMP = { fromLo:6*60, fromHi:21*60, toHi:23*60 };
function setFrom(d){
  S.from = Math.max(CLAMP.fromLo, Math.min(CLAMP.fromHi, S.from + d));
  if (S.to < S.from + S.dur) S.to = Math.min(CLAMP.toHi, S.from + S.dur);
  if (S.to < S.from + S.dur) S.from = S.to - S.dur;
}
function setTo(d){
  S.to = Math.min(CLAMP.toHi, Math.max(CLAMP.fromLo + S.dur, S.to + d));
  if (S.from + S.dur > S.to) S.from = Math.max(CLAMP.fromLo, S.to - S.dur);
}
function syncWindow(){ if (S.to < S.from + S.dur) setFrom(0); }
const inSpan     = m => S.start != null && m >= S.start && m < S.start + S.dur;
const openStarts = () => BLOCKS.filter(m => fits(m) || inSpan(m));

const fmtMin = min => {
  const h = Math.floor(min/60)%24, m = min % 60;
  return (h % 12 || 12) + (m ? ':30' : '') + ' ' + (h < 12 ? 'AM' : 'PM');
};
const range    = () => S.start == null ? '—' : fmtMin(S.start) + ' – ' + fmtMin(S.start + S.dur);
const durLabel = () => S.dur === 60 ? '1 hr' : S.dur === 90 ? '1½ hr' : '2 hr';

/* Slots free today across the courts the format filter actually shows —
   otherwise the tag promises availability in a format you filtered out. */
const freeCount = t => matching(t).reduce((n,c) =>
  n + HOUR_STARTS.filter(m => m>=venueMinute() && !isTaken(t.id,c.id,0,m) && !isTaken(t.id,c.id,0,m+30)).length, 0);

function dayLabel(){
  const d = new Date(dateForDay(S.day)+'T12:00:00Z');
  return S.day === 0 ? 'Today' : S.day === 1 ? 'Tomorrow' : DOW[d.getDay()] + ' ' + d.getDate();
}

async function api(path,{ method='GET',body }={}){
  if(body)await ensureSession();
  const headers=body?{'Content-Type':'application/json','X-CSRF-Token':S.csrf}:{};
  const response=await fetch(API_BASE+path,{ method,headers,credentials:'same-origin',body:body?JSON.stringify(body):undefined });
  const data=await response.json().catch(()=>({}));
  if (!response.ok){const error=new Error(data.error?.message || 'Could not reach Futly. Try again.');error.code=data.error?.code;throw error;}
  return data;
}

let sessionRequest=null;
function ensureSession(){
  if(S.csrf)return Promise.resolve();
  if(!sessionRequest)sessionRequest=api('/api/public/session').then(data=>{S.csrf=data.csrfToken;applyProfile(data.user);})
    .finally(()=>{sessionRequest=null;});
  return sessionRequest;
}

function applyAvailability(venueId,day,data){
  const current=TURFS.find(item=>item.id===venueId);
  if (!current) return;
  current.courts=data.resources.map(resource=>({ id:resource.id,n:resource.name,kind:resource.sub || 'Football',price:resource.rate,surface:'Turf' }));
  S.availability[availabilityKey(venueId,day)]=data;
  if(venueId===S.turfId&&day===S.day&&S.start!=null&&!fits(S.start,S.dur))S.start=null;
  if (venueId===S.turfId && !current.courts.some(court=>String(court.id)===String(S.court))) S.court=String(current.courts[0]?.id ?? '');
}

const availabilityRequests=new Map();
async function loadAvailability(venueId,day=S.day,force=false){
  const key=availabilityKey(venueId,day);
  if(availabilityRequests.has(key))return availabilityRequests.get(key);
  if (!force && S.availability[key]) return S.availability[key];
  S.loadingAvailability=true;S.apiError='';
  const request=(async()=>{
    try {
      const data=await api(`/api/public/venues/${encodeURIComponent(venueId)}/availability?date=${encodeURIComponent(dateForDay(day))}`);
      applyAvailability(venueId,day,data);
      return data;
    } catch (error) { S.apiError=error.message;throw error; }
    finally { availabilityRequests.delete(key);S.loadingAvailability=availabilityRequests.size>0; }
  })();
  availabilityRequests.set(key,request);
  if(!force)render(true);
  return request;
}

async function loadAllAvailability(day=S.day){ await Promise.all(TURFS.map(venue=>loadAvailability(venue.id,day))); }

async function openTurf(venueId,{ day=0,start=null,court=null }={}){
  const venue=TURFS.find(item=>item.id===venueId);if (!venue) return;
  S.turfId=venueId;S.day=day;S.start=start;S.court=court==null?'':String(court);S.tab='courts';S.screen='turf';
  render(false);
  try { await loadAvailability(venueId,day); } catch (_) { /* Render the request error in context. */ }
  render(false);
}

async function loadVenues(){
  // Browsing never waits for a guest cookie or the customer's booking history.
  loadBookings().catch(()=>{}).finally(()=>render(true));
  try {
    const data=await api('/api/public/venues');
    TURFS.splice(0,TURFS.length,...data.venues.map((venue,index)=>({ id:venue.slug,art:venueArt(index),name:venue.name,area:venue.location,
      settings:venue.settings,phone:venue.phone,timeZone:venue.timeZone,dist:0,rate:0,reviews:0,blurb:venueBlurb(venue.name),
      courts:(venue.resources||[]).map(r=>({id:r.id,n:r.name,kind:r.sub,price:r.rate,surface:'Turf'})) })));
    S.turfId=TURFS[0]?.id || '';
    const policy=TURFS[0]?.settings;if(policy){WINDOWS.splice(0,WINDOWS.length,[policy.openMinute,policy.closeMinute]);HOUR_STARTS.splice(0);BLOCKS.splice(0);for(let m=policy.openMinute;m<policy.closeMinute;m+=30){BLOCKS.push(m);if(m%60===0)HOUR_STARTS.push(m);}CLAMP.fromLo=policy.openMinute;CLAMP.fromHi=policy.closeMinute-60;CLAMP.toHi=policy.closeMinute;}
    S.loadingVenues=false;render(true);
    await loadAllAvailability(0);
  } catch (error) { S.apiError=error.message; }
  finally { S.loadingVenues=false;render(true); }
}

/* ─── icons ───────────────────────────────────────────── */
const I = {
  pin:'<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8Z"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/>',
  card:'<rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 11h20"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/>',
  heart:'<path d="M20.8 9.1a4.6 4.6 0 0 0-8.8-1.9 4.6 4.6 0 0 0-8.8 1.9C3.2 14 12 19.5 12 19.5s8.8-5.5 8.8-10.4Z"/>',
  back:'<path d="m14 6-6 6 6 6"/>',
  chev:'<path d="m9 6 6 6-6 6"/>',
  arrow:'<path d="M5 12h13M12 5l7 7-7 7"/>',
  tick:'<path d="m4 12 5 5L20 6"/>',
  phone:'<path d="M4 5c0-1 1-2 2-2h2l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2v2c0 1-1 2-2 2A17 17 0 0 1 4 5Z"/>',
  chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.6 6.8-4M8.6 13.4l6.8 4"/>',
  more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  home:'<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cup:'<path d="M8 4h8v6a4 4 0 0 1-8 0Z"/><path d="M8 6H5a4 4 0 0 0 3 4M16 6h3a4 4 0 0 1-3 4M12 14v3M9 20h6l-1-3h-4Z"/>',
  wallet:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M17 14h1"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>',
  plan:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M3 12h6"/>',
  edit:'<path d="m4 20 4-1 10-10-3-3L5 16Z"/><path d="m14 6 3 3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
};
const ic = (k, sz, w) => `<svg width="${sz||18}" height="${sz||18}" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="${w||1.8}" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;
const starSvg = (sz) => `<svg width="${sz||11}" height="${sz||11}" viewBox="0 0 24 24" fill="#D7F24B" stroke="#B9D62F"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9Z"/></svg>`;

const AV_FILL = ['#3A3F45','#3D4249','#4F555C','#61686F'];
const stack = (n, ringBg, size, last) => {
  let h = '<span class="stack">';
  for (let i = 0; i < n; i++){
    const isLast = i === n - 1 && last;
    h += `<span class="avatar av-ring" style="background:${isLast ? '#D7F24B' : AV_FILL[i % 4]};
      color:${isLast ? '#16181C' : '#fff'};border-color:${ringBg};width:${size}px;height:${size}px">${isLast ? last : ''}</span>`;
  }
  return h + '</span>';
};

/* ─── home ────────────────────────────────────────────── */
const hitsQuery = t => !S.q.trim() ||
  (t.name + ' ' + t.area).toLowerCase().includes(S.q.trim().toLowerCase());

function vList(){
  return TURFS.filter(hitsQuery).sort((a,b) => a.dist - b.dist);
}
const priceOf = t => matching(t).length ? money(Math.min.apply(null, matching(t).map(c => c.price))) : 'Live rates';
const priceWithUnit = t => matching(t).length ? `${priceOf(t)}<span> / hr</span>` : priceOf(t);

function screenHome(){
  const list = vList(), feature = list[0];
  const chips = [['all','All formats'],['5-a-side','5-a-side'],['7-a-side','7-a-side'],['11-a-side','11-a-side']];

  return `<div class="pad">
    <div class="hdr-row">
      <button class="avatar hdr-av" data-act="go" data-v="profile" aria-label="Your profile">${esc(S.userName[0].toUpperCase())}</button>
      <span class="hdr-who">
        <b>Hi, ${esc(S.userName)}</b>
        <span class="hdr-loc">${ic('pin',11,2)} ${esc(TURFS[0]?.area || 'Choose your venue')}</span>
      </span>
      <span class="credits">Live</span>
      <button class="bell" data-act="go" data-v="bookings" aria-label="My bookings">${ic('bell',15,1.7)}<i></i></button>
    </div>

    <div class="headwrap ${S.searching?'on':''}" id="headwrap">
      <div class="headline">
        <div>
          <div class="l1"><span class="big">Book</span><span class="pill">Your</span></div>
          <div class="l2">Perfect Pitch.</div>
        </div>
      </div>
      <button class="searchbtn" data-act="search-open" aria-label="Search">${ic('search',21,1.9)}</button>
      <div class="searchbar">
        <span class="mag">${ic('search',19,1.9)}</span>
        <input id="q" type="text" placeholder="Search turfs or areas"
          value="${esc(S.q)}" autocomplete="off" ${S.searching?'':'tabindex="-1"'}>
        <button class="xbtn" data-act="search-close" aria-label="Close search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
    </div>

    ${S.apiError ? `<div class="noslots" style="margin-bottom:16px"><b>Couldn’t load live venues</b><span class="t-sub">${esc(S.apiError)}</span></div>` : ''}
    ${findPanel()}

    <div class="chiprow sc mb-lg">
      ${chips.map(([k,l]) => `<button class="chip ${S.fmt===k?'on':''}" data-act="fmt" data-v="${k}">${l}</button>`).join('')}
    </div>

    <div class="screen-head">
      <h2 class="t-sec">${S.q.trim() ? 'Results' : 'Available venues'}</h2>
      <span class="t-sub" id="secNote">${listNote(list)}</span>
    </div>

    <div id="turfList">${S.loadingVenues ? `<div class="noslots"><b>Loading live venues…</b><span class="t-sub">Checking Futly availability.</span></div>` : turfListHtml()}</div>

  </div>`;
}

/* "Free between…" — search every turf at once for a window that works. */
function findPanel(){
  const n = findTotal();
  const hasLiveData = Object.keys(S.availability).length > 0;
  const field = (which, label, val) => `<div class="fp-field">
    <span class="fp-lbl">${label}</span>
    <div class="fp-val">
      <b>${fmtMin(val)}</b>
      <span class="fp-steps">
        <button data-act="win" data-v="${which}:-30" aria-label="${label} earlier">–</button>
        <button data-act="win" data-v="${which}:30" aria-label="${label} later">+</button>
      </span>
    </div>
  </div>`;

  return `<div class="findpanel">
    <div class="fp-head">
      <span class="fp-ic">${ic('clock',16,1.9)}</span>
      <span class="fp-txt"><b>Free between…</b><small>Search every turf at once</small></span>
      <span class="fp-new">NEW</span>
    </div>
    <div class="fp-fields">${field('from','From',S.from)}${field('to','Until',S.to)}</div>
    <div class="fp-bottom">
      <div class="fp-durs">
        ${[[60,'1 hr'],[90,'1½'],[120,'2 hr']].map(([d,l]) =>
          `<button class="fp-dur ${S.dur===d?'on':''}" data-act="windur" data-v="${d}">${l}</button>`).join('')}
      </div>
      <button class="fp-cta" data-act="go" data-v="find">
        ${hasLiveData ? `Find ${n} slot${n===1?'':'s'}` : 'Search live slots'} ${ic('chev',15,2.4)}
      </button>
    </div>
  </div>`;
}

/* ─── window-search results ───────────────────────────── */
function screenFind(){
  const res = findResults();
  const matched = res.length, all = TURFS.filter(t => matching(t).length).length;
  const durTxt = durLabel();

  return `<div class="pad">
    <div class="topbar">
      <button class="back-flat" data-act="go" data-v="home">${ic('back',19,2)}</button>
      <h1>Open pitches</h1>
    </div>
    <p class="t-sub2" style="margin:-8px 0 16px">${fmtMin(S.from)} – ${fmtMin(S.to)} · ${durTxt} ·
      ${S.day===0?'today':dayLabel().toLowerCase()} · ${matched} of ${all} turfs</p>

    <div class="chiprow sc mb-lg">
      ${[[60,'1 hr games'],[90,'1½ hr games'],[120,'2 hr games']].map(([d,l]) =>
        `<button class="chip ${S.dur===d?'on':''}" data-act="windur" data-v="${d}">${l}</button>`).join('')}
      <button class="chip" data-act="go" data-v="home">Change window</button>
    </div>

    ${!res.length ? `<div class="noslots">
      <b>Nothing open in that window</b>
      <span class="t-sub">Widen the window, shorten the game, or try tomorrow.</span>
    </div>` : res.map(r => {
      const cheapest = Math.min(...r.times.map(([,v]) => v.price));
      const shown = r.times.slice(0,4), more = r.times.length - shown.length;
      return `<div class="fcard">
        <div class="fc-top">
          <span class="fc-pic">${art(r.t.art)}</span>
          <span class="fc-txt">
            <b>${esc(r.t.name)}</b>
            <small>${r.times.length} kick-off${r.times.length===1?'':'s'} open</small>
          </span>
          <span class="fc-price"><b>${money(slotPrice(r.t,{price:cheapest},shown[0]?.[0],S.dur))}</b><small>for ${durTxt}</small></span>
        </div>
        <div class="fc-pills">
          ${shown.map(([m,v]) =>
            `<button class="fpill" data-act="findpick" data-v="${r.t.id}:${v.court}:${m}">${fmtMin(m)}</button>`).join('')}
          ${more > 0 ? `<button class="fpill more" data-act="turf" data-v="${r.t.id}">+${more} more</button>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

const listNote = list => S.q.trim()
  ? `${list.length} match${list.length===1?'':'es'}`
  : `${list.length} turf${list.length===1?'':'s'} · live availability`;

/* Rendered on its own so typing can refresh results without rebuilding the
   header — that would blow away input focus and restart the expand animation. */
function turfListHtml(){
  const list = vList(), feature = list[0];
  if (!list.length) return `<div class="noslots">
    <b>Nothing matches “${esc(S.q.trim())}”</b>
    <span class="t-sub">${TURFS.length ? 'Try a turf name or an area.' : 'No venues are listed yet.'}</span></div>`;

  const row = (t,i) => {
    const live=availabilityFor(t.id,0),free=live ? freeCount(t) : null;
    return `<button class="trow" data-act="turf" data-v="${t.id}" style="--i:${i}">
      <span class="thumb">${art(t.art)}</span>
      <span class="txt">
        <span class="name">${esc(t.name)}</span>
        <span class="t-sub">${esc(t.area)} · Live availability</span>
        <span class="foot">
          <span class="price">${priceWithUnit(t)}</span>
          <span class="tag" style="background:${free==null?'#F1F2ED':free?'#EFF8CE':'#F1F2ED'};color:${free==null?'#9AA0A6':free?'#6E8A11':'#9AA0A6'}">
            ${free==null ? 'Check live times' : free ? free + ' slots today' : 'fully booked'}</span>
        </span>
      </span>
    </button>`;
  };

  return `<button class="feature" data-act="turf" data-v="${feature.id}" style="--i:0">
      ${art(feature.art)}
      <span class="scrim"></span>
      <span class="badges">
        <span class="tag" style="background:#D7F24B">FLOODLIT</span>
        <span class="tag" style="background:rgba(255,255,255,.9)">Demo venue</span>
      </span>
      <span class="info">
        <span class="txt">
          <span class="t-card">${esc(feature.name)}</span>
          <span class="t-sub">${esc(feature.area)}</span>
          <span class="price">${priceWithUnit(feature)}</span>
        </span>
        <span class="go">${ic('arrow',19,2)}</span>
      </span>
    </button>
    <div class="rows">${list.slice(1).map((t,i) => row(t,i+1)).join('')}</div>`;
}

/* ─── turf detail ─────────────────────────────────────── */
function screenTurf(){
  const t = turf();
  const courts=t.courts || [];
  const lo = courts.length ? money(Math.min.apply(null, courts.map(c => c.price))) : 'Loading';
  const hi = courts.length ? money(Math.max.apply(null, courts.map(c => c.price))) : 'rates';
  const tabs = [['about','About'],['courts','Courts']];

  return `<div class="pad-flush">
    <div class="hero">
      ${art(t.art)}
      <span class="scrim"></span>
      <button class="back" data-act="go" data-v="home">${ic('back',19,2)}</button>
      <span class="plan">Court plan</span>
      <span class="lip"></span>
    </div>

    <div class="turf-head">
      <h1>${esc(t.name)}</h1>
      <div class="meta">${ic('pin',12,2)} ${esc(t.area)} · ${lo}–${hi}</div>
      <div class="socialrow"><span class="star" style="font-size:13px">Live availability</span></div>
    </div>

    <div class="tabs">
      ${tabs.map(([k,l]) => `<button class="chip ${S.tab===k?'on':''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}
    </div>

    ${S.tab === 'about'   ? tabAbout(t)   : ''}
    ${S.tab === 'courts'  ? tabCourts(t)  : ''}
    ${S.tab === 'reviews' ? tabReviews(t) : ''}
  </div>`;
}

function tabAbout(t){
  return `<div class="sect"><h3 class="t-sec">About the pitch</h3><p class="t-body">${esc(t.blurb)}</p>
    <div class="amen"><div><i class="sq"></i>Floodlights after 6 PM</div><div><i class="sq"></i>Pay at venue</div></div>
    <h3 class="t-sec" style="margin-top:22px">Contact</h3>${t.phone ? `<div class="contact"><a class="call" href="tel:${esc(t.phone.replace(/[^\d+]/g,''))}">Call venue</a></div>` : '<p class="t-body">Contact the venue staff about changes to a paid booking.</p>'}</div>`;
}

function tabCourts(t){
  if (S.loadingAvailability && !(t.courts || []).length) return `<div class="sect"><div class="noslots"><b>Loading live availability…</b><span class="t-sub">Checking the venue’s booking ledger.</span></div></div>`;
  if (!(t.courts || []).length) return `<div class="sect"><div class="noslots"><b>Live availability is unavailable</b><span class="t-sub">${esc(S.apiError || 'Try reopening this venue.')}</span></div></div>`;
  const open = openStarts();
  const am = open.filter(m => m < 12*60), pm = open.filter(m => m >= 12*60);
  const booked = BLOCKS.filter(m => !blockFree(m)).length;

  const durs = [60,90,120].map(d => {
    const n = HOUR_STARTS.reduce((k,m) => k + (fits(m,d)?1:0) + (fits(m+30,d)?1:0), 0);
    return { d, n, label: d===60?'1 hr':d===90?'1½ hr':'2 hr' };
  });
  const fitNow = HOUR_STARTS.reduce((k,m) => k + (fits(m)?1:0) + (fits(m+30)?1:0), 0);

  const pill = m => {
    const st = S.start === m ? 'start' : inSpan(m) ? 'span' : 'free';
    const tappable = fits(m);
    const h = Math.floor(m/60) % 12 || 12;
    return `<button class="slot ${st}" ${tappable ? `data-act="slot" data-v="${m}"` : ''}
      ${tappable ? '' : 'tabindex="-1"'}>${h}:${m % 60 ? '30' : '00'}</button>`;
  };
  const group = (label, arr) => arr.length ? `<div class="grp">
      <div class="grp-lbl"><span>${label}</span><i></i></div>
      <div class="slots">${arr.map(pill).join('')}</div>
    </div>` : '';

  return `<div class="sect">
    <h3 class="t-sec" style="margin-bottom:10px">Pick a court</h3>
    <div class="rows" style="gap:9px">
      ${t.courts.map(c => `<button class="courtrow ${String(c.id)===String(S.court)?'on':''}" data-act="court" data-v="${c.id}">
        <span class="tile">${c.n.slice(0,1)}</span>
        <span class="txt"><b>${esc(c.n)}</b><small>${esc(c.kind)} · ${c.surface}</small></span>
        <span class="p">${money(c.price)}<small>per hour</small></span>
      </button>`).join('')}
    </div>

    <h3 class="t-sec" style="margin:22px 0 10px">Pick a day</h3>
    <div class="days sc">
      ${Array.from({length:7}, (_,i) => {
        const d = new Date(dateForDay(i)+'T12:00:00Z');
        return `<button class="day ${i===S.day?'on':''}" data-act="day" data-v="${i}">
          <small>${i===0?'Today':DOW[d.getUTCDay()]}</small><b>${d.getUTCDate()}</b></button>`;
      }).join('')}
    </div>

    <div class="screen-head" style="margin:22px 0 10px">
      <h3 class="t-sec">How long?</h3>
      <span class="t-sub">${money(base())}${S.start!=null&&S.start+S.dur>(t.settings?.floodlightAfter??1080)?' incl. floodlights':''} · ${fitNow} starts fit</span>
    </div>
    <div class="durs">
      ${durs.map(x => `<button class="dur ${S.dur===x.d?'on':''}" data-act="dur" data-v="${x.d}">
        <b>${x.label}</b><small>${x.n} starts</small></button>`).join('')}
    </div>

    <div class="screen-head" style="margin:22px 0 2px">
      <h3 class="t-sec">Start time</h3>
      <span class="t-sub">${open.length} kick-off${open.length===1?'':'s'} open for a ${durLabel()} game</span>
    </div>
    <p class="t-sub" style="line-height:1.5">Every time shown is bookable right now — ${booked} of ${BLOCKS.length} half-hours unavailable on ${esc(courtObj()?.n || 'this court')}.</p>

    ${open.length ? group('MORNING', am) + group('EVENING', pm) : `<div class="noslots" style="margin-top:16px">
      <b>No ${durLabel()} window left ${S.day===0?'today':'that day'}</b>
      <span class="t-sub">Try a shorter game, another court, or the next day.</span></div>`}
  </div>`;
}

function tabReviews(t){
  const bars = [['5','78%'],['4','52%'],['3','18%'],['2','8%'],['1','4%']];
  const REV = [
    { name:'Sameer Kulkarni', when:'2 weeks ago', rate:'5.0',
      d:['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM12 7.5l3.6 2.6-1.4 4.3H9.8L8.4 10.1ZM12 7.5V3M8.4 10.1 4.3 8.8M15.6 10.1l4.1-1.3M9.8 14.4 7.3 18M14.2 14.4 16.7 18',
          'M12 22V9M7 9h10l-1.2-4H8.2ZM8.6 5 9 2M15.4 5 15 2M4 22h16',
          'M3 15h6l4 2h6a2 2 0 0 1 2 2v1H3ZM4 15V9h4l1 3M9 12h4'],
      text:'Turf is genuinely well kept — no bald patches near the goal, and the lights are bright enough for a 10 PM game. Booking through the app saved the usual four phone calls.' },
    { name:'Priya Nair', when:'Last month', rate:'4.0',
      d:['M4 5h16v10H4ZM4 15v4M20 15v4M8 8h2M14 8h2M12 6v8',
          'M12 4l5 14H7ZM9 12h6M5 20h14',
          'M3 10h9l3-2v7l-3-2H3ZM3 10v5h9M17 9h3M17 13h3'],
      text:'Great pitch, parking is tight on weekends. Ground staff swapped our court when the sprinklers came on — no fuss.' },
  ];
  const grounds = [['#16181C','#D7F24B'],['#EDF8C4','#5E6B23'],['#F4F5F0','#5E646B']];

  return `<div class="sect">
    <div class="card">
      <div class="ratingsum">
        <div>
          <div class="n">${t.rate}</div>
          <div class="t-sub">${t.reviews} reviews</div>
        </div>
        <div class="bars">
          ${bars.map(([n,p]) => `<div class="bar">${n}<i><b style="width:${p}"></b></i></div>`).join('')}
        </div>
      </div>
    </div>
    ${REV.map(r => `<div class="review">
      <div class="top">
        <span class="avatar">${r.name.split(' ').map(w=>w[0]).join('')}</span>
        <span style="flex:1"><b>${esc(r.name)}</b><small>${r.when}</small></span>
        <span class="tag" style="background:#EFF8CE;color:#6E8A11">★ ${r.rate}</span>
      </div>
      <p>${esc(r.text)}</p>
      <div class="doodles">${r.d.map((d,i) => doodle(d, grounds[i][0], grounds[i][1])).join('')}</div>
    </div>`).join('')}
  </div>`;
}

/* ─── checkout ────────────────────────────────────────── */
function screenCheckout(){
  const t = turf(), c = courtObj();
  return `<div class="pad">
    <div class="topbar">
      <button class="back-flat" data-act="go" data-v="turf">${ic('back',19,2)}</button>
      <h1>Confirm your booking</h1>
    </div>

    <div class="card">
      <div class="sum-top">
        <span class="tile">⚽</span>
        <span><b>${esc(t.name)}</b><small>${esc(c.n)} · ${esc(c.kind)}</small></span>
      </div>
      <div class="divider"></div>
      <div class="grid2">
        <div><span>Day</span><b>${dayLabel()}</b></div>
        <div><span>Time</span><b>${range()} · ${durLabel()}</b></div>
      </div>
    </div>

    <div class="auth-message" style="margin-top:16px">${S.user?`Booking as ${esc(S.user.email)}`:'Sign in at the next step to save this booking to your profile.'}</div>
    <h3 class="t-sec" style="margin:22px 0 10px">Booking details</h3>
    <div class="card" style="display:grid;gap:12px">
      <label class="booking-field"><span>Name or team</span><input id="customer-name" value="${esc(S.customerName)}" placeholder="e.g. Kanishq or Kozhikode FC" maxlength="120" autocomplete="name"></label>
      <label class="booking-field"><span>Mobile number</span><input id="customer-phone" value="${esc(S.customerPhone)}" placeholder="+91 98765 43210" maxlength="80" inputmode="tel" autocomplete="tel"></label>
    </div>

    <h3 class="t-sec" style="margin:22px 0 10px">Payment</h3>
    <div class="payrow on" style="cursor:default">
      <span class="tile">₹</span><span class="txt"><b>Pay at venue</b><small>Confirm your slot now and pay the staff when you arrive.</small></span>
      <span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#D7F24B" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${I.tick}</svg></span>
    </div>
    ${S.apiError ? `<p class="booking-error" role="alert">${esc(S.apiError)}</p>` : ''}

    <div class="card" style="margin-top:16px">
      <div class="billrow"><span>Pitch time</span><b>${money(Math.round(c.price*S.dur/60))}</b></div>${S.start+S.dur>(t.settings?.floodlightAfter??1080)?`<div class="billrow"><span>Floodlights</span><b>${money(t.settings?.floodlightFee??300)}</b></div>`:''}
      <div class="divider"></div>
      <div class="billrow total"><span>Total due at venue</span><b>${money(base())}</b></div>
    </div>
  </div>`;
}

/* ─── split ───────────────────────────────────────────── */
function screenSplit(){
  return `<div class="pad">
    <div class="topbar">
      <button class="back-flat" data-act="go" data-v="checkout">${ic('back',19,2)}</button>
      <h1>Split the bill</h1>
    </div>
    <p class="t-sub2" style="margin:-8px 0 18px">Everyone gets a payment link. The pitch is held for 30 minutes.</p>

    <div class="card-ink perhead">
      <div class="t-micro" style="color:#8B9199">PER HEAD</div>
      <div class="n">${money(shareN())}</div>
      <small>${S.split.length + 1} playing · ${money(total())} total</small>
    </div>

    <h3 class="t-sec" style="margin:22px 0 10px">Your squad</h3>
    <div class="rows" style="gap:9px">
      ${FRIENDS.map(f => {
        const on = S.split.indexOf(f.id) >= 0;
        return `<button class="frow ${on?'on':''}" data-act="friend" data-v="${f.id}">
          <span class="avatar">${f.initials}</span>
          <span class="txt"><b>${esc(f.name)}</b><small>${on ? 'Link will be sent' : esc(f.sub)}</small></span>
          <span class="amt" style="color:${on?'#16181C':'#8E949B'}">${on ? money(shareN()) : '+ Add'}</span>
        </button>`;
      }).join('')}
    </div>
  </div>`;
}

/* ─── confirmation ────────────────────────────────────── */
function screenDone(){
  const t = turf(),c=courtObj(),booking=S.latestBooking;
  return `<div class="pad" style="padding-top:120px">
    <div class="done">
      <div class="mark"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16181C"
        stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${I.tick}</svg></div>
      <h1>Pitch booked</h1>
      <p class="sub">Confirmed with the venue. ${money(booking?.outstanding ?? base())} due when you arrive.</p>${S.notice?`<p role="status">${esc(S.notice)}</p>`:''}

      <div class="ticket">
        <div class="in">
          <div class="code"><span class="t-micro">Booking code</span><b>${esc(S.code)}</b></div>
          <div class="dashed"></div>
          <div class="grid2">
            <div><span>Turf</span><b>${esc(t.name)}</b></div>
            <div><span>Court</span><b>${esc(c?.n || 'Pitch')}</b></div>
            <div><span>Day</span><b>${dayLabel()}</b></div>
            <div><span>Time</span><b>${range()}</b></div>
          </div>
        </div>
        <div class="foot">
          <button class="w" data-act="calendar">Add to calendar</button>
          <button class="k" data-act="share-booking">Share booking</button>
        </div>
      </div>

      <button class="bigcta" data-act="go" data-v="bookings">View this booking</button>
    </div>
  </div>`;
}

/* ─── bookings ────────────────────────────────────────── */
function screenBookings(){
  return `<div class="pad"><h1 class="t-title">My bookings</h1>
    <p class="t-sub" style="margin:4px 0 20px">${S.user?'Linked to your profile. Staff updates and payments appear here.':'Sign in to keep your bookings across devices. Existing browser bookings appear below.'}</p>
    ${S.apiError?`<p class="booking-error" role="alert">${esc(S.apiError)}</p>`:''}
    ${!S.user?'<button class="bigcta" style="margin-bottom:16px" data-act="go" data-v="profile">Sign in or create account</button>':''}
    ${S.bookingsError?`<p class="booking-error" role="alert">${esc(S.bookingsError)}</p>`:''}
    ${!S.bookings.length?(S.loadingBookings?'<div class="noslots"><b>Loading your bookings…</b></div>':S.bookingsError?'':'<div class="noslots"><b>No bookings yet</b><span class="t-sub">Choose a live slot for your first game.</span></div>'):S.bookings.map(b=>{
      const date=new Date(b.date+'T00:00:00');
      const state=b.status==='cancelled'?'Cancelled':b.status==='done'?'Finished':b.status==='running'?(b.paused?'Paused':'In play'):b.status==='noshow'?'No-show':'Confirmed';
      return `<div class="card booking-card" style="margin-bottom:14px"><span class="tag">${state}</span>
      <h3 class="t-sec" style="margin-top:12px">${esc(b.venueName)}</h3><p class="t-body">${esc(b.pitchName)} · ${date.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})}<br>${fmtMin(b.start)} – ${fmtMin(b.end)}</p>
      <p class="t-body">${esc(b.team)} · ${esc(b.code)}</p><div class="billrow"><span>Total</span><b>${money(b.amount-b.discount)}</b></div><div class="billrow"><span>${b.status==='cancelled'?'Cancelled booking':b.outstanding?'Due at venue':'Paid'}</span><b>${b.status==='cancelled'?'—':money(b.outstanding||b.collected)}</b></div>
      ${b.status==='upcoming'&&b.collected===0&&(b.date>dateForDay(0)||(b.date===dateForDay(0)&&b.start>venueMinute()))?(S.cancelAsk===b.id?`<p class="t-body">Cancel this booking and free the slot?</p><button class="bigcta" data-act="cancel-confirm" data-v="${b.id}"${S.bookingBusy?' disabled':''}>Confirm cancellation</button><button class="chip" data-act="cancel-dismiss">Keep booking</button>`:`<button class="chip" style="margin-top:12px" data-act="cancel-ask" data-v="${b.id}">Cancel booking</button>`):''}</div>`;
    }).join('')}</div>`;
}

/* ─── cups ────────────────────────────────────────────── */
function screenCups(){
  const table = [
    {rank:1,team:'Kora FC',p:6,w:5,pts:16,mine:true},
    {rank:2,team:'HSR United',p:6,w:5,pts:15},
    {rank:3,team:'Indira Rangers',p:6,w:4,pts:13},
    {rank:4,team:'BTM Bulls',p:6,w:3,pts:10},
    {rank:5,team:'JP Nagar XI',p:6,w:2,pts:7},
    {rank:6,team:'Ejipura Athletic',p:6,w:1,pts:4},
  ];
  const crests = ['#D7F24B','#3D4249','#B9C1C8','#8E949B','#C9CEC2','#E1E3DA'];

  return `<div class="pad">
    <h1 class="t-title">Cups &amp; leagues</h1>
    <p class="t-sub" style="margin:2px 0 20px">Koramangala Sunday League · Week 6</p>

    <div class="banner">
      ${TROPHY}
      <span class="scrim"></span>
      <div class="in">
        <span class="tag" style="background:#D7F24B">REGISTRATION OPEN</span>
        <h3>Monsoon Cup · 7-a-side</h3>
        <p>16 teams · ₹4,000 per team · Prize ₹40,000</p>
      </div>
    </div>

    <div class="table">
      <div class="tr head"><span>#</span><span>Team</span><span class="num">P</span><span class="num">W</span><span class="pts">Pts</span></div>
      ${table.map((r,i) => `<div class="tr" style="background:${r.mine?'#F7FCE4':'#fff'}">
        <span style="color:${r.mine?'#6E8A11':'#8E949B'};font-weight:700">${r.rank}</span>
        <span class="team"><i class="crest" style="background:${crests[i]}"></i>
          <b style="font-weight:${r.mine?700:600}">${r.team}</b></span>
        <span class="num">${r.p}</span><span class="num">${r.w}</span><span class="pts">${r.pts}</span>
      </div>`).join('')}
    </div>

    <div class="card-ink" style="margin-top:16px">
      <div class="t-micro" style="color:#8B9199;text-align:center">Next fixture</div>
      <div class="fixture">
        <div class="side"><i class="crest" style="background:#D7F24B;width:34px;height:34px"></i><b>Kora FC</b></div>
        <div class="mid"><b>SUN</b><small>7:00 PM</small></div>
        <div class="side"><i class="crest" style="background:#3D4249;width:34px;height:34px"></i><b>HSR United</b></div>
      </div>
    </div>
  </div>`;
}

/* ─── wallet ──────────────────────────────────────────── */
function screenWallet(){
  const offers = [
    {big:'20% off',t:'Weekday mornings',s:'Any 6–10 AM slot, Mon to Thu.',c:'EARLYBIRD',bg:'#16181C',bd:'#3A3F45',fg:'#fff',sf:'#A9AEB4'},
    {big:'₹200 back',t:'Bring a new player',s:'Credits land after their first game.',c:'SQUAD200',bg:'#D7F24B',bd:'#BCD53C',fg:'#16181C',sf:'#5E6B23'},
    {big:'Free hour',t:'Book 5, play 6',s:'Sixth booking this month is on us.',c:'AUTO',bg:'#fff',bd:'#EAECE4',fg:'#16181C',sf:'#8E949B'},
  ];
  const txns = [
    {ic:'−',n:'Greenfield Arena · Court B',w:'Today, 6:12 PM',a:'– ₹1,690',af:'#16181C',ib:'#F4F5F0',if:'#7B8189'},
    {ic:'+',n:'Split from Nikhil M.',w:'Yesterday',a:'+ ₹380',af:'#6E8A11',ib:'#EFF8CE',if:'#6E8A11'},
    {ic:'+',n:'Referral credit · SQUAD200',w:'28 Jul',a:'+ ₹200',af:'#6E8A11',ib:'#EFF8CE',if:'#6E8A11'},
    {ic:'−',n:'Monsoon Cup entry',w:'24 Jul',a:'– ₹4,000',af:'#16181C',ib:'#F4F5F0',if:'#7B8189'},
  ];

  return `<div class="pad">
    <h1 class="t-title">Wallet</h1>
    <p class="t-sub" style="margin:2px 0 20px">Credits never expire</p>

    <div class="card-ink balance">
      <div class="top">
        <div>
          <div class="t-micro" style="color:#8B9199">TURF CREDITS</div>
          <div class="n">₹450</div>
        </div>
        <div class="tile" style="color:#16181C">${ic('card',20,1.8)}</div>
      </div>
      <div class="acts">
        <button class="a1">Add money</button>
        <button class="a2">Send to friend</button>
      </div>
    </div>

    <h3 class="t-sec" style="margin:22px 0 4px">Offers</h3>
    <div class="offers sc">
      ${offers.map(o => `<div class="offer" style="background:${o.bg};border-color:${o.bd};color:${o.fg}">
        <div class="big">${o.big}</div>
        <div class="t">${o.t}</div>
        <div class="s" style="color:${o.sf}">${esc(o.s)}</div>
        <div class="rule"></div>
        <div class="cd"><span>${o.c}</span><span style="color:${o.sf}">Apply</span></div>
      </div>`).join('')}
    </div>

    <h3 class="t-sec" style="margin:22px 0 2px">Activity</h3>
    <div>${txns.map(x => `<div class="txn">
      <span class="tile" style="background:${x.ib};color:${x.if}">${x.ic}</span>
      <span class="txt"><b>${esc(x.n)}</b><small>${x.w}</small></span>
      <span class="amt" style="color:${x.af}">${x.a}</span>
    </div>`).join('')}</div>
  </div>`;
}

/* ─── profile ─────────────────────────────────────────── */
function screenProfile(){
  const message=S.authMessage?`<p class="auth-message" role="status">${esc(S.authMessage)}</p>`:'';
  const error=S.authError?`<p class="booking-error" role="alert">${esc(S.authError)}</p>`:'';
  const back=S.authReturn?'<button class="chip" data-act="auth-back">Back to booking</button>':'';
  if(S.user&&!S.recovery)return `<div class="pad">
    <h1 class="t-title">Your profile</h1><p class="t-sub">Your games, wherever you sign in.</p>
    <div class="prof"><span class="avatar">${esc(S.userName[0].toUpperCase())}</span><span class="who"><h1>${esc(S.user.name||'Futly player')}</h1><p>${esc(S.user.email)}</p></span></div>
    <div class="card"><h2 class="t-sec">Bookings that stay with you</h2><p class="t-body">Sign in with this email on any device to see your bookings and the latest payments from the venue.</p>
    <button class="bigcta" data-act="go" data-v="bookings">My bookings</button></div>${message}${error}
    <div class="auth-actions">${back}<button class="chip" data-act="auth-mode" data-v="password">Change password</button><button class="chip" data-act="auth-logout" ${S.authBusy?'disabled':''}>${S.authBusy?'Signing out…':'Sign out'}</button></div></div>`;
  const mode=S.recovery?'password':S.authMode, signup=mode==='signup',recover=mode==='recover',password=mode==='password';
  const title=password?'Set a new password':recover?'Reset your password':signup?'Create your account':'Welcome back';
  const label=password?'Save password':recover?'Send reset email':signup?'Create account':'Sign in';
  return `<div class="pad"><span class="tag">YOUR FUTLY ACCOUNT</span><h1 class="t-title" style="margin-top:14px">${title}</h1>
    <p class="t-body">${password?'Use at least 10 characters.':recover?'We’ll email a secure reset link. Open it in this browser.':'Keep your bookings together, across every device.'}</p>
    ${S.loadingBookings&&!S.csrf?'<p class="t-sub">Checking your session…</p>':''}
    ${!recover&&!password?`<button class="google-signin" data-act="auth-google" ${S.authBusy?'disabled':''}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.3 2.98-7.36Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.8-1.76-5.58-4.13H3.08v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.42 13.92A6 6 0 0 1 6.1 12c0-.67.11-1.32.32-1.92V7.49H3.08A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.51l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.92 5.49l3.34 2.59A5.99 5.99 0 0 1 12 5.95Z"/></svg>Continue with Google</button><div class="auth-or">or use your email</div>`:''}
    <form id="customer-auth-form" class="card auth-form">
      ${signup?'<label class="booking-field"><span>Your name</span><input name="name" autocomplete="name" maxlength="120" required></label>':''}
      ${!password?`<label class="booking-field"><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="254" value="${esc(S.authEmail)}" required></label>`:''}
      ${!recover?`<label class="booking-field"><span>Password${signup||password?' · at least 10 characters':''}</span><input name="password" type="password" autocomplete="${signup||password?'new-password':'current-password'}" minlength="${signup||password?10:1}" maxlength="128" required></label>`:''}
      ${message}${error}<button class="bigcta" type="submit" ${S.authBusy?'disabled':''}>${S.authBusy?'Please wait…':label}</button>
    </form>
    ${!password?`<div class="auth-actions"><button class="chip" data-act="auth-mode" data-v="${signup||recover?'login':'signup'}">${signup||recover?'Already have an account? Sign in':'New here? Create an account'}</button>${!recover&&!signup?'<button class="chip" data-act="auth-mode" data-v="recover">Forgot password?</button>':''}${back}</div>`:''}
  </div>`;
}

function applyProfile(user){
  const previous=S.user?.id||null;
  S.user=user||null;S.userName=user?.name||user?.email?.split('@')[0]||'player';
  if(previous!==(user?.id||null)){S.bookings=[];S.latestBooking=null;S.cancelAsk=null;S.requestKey=null;}
  if(user?.name&&!S.customerName)S.customerName=user.name;
}
function openLogin(){S.authReturn='checkout';S.authMode='login';S.authError='';S.screen='profile';render(false);}
async function submitAuth(form){
  if(S.authBusy)return;
  const mode=S.recovery?'password':S.authMode;
  const body=Object.fromEntries(new FormData(form));
  S.authEmail=String(body.email||S.authEmail);S.authBusy=true;S.authError='';S.authMessage='';
  const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='Please wait…';
  try{
    if(bookingsRequest)await bookingsRequest.catch(()=>{});
    const data=await api('/api/public/auth/'+mode,{method:'POST',body});applyProfile(data.user);
    if(data.confirmationRequired){S.authMessage=mode==='recover'?'If this email has an account, a reset link is on its way. Open it in this browser.':'Check your email to confirm your account, then sign in. You can confirm on another device and sign in here.';S.authMode='login';}
    else if(mode==='password'){S.recovery=false;S.authMode='login';S.authMessage='Password updated.';}
    else {S.authMessage='You’re signed in.';if(S.authReturn){S.screen=S.authReturn;S.authReturn='';}await loadBookings();}
  }catch(error){S.authError=error.message;}
  finally{S.authBusy=false;render(true);}
}
async function signOut(){
  if(S.authBusy)return;S.authBusy=true;S.authError='';render(true);
  try{if(bookingsRequest)await bookingsRequest.catch(()=>{});await api('/api/public/auth/logout',{method:'POST',body:{}});applyProfile(null);S.customerName='';S.customerPhone='';S.authReturn='';S.recovery=false;S.authMode='login';S.authMessage='You’re signed out.';}
  catch(error){S.authError=error.message;}finally{S.authBusy=false;render(true);}
}
const GOOGLE_DRAFT_KEY='futly-google-booking';
function saveGoogleDraft(){
  // Only this tab's unfinished booking is retained; no credentials or history.
  const draft={at:Date.now(),returnTo:S.authReturn==='checkout'?'checkout':'profile',
    turfId:S.turfId,court:S.court,date:dateForDay(S.day),start:S.start,dur:S.dur,
    customerName:S.customerName,customerPhone:S.customerPhone};
  try{sessionStorage.setItem(GOOGLE_DRAFT_KEY,JSON.stringify(draft));}
  catch{throw new Error('Allow session storage in this browser to return to your booking after Google sign-in.');}
}
async function restoreGoogleDraft(returnToCheckout=true){
  let draft;
  try{const raw=sessionStorage.getItem(GOOGLE_DRAFT_KEY);sessionStorage.removeItem(GOOGLE_DRAFT_KEY);draft=JSON.parse(raw||'null');}catch{return;}
  if(!draft||!Number.isFinite(draft.at)||Date.now()-draft.at>3600000||draft.at>Date.now()||draft.returnTo!=='checkout')return;
  await startupVenues;
  const venue=TURFS.find(t=>t.id===draft.turfId),court=venue?.courts.find(c=>String(c.id)===String(draft.court));
  const day=(Date.parse(draft.date+'T00:00:00Z')-Date.parse(dateForDay(0)+'T00:00:00Z'))/86400000;
  if(!venue||!court||!Number.isInteger(day)||day<0||day>30||!Number.isInteger(draft.start)||draft.start%30||![60,90,120].includes(draft.dur))return;
  S.turfId=venue.id;S.court=String(court.id);S.day=day;S.start=draft.start;S.dur=draft.dur;S.tab='courts';
  S.customerName=String(draft.customerName||'').slice(0,120);S.customerPhone=String(draft.customerPhone||'').slice(0,80);
  await loadAvailability(venue.id,day,true);
  if(!fits(S.start,S.dur)){S.start=null;S.screen='turf';S.authReturn='';S.apiError='That slot is no longer available. Choose another time.';}
  else {S.screen=returnToCheckout?'checkout':'profile';S.authReturn=returnToCheckout?'':'checkout';}
}
async function startGoogleSignIn(){
  if(S.authBusy)return;S.authBusy=true;S.authError='';render(true);
  try{
    if(bookingsRequest)await bookingsRequest.catch(()=>{});
    saveGoogleDraft();
    const data=await api('/api/public/auth/google',{method:'POST',body:{}});
    location.assign(data.url);
  }catch(error){try{sessionStorage.removeItem(GOOGLE_DRAFT_KEY);}catch{}S.authError=error.message;S.authBusy=false;render(true);}
}
async function finishEmailLink(){
  const params=new URLSearchParams(location.search),fragment=new URLSearchParams(String(location.hash||'').replace(/^#/,'')),code=params.get('code'),google=params.get('auth')==='google';
  if(!code&&!params.get('error')&&!params.get('error_description')&&!fragment.get('error'))return;
  // Remove one-use authorization codes from the address bar before other work.
  history.replaceState(null,'','/book/');S.screen='profile';S.authBusy=true;
  try{
    if(!code)throw new Error(google?'Google sign-in was cancelled or could not complete. Try again.':'The email link has expired. Request a new link.');
    await ensureSession();
    if(bookingsRequest)await bookingsRequest.catch(()=>{});
    const data=await api('/api/public/auth/exchange',{method:'POST',body:{code}});
    applyProfile(data.user);S.recovery=data.recovery;S.authMessage=data.recovery?'Choose your new password.':data.provider==='google'?'You’re signed in with Google.':'Email confirmed. Your account is ready.';
    await loadBookings();
    if(data.provider==='google')await restoreGoogleDraft();
  }catch(error){S.authError=error.message;if(google){try{await restoreGoogleDraft(false);}catch{}}else{try{sessionStorage.removeItem(GOOGLE_DRAFT_KEY);}catch{}}}
  finally{S.authBusy=false;render(false);}
}

/* ─── render ──────────────────────────────────────────── */
const SCREENS = {
  home:screenHome, find:screenFind, turf:screenTurf, checkout:screenCheckout, split:screenSplit,
  done:screenDone, bookings:screenBookings, cups:screenCups, wallet:screenWallet, profile:screenProfile,
};
const TABS = ['home','bookings','profile'];

function render(keepScroll){
  const sc = document.getElementById('scroll');
  const y = keepScroll ? sc.scrollTop : 0;
  sc.innerHTML = SCREENS[S.screen]();
  sc.scrollTop = y;
  renderNav();
  renderBar();
}

function renderNav(){
  const nav = document.getElementById('nav');
  const on = TABS.indexOf(S.screen) >= 0;
  nav.hidden = !on;
  if (!on) return;
  const items = [['home','home'],['bookings','cal'],['profile','user']];
  nav.innerHTML = items.map(([k,i]) =>
    `<button class="nb ${S.screen===k?'on':''}" data-act="go" data-v="${k}" aria-label="${k}">${ic(i,22,1.8)}</button>`).join('');
}

function renderBar(){
  const bar = document.getElementById('stickybar');
  let cfg = null;

  if (S.screen === 'turf' && S.tab === 'courts' && S.start != null)
    cfg = { lbl:`${esc(courtObj()?.n || 'Pitch')} · ${durLabel()} · ${range()}`, amt:money(base()), cta:'Continue', go:'checkout' };
  else if (S.screen === 'checkout')
    cfg = { lbl:'Pay at venue', amt:money(base()), cta:S.bookingBusy?'Confirming…':S.user?'Confirm booking':'Sign in to book', go:'paynow' };

  if (S.screen === 'split'){
    bar.hidden = false;
    bar.className = 'splitfoot';
    bar.innerHTML = `<button class="skip" data-act="go" data-v="checkout">Skip</button>
      <button class="send" data-act="go" data-v="checkout">${ic('share',17,1.8)} Send requests</button>`;
    return;
  }

  bar.className = 'stickybar';
  bar.hidden = !cfg;
  if (!cfg) return;
  bar.innerHTML = `<span class="l"><span>${cfg.lbl}</span><b>${cfg.amt}</b></span>
    <button class="go" data-act="go" data-v="${cfg.go}"${S.bookingBusy?' disabled':''}>${cfg.cta}</button>`;
}

async function submitBooking(){
  if(!S.user){openLogin();return;}
  const name=S.customerName.trim(),contact=S.customerPhone.trim(),digits=contact.replace(/\D/g,'');
  if (!name || digits.length<8 || digits.length>15){S.apiError='Enter your name or team and a valid mobile number.';render(true);return;}
  if (!turf() || !courtObj() || S.start==null || S.bookingBusy) return;
  S.bookingBusy=true;S.apiError='';render(true);
  try {
    const payload={ date:dateForDay(S.day),pitch:Number(S.court),start:S.start,end:S.start+S.dur,team:name,contact,notes:'',idempotencyKey:S.requestKey || (S.requestKey=crypto.randomUUID?crypto.randomUUID():'booking-'+Date.now()+'-'+Math.random().toString(36).slice(2)) };
    const held=await api(`/api/public/venues/${encodeURIComponent(turf().id)}/holds`,{ method:'POST',body:payload });
    const result=held.confirmedBooking?{booking:held.confirmedBooking}:await api(`/api/public/venues/${encodeURIComponent(turf().id)}/holds/${encodeURIComponent(held.hold.id)}/confirm`,
      { method:'POST',body:{ contact,payAtVenue:true } });
    S.latestBooking=result.booking;S.requestKey=null;S.code=result.booking.code;S.screen='done';
    S.bookings=[result.booking,...S.bookings.filter(b=>b.id!==result.booking.id)];
    await loadBookings().catch(()=>{S.notice='Booking confirmed. History will refresh when your connection returns.';});
    delete S.availability[availabilityKey(turf().id,S.day)];
  } catch (error) { S.apiError=error.message;if(error.code==='customer_login_required'){applyProfile(null);openLogin();S.authError=error.message;}if(['booking_conflict','hold_conflict','hold_expired','past_slot','request_key_reused'].includes(error.code)){S.requestKey=null;delete S.availability[availabilityKey(turf().id,S.day)];} }
  finally { S.bookingBusy=false;render(false); }
}

/* ─── events ──────────────────────────────────────────── */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled || S.bookingBusy || S.authBusy) return;
  const a = el.dataset.act, v = el.dataset.v;
  let keep = true;

  switch (a){
    case 'go':
      if (v === 'paynow'){
        submitBooking();return;
      }
      if (v === 'find'){
        S.screen='find';render(false);loadAllAvailability(S.day).then(()=>render(false)).catch(()=>render(false));return;
      }
      else S.screen = v;
      if(v==='bookings')loadBookings().then(()=>render(true)).catch(error=>{S.apiError=error.message;render(true)});
      keep = false;
      break;
    case 'auth-google':startGoogleSignIn();return;
    case 'auth-mode':S.authMode=v;S.recovery=v==='password';S.authError='';S.authMessage='';break;
    case 'auth-back':S.screen=S.authReturn||'home';S.authReturn='';break;
    case 'auth-logout':signOut();return;
    case 'cancel-ask':S.cancelAsk=v;break;
    case 'cancel-dismiss':S.cancelAsk=null;break;
    case 'cancel-confirm':cancelBooking(v);return;
    case 'calendar':downloadCalendar();return;
    case 'share-booking':shareBooking();return;
    case 'turf': {
      openTurf(v);return;
    }
    case 'search-open':
      S.searching = true;
      // toggle the class on the live node so the expand transition runs, rather
      // than re-rendering into a fresh element that has nothing to animate from
      document.getElementById('headwrap').classList.add('on');
      const oi = document.getElementById('q');
      oi.removeAttribute('tabindex'); oi.focus();
      return;
    case 'search-close': {
      S.searching = false; S.q = '';
      const hw = document.getElementById('headwrap'), inp = document.getElementById('q');
      hw.classList.remove('on'); inp.value = ''; inp.blur();
      inp.setAttribute('tabindex','-1');
      refreshList();                       // collapse animates; results restore behind it
      return;
    }
    case 'win': {
      const [which, step] = v.split(':');
      which === 'from' ? setFrom(+step) : setTo(+step);
      break;
    }
    case 'windur':
      S.dur = +v; syncWindow();
      if (S.start != null && !fits(S.start, +v)) S.start = null;
      break;
    case 'findpick': {                 // land on the turf with everything preselected
      const [tid, court, m] = v.split(':');
      openTurf(tid,{ court,start:+m });return;
    }
    case 'fmt':     S.fmt = v; keep = false; break;
    case 'tab':     S.tab = v; keep = v !== 'reviews'; break;
    case 'court':   S.court = v; S.start = null; break;   // a start valid for one court isn't valid for another
    case 'day':
      S.day=+v;S.start=null;render(false);loadAvailability(S.turfId,S.day).then(()=>render(false)).catch(()=>render(false));return;
    case 'dur':     S.dur = +v; if (S.start != null && !fits(S.start, +v)) S.start = null; break;
    case 'slot':    if (fits(+v)) S.start = +v; break;
    case 'pay':     S.pay = v; break;
    case 'booktab': S.bookTab = v; break;
    case 'friend':
      S.split = S.split.indexOf(v) >= 0 ? S.split.filter(x => x !== v) : S.split.concat(v);
      break;
    default: return;
  }
  render(keep);
});

/* Live search. Only the list and its count redraw, so the input keeps focus and
   the expand animation isn't restarted on every keystroke. */
function refreshList(){
  const list = document.getElementById('turfList');
  if (!list) return;
  list.classList.add('quiet');            // suppress the stagger while typing
  list.innerHTML = turfListHtml();
  const note = document.getElementById('secNote');
  if (note) note.textContent = listNote(vList());
  const head = document.querySelector('#scroll .screen-head .t-sec');
  if (head) head.textContent = S.q.trim() ? 'Results' : 'Available venues';
}

document.addEventListener('submit',e=>{if(e.target.id==='customer-auth-form'){e.preventDefault();submitAuth(e.target);}});

document.addEventListener('input', e => {
  if (e.target.id === 'q') { S.q=e.target.value;refreshList();return; }
  if (e.target.id === 'customer-name') S.customerName=e.target.value;
  if (e.target.id === 'customer-phone') S.customerPhone=e.target.value;
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && S.searching)
    document.querySelector('[data-act="search-close"]')?.click();
});

function venueMinute(){
  const parts=new Intl.DateTimeFormat('en',{timeZone:TURFS[0]?.timeZone || 'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  return Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
}
let bookingsRequest=null;
function loadBookings(){
  if(bookingsRequest)return bookingsRequest;
  S.loadingBookings=true;S.bookingsError='';
  bookingsRequest=(async()=>{
    try{await ensureSession();const data=await api('/api/public/bookings');applyProfile(data.user);S.bookings=data.bookings;}
    catch(error){S.bookingsError=error.message;throw error;}
    finally{S.loadingBookings=false;bookingsRequest=null;}
  })();
  return bookingsRequest;
}
async function cancelBooking(id){
  if(S.bookingBusy)return;S.bookingBusy=true;S.apiError='';render(true);
  try{await api('/api/public/bookings/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:{}});await loadBookings();S.availability={};S.cancelAsk=null;}
  catch(error){S.apiError=error.message;}finally{S.bookingBusy=false;render(true);}
}
function downloadCalendar(){
  const b=S.latestBooking;if(!b)return;
  const stamp=minute=>{const date=new Date(b.date+'T00:00:00Z');date.setUTCMinutes(minute);return date.getUTCFullYear()+String(date.getUTCMonth()+1).padStart(2,'0')+String(date.getUTCDate()).padStart(2,'0')+'T'+String(date.getUTCHours()).padStart(2,'0')+String(date.getUTCMinutes()).padStart(2,'0')+'00'};
  const clean=s=>String(s).replace(/[\r\n]/g,' ').replace(/[,;]/g,' ');
  const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Futly//Booking//EN','BEGIN:VEVENT','UID:'+b.id+'@futly','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'),'DTSTART;TZID='+(turf()?.timeZone||'Asia/Kolkata')+':'+stamp(b.start),'DTEND;TZID='+(turf()?.timeZone||'Asia/Kolkata')+':'+stamp(b.end),'SUMMARY:'+clean(b.team+' at '+b.venueName),'LOCATION:'+clean(b.pitchName),'DESCRIPTION:'+clean(b.code+'; pay at venue '+money(b.outstanding)),'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/calendar'}));const a=document.createElement('a');a.href=url;a.download=b.code+'.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function shareBooking(){
  const b=S.latestBooking;if(!b)return;const text=b.team+' · '+b.venueName+' · '+b.pitchName+' · '+b.date+' '+fmtMin(b.start)+'–'+fmtMin(b.end)+' · '+b.code+' · '+money(b.outstanding)+' due at venue';
  try{if(navigator.share)await navigator.share({title:'Futly booking',text});else{await navigator.clipboard.writeText(text);S.notice='Booking details copied.';render(true);}}catch(error){if(error.name!=='AbortError'){S.notice='Sharing unavailable. Your booking code is '+b.code;render(true);}}
}
let refreshing=false;
async function refreshLive(){
  if(refreshing||S.loadingVenues||availabilityRequests.size||S.bookingBusy||S.authBusy||document.hidden||document.activeElement?.tagName==='INPUT'||!S.csrf)return;
  refreshing=true;
  try{if(S.screen==='bookings')await loadBookings();else if(['home','find','turf'].includes(S.screen)){await Promise.all(TURFS.map(t=>loadAvailability(t.id,S.screen==='home'?0:S.day,true)));}else return;S.apiError='';render(true);}
  catch(error){S.apiError='Live availability could not refresh. Check your connection.';render(true);}finally{refreshing=false;}
}
setInterval(refreshLive,5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive()});

const ledgerEvents=new EventSource('/api/public/events');
ledgerEvents.addEventListener('ledger',refreshLive);

let startupVenues;
if(typeof location.search==='string'&&location.search)finishEmailLink();
render();
startupVenues=loadVenues();
