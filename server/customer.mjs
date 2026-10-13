import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PITCHES, OPEN_MIN, CLOSE_MIN, ProductError } from './store.mjs';

const fail = (status, code, message) => { throw new ProductError(status, code, message); };
const hash = value => createHash('sha256').update(String(value)).digest('hex');

/* Guest bookings belong to a browser session, never to a supplied phone number.
   Staff state, contact details and payment history stay behind staff auth. */
export function createCustomerApi(store, env = process.env, now = () => Date.now()){
  const db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS customer_reservations (
    hold_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES customer_sessions(id),
    request_key TEXT NOT NULL, request_json TEXT NOT NULL, booking_id TEXT REFERENCES bookings(id),
    UNIQUE(session_id,request_key));`);
  const slug = env.TURF_VENUE_SLUG || 'futly-demo';
  const venue = { slug, name:env.TURF_VENUE_NAME || 'Futly Demo Arena',
    location:env.TURF_VENUE_LOCATION || 'Koramangala, Bengaluru',
    phone:env.TURF_VENUE_PHONE || '', demo:true,
    amenities:['Floodlights'], timeZone:env.TURF_TIME_ZONE || 'Asia/Kolkata' };
  const resources = PITCHES.map((pitch,id)=>({ id, ...pitch, sub:['7-a-side','5-a-side','11-a-side'][id] }));
  const settings = () => ({ openMinute:OPEN_MIN, closeMinute:CLOSE_MIN,
    minimumMinutes:60, stepMinutes:30, floodlightAfter:1080, floodlightFee:300,
    depositAmount:store.getSettings().depositAmount });
  function actor(){
    if(!db.prepare("SELECT id FROM users WHERE role='owner' AND active=1 LIMIT 1").get())
      fail(503,'venue_not_ready','The venue is not accepting bookings yet.');
    const email = 'customer-booking-service@futly.internal';
    let user = db.prepare('SELECT id,email,name,role FROM users WHERE email=?').get(email);
    if (!user){
      const id = randomUUID();
      db.prepare(`INSERT INTO users (id,email,name,role,password_salt,password_hash,active,created_at)
        VALUES (?,?,?,'operator',?,?,0,?)`).run(id,email,'Futly customer bookings',
        randomBytes(24).toString('hex'),randomBytes(64).toString('hex'),new Date(now()).toISOString());
      user = { id,email,name:'Futly customer bookings',role:'operator' };
    }
    return user;
  }
  const todayParts = () => new Intl.DateTimeFormat('en-CA',{
    timeZone:venue.timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(new Date(now())).reduce((a,p)=>(a[p.type]=p.value,a),{});
  function validateDate(date){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) fail(400,'invalid_date','Choose a valid booking date.');
    const parts=todayParts(),today=`${parts.year}-${parts.month}-${parts.day}`;
    const value=Date.parse(date+'T00:00:00Z'),base=Date.parse(today+'T00:00:00Z');
    if (!Number.isFinite(value) || new Date(value).toISOString().slice(0,10)!==date)
      fail(400,'invalid_date','Choose a valid booking date.');
    if (value < base || value > base + 30*86400000) fail(400,'date_out_of_range','Choose a date within the next 30 days.');
    return { today,minute:Number(parts.hour)*60+Number(parts.minute) };
  }
  function session(token){
    return token ? db.prepare('SELECT * FROM customer_sessions WHERE id=? AND expires_at>?').get(hash(token),now()) : null;
  }
  function createSession(){
    const token=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url'),expiresAt=now()+30*86400000;
    db.prepare('INSERT INTO customer_sessions VALUES (?,?,?)').run(hash(token),csrf,expiresAt);
    return { token,csrf,expiresAt };
  }
  function availability(date){
    validateDate(date);
    const state=store.listState(date,date);
    return { venue, date, resources, settings:settings(), serverTime:new Date(now()).toISOString(),
      unavailable:[...state.bookings.filter(b=>b.status!=='noshow').map(b=>({ resourceId:b.pitch,start:b.start,end:b.end,kind:'booked' })),
        ...state.holds.map(h=>({ resourceId:h.pitch,start:h.start,end:h.end,kind:'hold' })),
        ...state.blocks.map(b=>({ resourceId:b.pitch,start:b.start,end:b.end,kind:'maintenance' }))] };
  }
  function shape(b){
    return { id:b.id,code:`FUTLY-${b.id.slice(0,8).toUpperCase()}`,venueSlug:slug,venueName:venue.name,
      pitch:b.pitch,pitchName:resources[b.pitch].name,date:b.date,start:b.start,end:b.end,
      team:b.team,contact:b.contact,status:b.status,paused:!!b.pausedAt,amount:b.amount,discount:b.discount,collected:b.collected,
      outstanding:Math.max(0,b.amount-b.discount-b.collected),pay:b.pay,version:b.version };
  }
  function createHold(customer, input){
    const { today,minute }=validateDate(input.date);
    const start=Number(input.start),end=Number(input.end);
    if (!Number.isInteger(start)||!Number.isInteger(end)||start%30||end%30||end-start<60||end-start>240)
      fail(400,'invalid_duration','Book at least one hour, in 30-minute steps.');
    if (input.date===today && start < minute) fail(409,'past_slot','That start time has passed. Choose a later slot.');
    const key=String(input.idempotencyKey||'');
    if (!/^[\w-]{8,100}$/.test(key)) fail(400,'invalid_request_key','A booking request key is required.');
    const payload={ date:input.date,pitch:Number(input.pitch),start,end,team:String(input.team||'').trim(),contact:String(input.contact||'').trim() };
    const request=JSON.stringify(payload);
    const prior=db.prepare('SELECT * FROM customer_reservations WHERE session_id=? AND request_key=?').get(customer.id,key);
    if (prior){
      if(prior.request_json!==request)fail(409,'request_key_reused','This request belongs to another booking.');
      if(prior.booking_id)return { confirmedBooking:shape(store.getBooking(prior.booking_id)) };
      const hold=db.prepare('SELECT * FROM holds WHERE id=? AND expires_at>?').get(prior.hold_id,now());
      if(!hold)fail(409,'hold_expired','The reservation expired. Choose your slot again.');
      return { hold:{ id:hold.id,expiresAt:hold.expires_at } };
    }
    const hold=store.createHold(payload,actor(),{ afterCreate:record=>{
      db.prepare('INSERT INTO customer_reservations (hold_id,session_id,request_key,request_json) VALUES (?,?,?,?)')
        .run(record.id,customer.id,key,request);
    }});
    return { hold:{ id:hold.id,expiresAt:hold.expiresAt } };
  }
  function confirmHold(customer, id){
    const reservation=db.prepare('SELECT * FROM customer_reservations WHERE hold_id=? AND session_id=?').get(id,customer.id);
    if (!reservation)fail(404,'not_found','Reservation not found in this browser.');
    if (reservation.booking_id)return { booking:shape(store.getBooking(reservation.booking_id)) };
    const hold=db.prepare('SELECT date,start FROM holds WHERE id=?').get(id);
    if(hold){const {today,minute}=validateDate(hold.date);if(hold.date===today&&hold.start<minute)fail(409,'past_slot','That start time has passed. Choose a later slot.');}
    const booking=store.confirmHold(id,actor(),{ source:'app',afterConfirm:b=>{
      db.prepare('UPDATE customer_reservations SET booking_id=? WHERE hold_id=?').run(b.id,id);
    }});
    return { booking:shape(booking) };
  }
  function bookings(customer){
    return db.prepare('SELECT booking_id FROM customer_reservations WHERE session_id=? AND booking_id IS NOT NULL')
      .all(customer.id).map(r=>shape(store.getBooking(r.booking_id))).sort((a,b)=>b.date.localeCompare(a.date)||b.start-a.start);
  }
  function cancel(customer,id){
    const reservation=db.prepare('SELECT booking_id FROM customer_reservations WHERE booking_id=? AND session_id=?').get(id,customer.id);
    if(!reservation)fail(404,'not_found','Booking not found in this browser.');
    const b=store.getBooking(id),{today,minute}=(()=>{const p=todayParts();return {today:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)}})();
    if(b.status==='cancelled')return { booking:shape(b) };
    if(b.status!=='upcoming'||b.date<today||(b.date===today&&b.start<=minute))fail(409,'cannot_cancel','Contact the venue to change a match that has started.');
    store.releaseBooking(id,{...actor(),role:'manager'},'Customer cancelled an unpaid future booking',b.version);
    return { booking:shape(store.getBooking(id)) };
  }
  return { slug,venue,resources,settings,session,createSession,availability,createHold,confirmHold,bookings,cancel };
}
