export const PITCHES = [
  { name:'Pitch A', sub:'7-a-side', rate:1800 },
  { name:'Pitch B', sub:'5-a-side', rate:1200 },
  { name:'Main Ground', sub:'11-a-side', rate:3200 },
];

export const START_HOUR = 6;
export const END_HOUR = 22;
export const DAY_START = START_HOUR * 60;
export const DAY_END = END_HOUR * 60;
export const SPAN = DAY_END - DAY_START;

export const PITCH_PALETTE = [
  { name:'Forest', hex:'#006B3C' }, { name:'Crimson', hex:'#C8102E' },
  { name:'Royal', hex:'#69359C' }, { name:'Teal', hex:'#0B6E6E' },
  { name:'Navy', hex:'#1E3A6E' }, { name:'Ember', hex:'#C1541C' },
  { name:'Plum', hex:'#7A2048' }, { name:'Indigo', hex:'#3D2C8D' },
  { name:'Olive', hex:'#5B6B1E' }, { name:'Maroon', hex:'#7A1F2B' },
  { name:'Umber', hex:'#8A5A11' }, { name:'Steel', hex:'#2F5673' },
  { name:'Berry', hex:'#A6215B' }, { name:'Terracotta', hex:'#A24B2E' },
  { name:'Slate', hex:'#4A5568' }, { name:'Denim', hex:'#35507A' },
];
export const PITCH_DEFAULT_HEX = ['#006B3C', '#C8102E', '#69359C'];
export const NEUTRAL_TINT = {
  bg:'#FFFFFF', line:'#EAECE4', fg:'#16181C', soft:'#8E949B', chip:'#F4F5F0', chipFg:'#16181C',
};

export const MATCH_STATES = [
  { k:'upcoming', label:'Not started' }, { k:'running', label:'In play' },
  { k:'done', label:'Finished' }, { k:'noshow', label:'No-show' },
];
export const PAY_STATES = ['Payment at venue','Advance paid','Payment done'];
export const PAY_MODES = ['Cash','UPI','Card'];
export const PAY_FORM = ['Payment at venue'];
export const payShort = value => value === 'Payment at venue' ? 'Due' : value === 'Advance paid' ? 'Advance' : 'Paid';

export const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const DOWL = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
export const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
