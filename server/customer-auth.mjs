import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';
import { ProductError } from './store.mjs';

export const AUTH_COOKIE='futly_customer_auth', PROOF_COOKIE='futly_customer_proof';
export function createCustomerAuth(env={}, fetcher=fetch){
  const base=env.TURF_SUPABASE_URL||env.SUPABASE_URL;
  const key=env.TURF_SUPABASE_PUBLISHABLE_KEY||env.SUPABASE_ANON_KEY;
  const secure=env.NODE_ENV==='production'?'; Secure':'';
  const cookie=(name,value,maxAge=2592000)=>`${name}=${value}; Path=/api/public/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  const encode=data=>Buffer.from(JSON.stringify(data)).toString('base64url');
  function decode(value){try{return JSON.parse(Buffer.from(value,'base64url').toString());}catch{return null;}}
  async function request(path,{method='GET',body,token}={}){
    if(!base||!key)throw new ProductError(503,'auth_unavailable','Customer sign-in is not configured yet.');
    let response;
    try{response=await fetcher(base+'/auth/v1/'+path,{method,headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),
      'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});}
    catch{throw new ProductError(503,'auth_unavailable','Sign-in is temporarily unavailable. Try again.');}
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      if(response.status===429)throw new ProductError(429,'auth_rate_limited','Too many attempts. Wait a few minutes and try again.');
      if(response.status>=500)throw new ProductError(503,'auth_unavailable','Account email or sign-in is temporarily unavailable. Try again.');
      const code=data.error_code||data.code;
      throw new ProductError(response.status===401?401:400,code==='email_not_confirmed'?'email_not_confirmed':'auth_failed',
        code==='email_not_confirmed'?'Confirm your email before signing in.':path.startsWith('token?grant_type=password')?
        'Email or password is incorrect.':path.startsWith('signup')?'Could not create the account. Try signing in, or use a different email.':
        'This sign-in request has expired or could not be completed. Please try again.');
    }
    return data;
  }
  function profile(user){
    // Identity comes only from Auth's verified /user response. Metadata is display-only.
    if(!user?.id||!user.email||user.is_anonymous)throw new ProductError(401,'customer_login_required','Sign in to your customer account.');
    return {id:user.id,email:user.email,name:String(user.user_metadata?.name||user.user_metadata?.full_name||'').slice(0,120)};
  }
  async function fromTokens(tokens){
    if(!tokens?.access_token||!tokens.refresh_token)throw new ProductError(401,'customer_login_required','Sign in to your customer account.');
    const user=profile(await request('user',{token:tokens.access_token}));
    const value=encode({access_token:tokens.access_token,refresh_token:tokens.refresh_token});
    if(value.length>3800)throw new ProductError(503,'auth_unavailable','Account session is too large. Please contact support.');
    return {user,accessToken:tokens.access_token,cookie:cookie(AUTH_COOKIE,value)};
  }
  async function session(value){
    if(!value)return {user:null};
    const tokens=decode(value);
    if(!tokens?.access_token||!tokens.refresh_token)return {user:null,cookie:cookie(AUTH_COOKIE,'',0)};
    try{return {user:profile(await request('user',{token:tokens.access_token})),accessToken:tokens.access_token};}
    catch(error){
      if(error.status===503||error.status===429)throw error;
      try{return await fromTokens(await request('token?grant_type=refresh_token',{method:'POST',body:{refresh_token:tokens.refresh_token}}));}
      catch(refreshError){if(refreshError.status===503||refreshError.status===429)throw refreshError;return {user:null,cookie:cookie(AUTH_COOKIE,'',0),expired:true};}
    }
  }
  function credentials(body,signup=false){
    const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new ProductError(400,'invalid_email','Enter a valid email address.');
    if(password.length>128||password.length<(signup?10:1))throw new ProductError(400,'invalid_password',signup?'Use a password with 10–128 characters.':'Enter your password.');
    return {email,password};
  }
  async function action(name,body,cookies,origin){
    if(name==='google'){
      const settings=await request('settings');
      if(!settings.external?.google)throw new ProductError(503,'google_not_configured','Google sign-in is not available yet. Use email and password for now.');
      const verifier=randomBytes(32).toString('base64url');
      const authorize=new URL(base+'/auth/v1/authorize');
      authorize.search=new URLSearchParams({provider:'google',redirect_to:origin+'/book/?auth=google',
        code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256',prompt:'select_account'}).toString();
      return {user:null,url:authorize.href,cookie:cookie(PROOF_COOKIE,encode({verifier,provider:'google'}),3600)};
    }
    if(name==='login')return fromTokens(await request('token?grant_type=password',{method:'POST',body:credentials(body)}));
    if(name==='signup'||name==='recover'){
      const input=name==='signup'?credentials(body,true):{email:credentials({...body,password:'unused'}).email};
      const verifier=randomBytes(32).toString('base64url');
      const challenge=createHash('sha256').update(verifier).digest('base64url');
      const redirect=origin+'/book/?auth='+ (name==='recover'?'recovery':'confirmed');
      const result=await request((name==='signup'?'signup':'recover')+'?redirect_to='+encodeURIComponent(redirect),{method:'POST',body:{...input,
        ...(name==='signup'?{data:{name:String(body.name||'').trim().slice(0,120)}}:{}),code_challenge:challenge,code_challenge_method:'s256'}});
      if(result.access_token)return fromTokens(result);
      return {user:null,confirmationRequired:true,cookie:cookie(PROOF_COOKIE,encode({verifier,recovery:name==='recover'}),3600)};
    }
    if(name==='exchange'){
      const proof=decode(cookies[PROOF_COOKIE]);
      if(!proof?.verifier||typeof body.code!=='string'||body.code.length>200)throw new ProductError(400,'auth_failed','This sign-in link has expired or belongs to another browser. Start sign-in again.');
      const result=await fromTokens(await request('token?grant_type=pkce',{method:'POST',body:{auth_code:body.code,code_verifier:proof.verifier}}));
      return {...result,recovery:!!proof.recovery,provider:proof.provider||'email',cookie:[result.cookie,cookie(PROOF_COOKIE,'',0)]};
    }
    const current=await session(cookies[AUTH_COOKIE]);
    if(name==='logout'){
      if(current.accessToken)await request('logout?scope=local',{method:'POST',token:current.accessToken});
      return {user:null,cookie:[cookie(AUTH_COOKIE,'',0),cookie(PROOF_COOKIE,'',0)]};
    }
    if(name==='password'){
      if(!current.user)throw new ProductError(401,'customer_login_required','Sign in again to change your password.');
      credentials({email:current.user.email,password:body.password},true);
      await request('user',{method:'PUT',body:{password:body.password},token:current.accessToken});
      return current;
    }
    throw new ProductError(404,'not_found','Account action not found.');
  }
  return {session,action};
}
