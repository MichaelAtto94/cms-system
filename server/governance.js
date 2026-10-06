export const defaultPolicy={skillWeight:60,workloadWeight:30,availabilityWeight:10,maxWorkload:3,requireDeclaration:true,declarationDays:365,maxPerDepartment:0,minimumWomen:0};
export function allocationPolicy(c){return {...defaultPolicy,...c.allocation_policy}}
export function latestDeclaration(declarations,uid,cid){return declarations.filter(d=>d.user_id===uid&&d.committee_id===cid&&d.status!=='SUPERSEDED').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)||b.id.localeCompare(a.id))[0]}
export function declarationClear(d,today){return !!d&&['CLEARED','RESOLVED'].includes(d.status)&&d.valid_until>=today}
export function rankCandidates(committee,users,allocations,conflicts,today=new Date().toISOString().slice(0,10),declarations=null){
 const policy=allocationPolicy(committee);
 const requirements=committee.skills.toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 return users.filter(u=>u.active&&u.role!=='VIEWER').map(u=>{
 const history=allocations.filter(a=>a.user_id===u.id);
 const active=history.filter(a=>a.status==='ACTIVE'&&a.end_date>=today&&(!a.start_date||a.start_date<=today));
 const terms=history.filter(a=>a.committee_id===committee.id&&['ACTIVE','ENDED'].includes(a.status)).length;
 const reasons=[];const declaration=latestDeclaration(declarations||[],u.id,committee.id);
 if(declarations!==null&&policy.requireDeclaration&&!declarationClear(declaration,today))reasons.push(declaration?'Declaration awaiting clearance or expired':'Declaration required');
 if(active.length>=policy.maxWorkload)reasons.push('Maximum committee workload reached');
 const composition=allocations.filter(a=>a.committee_id===committee.id&&a.status==='ACTIVE'&&a.end_date>=today&&(!a.start_date||a.start_date<=today)).map(a=>users.find(v=>v.id===a.user_id)).filter(Boolean);
 if(policy.maxPerDepartment&&!u.department?.trim())reasons.push('Department required by composition policy');
 if(policy.maxPerDepartment&&composition.filter(v=>v.department.trim().toLowerCase()===u.department.trim().toLowerCase()).length>=policy.maxPerDepartment)reasons.push('Department representation limit reached');
 const women=composition.filter(v=>v.gender==='Female').length,remaining=committee.seats-composition.length;
 if(policy.minimumWomen>women&&remaining<=policy.minimumWomen-women&&u.gender!=='Female')reasons.push('Remaining seats reserved by approved composition policy');
 if(!u.available)reasons.push('Member unavailable');
 if(conflicts.some(c=>c.user_id===u.id&&c.committee_id===committee.id&&c.active))reasons.push('Active conflict declaration');
 if(history.some(a=>a.committee_id===committee.id&&(['PENDING','REVIEWED'].includes(a.status)||a.status==='ACTIVE'&&a.end_date>=today&&(!a.start_date||a.start_date<=today))))reasons.push('Already assigned or awaiting approval');
 if(terms>=committee.max_terms)reasons.push('Maximum terms reached');
 const ownSkills=u.skills.toLowerCase().split(',').map(x=>x.trim());
 const expertise=requirements.length?Math.round(policy.skillWeight*requirements.filter(x=>ownSkills.includes(x)).length/requirements.length):Math.round(policy.skillWeight/2);
 const workload=Math.round(policy.workloadWeight*Math.max(0,1-active.length/policy.maxWorkload));
 const availability=u.available?policy.availabilityWeight:0;
 return {user_id:u.id,name:u.name,department:u.department,gender:u.gender,skills:u.skills,eligible:!reasons.length,reasons,workload:active.length,score:expertise+workload+availability,breakdown:{expertise,workload,availability},policy,policy_version:committee.policy_version||1,declaration_id:declaration?.id||null};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.score-a.score||a.name.localeCompare(b.name));
}
export function tenureAlerts(a,today=new Date()){
 const days=Math.ceil((new Date(a.end_date+'T00:00:00Z')-today)/86400000);
 return days<0?'Expired':days<=30?'Within 30 days':days<=60?'Within 60 days':days<=90?'Within 90 days':null;
}
