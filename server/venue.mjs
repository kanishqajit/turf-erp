// Public venue metadata shared by the ledger API and its lightweight read path.
export const PITCHES = [
  { name:'Pitch A', rate:1800 },
  { name:'Pitch B', rate:1200 },
  { name:'Main Ground', rate:3200 },
];
export const OPEN_MIN = 6 * 60;
export const CLOSE_MIN = 24 * 60;

export function publicVenue(depositAmount, env = {}){
  return {
    slug:env.TURF_VENUE_SLUG || 'futly-demo', name:env.TURF_VENUE_NAME || 'Futly Demo Arena',
    location:env.TURF_VENUE_LOCATION || 'Koramangala, Bengaluru',
    phone:env.TURF_VENUE_PHONE || '', demo:true, amenities:['Floodlights'],
    timeZone:env.TURF_TIME_ZONE || 'Asia/Kolkata',
    resources:PITCHES.map((pitch,id)=>({id,...pitch,sub:['7-a-side','5-a-side','11-a-side'][id]})),
    settings:{openMinute:OPEN_MIN,closeMinute:CLOSE_MIN,minimumMinutes:60,stepMinutes:30,
      floodlightAfter:1080,floodlightFee:300,depositAmount},
  };
}
