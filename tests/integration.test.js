import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import bcrypt from 'bcryptjs';
import os from 'node:os';
import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cms-test-'));
let port,base;
let server,output='';
const messages=[];
const smtp=net.createServer(socket=>{socket.write('220 localhost Test SMTP\r\n');let buffer='',data=false,body=[];socket.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\r\n')){const pos=buffer.indexOf('\r\n'),line=buffer.slice(0,pos);buffer=buffer.slice(pos+2);if(data){if(line==='.') {messages.push(body.join('\n'));body=[];data=false;socket.write('250 queued\r\n')}else body.push(line)}else if(/^EHLO/.test(line))socket.write('250 localhost\r\n');else if(/^DATA/.test(line)){data=true;socket.write('354 send data\r\n')}else if(/^QUIT/.test(line)){socket.end('221 goodbye\r\n')}else socket.write('250 OK\r\n')}})});

async function waitForServer(){
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){
  assert.ok(server.exitCode===null&&server.signalCode===null,'Test server exited before becoming ready.\n'+output);
  try{if((await fetch(base+'/health',{signal:AbortSignal.timeout(1000)})).ok)return}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.fail('Test server did not become ready within 90 seconds.\n'+(output||'No server output received. Check Node.js and security software.'));
}
function startServer(options){
 const child=spawn(process.execPath,['server/index.js'],options);
 child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 child.on('error',e=>output+='\n'+e.stack);
 return child;
}
async function stopServer(){
 if(!server||server.exitCode!==null||server.signalCode!==null)return;
 const child=server;
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill();reject(new Error('Test server shutdown timed out.\n'+output))},30000);
  child.once('exit',()=>{clearTimeout(timer);resolve()});
  child.send('cms:test:shutdown',e=>{if(e){clearTimeout(timer);child.kill();reject(e)}});
 });
}

async function request(url,body,cookie='',method='POST'){
 const r=await fetch(base+url,{method:body===undefined?'GET':method,headers:{'Content-Type':'application/json','X-CMS-Request':'1',cookie},body:body===undefined?undefined:JSON.stringify(body)});
 const ct=r.headers.get('content-type');return {status:r.status,cookie:r.headers.get('set-cookie')?.split(';')[0],data:ct?.includes('json')?await r.json():Buffer.from(await r.arrayBuffer())};
}
const profile=(name,email,role='ADMIN')=>({name,email,role,department:'Governance',skills:'finance,governance',gender:'Unspecified',available:true,password:'TestPassword!234'});
test('Governance integration: approvals, conflicts, tenant access, reports and locked minutes',async t=>{
 process.env.DATA_DIR=dir;process.env.DATABASE_URL='';process.env.ADMIN_EMAIL='admin@cms.local';process.env.ADMIN_PASSWORD='TestPassword!234';
 const db=await import('../server/db.js');await db.init();await (await import('../server/seed.js')).seed();
 await db.query("INSERT INTO institutions VALUES('other','Other institution','{}')");
 await db.query("INSERT INTO users(id,tenant,name,email,password,role) VALUES('other-admin','other','Other admin','other@example.com',$1,'ADMIN')",[await bcrypt.hash('TestPassword!234',12)]);await db.query("INSERT INTO outbox(id,tenant,recipient,subject,body,status) VALUES('retry-fixture','nipa','admin@cms.local','Test failure','Test','FAILED')");await db.close();
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));port=probe.address().port;await new Promise(r=>probe.close(r));base='http://127.0.0.1:'+port+'/api';
 await new Promise(r=>smtp.listen(0,'127.0.0.1',r));
 const serverOptions={env:{...process.env,PORT:String(port),DATA_DIR:dir,DATABASE_URL:'',JWT_SECRET:'test-secret-that-is-over-thirty-two-characters-long',ADMIN_EMAIL:'admin@cms.local',ADMIN_PASSWORD:'TestPassword!234',DISABLE_WORKER:'true',REQUIRE_2FA:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.address().port),SMTP_SECURE:'false',SMTP_USER:''},stdio:['ignore','pipe','pipe','ipc']};
 server=startServer(serverOptions);
 t.after(async()=>{try{await stopServer()}finally{smtp.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100})}});
 await waitForServer();
 const login=async email=>{const r=await request('/login',{email,password:'TestPassword!234',tenant:'nipa'});if(!r.data.challenge)return r.cookie;const code=messages.at(-1).match(/Verification code: (\d{6})/)[1];const verified=await request('/login/verify',{challenge:r.data.challenge,code});assert.equal(verified.status,200);return verified.cookie};
 const admin=await login('admin@cms.local');assert.ok(admin);assert.ok(messages.some(m=>m.includes('CMS sign-in verification')));assert.equal((await request('/integrations/email-test',{},admin)).status,200);assert.ok(messages.some(m=>m.includes('CMS connection test')));
 const otherLogin=await request('/login',{tenant:'other',email:'other@example.com',password:'TestPassword!234'});const otherCode=messages.at(-1).match(/Verification code: (\d{6})/)[1];const otherCookie=(await request('/login/verify',{challenge:otherLogin.data.challenge,code:otherCode})).cookie;
 const committee=await request('/committees',{name:'Finance Committee',type:'Finance',tor:'Review budget and procurement records',skills:'finance,governance',seats:3,term_months:12,max_terms:2},admin);assert.equal(committee.status,200);const cid=committee.data.id;assert.equal((await request('/committees/'+cid+'/rank',undefined,otherCookie)).status,404);assert.equal((await request('/state',undefined,otherCookie)).data.committees.length,0);
 const reviewer=(await request('/users',profile('Reviewer','reviewer@example.com'),admin)).data.id;
 const approver=(await request('/users',profile('Approver','approver@example.com'),admin)).data.id;
 const member=(await request('/users',profile('Member','member@example.com','MEMBER'),admin)).data.id;
 const rev=await login('reviewer@example.com'),appr=await login('approver@example.com'),mem=await login('member@example.com');
 const conflict=(await request('/conflicts',{committee_id:cid,user_id:member,description:'Supplier ownership'},admin));assert.equal(conflict.status,200);
 const start=new Date().toISOString().slice(0,10),end=new Date(Date.now()+180*86400000).toISOString().slice(0,10);
 const payload={committee_id:cid,user_id:member,role:'MEMBER',start_date:start,end_date:end};
 assert.equal((await request('/allocations',payload,admin)).status,400);
 let s=(await request('/state',undefined,admin)).data;const conflictId=s.conflicts[0].id;
 assert.equal((await request('/conflicts/'+conflictId+'/resolve',{reason:'Ownership divested; evidence checked'},admin)).status,200);
 assert.equal((await request('/allocations',payload,admin)).status,400); // A resolved legacy conflict is not a no-conflict attestation.
 assert.equal((await request('/declaration-requests',{committee_id:cid,user_id:member},admin)).status,200);
 assert.equal((await request('/declarations',{committee_id:cid,kind:'NO_CONFLICT',description:'I have no personal or supplier interest in this committee.',evidence:'Supplier register checked',attested:true},mem)).status,200);
 s=(await request('/state',undefined,admin)).data;const declarationId=s.declarations.find(d=>d.user_id===member).id;
 assert.equal((await request('/declarations/'+declarationId+'/review',{decision:'CLEAR',reason:'Checked declaration against supplier register'},admin)).status,200);
 assert.equal((await request('/allocations',payload,admin)).status,200);s=(await request('/state',undefined,admin)).data;const aid=s.allocations[0].id;assert.equal((await request('/document-templates/appointment/'+aid+'/pdf',undefined,admin)).status,400);
 assert.equal((await request('/allocations/'+aid+'/decision',{decision:'REVIEW',reason:'Checked'},admin)).status,400);
 assert.equal((await request('/allocations/'+aid+'/decision',{decision:'REVIEW',reason:'Checked'},rev)).status,200);
 assert.equal((await request('/allocations/'+aid+'/decision',{decision:'APPROVE',reason:'Approved'},rev)).status,400);
 assert.equal((await request('/allocations/'+aid+'/decision',{decision:'APPROVE',reason:'Approved'},appr)).status,200);
 assert.equal((await request('/committees',{name:'Forbidden'},mem)).status,403);
 assert.equal((await request('/committees/unknown/rank',undefined,admin)).status,404);
 const meeting=(await request('/meetings',{committee_id:cid,title:'Budget review',starts_at:new Date(Date.now()+1500).toISOString(),venue:'Boardroom',agenda:'1. Budget review\n2. Actions'},admin));assert.equal(meeting.status,200);
 s=(await request('/state',undefined,admin)).data;const mid=s.meetings[0].id;await new Promise(r=>setTimeout(r,1600));
 assert.equal((await request('/attendance',{meeting_id:mid,user_id:member,present:true},admin)).status,200);
 assert.equal((await request('/meetings/'+mid,{minutes:'Budget reviewed. Member will prepare a revision.',status:'SUBMITTED'},admin,'PATCH')).status,200);
 assert.equal((await request('/meetings/'+mid,{minutes:'Budget reviewed. Member will prepare a revision.',status:'APPROVED'},appr,'PATCH')).status,200);
 assert.equal((await request('/meetings/'+mid,{minutes:'Changed',status:'DRAFT'},admin,'PATCH')).status,400);
 assert.equal((await request('/actions',{meeting_id:mid,title:'Prepare budget revision',owner_id:member,due_date:end},admin)).status,200);
 assert.equal((await request('/votes',{meeting_id:mid,question:'Adopt revised budget?',closes_at:new Date(Date.now()+86400000).toISOString()},admin)).status,200);
 s=(await request('/state',undefined,admin)).data;const vid=s.votes[0].id;
 assert.equal((await request('/votes/'+vid+'/ballot',{choice:'YES'},mem)).status,200);
 assert.equal((await request('/votes/'+vid+'/ballot',{choice:'NO'},mem)).status,409);
 assert.equal((await request('/votes/'+vid+'/ballot',{choice:'YES'},admin)).status,403);assert.equal((await request('/recusals',{meeting_id:mid,user_id:member,reason:'Late disclosure'},admin)).status,400);
 const form=new FormData();form.append('committee_id',cid);form.append('title','Policy');form.append('access','CONFIDENTIAL');form.append('file',new Blob(['%PDF-1.4\nTest file']), 'policy.pdf');
 const upload=await fetch(base+'/documents',{method:'POST',headers:{cookie:admin,'X-CMS-Request':'1'},body:form});assert.equal(upload.status,200);
 s=(await request('/state',undefined,admin)).data;const did=s.documents[0].id;
 assert.equal((await request('/documents/'+did+'/download',undefined,mem)).status,403);
 assert.equal((await request('/checklist',{committee_id:cid,title:'Approved appointment record',requirement:'All members have recorded independent appointment approval',policy_reference:'Test institutional policy section 4',due_date:end,required:true},admin)).status,200);
 s=(await request('/state',undefined,admin)).data;const checkId=s.checklist[0].id;
 assert.equal((await request('/checklist/'+checkId+'/evidence',{evidence:'Appointment '+aid+' independently approved.',document_id:did},admin)).status,200);
 assert.equal((await request('/checklist/'+checkId+'/review',{decision:'VERIFY',reason:'Record reviewed'},admin)).status,403);
 assert.equal((await request('/checklist/'+checkId+'/review',{decision:'RETURN',reason:'Add a reference to the approval evidence.'},rev)).status,200);
 assert.equal((await request('/checklist/'+checkId+'/evidence',{evidence:'Appointment '+aid+'; approval audit record checked.',document_id:did,allocation_id:aid,meeting_id:mid},admin)).status,200);
 assert.equal((await request('/checklist/'+checkId+'/review',{decision:'VERIFY',reason:'Policy evidence confirmed'},rev)).status,200);
 assert.equal((await request('/checklist/'+checkId+'/evidence',{evidence:'Overwrite',document_id:null},admin)).status,400);
 const customPolicy={skillWeight:50,workloadWeight:40,availabilityWeight:10,maxWorkload:1,requireDeclaration:true,declarationDays:180,maxPerDepartment:1,minimumWomen:0};
 assert.equal((await request('/committees/'+cid+'/policy',{policy:{...customPolicy,skillWeight:70},reason:'Invalid total'},admin,'PATCH')).status,400);
 assert.equal((await request('/committees/'+cid+'/policy',{policy:customPolicy,reason:'Approved test policy section 7'},admin,'PATCH')).status,200);
 assert.equal((await request('/committees/'+cid+'/policy',{policy:customPolicy,reason:'Forbidden'},mem,'PATCH')).status,403);
 s=(await request('/state',undefined,admin)).data;assert.equal(s.committees[0].policy_version,2);assert.equal(s.policyHistory.length,2);assert.equal(s.checklist[0].status,'VERIFIED');
 const ranked=(await request('/committees/'+cid+'/rank',undefined,admin)).data;assert.ok(ranked.find(r=>r.user_id===member).reasons.includes('Maximum committee workload reached'));
 assert.equal((await request('/reports/compliance/pdf?committee_id='+cid,undefined,otherCookie)).status,404);
 const candidate2=(await request('/users',{...profile('Second candidate','candidate2@example.com','ADMIN'),department:'Technology',gender:'Female'},admin)).data.id;
 const cand2=await login('candidate2@example.com');
 assert.equal((await request('/declaration-requests',{committee_id:cid,user_id:candidate2},admin)).status,200);
 assert.equal((await request('/declarations',{committee_id:cid,kind:'NO_CONFLICT',description:'No relevant personal interest.',evidence:'Register checked',attested:true},cand2)).status,200);
 s=(await request('/state',undefined,admin)).data;const did2=s.declarations.find(d=>d.user_id===candidate2).id;
 assert.equal((await request('/declarations/'+did2+'/review',{decision:'CLEAR',reason:'Independent check'},cand2)).status,403);
 assert.equal((await request('/declarations/'+did2+'/review',{decision:'CLEAR',reason:'Independent check'},admin)).status,200);
 const payload2={...payload,user_id:candidate2};assert.equal((await request('/allocations',payload2,admin)).status,200);
 s=(await request('/state',undefined,admin)).data;let aid2=s.allocations.find(a=>a.user_id===candidate2&&a.status==='PENDING').id;
 assert.equal((await request('/allocations/'+aid2+'/decision',{decision:'REVIEW',reason:'Self review'},cand2)).status,403);
 assert.equal((await request('/allocations/'+aid2+'/decision',{decision:'REVIEW',reason:'Reviewed'},rev)).status,200);
 assert.equal((await request('/committees/'+cid+'/policy',{policy:customPolicy,reason:'New policy approval reference'},admin,'PATCH')).status,200);
 assert.equal((await request('/allocations/'+aid2+'/decision',{decision:'APPROVE',reason:'Stale evidence'},appr)).status,400);
 assert.equal((await request('/allocations/'+aid2+'/decision',{decision:'REJECT',reason:'Policy changed; resubmit'},admin)).status,200);
 assert.equal((await request('/allocations',payload2,admin)).status,200);s=(await request('/state',undefined,admin)).data;aid2=s.allocations.find(a=>a.user_id===candidate2&&a.status==='PENDING').id;
 assert.equal((await request('/allocations/'+aid2+'/decision',{decision:'REVIEW',reason:'Current policy reviewed'},rev)).status,200);
 assert.equal((await request('/allocations/'+aid2+'/decision',{decision:'APPROVE',reason:'Current evidence approved'},appr)).status,200);
 assert.equal((await request('/meetings',{committee_id:cid,title:'Recusal demonstration',starts_at:new Date(Date.now()+2*3600000).toISOString(),venue:'Boardroom',agenda:'Declaration and decision'},admin)).status,200);
 s=(await request('/state',undefined,admin)).data;const mid2=s.meetings.find(m=>m.title==='Recusal demonstration').id;
 assert.equal((await request('/votes',{meeting_id:mid2,question:'Proceed with motion?',closes_at:new Date(Date.now()+4*3600000).toISOString()},admin)).status,200);
 s=(await request('/state',undefined,admin)).data;const vid2=s.votes.find(v=>v.meeting_id===mid2).id;
 assert.equal((await request('/recusals',{meeting_id:mid2,user_id:candidate2,reason:'Recusal from this agenda discussion'},cand2)).status,200);
 assert.equal((await request('/votes/'+vid2+'/ballot',{choice:'YES'},cand2)).status,403);
 assert.equal((await request('/declarations',{committee_id:cid,kind:'CONFLICT',description:'New supplier interest disclosed',evidence:'Ownership reference',attested:true},cand2)).status,200);
 s=(await request('/state',undefined,admin)).data;const conflictDecl=s.declarations.find(d=>d.user_id===candidate2&&d.kind==='CONFLICT').id;
 assert.equal((await request('/declarations/'+conflictDecl+'/review',{decision:'CLEAR',reason:'Wrong review action'},admin)).status,400);
 assert.equal((await request('/declarations',{committee_id:cid,kind:'NO_CONFLICT',description:'Attempt to bypass conflict',evidence:'',attested:true},cand2)).status,400);
 assert.equal((await request('/declarations/'+conflictDecl+'/review',{decision:'CONFIRM_CONFLICT',reason:'Confirmed ownership'},admin)).status,200);
 assert.equal((await request('/declarations/'+conflictDecl+'/review',{decision:'RESOLVE',reason:'Verified disposal of ownership interest'},admin)).status,200);

 for(const type of ['governance','attendance','workload','minutes','audit','compliance']){for(const format of ['pdf','xlsx']){const r=await request('/reports/'+type+'/'+format,undefined,admin);assert.equal(r.status,200);assert.ok(r.data.length>1000);if(process.env.REPORT_SAMPLES_DIR&&format==='pdf'){fs.mkdirSync(process.env.REPORT_SAMPLES_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.REPORT_SAMPLES_DIR,'SAMPLE_'+type+'.pdf'),r.data)}assert.equal(r.data.subarray(0,format==='pdf'?4:2).toString(),format==='pdf'?'%PDF':'PK')}}
 assert.equal((await request('/ai',{meeting_id:mid,prompt:'Summarise'},admin)).status,503);
 assert.ok(s.audit.some(a=>a.action==='ALLOCATION_APPROVE'));assert.equal(s.allocations[0].status,'ACTIVE');assert.equal(s.allocations[0].start_date,start);assert.equal(s.allocations[0].end_date,end);
 // Member can only see committees where currently appointed, with no confidential documents or audit feed.
 const ms=(await request('/state',undefined,mem)).data;assert.equal(ms.committees.length,1);assert.equal(ms.documents.length,0);assert.equal(ms.audit.length,0);
 // Group permissions replace the role defaults, combine by scope, and apply to existing sessions.
 const delegatedUser=(await request('/users',profile('Delegated member','delegate@example.com','MEMBER'),admin)).data.id;
 const delegate=await login('delegate@example.com');
 const c2=(await request('/committees',{name:'Restricted second committee',type:'Finance',tor:'Second committee scope',skills:'finance',seats:3,term_months:12,max_terms:2},admin)).data.id;
 const groupBody={name:'Finance Secretariat',description:'Scoped scheduling duties',enabled:true,all_committees:false,committee_ids:[cid],permissions:['committee.read','meetings.create'],user_ids:[delegatedUser],reason:'Approved delegation for Finance'};
 const group=(await request('/access/groups',groupBody,admin)).data.id;assert.ok(group);
 assert.equal((await request('/access/groups',undefined,delegate)).status,403);
 assert.equal((await request('/access/groups',undefined,otherCookie)).data.groups.length,0);
 assert.equal((await request('/access/groups/'+group,{...groupBody,reason:'Attempt foreign change'},otherCookie,'PATCH')).status,404);
 assert.equal((await request('/access/groups',{...groupBody,name:'Foreign membership',user_ids:['other-admin']},admin)).status,404);
 assert.equal((await request('/access/groups',{...groupBody,name:'Invalid permission',permissions:['users.manage']},admin)).status,400);
 assert.equal((await request('/access/groups',{...groupBody,name:'No administrator restriction',user_ids:[reviewer]},admin)).status,400);
 let ds=(await request('/state',undefined,delegate)).data;assert.deepEqual(ds.committees.map(c=>c.id),[cid]);assert.ok(ds.access.permissions.includes('meetings.create'));assert.equal(ds.documents.length,0);assert.equal((await request('/documents/'+did+'/download',undefined,delegate)).status,403);assert.equal((await request('/allocations/'+aid+'/decision',{decision:'APPROVE',reason:'No approval grant'},delegate)).status,403);
 const delegatedMeeting={committee_id:cid,title:'Delegated scheduling',starts_at:new Date(Date.now()+86400000*10).toISOString(),venue:'Conference room',agenda:'Scoped access review'};
 assert.equal((await request('/meetings',delegatedMeeting,delegate)).status,200);
 assert.equal((await request('/meetings',{...delegatedMeeting,committee_id:c2},delegate)).status,403);
 assert.equal((await request('/committees/'+cid+'/rank',undefined,delegate)).status,403);
 assert.equal((await request('/settings',{},delegate,'PATCH')).status,403);
 const readOnly={...groupBody,name:'Second committee readers',committee_ids:[c2],permissions:['committee.read']};
 const g2=(await request('/access/groups',readOnly,admin)).data.id;assert.ok(g2);
 assert.equal((await request('/state',undefined,delegate)).data.committees.length,2);
 assert.equal((await request('/meetings',{...delegatedMeeting,committee_id:c2},delegate)).status,403,'Permission from first group cannot escape its scope');
 assert.equal((await request('/access/groups/'+group,{...groupBody,enabled:false,reason:'Suspend scheduling'},admin,'PATCH')).status,200);
 ds=(await request('/state',undefined,delegate)).data;assert.deepEqual(ds.committees.map(c=>c.id),[c2]);
 assert.equal((await request('/meetings',delegatedMeeting,delegate)).status,403,'Existing cookie observes revoked permissions');
 assert.equal((await request('/access/groups/'+g2,{...readOnly,enabled:false,reason:'Suspend all group access'},admin,'PATCH')).status,200);
 assert.equal((await request('/state',undefined,delegate)).data.committees.length,0,'Disabled assignments do not fall back to role defaults');
 assert.equal((await request('/access/groups/'+group,{...groupBody,enabled:true,permissions:['committee.read','reports.export'],reason:'Restore reporting only'},admin,'PATCH')).status,200);
 assert.equal((await request('/reports/governance/pdf?committee_id='+cid,undefined,delegate)).status,200);
 assert.equal((await request('/reports/governance/pdf?committee_id='+c2,undefined,delegate)).status,403);
 assert.equal((await request('/reports/governance/pdf',undefined,delegate)).status,403);
 assert.equal((await request('/reports/audit/pdf?committee_id='+cid,undefined,delegate)).status,403);
 assert.equal((await request('/access/groups/'+group,{...groupBody,permissions:['committee.read','reports.export','nominations.propose'],reason:'Delegate candidate proposals'},admin,'PATCH')).status,200);
 assert.equal((await request('/committees/'+cid+'/rank',undefined,delegate)).status,200);assert.equal((await request('/committees/'+c2+'/rank',undefined,delegate)).status,403);assert.ok((await request('/state',undefined,delegate)).data.users.some(u=>u.id===reviewer));
 assert.ok((await request('/state',undefined,admin)).data.audit.some(a=>a.action==='ACCESS_GROUP_UPDATED'));
 // Branded documents export only authorised actual records, with stable references and embedded logos.
 const branding={prefix:'NIPA',header:'Lusaka, Zambia',footer:'Institutional record — controlled copy',signatory:'Test Secretary',signatoryTitle:'Authorised secretary'};
 assert.equal((await request('/document-templates/branding',branding,admin,'PATCH')).status,200);
 assert.equal((await request('/document-templates/branding',branding,delegate,'PATCH')).status,403);
 const appearance={name:'Test institution',primary:'#167568',font:'Arial',fontSize:15,density:'Comfortable',logo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAeCAIAAAD/+uoYAAAAQElEQVR4nO3OQQ3AIAAAMUDENGIA//Owx5ElrYLO5+zxN+t24AvpinRFuiJdka5IV6Qr0hXpinRFuiJdka5IV16y3gEva209CAAAAABJRU5ErkJggg==',aiEnabled:false,reportFooter:'Report footer'};
 assert.equal((await request('/settings',appearance,admin,'PATCH')).status,200);assert.equal((await request('/state',undefined,admin)).data.institution.settings.documentBranding.prefix,'NIPA');
 for(const kind of ['appointment','invitation','agenda','attendance','minutes','decisions']){
  const source=kind==='appointment'?aid:mid;let reference;
  for(const format of ['docx','pdf']){const r=await request('/document-templates/'+kind+'/'+source+'/'+format,undefined,admin);assert.equal(r.status,200);assert.ok(r.data.length>1000);
   if(format==='docx'){const zip=await (await import('jszip')).default.loadAsync(r.data);const xml=await zip.file('word/document.xml').async('string');reference=xml.match(/Reference: (NIPA\/[0-9]{4}\/[0-9]{5})/)[1];assert.ok(zip.file('word/media/logo.png'));assert.ok((await zip.file('word/header1.xml').async('string')).includes('Test institution'));assert.ok(xml.includes('Signature:'));}else assert.equal(r.data.subarray(0,4).toString(),'%PDF');
   if(process.env.TEMPLATE_SAMPLES_DIR){fs.mkdirSync(process.env.TEMPLATE_SAMPLES_DIR,{recursive:true});fs.writeFileSync(path.join(process.env.TEMPLATE_SAMPLES_DIR,kind+'.'+format),r.data)}
  }
  const repeated=await request('/document-templates/'+kind+'/'+source+'/docx',undefined,admin),zip=await (await import('jszip')).default.loadAsync(repeated.data);assert.ok((await zip.file('word/document.xml').async('string')).includes(reference));
 }
 assert.equal((await request('/document-templates/minutes/'+mid+'/pdf',undefined,otherCookie)).status,404);
 assert.equal((await request('/document-templates/minutes/'+mid+'/pdf',undefined,mem)).status,403);
 assert.equal((await request('/document-templates/minutes/'+mid+'/pdf',undefined,delegate)).status,200);
 assert.equal((await request('/document-templates/minutes/not-a-record/pdf',undefined,admin)).status,404);
 assert.ok((await request('/state',undefined,admin)).data.audit.some(a=>a.action==='BRANDED_DOCUMENT_EXPORTED'));
 // Administrators manage scoped schedules; other tenants and members cannot change them.
 const scheduleBody={name:'Weekly Finance',report_type:'governance',format:'pdf',committee_id:cid,recipient_ids:[delegatedUser],frequency:'WEEKLY',time:'08:00',weekday:1,monthday:1,enabled:true};
 const scheduled=await request('/report-schedules',scheduleBody,admin);assert.equal(scheduled.status,200);const sid=scheduled.data.id;
 assert.equal((await request('/report-schedules',undefined,mem)).status,403);assert.equal((await request('/report-schedules',undefined,otherCookie)).data.schedules.length,0);
 assert.equal((await request('/report-schedules/'+sid,{...scheduleBody,name:'Foreign edit'},otherCookie,'PATCH')).status,404);
 assert.equal((await request('/report-schedules',{...scheduleBody,committee_id:null},admin)).status,400);
 assert.equal((await request('/report-schedules',{...scheduleBody,report_type:'audit'},admin)).status,400);
 assert.equal((await request('/report-schedules/'+sid+'/run',{},admin)).status,200);let history=(await request('/report-schedules',undefined,admin)).data;assert.ok(history.deliveries.some(d=>d.schedule_id===sid&&d.status==='QUEUED'));
 assert.equal((await request('/access/groups/'+group,{...groupBody,permissions:['committee.read'],reason:'Revoke scheduled recipient export access'},admin,'PATCH')).status,200);
 assert.equal((await request('/report-schedules/'+sid,{...scheduleBody,enabled:false},admin,'PATCH')).status,200);history=(await request('/report-schedules',undefined,admin)).data;assert.equal(history.schedules[0].enabled,false);assert.ok(history.deliveries.some(d=>d.schedule_id===sid&&d.status==='CANCELLED'));
 assert.equal((await request('/access/groups/'+group,{...groupBody,permissions:['committee.read','reports.export','nominations.propose'],reason:'Restore recipient access after pause check'},admin,'PATCH')).status,200);
 // Personal notification controls remain scoped to the signed-in owner.
 const centre=(await request('/notifications/centre',undefined,mem)).data;assert.ok(centre.items.length);const nid=centre.items[0].id;
 assert.equal((await request('/notifications/'+nid,{read:true},otherCookie,'PATCH')).status,404);
 assert.equal((await request('/notifications/'+nid,{read:true,archived:true},mem,'PATCH')).status,200);
 assert.ok((await request('/notifications/centre?archived=true',undefined,mem)).data.items.some(n=>n.id===nid));
 assert.equal((await request('/notifications/'+nid,{archived:false,read:false},mem,'PATCH')).status,200);
 assert.equal((await request('/outbox/retry-fixture/retry',{},mem)).status,403);assert.equal((await request('/outbox/retry-fixture/retry',{},otherCookie)).status,404);assert.equal((await request('/outbox/retry-fixture/retry',{},admin)).status,200);assert.equal((await request('/outbox/retry-fixture/retry',{},admin)).status,400);assert.equal((await request('/notifications/centre',undefined,admin)).data.deliveries.find(d=>d.id==='retry-fixture').status,'QUEUED');
 const pref={...centre.preferences,email:false};assert.equal((await request('/notifications/preferences',pref,mem,'PATCH')).status,200);
 assert.equal((await request('/notifications/centre',undefined,mem)).data.preferences.email,false);
 assert.ok((await request('/notifications/centre',undefined,mem)).data.deliveries.every(d=>d.recipient==='member@example.com'));
 // Password changes revoke the previous session.
 assert.equal((await request('/password',{current:'TestPassword!234',password:'NewPassword!5678'},mem)).status,200);
 assert.equal((await request('/state',undefined,mem)).status,401);
 await stopServer();assert.ok(output.includes('Database safely closed.'));
 server=startServer(serverOptions);await waitForServer();
 const again=await login('admin@cms.local');const persisted=(await request('/state',undefined,again)).data;assert.equal((await request('/access/groups',undefined,again)).data.groups.length,2);assert.equal((await request('/state',undefined,await login('delegate@example.com'))).data.access.permissions.includes('reports.export'),true);assert.equal(persisted.allocations.find(a=>a.id===aid).status,'ACTIVE');assert.equal(persisted.meetings.find(m=>m.id===mid).status,'APPROVED');
});
