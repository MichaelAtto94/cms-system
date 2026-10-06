import {randomBytes,randomUUID,createHash} from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import {z} from 'zod';
import {query,transaction} from './db.js';
import {transport} from './mail.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const message='If an active account matches those details, a password reset link will be emailed. Check your inbox and spam folder.';
export function recoveryBaseURL(){const url=new URL(process.env.APP_URL||'http://localhost:'+(process.env.PORT||4000));if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('APP_URL must be an HTTP(S) application URL without credentials, query or fragment');if(process.env.NODE_ENV==='production'&&url.protocol!=='https:')throw Error('Set APP_URL to the public HTTPS application URL for password recovery');return url.origin}
export function installPasswordRecovery(app){
 const limit=()=>rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false});
 const origin=(req,res,next)=>req.headers['x-cms-request']==='1'?next():res.status(403).json({error:'Invalid request origin'});
 app.post('/api/forgot-password',limit(),origin,async(req,res)=>{
  const b=z.object({tenant:z.string().trim().min(1).max(100),email:z.email().max(254)}).parse(req.body);
  const base=recoveryBaseURL(),token=randomBytes(32).toString('hex');let mail;
  await transaction(async q=>{
   const u=(await q('SELECT * FROM users WHERE tenant=$1 AND email=$2 AND active=true FOR UPDATE',[b.tenant,b.email.toLowerCase()])).rows[0];if(!u)return;
   const last=(await q('SELECT created_at FROM password_resets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',[u.id])).rows[0];if(last&&Date.now()-new Date(last.created_at).getTime()<60000)return;
   await q('UPDATE password_resets SET used=true WHERE user_id=$1 AND used=false',[u.id]);
   const rid=randomUUID();await q("INSERT INTO password_resets(id,tenant,user_id,token_hash,session_version,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes')",[rid,u.tenant,u.id,hash(token),u.session_version]);
   mail={id:rid,to:u.email,url:base+'/reset-password#reset='+token};
  });
  res.json({message});
  // Send after returning the same response for matching and non-matching accounts.
  if(mail)setImmediate(async()=>{try{await transport.sendMail({from:process.env.MAIL_FROM,to:mail.to,subject:'Reset your CMS password',text:'A password reset was requested for your committee workspace.\n\n'+mail.url+'\n\nThis link expires in 30 minutes and can be used once. If you did not request it, you can ignore this email.'})}catch(e){try{await query('UPDATE password_resets SET used=true WHERE id=$1',[mail.id])}catch{}console.error('Password recovery email failed: '+String(e.code||'SMTP_ERROR'))}});
 });
 app.post('/api/reset-password',limit(),origin,async(req,res)=>{
  const b=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),password:z.string().min(12).max(128)}).parse(req.body);
  const password=await bcrypt.hash(b.password,12);
  await transaction(async q=>{
   const r=(await q('SELECT * FROM password_resets WHERE token_hash=$1',[hash(b.token)])).rows[0];
   const bad=()=>{const e=Error('This reset link is invalid or expired. Request a new link.');e.status=400;throw e};if(!r)bad();
   const u=(await q('SELECT * FROM users WHERE id=$1 AND tenant=$2 FOR UPDATE',[r.user_id,r.tenant])).rows[0];
   if(!u?.active||u.session_version!==r.session_version)bad();
   const claimed=(await q('UPDATE password_resets SET used=true WHERE id=$1 AND used=false AND expires_at>now() RETURNING id',[r.id])).rows[0];if(!claimed)bad();
   await q('UPDATE users SET password=$1,session_version=session_version+1 WHERE id=$2',[password,u.id]);
   await q('UPDATE password_resets SET used=true WHERE user_id=$1',[u.id]);
   await q('INSERT INTO audit(id,tenant,user_id,action,entity,details,ip) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),u.tenant,u.id,'PASSWORD_RESET',u.id,{method:'email recovery'},req.ip||'']);
  });
  res.clearCookie('cms',{path:'/'});res.json({message:'Password reset successfully. Sign in with your new password.'});
 });
}
