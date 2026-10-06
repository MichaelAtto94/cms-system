import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export const permissionCatalog=[
 ['committee.read','View committee records'],['nominations.propose','Rank candidates and propose appointments'],['nominations.review','Review or reject appointments'],['nominations.approve','Approve appointments'],['nominations.end','End appointments'],['meetings.create','Schedule meetings'],['minutes.edit','Draft and submit minutes'],['minutes.approve','Approve submitted minutes'],['attendance.manage','Record attendance'],['actions.manage','Assign and manage actions'],['votes.create','Create voting questions'],['documents.upload','Upload documents'],['documents.confidential','Access confidential documents'],['communications.send','Send committee communications'],['declarations.review','Request and review declarations'],['checklist.manage','Manage institutional evidence'],['reports.export','Export committee reports'],['ai.use','Generate AI meeting drafts']
].map(([key,label])=>({key,label}));
const keys=permissionCatalog.map(p=>p.key);
const officerDefaults=keys.filter(k=>!['nominations.approve','minutes.approve'].includes(k));
export function defaultPermissions(role){return role==='ADMIN'||role==='CHAIRPERSON'?keys:role==='SECRETARY'?officerDefaults:['committee.read']}
export function hasPermission(access,key,cid=null){
 if(access.admin)return true;
 if(!access.grouped)return access.permissions.includes(key);
 return access.groups.some(g=>g.enabled&&g.permissions.includes(key)&&(!cid||g.all_committees||g.committee_ids.includes(cid)));
}
export async function loadAccess(q,user){
 const rows=(await q('SELECT g.* FROM access_groups g JOIN access_group_members m ON m.group_id=g.id WHERE g.tenant=$1 AND m.tenant=$1 AND m.user_id=$2',[user.tenant,user.id])).rows;
 const groups=rows.map(g=>({...g,permissions:g.permissions||[],committee_ids:g.committee_ids||[]}));
 return {admin:user.role==='ADMIN',grouped:groups.length>0,groups,permissions:user.role==='ADMIN'?keys:groups.length?[...new Set(groups.filter(g=>g.enabled).flatMap(g=>g.permissions))]:defaultPermissions(user.role)};
}
export function routePermission(req){
 const p=req.path,b=req.body||{};
 if(p==='/committees'||/^\/committees\/[^/]+\/policy$/.test(p)||/^\/users(?:\/|$)/.test(p)||['/settings','/integrations/email-test'].includes(p)||p.startsWith('/outbox/')||p.startsWith('/access/')||p==='/document-templates/branding')return null;
 if(/^\/committees\/[^/]+\/rank$/.test(p)||p==='/allocations')return 'nominations.propose';
 if(/^\/allocations\/[^/]+\/decision$/.test(p))return ({APPROVE:'nominations.approve',END:'nominations.end',REVIEW:'nominations.review',REJECT:'nominations.review'})[b.decision]||'nominations.review';
 if(p==='/meetings'&&req.method==='POST')return 'meetings.create';
 if(/^\/meetings\/[^/]+$/.test(p)&&req.method==='PATCH')return b.status==='APPROVED'?'minutes.approve':'minutes.edit';
 if(p==='/attendance')return 'attendance.manage';
 if(p==='/actions')return 'actions.manage';
 if(p==='/votes')return 'votes.create';
 if(p==='/documents'&&req.method==='POST')return 'documents.upload';
 if(p==='/communications')return 'communications.send';
 if(p==='/declaration-requests'||/^\/declarations\/[^/]+\/review$/.test(p))return 'declarations.review';
 if(p.startsWith('/checklist'))return 'checklist.manage';
 if(p.startsWith('/document-templates/'))return 'reports.export';
 if(p.startsWith('/reports/'))return 'reports.export';
 if(p==='/ai')return 'ai.use';
 return null;
}
export function installAccess(app,{query,transaction,entity,audit,roles,fail}){
 const body=z.object({name:z.string().trim().min(2).max(100),description:z.string().trim().max(1000),enabled:z.boolean(),all_committees:z.boolean(),committee_ids:z.array(z.string().min(1).max(100)).max(500),permissions:z.array(z.enum(keys)).max(keys.length),user_ids:z.array(z.string().min(1).max(100)).max(500),reason:z.string().trim().min(3).max(1000)}).superRefine((b,c)=>{if(b.permissions.length&&!b.permissions.includes('committee.read'))c.addIssue({code:'custom',message:'Include View committee records when granting committee actions'});if(b.all_committees&&b.committee_ids.length)c.addIssue({code:'custom',message:'Choose all committees or selected committees'});});
 app.get('/api/access/groups',roles('ADMIN'),async(req,res)=>{res.json({catalog:permissionCatalog,groups:(await query('SELECT * FROM access_groups WHERE tenant=$1 ORDER BY name',[req.user.tenant])).rows,members:(await query('SELECT * FROM access_group_members WHERE tenant=$1',[req.user.tenant])).rows})});
 async function save(req,res){const b=body.parse(req.body),gid=req.params.id||randomUUID();await transaction(async q=>{
  // Serialise changes so membership replacements and group edits stay atomic.
  await q('SELECT id FROM institutions WHERE id=$1 FOR UPDATE',[req.user.tenant]);
  const before=req.params.id?await entity(q,'access_groups',gid,req.user.tenant):null;
  const previous=(await q('SELECT user_id FROM access_group_members WHERE group_id=$1 AND tenant=$2',[gid,req.user.tenant])).rows.map(m=>m.user_id);
  for(const cid of new Set(b.committee_ids))await entity(q,'committees',cid,req.user.tenant);
  for(const uid of new Set(b.user_ids)){const u=await entity(q,'users',uid,req.user.tenant);if(u.role==='ADMIN')fail(400,'Administrators retain full access and cannot be assigned to restricted groups');if(!u.active)fail(400,'Choose active members only')}
  const permissions=[...new Set(b.permissions)],committeeIds=[...new Set(b.committee_ids)];
  if(before)await q('UPDATE access_groups SET name=$1,description=$2,enabled=$3,all_committees=$4,committee_ids=$5,permissions=$6,updated_at=now() WHERE id=$7 AND tenant=$8',[b.name,b.description,b.enabled,b.all_committees,JSON.stringify(committeeIds),JSON.stringify(permissions),gid,req.user.tenant]);
  else await q('INSERT INTO access_groups(id,tenant,name,description,enabled,all_committees,committee_ids,permissions) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[gid,req.user.tenant,b.name,b.description,b.enabled,b.all_committees,JSON.stringify(committeeIds),JSON.stringify(permissions)]);
  await q('DELETE FROM access_group_members WHERE group_id=$1 AND tenant=$2',[gid,req.user.tenant]);
  for(const uid of new Set(b.user_ids))await q('INSERT INTO access_group_members(tenant,group_id,user_id) VALUES($1,$2,$3)',[req.user.tenant,gid,uid]);
  await audit(q,req,before?'ACCESS_GROUP_UPDATED':'ACCESS_GROUP_CREATED',gid,{before:before?{...before,user_ids:previous}:null,after:{...b,permissions,committee_ids:committeeIds},reason:b.reason});
 });res.json({id:gid});}
 app.post('/api/access/groups',roles('ADMIN'),save);app.patch('/api/access/groups/:id',roles('ADMIN'),save);
}
