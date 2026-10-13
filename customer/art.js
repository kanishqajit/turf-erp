/* ═══════════════════════════════════════════════════════
   TurfArt — one illustration per venue (variants 1–5).
   Drawn, never photographed, so no venue shows an empty
   photo box. The same variant is used by the hero, the
   featured card and the list thumbnail, so a venue looks
   the same everywhere.

   Variants 1, 4, 5 are dark grounds  → light status bar.
   Variants 2, 3 are light grounds    → ink status bar.
   ═══════════════════════════════════════════════════════ */

const DARK_ART = ['1', '4', '5'];

/* Roughening filter ids must be unique per instance or a second copy on the
   same page re-uses the first one's filter region and renders blank. */
let artSeq = 0;

function art(variant){
  const v = String(variant || '1');
  const u = 'ar' + (++artSeq);
  const open = `<svg viewBox="0 0 360 240" preserveAspectRatio="xMidYMid slice"
    style="position:absolute;inset:0;width:100%;height:100%;display:block">`;

  if (v === '1') return open + `
    <filter id="${u}"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="3" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.8" xChannelSelector="R" yChannelSelector="G"/></filter>
    <rect width="360" height="240" fill="#16181C"/>
    <g filter="url(#${u})" fill="none" stroke="#EDF0E2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".6">
      <path d="M40 212c38-5 84-8 140-8 56 0 106 3 146 9M40 212c-4-50-2-104 5-154M320 213c6-50 6-104 2-154M46 58c42-6 96-9 146-9 48 0 96 3 136 7"/>
      <path d="M44 136c42-5 96-8 146-8 48 0 96 3 136 7"/>
      <path d="M158 108c31-5 57 5 58 20 2 17-23 29-51 27-28-3-43-16-40-29 2-10 14-16 33-18Z"/>
      <path d="M140 58c36-4 62-4 95-1v31c-33-3-59-3-95 1Z"/>
    </g>
    <g filter="url(#${u})" fill="none" stroke="#D7F24B" stroke-width="3" stroke-linecap="round" opacity=".95">
      <path d="M84 180c20-22 44-33 64-22 18 10 11 35 31 40 20 5 40-15 55-38"/>
      <path d="M230 165l11-5-2 12"/>
    </g>
    <g filter="url(#${u})" fill="none" stroke="#EDF0E2" stroke-width="2.5" stroke-linecap="round" opacity=".8">
      <path d="M76 182a12 12 0 1 0 .4 0Z"/>
      <path d="M124 86l16 15M140 86l-16 15M222 82l15 14M237 82l-15 14M102 128l14 13M116 128l-14 13"/>
      <path d="M180 88a9 9 0 1 0 .3 0ZM268 136a9 9 0 1 0 .3 0ZM146 166a9 9 0 1 0 .3 0Z"/>
    </g></svg>`;

  if (v === '2') return open + `
    <filter id="${u}"><feTurbulence type="fractalNoise" baseFrequency="1" numOctaves="2" seed="8" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>
    <rect width="360" height="240" fill="#ECEEE4"/>
    <g stroke="#C9CCBE" stroke-width="1" opacity=".9"><path d="M0 40h360M0 80h360M0 120h360M0 160h360M0 200h360"/></g>
    <g filter="url(#${u})" fill="none" stroke="#2A2E33" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <path d="M96 96a11 11 0 1 0 .4 0Z"/>
      <path d="M96 107v34M96 141l-13 32M96 141l14 32M96 116l-24 12M96 116l25 9"/>
      <path d="M232 88a11 11 0 1 0 .4 0Z"/>
      <path d="M232 99v33M232 132l-15 30M232 132l16 30M232 110l-27 6M232 110l26 14"/>
      <path d="M262 128c14-2 24 4 26 14"/>
    </g>
    <g filter="url(#${u})" fill="none" stroke="#2A2E33" stroke-width="2" stroke-linecap="round" opacity=".55">
      <path d="M28 196c12-4 26-5 40-3M300 200c14-4 26-4 34-1M40 60c8 3 14 8 17 14M320 52c-6 4-11 9-14 15"/>
    </g>
    <g filter="url(#${u})">
      <circle cx="164" cy="174" r="13" fill="#D7F24B" stroke="#2A2E33" stroke-width="2.4"/>
      <path d="M164 165l6 5-2 8h-8l-3-8Z" fill="none" stroke="#2A2E33" stroke-width="1.6"/>
    </g>
    <path filter="url(#${u})" d="M140 186c-16 6-30 8-46 6" fill="none" stroke="#2A2E33" stroke-width="2" stroke-dasharray="6 7" stroke-linecap="round" opacity=".8"/></svg>`;

  if (v === '3') return open + `
    <defs><pattern id="${u}d" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#16181C" opacity=".5"/></pattern></defs>
    <rect width="360" height="240" fill="#D7F24B"/>
    <rect x="0" y="150" width="360" height="90" fill="url(#${u}d)"/>
    <path d="M180 26c50 0 90 40 90 90v58H90v-58c0-50 40-90 90-90Z" fill="#16181C"/>
    <circle cx="180" cy="104" r="34" fill="#D7F24B"/>
    <g fill="none" stroke="#16181C" stroke-width="3.4" stroke-linejoin="round">
      <path d="M180 82l16 12-6 19h-20l-6-19Z"/>
      <path d="M180 82V70M164 94l-11-6M196 94l11-6M170 113l-7 11M190 113l7 11"/>
    </g>
    <g fill="#16181C"><rect x="60" y="188" width="240" height="9"/><rect x="96" y="204" width="168" height="6" opacity=".55"/></g>
    <g fill="none" stroke="#16181C" stroke-width="4" stroke-linecap="round">
      <path d="M34 62v40M22 74h24M326 58l24 24M350 58l-24 24"/>
    </g></svg>`;

  if (v === '4') return open + `
    <defs>
      <pattern id="${u}d" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.5" fill="#EDF0E2" opacity=".16"/></pattern>
      <clipPath id="${u}c"><circle cx="180" cy="112" r="72"/></clipPath>
    </defs>
    <rect width="360" height="240" fill="#16181C"/>
    <rect width="360" height="240" fill="url(#${u}d)"/>
    <circle cx="180" cy="112" r="72" fill="#D7F24B" opacity=".16"/>
    <g clip-path="url(#${u}c)" stroke="#D7F24B" stroke-width="3" opacity=".2"><path d="M100 56h160M100 76h160M100 96h160M100 116h160M100 136h160M100 156h160"/></g>
    <g fill="none" stroke="#D7F24B" stroke-width="3.6" stroke-linejoin="round">
      <circle cx="180" cy="112" r="46"/>
      <path d="M180 84l22 16-8 26h-28l-8-26Z"/>
      <path d="M180 84V66M158 100l-17-9M202 100l17-9M166 126l-11 16M194 126l11 16"/>
    </g>
    <g fill="none" stroke="#EDF0E2" stroke-width="2.6" stroke-linecap="round" opacity=".5">
      <path d="M28 196c18-10 36-10 54 0 18 10 36 10 54 0 18-10 36-10 54 0 18 10 36 10 54 0 18-10 36-10 54 0"/>
      <path d="M42 44c6 8 8 16 6 24M318 40c-6 8-9 16-8 25"/>
    </g></svg>`;

  return open + `
    <rect width="360" height="240" fill="#1B1E17"/>
    <g fill="none" stroke="#D7F24B" stroke-width="2" opacity=".25" stroke-linecap="round"><path d="M20 210c40-16 90-24 160-24s120 8 160 24"/></g>
    <g stroke="#EDF0E2" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M148 58c34 0 56 20 56 46 0 28-24 48-56 48s-56-20-56-48c0-26 22-46 56-46Z"/>
      <path d="M92 84c14-10 34-15 56-15s42 5 56 15"/>
      <path d="M120 110c5-5 12-5 17 0M159 110c5-5 12-5 17 0"/>
      <path d="M116 128c10 14 22 21 32 21s22-7 32-21c-20 6-44 6-64 0Z"/>
      <path d="M148 152v26M148 178l-20 26M148 178l20 26M148 160l-26 12M148 160l26 12"/>
    </g>
    <g fill="#D7F24B"><circle cx="128" cy="103" r="5"/><circle cx="168" cy="103" r="5"/>
      <path d="M92 78c14-12 34-18 56-18s42 6 56 18l-6 10c-14-10-32-15-50-15s-36 5-50 15Z"/></g>
    <g fill="none" stroke="#D7F24B" stroke-width="3.6" stroke-linecap="round">
      <path d="M262 150a24 24 0 1 0 .8 0Z"/>
      <path d="M262 164l11 8-4 13h-15l-3-13Z"/>
      <path d="M232 128l-14-14M240 112l-4-18M258 108l6-18"/>
    </g>
    <g fill="none" stroke="#EDF0E2" stroke-width="2.6" stroke-linecap="round" opacity=".4">
      <path d="M48 96l24 8M44 122l26-2M56 148l22-10"/>
    </g></svg>`;
}

/* Small hand-drawn doodle tiles used on review cards. */
function doodle(d, bg, stroke){
  return `<span class="doodle" style="background:${bg}">
    <svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg></span>`;
}

/* Sketched trophy for the tournament banner. */
const TROPHY = `<svg viewBox="0 0 360 180" preserveAspectRatio="xMidYMid slice"
  style="position:absolute;inset:0;width:100%;height:100%;display:block">
  <rect width="360" height="180" fill="#16181C"/>
  <g fill="none" stroke="#D7F24B" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M148 38h64v34c0 18-14 32-32 32s-32-14-32-32Z"/>
    <path d="M148 46h-16c0 16 7 24 17 26M212 46h16c0 16-7 24-17 26"/>
    <path d="M180 104v20M162 124h36l4 14h-44Z"/>
  </g>
  <g fill="none" stroke="#EDF0E2" stroke-width="1.8" stroke-linecap="round" opacity=".38">
    <path d="M40 52h44M40 52v56M40 108h44M62 52v56M266 44h44M266 44v64M266 108h44M288 44v64"/>
  </g>
  <g fill="none" stroke="#D7F24B" stroke-width="2.4" stroke-linecap="round" opacity=".55">
    <path d="M96 26l6 10M126 18l2 12M232 20l-3 12M262 28l-7 10M110 148l8-9M250 150l-8-9"/>
  </g></svg>`;
