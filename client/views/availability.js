import { DOW, DOWL, MON, PAY_FORM, PITCHES, START_HOUR } from '../constants.js';
import { dateAt, dateForAddress, daysFromToday, hourRng12, hours, hourT12, isoDate, nowMin, relDay, rng12, t12,
  TODAY_DI, toMin } from '../datetime.js';
import { blockAtTime, bookingAtTime, bookingWindow, bookingWindowAt, chipCls, coverage, esc, hbar, holdAtTime,
  label, money, pitchColorFor, segCls, sourceFor, statusAtTime, statusFor, tintFor, tintVars, weekStart } from '../domain.js';
import { can, S } from '../state.js';

const blockReady = () => S.blockReason.trim().length >= 15;
const bubble = (status, source, selected, covered, full) => {
  const kind = covered && !full ? 'part'
    : status === 'booked' ? (source === 'app' ? 'via-app' : 'counter')
    : status === 'free' ? '' : status;
  return ['bub',kind,selected ? 'sel' : ''].filter(Boolean).join(' ');
};

function slotHtml(di, hi, hour, pitch = S.pitch){
  const covered = coverage(pitch, di, hour);
  const status = covered ? 'booked' : statusFor(di, hi, pitch);
  const source = covered ? covered.c.source || 'counter' : sourceFor(di, hi, pitch);
  const selected = !!(S.sel && S.sel.di === di && S.sel.hi === hi && S.pitch === pitch);
  const full = !!(covered && covered.s <= 0 && covered.e >= 100);
  const time = hourRng12(hour);
  const title = covered ? rng12(covered.c.start, covered.c.end) + ' · custom booking'
      + (covered.c.team ? ' · ' + covered.c.team : '')
    : time + ' · ' + label(status) + (status === 'booked' ? ' · ' + (source === 'app' ? 'app' : 'counter') : '');
  const indicator = status === 'booked'
    ? { text:source === 'app' ? 'APP' : 'Counter', cls:`source ${source}` }
    : status === 'hold' ? { text:'Hold', cls:'state hold' }
    : status === 'blocked' ? { text:'Maintenance', cls:'state maintenance' }
    : null;
  const indicatorPill = indicator
    ? `<span class="bub-indicator ${indicator.cls}" aria-hidden="true">${indicator.text}</span>`
    : '';
  const overlay = covered && !full
    ? `<span class="ovl" style="clip-path:inset(0 ${100-covered.e}% 0 ${covered.s}%)">${time}</span>` : '';
  return `<button class="${bubble(status,source,selected,covered,full)}" title="${esc(title)}"
    data-act="slot" data-di="${di}" data-hi="${hi}" data-pi="${pitch}">
    <span class="bub-time">${time}</span>${indicatorPill}${overlay}</button>`;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rowOf = minute => Math.floor((minute - START_HOUR * 60) / 30) + 1;
const rowSpan = (start, end) => Math.max(1, Math.ceil((end - start) / 30));
const recordOverlaps = (record, start, end) => record.start < end && record.end > start;
const bookingClass = booking => bubble('booked', booking.source || 'counter', false, true, true);
const recordHi = record => clamp(Math.floor(record.start / 60) - START_HOUR, 0, hours().length - 1);
const sourceText = booking => booking.source === 'app' ? 'App' : booking.groupType ? booking.groupType : 'Counter';

function scheduleBubble({ cls, title, di, pitch, start, span, time, detail = '', meta = '' }){
  return `<div class="schedule-cell${span === 1 ? ' compact' : ''}" style="--grid-col:${pitch + 2};--grid-row:${rowOf(start)};--grid-span:${span}">
    <button class="${cls} schedule-bub" title="${esc(title)}" data-act="slot" data-di="${di}" data-hi="${recordHi({ start })}"
      data-pi="${pitch}" data-offset="${start % 60}">
      <span class="bub-time">${esc(time)}</span>${detail ? `<strong>${esc(detail)}</strong>` : ''}${meta ? `<small>${esc(meta)}</small>` : ''}
    </button></div>`;
}

function scheduleHtml(di, showNow){
  const startMin = START_HOUR * 60, endMin = (START_HOUR + hours().length) * 60;
  const date = dateForAddress(S.weekOffset, di), rows = hours().length * 2, pieces = [];
  const records = [];
  PITCHES.forEach((_, pitch) => {
    S.bookings.filter(booking => booking.date === date && booking.pitch === pitch
      && booking.status !== 'noshow' && booking.status !== 'cancelled' && booking.end > startMin && booking.start < endMin)
      .forEach(booking => records.push({ type:'booking', pitch, record:booking }));
    S.holds.filter(hold => hold.expiresAt > Date.now() && hold.date === date && hold.pitch === pitch
      && hold.end > startMin && hold.start < endMin)
      .forEach(hold => records.push({ type:'hold', pitch, record:hold }));
    S.blocks.filter(block => block.date === date && block.pitch === pitch && block.end > startMin && block.start < endMin)
      .forEach(block => records.push({ type:'blocked', pitch, record:block }));
  });
  records.sort((a, b) => a.record.start - b.record.start || a.pitch - b.pitch);
  records.forEach(item => {
    const record = item.record, start = clamp(record.start, startMin, endMin), end = clamp(record.end, startMin, endMin);
    const selected = !!(S.sel && S.sel.di === di && S.pitch === item.pitch
      && hours()[S.sel.hi] * 60 + S.startOffset >= start && hours()[S.sel.hi] * 60 + S.startOffset < end);
    const cls = item.type === 'booking' ? bookingClass(record) : bubble(item.type, null, false, false, true);
    const detail = item.type === 'booking' ? record.team || sourceText(record)
      : item.type === 'hold' ? record.team || 'On hold' : record.reason || 'Maintenance';
    const meta = item.type === 'booking' ? sourceText(record) : item.type === 'hold' ? 'Hold' : 'Maintenance';
    pieces.push(scheduleBubble({ cls:cls + (selected ? ' sel' : ''), title:(detail ? detail + ' · ' : '') + rng12(record.start, record.end),
      di, pitch:item.pitch, start, span:rowSpan(start, end), time:rng12(record.start, record.end), detail, meta }));
  });
  hours().forEach(hour => {
    const start = hour * 60, mid = start + 30, end = start + 60;
    pieces.push(`<span class="hourlbl schedule-hour" style="--grid-row:${rowOf(start)};--grid-span:2">
      <span class="hourtxt">${hourT12(hour)}</span></span>`);
    PITCHES.forEach((_, pitch) => {
      const firstTaken = records.some(item => item.pitch === pitch && recordOverlaps(item.record, start, mid));
      const secondTaken = records.some(item => item.pitch === pitch && recordOverlaps(item.record, mid, end));
      const selectedStart = S.sel && S.sel.di === di && S.pitch === pitch ? hours()[S.sel.hi] * 60 + S.startOffset : -1;
      if (!firstTaken && !secondTaken){
        const selected = selectedStart >= start && selectedStart < end;
        pieces.push(scheduleBubble({ cls:'bub schedule-open full' + (selected ? ' sel' : ''), title:`Open · ${rng12(start, end)}`,
          di, pitch, start, span:2, time:hourRng12(hour), detail:'Open' }));
        return;
      }
      [[start, mid, firstTaken], [mid, end, secondTaken]].forEach(([slotStart, slotEnd, taken]) => {
        if (taken) return;
        const selected = selectedStart === slotStart;
        pieces.push(scheduleBubble({ cls:'bub schedule-open partial' + (selected ? ' sel' : ''), title:`Open half hour · ${rng12(slotStart, slotEnd)}`,
          di, pitch, start:slotStart, span:1, time:t12(slotStart) }));
      });
    });
  });
  const now = showNow ? nowMin() : null;
  if (now != null && now >= startMin && now <= endMin){
    pieces.push(`<span class="schedule-now" data-now-line data-schedule-now data-start-hour="${START_HOUR}"
      style="--now-row:${(now - startMin) / 30}" aria-hidden="true"><b>${t12(now)}</b></span>`);
  }
  return `<div class="schedule-board" style="--rows:${rows}">${pieces.join('')}</div>`;
}

const bandOf = hour => hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : hour < 21 ? 'Evening' : 'Late night';
function buildBands(allHours, cellsFor){
  const bands = [];
  allHours.forEach((hour, hi) => {
    const name = bandOf(hour);
    let band = bands[bands.length - 1];
    if (!band || band.name !== name){ band = { name, rows:[], firstH:hour }; bands.push(band); }
    band.lastH = hour;
    band.rows.push({ h:hour, hi, cells:cellsFor(hour, hi) });
  });
  return bands;
}

function bandsHtml(bands, withHourLabel, showNow = false){
  const liveNow = showNow ? nowMin() : null;
  const liveHour = liveNow == null ? -1 : Math.floor(liveNow / 60);
  return bands.map(band => {
    const closed = !!S.collapsedBands[band.name];
    return `<div class="band${closed ? ' closed' : ''}">
      <button class="band-head" data-act="toggle-band" data-v="${band.name}" aria-expanded="${!closed}">
        <i class="band-chev">&#9662;</i><span class="band-name">${band.name}</span><i class="band-rule"></i>
        <span class="band-span">${rng12(band.firstH * 60, (band.lastH + 1) * 60)}</span>
        <span class="band-toggle">${closed ? 'Show' : 'Hide'}</span>
      </button>
      ${closed ? '' : band.rows.map(row => {
        const isNow = row.h === liveHour;
        return `<div class="bandrow${isNow ? ' has-now' : ''}">
          ${withHourLabel ? `<span class="hourlbl"><span class="hourtxt">${hourT12(row.h)}</span></span>` : ''}
          ${row.cells.join('')}
          ${isNow ? `<span class="now-line" data-now-line data-hour="${row.h}"
            style="--now-offset:${((liveNow % 60) / 60) * 44}px" aria-hidden="true">
            <span class="now-line-label">${t12(liveNow)}</span></span>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function selectionHtml(){
  const allHours = hours(), startOfWeek = weekStart(), selection = S.sel;
  const hour = allHours[selection.hi];
  const date = new Date(startOfWeek); date.setDate(date.getDate() + selection.di);
  const pitch = PITCHES[S.pitch];
  const probeStart = hour * 60 + S.startOffset;
  const coveredBooking = bookingAtTime(selection.di, S.pitch, probeStart);
  const covered = coveredBooking ? { c:coveredBooking } : null;
  const bookingStart = hour * 60 + S.startOffset, bookingEnd = bookingStart + S.dur;

  if (covered){
    const booking = covered.c;
    const rows = [
      ['Duration', booking.end - booking.start + ' min'],
      ['Booked via', booking.source === 'app' ? 'Turf app · online'
        : booking.groupType ? 'Counter · group booking' : booking.kind === 'custom' ? 'Counter · custom' : 'Counter · walk-in'],
      ['Payment', booking.pay], ['Amount', money(booking.amount)],
    ].concat(booking.groupType ? [['Booking type', booking.groupType]] : [])
      .concat(booking.team ? [[booking.groupType === 'Corporate' ? 'Company' : 'Group name', booking.team]] : [])
      .concat(booking.contact ? [['Contact', booking.contact]] : [])
      .concat(booking.notes ? [['Notes', booking.notes]] : []);
    return `<div class="panel" role="region" aria-label="Selected booking details"><div class="panel-head">
      <span class="tag ondark">${booking.groupType ? esc(booking.groupType) + ' group'
        : booking.kind === 'custom' ? 'Custom booking' : 'Confirmed booking'}</span>
      <button class="x" data-act="clear-sel" aria-label="Close booking details">&times;</button></div>
      <div class="sel-time">${rng12(booking.start, booking.end)}</div>
      <div class="sel-where">${DOWL[selection.di]}, ${date.getDate()} ${MON[date.getMonth()]} &middot; ${esc(pitch.name)} &middot; ${esc(pitch.sub)}</div>
      <div class="drule" style="margin:16px 0 4px"></div>
      ${rows.map(row => `<div class="drow"><span>${esc(row[0])}</span><b>${esc(row[1])}</b></div>`).join('')}
      <div style="display:flex;gap:9px;margin-top:14px">${can('manager')
        ? '<button class="dbtn primary" data-act="drop-custom">Release this booking</button>'
        : '<span class="dsub">A manager must release confirmed bookings.</span>'}</div></div>`;
  }

  const status = statusAtTime(selection.di, S.pitch, probeStart);
  const windowCheck = status === 'free' ? bookingWindow(selection.di, S.pitch, bookingStart, S.dur) : null;
  const extendedCheck = status === 'free' && S.dur < 240
    ? bookingWindow(selection.di, S.pitch, bookingStart, S.dur + 30) : null;
  const hold = holdAtTime(selection.di, S.pitch, probeStart);
  const maintenance = blockAtTime(selection.di, S.pitch, probeStart);
  const rows = status === 'hold' ? [
      ['Booked via','Counter · walk-in'], ['Contact',hold?.contact || '—'], ['Format',pitch.sub],
      ['Hold expires', hold ? new Date(hold.expiresAt).toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit' })
        + ` · ${Math.max(0, Math.ceil((hold.expiresAt - Date.now()) / 60000))} min left` : '—'],
      ['Amount',money(pitch.rate)],
    ].concat(hold?.team ? [['Team',hold.team]] : []).concat(hold?.notes ? [['Notes',hold.notes]] : [])
    : status === 'blocked' ? [
      ['Reason',maintenance?.reason || 'Maintenance'], ['Blocked by',maintenance?.createdBy || 'Grounds team'],
      ['Logged',maintenance?.createdAt ? new Date(maintenance.createdAt).toLocaleString('en-IN') : '—'],
      ['Revenue lost',money(pitch.rate)],
    ] : [
      ['Rate',money(pitch.rate) + ' / hour'], ['Format',pitch.sub],
      ['Floodlights',bookingEnd > 18 * 60 ? 'Required (+₹300)' : 'Not needed'], ['Deposit',money(S.settings.depositAmount)],
    ];
  const primaryLabel = status === 'free' ? 'Book this slot' : status === 'hold' ? 'Confirm hold' : 'Reopen slot';

  const duration = status === 'free' ? `<div class="durbox">
    <span class="dlabel" style="margin:0 0 7px">Starts at</span>
    <div class="start-options" role="group" aria-label="Booking start time">${[0,30].map(offset =>
      `<button class="start-opt${S.startOffset === offset ? ' on' : ''}" data-act="start-offset" data-v="${offset}"
        aria-pressed="${S.startOffset === offset}">${t12(hour * 60 + offset)}</button>`).join('')}</div>
    <div class="durbox-head"><span class="dlabel" style="margin:0">Duration</span><span class="val">${rng12(bookingStart,bookingEnd)}</span></div>
    <div class="durbox-row"><button class="step" data-act="dur" data-v="-30" aria-label="Reduce duration by 30 minutes"${S.dur <= 30 ? ' disabled' : ''}>&minus;</button>
      <div class="mid"><b>${S.dur} min</b><small>${S.dur === 60 ? 'Standard hour' : 'Custom length · billed pro rata'}</small></div>
      <button class="step" data-act="dur" data-v="30" aria-label="Increase duration by 30 minutes"${S.dur >= 240 || !extendedCheck.ok ? ' disabled' : ''}>+</button></div>
    <div class="window-state ${windowCheck.ok ? 'ok' : 'conflict'}"><i>${windowCheck.ok ? '&#10003;' : '!'}</i>
      <span>${esc(windowCheck.reason)}</span></div></div>` : '';

  const maintenanceBox = status === 'free' && can('manager') ? `<div style="margin-top:12px">
    <button class="block-toggle" data-act="toggle-block">${S.blockOpen ? 'Cancel maintenance block' : 'Block for maintenance'}</button>
    ${S.blockOpen ? `<div class="blockbox"><div class="blockbox-warn"><i></i><p>Blocking removes a sellable slot.
      Every block is logged to the owner audit trail against your name and reviewed weekly.</p></div>
      <label><span class="dlabel">Reason &mdash; written, min 15 characters</span>
        <textarea class="reason" id="b-reason" data-act="reason" placeholder="Describe the work and why this slot cannot be sold">${esc(S.blockReason)}</textarea></label>
      <div class="reason-count">${S.blockReason.trim().length} / 15</div>
      <button class="dbtn wide" data-act="block-confirm"${blockReady() ? '' : ' disabled'} style="margin-top:11px">Block slot</button>
      <button class="holdbtn" id="holdBtn" data-act="hold-block"${blockReady() ? '' : ' disabled'}>
        <span class="fill" id="holdFill"></span><span class="lbl" id="holdLbl">${blockReady()
          ? (S.holdPct > 0 ? 'Keep holding… ' + Math.round(S.holdPct) + '%' : 'Or press and hold 2s to block')
          : 'Write a reason to continue'}</span></button></div>` : ''}</div>` : '';

  return `<div class="panel" role="region" aria-label="Selected slot details"><div class="panel-head"><span class="tag ondark">${label(status)}</span>
    <button class="x" data-act="clear-sel" aria-label="Close slot details">&times;</button></div>
    <div class="sel-time">${status === 'free' ? rng12(bookingStart,bookingEnd) : hourRng12(hour)}</div>
    <div class="sel-where">${DOWL[selection.di]}, ${date.getDate()} ${MON[date.getMonth()]} &middot; ${esc(pitch.name)} &middot; ${esc(pitch.sub)}</div>
    <div class="drule" style="margin:16px 0 4px"></div>
    ${rows.map(row => `<div class="drow"><span>${esc(row[0])}</span><b>${esc(row[1])}</b></div>`).join('')}
    ${duration}<div style="display:flex;gap:9px;margin-top:14px">
      <button class="dbtn primary" data-act="sel-primary"${status === 'free' && !windowCheck.ok ? ' disabled' : ''}>${primaryLabel}</button>
      ${status === 'free' && windowCheck.ok ? '<button class="dbtn" data-act="sel-hold">Hold slot</button>' : ''}
      ${status === 'hold' ? '<button class="dbtn" data-act="sel-release">Release hold</button>' : ''}</div>${maintenanceBox}</div>`;
}

export function formFieldsHtml(namespace){
  return [
    { k:'team',label:'Name / team · required',ph:'e.g. Northside FC' },
    { k:'contact',label:'Contact number · required',ph:'+91 ' },
    { k:'notes',label:'Notes (optional)',ph:'Bibs, coaching, floodlights…' },
  ].map(field => `<label class="dfield"><span class="dlabel">${field.label}</span>
    <input class="dinput" id="${namespace}-${field.k}" data-act="form-field" data-k="${field.k}"
      value="${esc(S.form[field.k])}" placeholder="${esc(field.ph)}"></label>`).join('');
}

function customPanelHtml(){
  const ready = S.cName.trim() && S.cPhone.trim().length >= 6, startOfWeek = weekStart();
  return `<div class="panel"><div class="panel-head"><b class="panel-title">Custom time slot</b>
    <button class="x" data-act="close-custom" aria-label="Close custom booking form">&times;</button></div>
    <span class="dlabel" style="margin-bottom:6px">Day</span><div style="display:flex;flex-wrap:wrap;gap:6px">
    ${DOW.map((day, index) => { const date = new Date(startOfWeek); date.setDate(date.getDate() + index); const active = S.cDay === index;
      return `<button data-act="c-day" data-v="${index}" style="height:34px;padding:0 12px;border-radius:11px;border:0;cursor:pointer;
        font:${active ? 700 : 600} 12.5px var(--sans);background:${active ? '#fff' : 'var(--field)'};
        color:${active ? 'var(--ink)' : 'var(--d-muted)'}">${day} ${date.getDate()}</button>`; }).join('')}</div>
    <label style="display:block;margin-top:13px"><span class="dlabel">Start time</span>
      <input class="dinput time" id="c-start" type="time" step="1800" value="${esc(S.cStart)}" data-act="c-start"></label>
    <span class="dlabel" style="margin:13px 0 6px">Pitch</span><div class="optrow wide">${PITCHES.map((pitch, index) =>
      `<button class="${segCls(S.pitch === index, true)}" data-act="pitch" data-v="${index}" title="${esc(pitch.sub)}">${esc(pitch.name)}</button>`).join('')}</div>
    <span class="dlabel" style="margin:13px 0 6px">Duration</span><div class="optrow">${[60,90,120,150].map(duration =>
      `<button class="${segCls(S.cDur === duration,true)}" data-act="c-dur" data-v="${duration}">${duration < 120 ? duration + ' min'
        : Math.floor(duration / 60) + ' hr' + (duration % 60 ? ' 30' : '')}</button>`).join('')}</div>
    <div style="font:700 15px var(--sans);color:var(--lime);margin:13px 0 3px">${rng12(toMin(S.cStart),toMin(S.cStart)+S.cDur)}
      &middot; ${esc(PITCHES[S.pitch].name)}</div><div class="drule" style="margin:10px 0 13px"></div>
    <label class="dfield"><span class="dlabel">Name / team · required</span><input class="dinput" id="c-name" data-act="c-field"
      data-k="cName" value="${esc(S.cName)}" placeholder="e.g. Northside FC"></label>
    <label class="dfield"><span class="dlabel">Contact number · required</span><input class="dinput" id="c-phone" data-act="c-field"
      data-k="cPhone" value="${esc(S.cPhone)}" placeholder="+91 "></label>
    <span class="dlabel" style="margin:11px 0 6px">Payment status</span><div class="optrow">${PAY_FORM.map(option =>
      `<button class="${segCls(S.cPay === option,true)}" data-act="c-pay" data-v="${esc(option)}">${option}</button>`).join('')}</div>
    <button data-act="add-custom" style="width:100%;height:50px;border-radius:18px;border:0;margin-top:13px;background:var(--lime);
      color:var(--ink);font:700 14.5px var(--sans);cursor:${ready ? 'pointer' : 'not-allowed'};opacity:${ready ? 1 : .45}">
      Confirm custom booking</button></div>`;
}

export const dateAddress = offset => {
  const absolute = TODAY_DI + offset;
  return { week:Math.floor(absolute / 7), di:((absolute % 7) + 7) % 7 };
};
const groupDateOptions = () => {
  const base = daysFromToday(S.weekOffset,S.dayIndex);
  return Array.from({length:14},(_,index) => {
    const offset = base + index, address = dateAddress(offset), date = dateAt(offset);
    return { offset,...address,date,check:bookingWindowAt(address.week,address.di,S.gPitch,toMin(S.gStart),S.gDur) };
  });
};
const groupChecks = () => S.gDates.map(offset => {
  const address = dateAddress(offset);
  return { offset,...address,check:bookingWindowAt(address.week,address.di,S.gPitch,toMin(S.gStart),S.gDur) };
});
export const groupValid = () => {
  const checks = groupChecks();
  return !!(S.gName.trim() && S.gPhone.trim().length >= 6 && checks.length && checks.every(item => item.check.ok));
};

function groupPanelHtml(){
  const start = toMin(S.gStart), end = start + S.gDur, options = groupDateOptions(), checks = groupChecks();
  const conflicts = checks.filter(item => !item.check.ok), count = S.gDates.length;
  const perSession = PITCHES[S.gPitch].rate * S.gDur / 60 + (end > 18 * 60 ? 300 : 0), total = perSession * count;
  const nameLabel = S.gType === 'Corporate' ? 'Company name' : 'Group name';
  return `<div class="panel group-panel"><div class="panel-head"><div><span class="modal-kicker">Multi-date booking</span>
    <b class="panel-title">Group booking</b></div><button class="x" data-act="close-group" aria-label="Close group booking form">&times;</button></div>
    <p class="group-intro">Reserve one time across several dates for a company or organised group.</p>
    <span class="dlabel">Booking type</span><div class="optrow group-type">${['Corporate','Group'].map(type =>
      `<button class="${segCls(S.gType===type,true)}" data-act="g-type" data-v="${type}">${type}</button>`).join('')}</div>
    <span class="dlabel group-label">Pitch</span><div class="optrow wide">${PITCHES.map((pitch,index) =>
      `<button class="${segCls(S.gPitch===index,true)}" data-act="g-pitch" data-v="${index}" title="${esc(pitch.sub)}">${esc(pitch.name)}</button>`).join('')}</div>
    <div class="group-time-row"><label><span class="dlabel">Start time</span><input class="dinput time" id="g-start" type="time"
      step="1800" value="${esc(S.gStart)}" data-act="g-start"></label><div><span class="dlabel">Duration</span>
      <div class="group-duration">${[60,90,120,180].map(duration => `<button class="${segCls(S.gDur===duration,true)}"
        data-act="g-dur" data-v="${duration}">${duration < 120 ? duration+'m' : duration/60+'h'}</button>`).join('')}</div></div></div>
    <div class="group-date-head"><span class="dlabel">Select dates · next 14 days</span>
      <button data-act="g-clear-dates"${count ? '' : ' disabled'}>Clear</button></div>
    <div class="group-dates">${options.map(option => { const selected=S.gDates.includes(option.offset), conflict=selected&&!option.check.ok,
      blocked=!option.check.ok&&!selected; return `<button class="group-date${selected?' on':''}${conflict?' conflict':''}${blocked?' unavailable':''}"
        data-act="g-date" data-v="${option.offset}" aria-pressed="${selected}" ${blocked?`disabled title="${esc(option.check.reason)}"`:''}>
        <span>${DOW[option.di]}</span><b>${option.date.getDate()} ${MON[option.date.getMonth()]}</b>
        <small>${conflict?'! Conflict':selected?'&#10003; Selected':blocked?'Unavailable':'Available'}</small></button>`; }).join('')}</div>
    <div class="group-summary${conflicts.length?' conflict':''}"><div><span>${count} session${count===1?'':'s'}</span>
      <b>${count?rng12(start,end):'Choose dates'}</b></div><strong>${count?money(total):'—'}</strong>
      ${conflicts.length?`<p>${conflicts.length} selected date${conflicts.length===1?'':'s'} no longer available.</p>`:''}</div>
    <div class="drule group-details"><label class="dfield"><span class="dlabel">${nameLabel} · required</span>
      <input class="dinput" id="g-name" data-act="g-field" data-k="gName" value="${esc(S.gName)}"></label>
      <label class="dfield"><span class="dlabel">Organizer contact · required</span><input class="dinput" id="g-phone"
        data-act="g-field" data-k="gPhone" value="${esc(S.gPhone)}" placeholder="+91 "></label>
      <label class="dfield"><span class="dlabel">Notes (optional)</span><input class="dinput" id="g-notes" data-act="g-field"
        data-k="gNotes" value="${esc(S.gNotes)}"></label>
      <span class="dlabel" style="margin:11px 0 6px">Payment status</span><div class="optrow wide">${PAY_FORM.map(option =>
        `<button class="${segCls(S.gPay===option,true)}" data-act="g-pay" data-v="${esc(option)}">${option}</button>`).join('')}</div></div>
    <button class="dbtn primary wide group-confirm" data-act="add-group"${groupValid()?'':' disabled'}>
      ${count?`Confirm ${count} booking${count===1?'':'s'} · ${money(total)}`:'Select dates to continue'}</button></div>`;
}

export function viewAvailability(){
  const allHours = hours(), startOfWeek = weekStart(), isDay = S.availMode === 'day';
  let free = 0, total = 0;
  for (let di=0;di<7;di++) allHours.forEach((hour,hi) => { total++; if (!coverage(S.pitch,di,hour)&&statusFor(di,hi,S.pitch)==='free') free++; });
  const weekEnd = new Date(startOfWeek); weekEnd.setDate(weekEnd.getDate()+6);
  const weekLabel = startOfWeek.getDate()+' '+MON[startOfWeek.getMonth()]+' – '+weekEnd.getDate()+' '+MON[weekEnd.getMonth()];
  const legend = [
    ['free',null,'Open'],['booked','app','Booked in app'],['booked','counter','Booked at counter'],
    ['hold',null,'On hold'],['blocked',null,'Maintenance'],
  ].map(([status,source,text])=>{
    const swatch=status==='free'?'background:var(--paper);border:1px solid var(--edge2)'
      :status==='booked'&&source==='app'?'background:var(--lime);border:1px solid var(--lime-deep)'
      :status==='booked'?'background:var(--ink);border:1px solid var(--ink)'
      :status==='hold'?'background:var(--lime-tint);border:1px solid var(--lime-tint)'
      :'background:var(--soft);border:1px solid var(--soft)';
    return `<span><i style="${swatch}"></i>${text}</span>`;
  }).join('')+`<span><i style="border:1px solid var(--ink);background:linear-gradient(90deg,#fff 0 50%,var(--ink) 50% 100%)"></i>Part-booked (custom)</span>`;
  const tint = tintFor(S.pitch);
  const days = DOW.map((dow,di) => { const date=new Date(startOfWeek);date.setDate(date.getDate()+di);let booked=0;
    allHours.forEach((hour,hi)=>{if((coverage(S.pitch,di,hour)?'booked':statusFor(di,hi,S.pitch))!=='free')booked++;});
    return {dow,dayNum:date.getDate(),month:MON[date.getMonth()],load:Math.round(booked/allHours.length*100),today:S.weekOffset===0&&di===TODAY_DI}; });
  const pitchChips = `<div class="pitchpicker">${PITCHES.map((pitch,index)=>`<button class="${chipCls(index===S.pitch)}" data-act="pitch"
    data-v="${index}" ${index===S.pitch||!S.showPitchColors?'':`style="background:${pitchColorFor(index)};border-color:${pitchColorFor(index)};color:#fff"`}>
    ${esc(pitch.name)}</button>`).join('')}</div>`;
  const weekGrid = `<div class="gridcard" data-scroll-pane="grid" style="${tintVars(tint)}"><div class="gridsticky"><div class="gridtop">${pitchChips}
    <span class="grid-soft push">${esc(PITCHES[S.pitch].sub)}</span></div>
    <div class="daystrip">${days.map((day, dayIndex)=>`<div><button type="button" class="dayhead${day.today?' today':''}"
      data-act="day-focus" data-v="${dayIndex}" aria-label="View ${day.dow} ${day.dayNum} across all pitches"><small>${day.dow}</small><b>${day.dayNum}</b>
      <span class="mon">${day.month}</span></button><div class="dayload"><i style="background:${day.load>=70?'var(--ink)':'var(--lime)'}"></i>${day.load}% full</div></div>`).join('')}</div></div>
    ${bandsHtml(buildBands(allHours,(hour,hi)=>days.map((_,di)=>slotHtml(di,hi,hour,S.pitch))),false,S.weekOffset===0)}</div>`;

  const di=S.dayIndex,dayDate=new Date(startOfWeek);dayDate.setDate(dayDate.getDate()+di);let dayFree=0,dayTotal=0;
  const pitchOpen=PITCHES.map((_,pitch)=>{let count=0;allHours.forEach((hour,hi)=>{dayTotal++;if(!coverage(pitch,di,hour)&&statusFor(di,hi,pitch)==='free'){count++;dayFree++;}});return count;});
  const offsetNow=daysFromToday(S.weekOffset,di),relative=relDay(offsetNow);
  const jumps=Array.from({length:8},(_,offset)=>{const date=dateAt(offset);return {offset,on:offset===offsetNow,label:relDay(offset)||DOW[(date.getDay()+6)%7]+' '+date.getDate()};});
  const dayGrid=`<div class="gridcard daycard" data-scroll-pane="grid" style="--cols:${PITCHES.length}"><div class="gridsticky"><div class="gridtop"><div class="gridcard-head">
    <div class="daynav"><button class="rbtn sm" data-act="day" data-v="-1">&#8592;</button><div class="daynav-now"><b>${relative||DOWL[di]}</b>
    <span>${relative?DOWL[di]+' &middot; ':''}${dayDate.getDate()} ${MON[dayDate.getMonth()]} ${dayDate.getFullYear()}</span></div>
    <button class="rbtn sm" data-act="day" data-v="1">&#8594;</button></div><span class="grid-soft dark">${dayFree} of ${dayTotal} open across ${PITCHES.length} pitches</span></div>
    <div class="dayjump">${jumps.map(jump=>`<button class="jchip${jump.on?' on':''}" data-act="day-jump" data-v="${jump.offset}">${jump.label}</button>`).join('')}
    <label class="jchip jdate${offsetNow<0||offsetNow>7?' on':''}"><span>${offsetNow<0||offsetNow>7?dayDate.getDate()+' '+MON[dayDate.getMonth()]:'Pick date'}</span>
    <input type="date" value="${isoDate(dayDate)}" data-act="day-date" aria-label="Jump to date"></label></div></div>
    <div class="pitchstrip"><span class="hourlbl head">Time</span>${PITCHES.map((pitch,index)=>`<button type="button" class="pitchcol${index===S.pitch?' on':''}"
      data-act="pitch" data-v="${index}" style="${S.showPitchColors?`--col-accent:${pitchColorFor(index)}`:''}"><b>${esc(pitch.name)}</b><span>${esc(pitch.sub)}</span>
      <span class="open">${pitchOpen[index]} of ${allHours.length} open</span></button>`).join('')}</div></div>
    ${scheduleHtml(di,offsetNow===0)}</div>`;
  const pitchLoad=PITCHES.map((pitch,index)=>{let booked=0,count=0;
    if(isDay)allHours.forEach((hour,hi)=>{count++;if(coverage(index,di,hour)||statusFor(di,hi,index)!=='free')booked++;});
    else for(let day=0;day<7;day++)allHours.forEach((hour,hi)=>{count++;if(coverage(index,day,hour)||statusFor(day,hi,index)!=='free')booked++;});
    const percent=Math.round(booked/count*100);return `<div class="loadrow"><div class="top"><span>${esc(pitch.name)}</span><b>${percent}%</b></div>
      <div class="track"><div class="fill" style="${hbar(percent)}"></div></div></div>`;}).join('');
  const loadCap=isDay?`Pitch load, ${DOW[di]} ${dayDate.getDate()}`:'Pitch load, this week';
  const asidePanel=!!(S.sel||S.customOpen||S.groupOpen);
  const asideBody=S.groupOpen?groupPanelHtml():S.customOpen?customPanelHtml():S.sel?selectionHtml()
    :'<div class="noselect"><b>No slot selected</b><p>Tap a time bubble to see the booking, confirm a hold, or block the slot for maintenance.</p></div>';
  return `<main class="avail"><section class="avail-main"><div class="headrow"><div class="headrow-lead"><div class="headrow-title">
    <div class="kicker">Week of ${weekLabel}</div><h1 class="h1">Slot availability</h1></div><div class="modeseg">
    <button class="modeopt${isDay?' on':''}" data-act="avail-mode" data-v="day">Day · all pitches</button>
    <button class="modeopt${isDay?'':' on'}" data-act="avail-mode" data-v="week">Week · one pitch</button></div></div>
    <div class="headrow-tools"><div class="nudge"><button class="rbtn" data-act="week" data-v="-1">&#8592;</button>
    <button class="rbtn" data-act="week" data-v="1">&#8594;</button></div>
    <button class="pillbtn" data-act="open-group">+ Group booking</button>
    <button class="pillbtn" data-act="open-custom">+ Custom slot</button></div></div>
    <div class="legend">${legend}<span class="fill">${isDay?dayFree+' of '+dayTotal+' slots open on '+DOW[di]+' '+dayDate.getDate():free+' of '+total+' slots open this week'}</span></div>
    ${isDay?dayGrid:weekGrid}</section><aside class="aside${asidePanel?' has-panel':''}">${asideBody}
    <div class="loadcard"><div class="cap">${loadCap}</div>${pitchLoad}</div></aside></main>`;
}
