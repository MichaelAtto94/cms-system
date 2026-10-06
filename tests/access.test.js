import test from 'node:test';import assert from 'node:assert/strict';
import {hasPermission,defaultPermissions,routePermission} from '../server/access.js';
test('Group grants combine within each scope without leaking permissions across committees',()=>{
 const a={admin:false,grouped:true,groups:[{enabled:true,all_committees:false,committee_ids:['finance'],permissions:['committee.read','meetings.create']},{enabled:true,all_committees:false,committee_ids:['procurement'],permissions:['committee.read']}]};
 assert.equal(hasPermission(a,'meetings.create','finance'),true);assert.equal(hasPermission(a,'meetings.create','procurement'),false);assert.equal(hasPermission(a,'committee.read','procurement'),true);
});
test('Disabled groups grant nothing; an enabled institution-wide group covers future committees',()=>{
 const a={admin:false,grouped:true,groups:[{enabled:false,all_committees:true,committee_ids:[],permissions:['meetings.create']}]};assert.equal(hasPermission(a,'meetings.create','new'),false);a.groups[0].enabled=true;assert.equal(hasPermission(a,'meetings.create','new'),true);
});
test('Ungrouped roles preserve approval boundaries and administrator recovery access',()=>{
 assert.equal(defaultPermissions('SECRETARY').includes('nominations.approve'),false);assert.equal(defaultPermissions('MEMBER').includes('meetings.create'),false);assert.equal(hasPermission({admin:true},'minutes.approve','any'),true);
});
test('Decision routing separates proposal review, final approval and minutes approval',()=>{
 assert.equal(routePermission({path:'/allocations/1/decision',body:{decision:'REVIEW'}}),'nominations.review');assert.equal(routePermission({path:'/allocations/1/decision',body:{decision:'APPROVE'}}),'nominations.approve');assert.equal(routePermission({path:'/meetings/1',method:'PATCH',body:{status:'APPROVED'}}),'minutes.approve');assert.equal(routePermission({path:'/settings',method:'PATCH'}),null);
});
