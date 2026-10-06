import {z} from 'zod';
export const categories=['GENERAL','MEETING','TERM','ACTION','APPROVAL','DECLARATION','COMMUNICATION','REPORT'];
export function preferences(value={}){return {inApp:value.inApp!==false,email:value.email!==false,categories:Object.fromEntries(categories.map(k=>[k,value.categories?.[k]!==false]))}}
export function installNotifications(app,{query,transaction,entity,audit,roles}){
 app.get('/api/notifications/centre',async(req,res)=>{
  const tenant=req.user.tenant,uid=req.user.id,limit=50,offset=Math.max(0,Math.min(100000,Math.floor(Number(req.query.offset)||0)));
  const archive=req.query.archived==='true',unread=req.query.unread==='true',category=categories.includes(req.query.category)?req.query.category:null;
  const args=[tenant,uid,archive,unread,category];
  const where='tenant=$1 AND user_id=$2 AND in_app=true AND archived=$3 AND (NOT $4::boolean OR read=false) AND ($5::text IS NULL OR category=$5)';
  const items=(await query('SELECT * FROM notifications WHERE '+where+' ORDER BY created_at DESC,id LIMIT 50 OFFSET $6',[...args,offset])).rows;
  const count=Number((await query('SELECT count(*) AS n FROM notifications WHERE '+where,args)).rows[0].n);
  const unreadCount=Number((await query('SELECT count(*) AS n FROM notifications WHERE tenant=$1 AND user_id=$2 AND in_app=true AND archived=false AND read=false',[tenant,uid])).rows[0].n);
  const deliveries=(await query(req.user.role==='ADMIN'?'SELECT id,recipient,subject,status,attempts,last_error,created_at FROM outbox WHERE tenant=$1 ORDER BY created_at DESC LIMIT 100':'SELECT id,recipient,subject,status,attempts,last_error,created_at FROM outbox WHERE tenant=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100',req.user.role==='ADMIN'?[tenant]:[tenant,uid])).rows;
  res.json({items,count,unreadCount,offset,limit,preferences:preferences(req.user.notification_preferences),deliveries,categories});
 });
 app.patch('/api/notifications/preferences',async(req,res)=>{const b=z.object({inApp:z.boolean(),email:z.boolean(),categories:z.object(Object.fromEntries(categories.map(k=>[k,z.boolean()])))}).parse(req.body);await transaction(async q=>{await q('UPDATE users SET notification_preferences=$1 WHERE id=$2 AND tenant=$3',[b,req.user.id,req.user.tenant]);await audit(q,req,'NOTIFICATION_PREFERENCES_CHANGED',req.user.id,b)});res.json({ok:true})});
 app.patch('/api/notifications/:id',async(req,res)=>{const b=z.object({read:z.boolean().optional(),archived:z.boolean().optional()}).refine(b=>Object.keys(b).length>0).parse(req.body);const n=(await query('SELECT id FROM notifications WHERE id=$1 AND tenant=$2 AND user_id=$3',[req.params.id,req.user.tenant,req.user.id])).rows[0];if(!n)return res.status(404).json({error:'Notification not found'});await query('UPDATE notifications SET read=COALESCE($1,read),archived=COALESCE($2,archived) WHERE id=$3 AND tenant=$4 AND user_id=$5',[b.read??null,b.archived??null,n.id,req.user.tenant,req.user.id]);res.json({ok:true})});
}
