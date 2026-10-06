import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PGlite} from '@electric-sql/pglite';
test('Audit logs reject updates/deletes and failed transactions leave no partial records',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cms-db-'));process.env.DATA_DIR=dir;process.env.DATABASE_URL='';
 const legacy=new PGlite(path.join(dir,'postgres'));await legacy.exec(fs.readFileSync('server/schema.sql','utf8').split('-- Governance release:')[0]);await legacy.query("INSERT INTO institutions VALUES('legacy','Legacy institution','{}')");await legacy.query("INSERT INTO committees(id,tenant,name,type,tor,seats,term_months) VALUES('legacy-c','legacy','Existing committee','Academic','Existing terms',5,12)");await legacy.close();
 const {query,transaction,init,close}=await import('../server/db.js');
 try{await init();await init();assert.equal((await query("SELECT * FROM committees WHERE id='legacy-c'")).rows[0].policy_version,1);assert.equal((await query("SELECT * FROM committees WHERE id='legacy-c'")).rows[0].name,'Existing committee');await query("INSERT INTO institutions VALUES('t','Test','{}')");await query("INSERT INTO audit(id,tenant,user_id,action,entity,details,ip) VALUES('a','t','u','TEST','e','{}','local')");
 await assert.rejects(query("UPDATE audit SET action='CHANGED' WHERE id='a'"),/append-only/);
 await assert.rejects(query("DELETE FROM audit WHERE id='a'"),/append-only/);
 await assert.rejects(query('TRUNCATE audit'),/append-only/);
 await assert.rejects(transaction(async q=>{await q("INSERT INTO institutions VALUES('rollback','Rollback','{}')");throw Error('cancel')}),/cancel/);
 assert.equal((await query("SELECT * FROM institutions WHERE id='rollback'")).rows.length,0);
 }finally{await close();fs.rmSync(dir,{recursive:true,force:true})}
});
