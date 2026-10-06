import nodemailer from 'nodemailer';
import {query,transaction} from './db.js';
import {randomUUID} from 'node:crypto';
import {preferences} from './notification-centre.js';
import {loadAccess,hasPermission} from './access.js';
import {createHash} from 'node:crypto';
import {tenureAlerts} from './governance.js';
export const transport=nodemailer.createTransport({host:process.env.SMTP_HOST||'localhost',port:Number(process.env.SMTP_PORT||1025),secure:process.env.SMTP_SECURE==='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined,connectionTimeout:7000,socketTimeout:10000,disableFileAccess:true,disableUrlAccess:true});
async function permittedTarget(q,user,page,id){
 if(!id||!['Meetings','Committees'].includes(page))return true;
 const cid=page==='Committees'?id:(await q('SELECT committee_id FROM meetings WHERE id=$1 AND tenant=$2',[id,user.tenant])).rows[0]?.committee_id;if(!cid)return false;
 const access=await loadAccess(q,user);return !access.grouped||hasPermission(access,'committee.read',cid);
}
export async function notify(q,tenant,user,title,body,dedupe=null,meta={}){
 const fresh=(await q('SELECT * FROM users WHERE id=$1 AND tenant=$2 AND active=true',[user.id,tenant])).rows[0];if(!fresh||!await permittedTarget(q,fresh,meta.page,meta.id))return;
 const p=preferences(fresh.notification_preferences),category=meta.category||'GENERAL';if(!p.categories[category]||(!p.inApp&&!p.email))return;
 const r=await q('INSERT INTO notifications(id,tenant,user_id,title,body,dedupe,category,target_page,target_id,in_app) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(dedupe) DO NOTHING RETURNING id',[randomUUID(),tenant,user.id,title,body,dedupe,category,meta.page||null,meta.id||null,p.inApp]);
 if(r.rows.length&&p.email)await q('INSERT INTO outbox(id,tenant,recipient,subject,body,user_id,notification_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),tenant,fresh.email,title,body,fresh.id,r.rows[0].id]);
}
async function approvalAlerts(){
 const users=(await query('SELECT * FROM users WHERE active=true')).rows;
 const people=[];for(const u of users)people.push({u,access:await loadAccess(query,u)});
 const allocations=(await query("SELECT * FROM allocations WHERE status IN ('PENDING','REVIEWED')")).rows;
 const minutes=(await query("SELECT * FROM meetings WHERE status='SUBMITTED'")).rows;
 const declarations=(await query("SELECT * FROM declarations WHERE status='SUBMITTED'")).rows;
 const checks=(await query("SELECT * FROM checklist_items WHERE status='SUBMITTED'")).rows;
 const jobs=[...allocations.map(a=>({record:a,key:a.status==='PENDING'?'nominations.review':'nominations.approve',exclude:[a.user_id,a.proposed_by,...(a.status==='REVIEWED'?[a.reviewed_by]:[])],page:'Committees',id:a.committee_id,title:a.status==='PENDING'?'Appointment awaiting review':'Appointment awaiting approval',version:a.status})),...minutes.map(m=>({record:m,key:'minutes.approve',exclude:[m.submitted_by],page:'Meetings',id:m.id,title:'Minutes awaiting approval',version:m.minutes})),...declarations.map(d=>({record:d,key:'declarations.review',exclude:[d.user_id],page:'Declarations',id:null,title:'Declaration awaiting review',version:d.status})),...checks.map(c=>({record:c,key:'checklist.manage',exclude:[c.submitted_by],page:'Governance',id:null,title:'Evidence awaiting review',version:c.evidence}))];
 for(const job of jobs)for(const {u,access} of people){const r=job.record;if(u.tenant!==r.tenant||job.exclude.includes(u.id)||!hasPermission(access,job.key,r.committee_id)||!hasPermission(access,'committee.read',r.committee_id))continue;
 if(!access.admin&&!access.grouped&&!(await query("SELECT id FROM allocations WHERE tenant=$1 AND user_id=$2 AND committee_id=$3 AND status='ACTIVE' AND start_date<=CURRENT_DATE AND end_date>=CURRENT_DATE",[u.tenant,u.id,r.committee_id])).rows.length)continue;
 const hash=createHash('sha256').update(String(job.version)).digest('hex').slice(0,16);
 await transaction(q=>notify(q,u.tenant,u,job.title,'Open the linked workspace to review the pending record.','approval:'+r.id+':'+job.key+':'+hash+':'+u.id,{category:'APPROVAL',page:job.page,id:job.id}));
 }
}
let working=false;
export async function tick(){
 if(working)return;working=true;
 try{
 const allocations=(await query("SELECT a.*,u.email,u.name FROM allocations a JOIN users u ON u.id=a.user_id WHERE a.status='ACTIVE' AND u.active=true")).rows;
 for(const a of allocations){const alert=tenureAlerts(a);if(alert)await transaction(q=>notify(q,a.tenant,{id:a.user_id,email:a.email},'Term reminder: '+alert,'Your committee term ends on '+a.end_date, a.id+':'+alert,{category:'TERM',page:'Committees',id:a.committee_id}));}
 const due=(await query("SELECT a.*,u.email FROM actions a JOIN users u ON u.id=a.owner_id WHERE a.status='OPEN' AND a.due_date<=CURRENT_DATE")).rows;
 for(const a of due)await transaction(q=>notify(q,a.tenant,{id:a.owner_id,email:a.email},'Action due',a.title+' • Due '+a.due_date,a.id+':due',{category:'ACTION',page:'Meetings',id:a.meeting_id}));
 const upcoming=(await query("SELECT m.*,u.id AS recipient_id,u.email FROM meetings m JOIN allocations a ON a.committee_id=m.committee_id JOIN users u ON u.id=a.user_id WHERE m.status NOT IN ('CANCELLED','APPROVED') AND m.starts_at>now() AND m.starts_at<=now()+interval '24 hours' AND a.status='ACTIVE' AND a.start_date<=m.starts_at::date AND a.end_date>=m.starts_at::date AND u.active=true")).rows;
 for(const m of upcoming)await transaction(q=>notify(q,m.tenant,{id:m.recipient_id,email:m.email},'Meeting starts within 24 hours',m.title+' • '+new Date(m.starts_at).toLocaleString('en-GB',{timeZone:'Africa/Lusaka'})+' CAT','meeting:'+m.id+':'+m.starts_at+':'+m.recipient_id,{category:'MEETING',page:'Meetings',id:m.id}));
 await approvalAlerts();
 // Recover abandoned claims. SMTP acceptance followed by a crash can still cause a repeat email.
 await query("UPDATE outbox SET status='QUEUED' WHERE status='SENDING' AND claimed_at<now()-interval '5 minutes'");
 const queued=(await query("SELECT * FROM outbox WHERE status='QUEUED' AND next_attempt<=now() ORDER BY created_at LIMIT 10")).rows;
 for(const message of queued){
 const m=(await query("UPDATE outbox SET status='SENDING',claimed_at=now() WHERE id=$1 AND status='QUEUED' RETURNING *",[message.id])).rows[0];if(!m)continue;
 if(m.user_id){const u=(await query('SELECT * FROM users WHERE id=$1 AND tenant=$2',[m.user_id,m.tenant])).rows[0],n=m.notification_id?(await query('SELECT category,target_page,target_id FROM notifications WHERE id=$1',[m.notification_id])).rows[0]:null;const pref=preferences(u?.notification_preferences);if(!u?.active||!pref.email||(n&&(!pref.categories[n.category]||!await permittedTarget(query,u,n.target_page,n.target_id)))){await query("UPDATE outbox SET status='CANCELLED',last_error='' WHERE id=$1",[m.id]);continue}}
 await query('UPDATE outbox SET attempts=attempts+1 WHERE id=$1',[m.id]);
 try{await transport.sendMail({from:process.env.MAIL_FROM,to:m.recipient,subject:m.subject,text:m.body});await query("UPDATE outbox SET status='SENT',last_error='' WHERE id=$1",[m.id]);}catch(e){await query("UPDATE outbox SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'QUEUED' END,next_attempt=now()+interval '5 minutes',last_error=$2 WHERE id=$1",[m.id,String(e.code||'SMTP delivery failed')]);}
 }
 }finally{working=false}
}
