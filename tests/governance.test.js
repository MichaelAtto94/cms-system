import test from 'node:test';
import assert from 'node:assert/strict';
import {rankCandidates,tenureAlerts} from '../server/governance.js';
const c={id:'c',skills:'finance,governance',max_terms:2};
const u={id:'u',name:'Member',active:true,role:'MEMBER',available:true,skills:'finance,governance',gender:'Unspecified'};
test('Skills and workload scoring is explainable',()=>{const r=rankCandidates(c,[u],[],[])[0];assert.equal(r.score,100);assert.deepEqual(r.breakdown,{expertise:60,workload:30,availability:10})});
test('Conflicted candidates remain visible but cannot be appointed',()=>{const r=rankCandidates(c,[u],[],[{user_id:'u',committee_id:'c',active:true}])[0];assert.equal(r.eligible,false);assert.ok(r.reasons.includes('Active conflict declaration'))});
test('Unavailable and term-limited members are blocked',()=>{const history=Array.from({length:2},()=>({user_id:'u',committee_id:'c',status:'ENDED'}));assert.equal(rankCandidates(c,[{...u,available:false}],history,[])[0].eligible,false)});
test('Workload penalties prefer equally skilled underallocated members',()=>{const other={...u,id:'v',name:'Other'};const r=rankCandidates(c,[u,other],[{user_id:'u',committee_id:'x',status:'ACTIVE',end_date:'2099-01-01'}],[]);assert.equal(r[0].user_id,'v')});
test('Term warning windows include expired appointments',()=>{assert.equal(tenureAlerts({end_date:'2026-10-01'},new Date('2026-10-06')),'Expired');assert.equal(tenureAlerts({end_date:'2026-10-20'},new Date('2026-10-06')),'Within 30 days')});
test('Custom weights, workload ceilings and declaration clearance affect eligibility',()=>{
 const committee={...c,seats:3,policy_version:4,allocation_policy:{skillWeight:40,workloadWeight:50,availabilityWeight:10,maxWorkload:1,requireDeclaration:true}};
 let r=rankCandidates(committee,[u],[],[],'2026-10-06',[])[0];assert.equal(r.eligible,false);assert.ok(r.reasons.includes('Declaration required'));
 r=rankCandidates(committee,[u],[],[],'2026-10-06',[{id:'d',user_id:'u',committee_id:'c',status:'CLEARED',valid_until:'2027-01-01',created_at:'2026-10-01'}])[0];assert.equal(r.eligible,true);assert.equal(r.score,100);assert.equal(r.breakdown.expertise,40);assert.equal(r.policy_version,4);assert.equal(r.declaration_id,'d');
});
test('Composition rules reserve remaining seats and enforce department ceilings',()=>{
 const committee={...c,seats:2,allocation_policy:{requireDeclaration:false,minimumWomen:1,maxPerDepartment:1}};
 const other={...u,id:'v',gender:'Male',department:'Finance'};
 const current=[{user_id:'v',committee_id:'c',status:'ACTIVE',end_date:'2027-01-01'}];
 let r=rankCandidates(committee,[{...u,department:'Finance'},other],current,[],'2026-10-06',[])[0];assert.equal(r.eligible,false);
 r=rankCandidates(committee,[{...u,gender:'Female',department:'Technology'},other],current,[],'2026-10-06',[]).find(r=>r.user_id==='u');assert.equal(r.eligible,true);
});
test('An expired or newly submitted declaration cannot provide clearance',()=>{
 const committee={...c,seats:3};
 const declarations=[{id:'old',user_id:'u',committee_id:'c',status:'CLEARED',valid_until:'2027-01-01',created_at:'2026-01-01'},{id:'new',user_id:'u',committee_id:'c',status:'SUBMITTED',valid_until:'2027-01-01',created_at:'2026-10-01'}];
 assert.equal(rankCandidates(committee,[u],[],[],'2026-10-06',declarations)[0].eligible,false);
});
