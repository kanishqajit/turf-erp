import { PITCHES, PITCH_PALETTE } from '../constants.js';
import { esc, pitchColorFor } from '../domain.js';
import { can, S, staffInitials } from '../state.js';

function pitchColorRowHtml(pitch,pitchIndex){
  const hex=pitchColorFor(pitchIndex),name=PITCH_PALETTE.find(swatch=>swatch.hex===hex)?.name||'Custom';
  const open=S.colorPickerOpen===pitchIndex;
  return `<div class="pcrow"><button class="pcrow-id" data-act="toggle-pitch-picker" data-pi="${pitchIndex}" aria-expanded="${open}">
    <i style="background:${hex}"></i><div><b>${esc(pitch.name)}</b><span>${name} &middot; ${hex}</span></div>
    <span class="pcrow-chev">${open?'Close':'Change'}</span></button>${open?`<div class="palette">${PITCH_PALETTE.map(swatch=>
    `<button class="swatchbtn${swatch.hex===hex?' on':''}" title="${swatch.name}" aria-label="${swatch.name}" aria-pressed="${swatch.hex===hex}"
      data-act="set-pitch-color" data-pi="${pitchIndex}" data-v="${swatch.hex}" style="background:${swatch.hex}"></button>`).join('')}</div>`:''}</div>`;
}

export function viewSettings(){
  const enabled=S.showPitchColors;
  const newUserReady=S.newName.trim()&&/^\S+@\S+\.\S+$/.test(S.newEmail.trim())&&S.newPassword.length>=12;
  return `<main class="settings"><div><div class="kicker">Console</div><h1 class="h1">Settings</h1></div><section class="setcard">
    <div class="chart-head"><h2 class="h3">Appearance</h2><span class="note">Applies to this console only</span></div><div class="setrow">
    <div class="setrow-txt"><b>Dark mode</b><span>Turns the page off rather than repainting it: surfaces step by lightness
    alone and the lime is untouched, because it is the one thing on screen with a colour and it does the same job either
    way. Stored on this console, so a shared terminal and a back-office laptop can differ.</span></div>
    <button class="switch${S.theme==='dark'?' on':''}" role="switch" aria-checked="${S.theme==='dark'}"
    data-act="toggle-theme"><i></i></button></div><div class="setrow">
    <div class="setrow-txt"><b>Colour-code pitches</b><span>Gives each pitch its own colour on the availability grid and on its
    section under Sessions. When off, every pitch uses the standard ink and lime palette.</span></div><button class="switch${enabled?' on':''}"
    role="switch" aria-checked="${enabled}" data-act="toggle-pitch-colors"><i></i></button></div>${enabled?`<div class="pitchcolors">
    <div class="pitchcolors-head"><b>Pitch colours</b><span>${PITCH_PALETTE.length} preset colours, chosen to read clearly against ink and lime — no colour wheel.</span></div>
    ${PITCHES.map(pitchColorRowHtml).join('')}</div>`:''}</section>
    <section class="setcard"><div class="chart-head"><h2 class="h3">Booking policy</h2><span class="note">Shared across every console</span></div>
    <div class="policy-row"><div class="setrow-txt"><b>Default booking deposit</b><span>Shown when a slot is booked and prefilled when staff record an advance. The amount collected can still be changed per booking.</span></div>
    ${can('manager')?`<div class="deposit-editor"><label><span class="sr-only">Deposit amount in rupees</span><i>₹</i>
      <input class="dinput amount" inputmode="numeric" data-act="deposit-draft" value="${esc(S.depositDraft)}" aria-label="Deposit amount in rupees"></label>
      <button class="dbtn primary sm" data-act="save-deposit"${S.depositDirty&&S.depositDraft!==''&&Number(S.depositDraft)>=0&&Number(S.depositDraft)<=50000?'':' disabled'}>Save deposit</button></div>`:
      `<strong class="policy-value">₹${Number(S.settings.depositAmount).toLocaleString('en-IN')}</strong>`}</div>
    <p class="settings-note">Current default: ₹${Number(S.settings.depositAmount).toLocaleString('en-IN')}. Managers and owners can change this from ₹0 to ₹50,000; every change is audited.</p></section>
    <section class="setcard"><div class="chart-head">
    <h2 class="h3">Signed-in account</h2><span class="note">Server-enforced access</span></div><div class="account-summary">
    <span class="avatar">${esc(staffInitials())}</span><div><b>${esc(S.user.name)}</b><span>${esc(S.user.email)} · ${esc(S.user.role)}</span></div></div>
    <p class="settings-note">Operators can manage bookings and payments. Managers can also release bookings,
    block maintenance, approve discounts, and inspect the audit log. Owners can create staff accounts.</p></section>
    ${can('owner')?`<section class="setcard"><div class="chart-head"><h2 class="h3">Staff access</h2><span class="note">Owner only</span></div>
    <div class="staff-list">${S.users.map(user=>`<div class="staff-row"><span class="avatar">${esc(user.name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase())}</span>
      <div><b>${esc(user.name)}</b><span>${esc(user.email)} · ${esc(user.role)} · ${user.active?'active':'deactivated'}${user.mustChangePassword?' · temporary password':''}</span></div>
      <div class="acct-actions">${user.id!==S.user.id?`<button class="mini" data-act="staff-${user.active?'deactivate':'activate'}" data-id="${user.id}">${user.active?'Deactivate':'Activate'}</button>`:''}
      ${user.active?`<button class="mini" data-act="staff-revoke" data-id="${user.id}">Revoke sessions</button>`:''}</div></div>`).join('')}</div></section>
    <section class="setcard"><div class="chart-head"><h2 class="h3">Create staff account</h2><span class="note">Temporary password requires change at first sign-in</span></div>
    <div class="user-form"><label><span class="dlabel">Name</span><input class="dinput" autocomplete="off" data-act="new-user" data-k="newName" value="${esc(S.newName)}"></label>
    <label><span class="dlabel">Email</span><input class="dinput" type="email" autocomplete="off" data-act="new-user" data-k="newEmail" value="${esc(S.newEmail)}"></label>
    <label><span class="dlabel">Temporary password · min 12 characters</span><input class="dinput" type="password" autocomplete="new-password" data-act="new-user" data-k="newPassword" value="${esc(S.newPassword)}"></label>
    <label><span class="dlabel">Role</span><select class="dinput" data-act="new-role">${['operator','manager','owner'].map(role=>`<option${S.newRole===role?' selected':''}>${role}</option>`).join('')}</select></label></div>
    ${S.newRole==='owner'?'<p class="settings-note warning">Owners can create and disable staff, revoke sessions, approve large discounts, and inspect every audit record. Grant this role sparingly.</p>':''}
    <button class="dbtn primary" data-act="create-user"${newUserReady?'':' disabled'}>Create account</button></section>`:''}
    ${can('manager')?`<section class="setcard audit-card"><div class="chart-head"><h2 class="h3">Operational audit log</h2>
    <span class="note">Latest ${S.audit.length} events · up to 200</span></div>${S.auditError?`<div class="error-banner" role="alert">Audit log unavailable: ${esc(S.auditError)}</div>`:''}<div class="audit-list">${S.audit.length?S.audit.map(event=>`<details class="audit-row">
    <summary>
    <time>${new Date(event.createdAt).toLocaleString('en-IN')}</time><div><b>${esc(event.action.replaceAll('.',' · '))}</b>
    <span>${esc(event.actor.name)}${event.reason?' · '+esc(event.reason):''}</span></div><code>${esc(event.entityType)} ${esc(event.entityId.slice(0,8))}</code></summary>
    <div class="audit-detail"><div><b>Before</b><pre>${esc(JSON.stringify(event.before,null,2)||'—')}</pre></div><div><b>After</b><pre>${esc(JSON.stringify(event.after,null,2)||'—')}</pre></div></div></details>`).join(''):
    '<div class="alert-none">No operational changes recorded yet.</div>'}</div></section>`:''}</main>`;
}
