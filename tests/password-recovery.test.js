import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import express from 'express';import bcrypt from 'bcryptjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cms-reset-'));process.env.DATA_DIR=dir;process.env.DATABASE_URL='';process.env.APP_URL='http://localhost:4000';
const {query,init,close}=await import('../server/db.js'),{installPasswordRecovery}=await import('../server/password-recovery.js'),{transport}=await import('../server/mail.js');
test('Email recovery hides account existence, hashes links, scopes tenants and resets once with session revocation',async()=>{
 await init();await query("INSERT INTO institutions VALUES('t','Test','{}')");await query("INSERT INTO users(id,tenant,name,email,password,role) VALUES('a','t','Admin','admin@example.com','old','ADMIN')");
 const mails=[];transport.sendMail=async m=>{mails.push(m)};const app=express();app.use(express.json());installPasswordRecovery(app);app.use((e,req,res,next)=>res.status(e.status||400).json({error:e.message}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 async function post(route,data,guard=true){const response=await fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(guard?{'X-CMS-Request':'1'}:{})},body:JSON.stringify(data)});return {status:response.status,data:await response.json()}}
 async function sent(){for(let i=0;i<100&&!mails.length;i++)await new Promise(r=>setTimeout(r,10));assert.ok(mails.length);return mails.at(-1).text.match(/#reset=([a-f0-9]{64})/)[1]}
 try{
  assert.equal((await post('forgot-password',{tenant:'t',email:'admin@example.com'},false)).status,403);
  const missing=await post('forgot-password',{tenant:'t',email:'missing@example.com'}),foreign=await post('forgot-password',{tenant:'wrong',email:'admin@example.com'}),known=await post('forgot-password',{tenant:'t',email:'admin@example.com'});assert.deepEqual(missing,known);assert.deepEqual(foreign,known);
  const token=await sent();const record=(await query('SELECT * FROM password_resets')).rows[0];assert.notEqual(record.token_hash,token);assert.equal(record.token_hash.length,64);assert.equal(mails[0].to,'admin@example.com');
  await post('forgot-password',{tenant:'t',email:'admin@example.com'});await new Promise(r=>setTimeout(r,20));assert.equal(mails.length,1,'Cooldown prevents repeated emails');
  const reset=await post('reset-password',{token,password:'NewRecovery!1234'});assert.equal(reset.status,200);assert.equal((await post('reset-password',{token,password:'OtherRecovery!1234'})).status,400);
  const user=(await query("SELECT * FROM users WHERE id='a'")).rows[0];assert.equal(user.session_version,1);assert.ok(await bcrypt.compare('NewRecovery!1234',user.password));assert.equal((await query("SELECT * FROM audit WHERE action='PASSWORD_RESET'")).rows.length,1);
  await query("UPDATE password_resets SET created_at=now()-interval '2 minutes'");mails.length=0;await post('forgot-password',{tenant:'t',email:'admin@example.com'});const expired=await sent();await query('UPDATE password_resets SET expires_at=now()');assert.equal((await post('reset-password',{token:expired,password:'NewRecovery!5678'})).status,400);
  async function freshLink(){await query("UPDATE password_resets SET created_at=now()-interval '2 minutes'");mails.length=0;assert.equal((await post('forgot-password',{tenant:'t',email:'admin@example.com'})).status,200);return sent()}
  const superseded=await freshLink();await query("UPDATE users SET session_version=session_version+1 WHERE id='a'");assert.equal((await post('reset-password',{token:superseded,password:'AnotherReset!1234'})).status,400,'Password/session changes revoke outstanding links');
  const concurrent=await freshLink();const results=await Promise.all([post('reset-password',{token:concurrent,password:'ConcurrentReset!1234'}),post('reset-password',{token:concurrent,password:'ConcurrentReset!1234'})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400],'Only one concurrent reset succeeds');

 }finally{await new Promise(r=>server.close(r));await close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
});
