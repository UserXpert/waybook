const assert = require('node:assert/strict');
const origin = process.env.WAYBOOK_TEST_ORIGIN || 'http://localhost:3336';
const host = process.env.WAYBOOK_TEST_HOST;
const base = `${origin}${host ? '' : '/nordic'}/api/public/manage`;
async function send(action, id, fields = {}, email = 'customer@example.invalid') {
 if (host) {
  const payload = JSON.stringify({action, bookingId:id, email, ...fields});
  return new Promise((resolve, reject) => {
   const request = require('node:http').request(base, { method:'POST', headers:{host, origin:`http://${host}`, 'content-type':'application/json', 'content-length':Buffer.byteLength(payload)} }, (response) => {
    let body=''; response.setEncoding('utf8'); response.on('data',(chunk)=>body+=chunk); response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(body),headers:new Headers(response.headers)}));
   });
   request.on('error',reject); request.end(payload);
  });
 }
 const response = await fetch(base, { method:'POST', headers:{ origin, 'content-type':'application/json' }, body:JSON.stringify({action, bookingId:id, email, ...fields}) });
 return {status:response.status, body:await response.json(), headers:response.headers};
}
(async () => {
 const a='60000000-0000-4000-8000-000000000001', b='60000000-0000-4000-8000-000000000002', paid='60000000-0000-4000-8000-000000000003';
 const invalid=await send('lookup',a,{},'wrong@example.invalid'); assert.equal(invalid.status,404);
 const found=await send('lookup',a); assert.equal(found.status,200,JSON.stringify(found.body)); assert.equal(found.body.booking.service,'Test Service'); assert.match(found.headers.get('cache-control'),/no-store/);
 const financial=await send('cancel',paid); assert.equal(financial.status,409); assert.match(financial.body.error,/payment or package/);
 const occupied=await send('lookup',paid); const conflict=await send('reschedule',a,{startsAt:occupied.body.booking.startsAt}); assert.equal(conflict.status,409);
 const day=new Date(found.body.booking.startsAt); const availability=await send('availability',a,{start:new Date(day.getTime()-86400000).toISOString(),end:new Date(day.getTime()+86400000).toISOString()}); assert.equal(availability.status,200,JSON.stringify(availability.body));
 const slot=availability.body.availability.flatMap(p=>p.slots).find(s=>new Date(s.startTime).getTime()>Date.now() && s.startTime!==found.body.booking.startsAt); assert.ok(slot,'fixture needs an available slot');
 const moved=await send('reschedule',a,{startsAt:slot.startTime}); assert.equal(moved.status,200,JSON.stringify(moved.body));
 const reloaded=await send('lookup',a); assert.equal(new Date(reloaded.body.booking.startsAt).toISOString(),new Date(slot.startTime).toISOString());
 const cancelled=await send('cancel',b); assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
 const repeated=await send('cancel',b); assert.equal(repeated.status,200);
 const final=await send('lookup',b); assert.equal(final.body.booking.status,'cancelled');
 console.log('Management API: credential isolation, occupied slot, reschedule persistence, paid cancellation guard and idempotent cancellation passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
