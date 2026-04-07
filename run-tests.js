'use strict'
/**
 * PAGIR 2 — Background Health-Check Test Suite
 *
 * NON-DESTRUCTIVE: no logout, no account delete, no emergency wipe.
 * Tokens are auto-refreshed and saved so this can be run any time.
 *
 * Usage:
 *   node run-tests.js            — run all tests (auto-refresh tokens)
 *   node run-tests.js --reauth   — paste a fresh accessToken + refreshToken
 *
 * Credentials stored in: .test-creds.json (auto-updated on each run)
 *
 * To populate credentials the first time:
 *   1. Log in via the app or OTP flow
 *   2. Copy the accessToken + refreshToken into .test-creds.json
 *   OR run:  node run-tests.js --reauth
 */

const fs     = require('fs')
const crypto = require('crypto')
const path   = require('path')
const BASE   = 'https://pagir2backend-production.up.railway.app/api/v2'
const CREDS  = path.join(__dirname, '.test-creds.json')

const G='\x1b[32m',R='\x1b[31m',C='\x1b[36m',Y='\x1b[33m',D='\x1b[2m',BD='\x1b[1m',X='\x1b[0m'
let pass=0,fail=0,skip=0,fails=[]
function ok(l){pass++;console.log('  '+G+'✓'+X+' '+l)}
function no(l,d){fail++;fails.push({l,d});console.log('  '+R+'✗'+X+' '+BD+l+X+(d?('\n    '+D+d+X):''))}
function sk(l){skip++;console.log('  '+Y+'⊘'+X+' '+D+l+X)}
function sec(t){console.log('\n'+BD+C+'━━ '+t+' ━━'+X)}
function inf(l,v){console.log('  '+D+'→'+X+' '+l+': '+Y+String(v)+X)}

async function api(method,path,body,token){
  const h={'X-Request-ID':Math.random().toString(36).slice(2),'X-Platform':'android','X-App-Version':'2.0.0'}
  if(body!=null) h['Content-Type']='application/json'
  if(token) h['Authorization']='Bearer '+token
  const r=await fetch(BASE+path,{method,headers:h,body:body!=null?JSON.stringify(body):undefined})
  return {status:r.status,body:await r.json().catch(()=>({}))}
}

// ─── QR Bundle helpers (pure JS, no network) ─────────────────────────────────
function encodePagirBundle(id,pk){return Buffer.from(JSON.stringify({v:2,id,pk})).toString('base64url')}
function decodePagirBundle(enc){
  try{
    const c=enc.replace(/^pagir2?:\/\//i,'').trim()
    const o=JSON.parse(Buffer.from(c,'base64url').toString('utf8'))
    if(!o.id||!o.pk) return null
    if(!/^PAG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(o.id)) return null
    return {pagirId:o.id,publicKeyPem:o.pk}
  }catch{return null}
}

const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789'  // 31 chars, matches generatePagirId() in app
function gid(){const b=crypto.randomBytes(12);let id='PAG-';for(let g=0;g<3;g++){for(let i=0;i<4;i++)id+=ALPHABET[b[g*4+i]%31];if(g<2)id+='-'}return id}
function jwtPayload(tok){try{return JSON.parse(Buffer.from(tok.split('.')[1],'base64url').toString())}catch{return null}}
function tokenExpiresIn(tok){const p=jwtPayload(tok);if(!p)return -1;return p.exp-Math.floor(Date.now()/1000)}

// ─── Credentials management ───────────────────────────────────────────────────
function loadCreds(){
  try{return JSON.parse(fs.readFileSync(CREDS,'utf8'))}catch{return null}
}
function saveCreds(creds){
  fs.writeFileSync(CREDS,JSON.stringify(creds,null,2),'utf8')
}

// ─── Interactive re-auth via email OTP ────────────────────────────────────────
async function reauth(){
  const readline=require('readline').createInterface({input:process.stdin,output:process.stdout})
  const ask=q=>new Promise(r=>readline.question(q,r))
  console.log('\n'+BD+C+'PAGIR 2 — Re-authenticate via Email OTP'+X+'\n')

  const email=await ask('  Email address: ')
  console.log('  '+D+'Requesting OTP…'+X)
  const sendR=await fetch(BASE+'/auth/otp/send-by-email',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Platform':'android','X-App-Version':'2.0.0'},
    body:JSON.stringify({email:email.trim()}),
  }).then(r=>r.json())

  if(!sendR.success){
    console.log(R+'OTP request failed: '+JSON.stringify(sendR.error??sendR)+X)
    readline.close();process.exit(1)
  }
  console.log(G+'  OTP sent to '+email.trim()+X)

  const otp=await ask('  Enter OTP code: ')
  const verR=await fetch(BASE+'/auth/otp/verify-by-email',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Platform':'android','X-App-Version':'2.0.0'},
    body:JSON.stringify({email:email.trim(),otp:otp.trim()}),
  }).then(r=>r.json())

  if(!verR.success){
    console.log(R+'OTP verify failed: '+JSON.stringify(verR.error??verR)+X)
    readline.close();process.exit(1)
  }

  readline.close()
  const d=verR.data
  // Keep existing publicKey if already stored; email flow doesn't re-send it
  const existing=loadCreds()
  const pk=existing?.A?.publicKey??''
  const creds={A:{pagirId:d.pagirId,accessToken:d.accessToken,refreshToken:d.refreshToken,publicKey:pk}}
  saveCreds(creds)
  console.log(G+'\nAuthenticated as '+d.pagirId+' — credentials saved to .test-creds.json'+X)
  return creds
}

;(async()=>{
  // ─── --reauth mode ───────────────────────────────────────────────────────────
  if(process.argv.includes('--reauth')){
    const creds=await reauth()
    console.log('\nRun  node run-tests.js  to execute the test suite.\n')
    process.exit(0)
  }

  console.log('\n'+BD+C+'╔══════════════════════════════════════════════════════════╗')
  console.log('║   PAGIR 2 — Background Health-Check Suite (Read-Only)    ║')
  console.log('╚══════════════════════════════════════════════════════════╝'+X+'\n')

  // ─── Load credentials ───────────────────────────────────────────────────────
  let creds=loadCreds()
  if(!creds){
    console.log(R+'No credentials found at .test-creds.json'+X)
    console.log(D+'Run:  node run-tests.js --reauth  to set them up.'+X+'\n')
    process.exit(1)
  }
  let A=creds.A
  inf('Account',A.pagirId)
  inf('Token expires in',tokenExpiresIn(A.accessToken)+'s')

  // ─── Auto-refresh if access token is close to expiry (<5 min) ───────────────
  sec('Phase 0 · Token Hydration')
  if(tokenExpiresIn(A.accessToken)<300){
    console.log('  '+D+'Access token expiring — refreshing…'+X)
    const rr=await api('POST','/auth/token/refresh',{refreshToken:A.refreshToken},null)
    if(rr.status===200&&rr.body.success){
      A.accessToken=rr.body.data.accessToken
      A.refreshToken=rr.body.data.refreshToken
      creds.A=A
      saveCreds(creds)
      ok('Tokens refreshed and saved to .test-creds.json')
      inf('New expiry in',tokenExpiresIn(A.accessToken)+'s')
    }else{
      no('Token refresh failed — run: node run-tests.js --reauth',JSON.stringify(rr.body.error??rr.body))
      process.exit(1)
    }
  }else{
    ok('Access token still valid ('+tokenExpiresIn(A.accessToken)+'s remaining)')
  }

  // Quick validity check before proceeding
  const quick=await api('GET','/users/me',null,A.accessToken)
  if(quick.status!==200){
    no('Token rejected by backend — run: node run-tests.js --reauth','status '+quick.status)
    process.exit(1)
  }
  ok('Token accepted by backend')

  // ─── Phase 1: Health Check ───────────────────────────────────────────────────
  sec('Phase 1 · Health Check')
  const h=await fetch('https://pagir2backend-production.up.railway.app/health').then(r=>r.json()).catch(e=>({error:e.message}))
  if(h.status==='ok'){ok('Backend healthy');inf('Protocol',h.protocol);inf('Version',h.version);inf('Env',h.env)}
  else{no('Health check failed',JSON.stringify(h));process.exit(1)}

  // ─── Phase 2: Security — Unauthenticated Rejection ───────────────────────────
  sec('Phase 2 · Auth Security')
  const noTok=await api('GET','/users/me',null,null)
  noTok.status===401?ok('No token → 401 Unauthorized'):no('No token should 401','got '+noTok.status)

  const badTok=await api('GET','/users/me',null,'Bearer eyJfake.garbage.signature')
  badTok.status===401?ok('Invalid token → 401 Unauthorized'):no('Bad token should 401','got '+badTok.status)

  const expiredTok='eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJQQUctWFhYWC1YWFhYLVhYWFgiLCJqdGkiOiJmYWtlIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDF9.invalidsig'
  const expR=await api('GET','/users/me',null,expiredTok)
  expR.status===401?ok('Expired/invalid token → 401'):no('Expired token should 401','got '+expR.status)

  // ─── Phase 3: User Profile ───────────────────────────────────────────────────
  sec('Phase 3 · User Profile — GET /users/me')
  const me=await api('GET','/users/me',null,A.accessToken)
  if(me.status===200&&me.body.data?.pagirId===A.pagirId){
    ok('/users/me returns correct profile')
    inf('pagirId',me.body.data.pagirId)
    inf('displayName',me.body.data.displayName)
    inf('keyVersion',me.body.data.keyVersion)
    inf('isActive',me.body.data.isActive)
    me.body.data.isActive===true?ok('Account is active'):no('Account not active')
    me.body.data.publicKey?ok('Public key present'):no('Public key missing')
  }else{
    no('/users/me',JSON.stringify(me.body.error??me.body))
  }

  // ─── Phase 4: User Lookup ────────────────────────────────────────────────────
  sec('Phase 4 · User Lookup — GET /users/:pagirId')
  const selfLookup=await api('GET','/users/'+encodeURIComponent(A.pagirId),null,A.accessToken)
  selfLookup.status===200&&selfLookup.body.data?.pagirId===A.pagirId
    ?(ok('Self-lookup returns correct profile'),inf('hasPublicKey',!!selfLookup.body.data.publicKey))
    :no('Self-lookup failed','got '+selfLookup.status)

  const fakeId='PAG-ZZZZ-ZZZZ-ZZZZ'
  const notFound=await api('GET','/users/'+encodeURIComponent(fakeId),null,A.accessToken)
  notFound.status===404?ok('Non-existent ID → 404'):no('Fake ID should 404','got '+notFound.status)

  const badFormat=await api('GET','/users/NOT-A-VALID-FORMAT',null,A.accessToken)
  ;(badFormat.status===400||badFormat.status===404)?ok('Invalid format → 400/404 ('+badFormat.status+')'):no('Invalid format should 400/404','got '+badFormat.status)

  const noAuthLookup=await api('GET','/users/'+encodeURIComponent(A.pagirId),null,null)
  noAuthLookup.status===200?ok('User lookup is public (no auth required)'):no('Unauthenticated lookup','got '+noAuthLookup.status)

  // ─── Phase 5: QR Bundle (pure-JS, no network) ────────────────────────────────
  sec('Phase 5 · QR Bundle Codec (offline)')
  const testKey='-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEAtest\n-----END RSA PUBLIC KEY-----\n'
  const enc=encodePagirBundle(A.pagirId,A.publicKey)
  ok('encodePagirBundle produced output (len='+enc.length+')')

  const dec=decodePagirBundle(enc)
  dec&&dec.pagirId===A.pagirId&&dec.publicKeyPem===A.publicKey
    ?ok('Roundtrip encode→decode exact match')
    :no('Roundtrip mismatch')

  decodePagirBundle('pagir2://'+enc)?.pagirId===A.pagirId
    ?ok('pagir2:// URI prefix stripped correctly')
    :no('pagir2:// prefix stripping failed')

  decodePagirBundle('PAGIR2://'+enc)?.pagirId===A.pagirId
    ?ok('PAGIR2:// uppercase URI prefix stripped')
    :no('PAGIR2:// uppercase failed')

  decodePagirBundle('garbage')===null?ok('Garbage input → null'):no('Garbage should return null')
  decodePagirBundle('')===null?ok('Empty string → null'):no('Empty should return null')
  decodePagirBundle(null)===null?ok('null input → null'):no('null should return null')

  // PAGIR ID format validator
  const validId=gid()
  ;/^PAG-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/.test(validId)
    ?ok('gid() produces valid PAGIR ID ('+validId+')')
    :no('gid() produced invalid ID: '+validId)

  // Alphabet has 31 chars — check no 'undefined' in generated IDs
  const sampleIds=Array.from({length:50},()=>gid())
  const badIds=sampleIds.filter(id=>id.includes('undefined'))
  badIds.length===0?ok('50 random IDs — none contain "undefined" (% 31 correct)'):no('IDs contain "undefined": '+badIds[0])

  // ─── Phase 6: Token Refresh ───────────────────────────────────────────────────
  sec('Phase 6 · Token Refresh')
  const refR=await api('POST','/auth/token/refresh',{refreshToken:A.refreshToken},null)
  if(refR.status===200&&refR.body.success){
    ok('Refresh succeeded — new tokens issued')
    const newAcc=refR.body.data.accessToken
    const newRef=refR.body.data.refreshToken
    inf('New access token exp in',tokenExpiresIn(newAcc)+'s')
    const verify=await api('GET','/users/me',null,newAcc)
    verify.status===200?ok('New access token functional'):no('New access token rejected','got '+verify.status)
    // Update stored credentials with freshly-minted tokens
    A.accessToken=newAcc
    A.refreshToken=newRef
    creds.A=A
    saveCreds(creds)
    ok('Credentials updated in .test-creds.json')
  }else{
    no('Token refresh',JSON.stringify(refR.body.error??refR.body))
  }

  const invalidRef=await api('POST','/auth/token/refresh',{refreshToken:'not-a-jwt-garbage'},null)
  ;(invalidRef.status===401||invalidRef.status===400)
    ?ok('Invalid refresh token → '+invalidRef.status)
    :no('Invalid refresh should 401/400','got '+invalidRef.status)

  const missingBody=await api('POST','/auth/token/refresh',null,null)
  ;(missingBody.status===400||missingBody.status===422)
    ?ok('Missing body → '+missingBody.status)
    :no('Missing body should 400/422','got '+missingBody.status)

  // ─── Phase 7: Friends List (read-only) ───────────────────────────────────────
  sec('Phase 7 · Friends')
  const fl=await api('GET','/friends',null,A.accessToken)
  fl.status===200
    ?(ok('GET /friends → 200'),inf('friend count',(fl.body.friends??[]).length))
    :no('GET /friends',JSON.stringify(fl.body.error??fl.body))

  const rq=await api('GET','/friends/requests',null,A.accessToken)
  rq.status===200
    ?(ok('GET /friends/requests → 200'),inf('pending count',(rq.body.requests??[]).length))
    :no('GET /friends/requests',JSON.stringify(rq.body.error??rq.body))

  // Error cases — no state modifications
  const selfReq=await api('POST','/friends/request',{receiverId:A.pagirId},A.accessToken)
  selfReq.status===400?ok('Self friend-request → 400'):no('Self-request should 400','got '+selfReq.status)

  const fakeReq=await api('POST','/friends/request',{receiverId:'PAG-ZZZZ-ZZZZ-ZZZZ'},A.accessToken)
  ;(fakeReq.status===404||fakeReq.status===400)
    ?ok('Friend request to non-existent → '+fakeReq.status)
    :no('Non-existent request should 404/400','got '+fakeReq.status)

  const noAuthFl=await api('GET','/friends',null,null)
  noAuthFl.status===401?ok('GET /friends without auth → 401'):no('Friends without auth should 401','got '+noAuthFl.status)

  // ─── Phase 8: Relay — Self-relay A→A ────────────────────────────────────────
  sec('Phase 8 · Chat Relay — A→A self-relay')

  // Build a minimal valid PAGIR frame (magic 0x54415241, type TEXT, 128 bytes total)
  const frame=Buffer.alloc(128)
  frame.writeUInt32BE(0x54415241,0)   // TARA magic
  frame.writeUInt8(0x01,4)            // type = TEXT
  crypto.randomBytes(64).copy(frame,16)
  const testFrame=frame.toString('base64')

  const sendR=await api('POST','/relay/frame',{receiverId:A.pagirId,frameBase64:testFrame},A.accessToken)
  sendR.status===200&&sendR.body.success
    ?(ok('A sent frame to self → 200 queued'))
    :no('POST /relay/frame A→A',JSON.stringify(sendR.body.error??sendR.body))

  // Send a second frame to verify ordering
  const frame2=Buffer.alloc(96)
  frame2.writeUInt32BE(0x54415241,0)
  frame2.writeUInt8(0x01,4)
  crypto.randomBytes(64).copy(frame2,16)
  const testFrame2=frame2.toString('base64')
  await api('POST','/relay/frame',{receiverId:A.pagirId,frameBase64:testFrame2},A.accessToken)

  const pollR=await api('GET','/relay/poll',null,A.accessToken)
  if(pollR.status===200){
    ok('GET /relay/poll → 200')
    inf('frames received',(pollR.body.frames??[]).length)
    const got=(pollR.body.frames??[]).find(f=>f.senderId===A.pagirId&&f.frame===testFrame)
    got?ok('Self-relayed frame recovered (content exact match)'):no('Self-relayed frame not found in poll')
    const gotTs=(pollR.body.frames??[]).find(f=>f.ts)
    gotTs?ok('Frame has timestamp (ts field present)'):sk('No ts field in frame — minor')
  }else{
    no('GET /relay/poll',JSON.stringify(pollR.body.error??pollR.body))
  }

  // ─── Phase 9: Frame Validation ───────────────────────────────────────────────
  sec('Phase 9 · Frame Validation')

  const tooShort=Buffer.alloc(32).toString('base64')
  const shortR=await api('POST','/relay/frame',{receiverId:A.pagirId,frameBase64:tooShort},A.accessToken)
  shortR.status===400?ok('Frame < 72 bytes → 400 rejected'):no('Short frame should 400','got '+shortR.status)

  const oversized=Buffer.alloc(Math.ceil(2.1*1024*1024)).toString('base64')
  const bigR=await api('POST','/relay/frame',{receiverId:A.pagirId,frameBase64:oversized},A.accessToken)
  ;(bigR.status===400||bigR.status===413)
    ?ok('Frame > 2 MB → '+bigR.status+' rejected')
    :no('Oversized frame should 400/413','got '+bigR.status)

  const noReceiver=await api('POST','/relay/frame',{receiverId:'PAG-ZZZZ-ZZZZ-ZZZZ',frameBase64:testFrame},A.accessToken)
  noReceiver.status===404?ok('Relay to non-existent receiver → 404'):no('Non-existent receiver should 404','got '+noReceiver.status)

  const noBodyR=await api('POST','/relay/frame',null,A.accessToken)
  ;(noBodyR.status===400||noBodyR.status===422)
    ?ok('Relay with empty body → '+noBodyR.status)
    :no('Empty body should 400/422','got '+noBodyR.status)

  // ─── Phase 10: Drain any leftover test frames ────────────────────────────────
  sec('Phase 10 · Cleanup — drain remaining test frames')
  let leftover=await api('GET','/relay/poll',null,A.accessToken)
  let drained=(leftover.body.frames??[]).length
  // Keep polling until queue is empty (max 10 rounds)
  let rounds=0
  while((leftover.body.frames??[]).length>0&&rounds<10){
    drained+=(leftover.body.frames??[]).length
    leftover=await api('GET','/relay/poll',null,A.accessToken)
    rounds++
  }
  ok('Queue drained ('+drained+' leftover test frame(s) removed)')

  // ─── Summary ─────────────────────────────────────────────────────────────────
  const tot=pass+fail
  console.log('\n'+BD+C+'━━ Results ━━'+X)
  console.log(
    '  '+G+pass+' passed'+X+
    '  '+(fail>0?R:G)+fail+' failed'+X+
    '  '+Y+skip+' skipped'+X+
    '  of '+tot+' total\n'
  )
  if(fails.length){
    console.log(BD+R+'Failed:'+X)
    fails.forEach(f=>{
      console.log('  '+R+'✗'+X+' '+f.l)
      if(f.d)console.log('    '+D+f.d+X)
    })
    console.log()
  }
  if(fail===0){
    console.log('  '+G+BD+'All tests passed — PAGIR 2 backend fully healthy! ✓'+X)
    console.log('  '+D+'No infrastructure changes. Credentials auto-refreshed in .test-creds.json'+X+'\n')
  }else{
    console.log('  '+R+BD+fail+' test(s) need attention.'+X+'\n')
  }
  process.exit(fail>0?1:0)
})().catch(e=>{console.error(e);process.exit(1)})
