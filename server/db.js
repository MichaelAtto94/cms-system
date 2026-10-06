import 'dotenv/config';
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
export const dataDir=path.resolve(process.env.DATA_DIR||'data');
fs.mkdirSync(dataDir,{recursive:true});
const embedded=process.env.DATABASE_URL?null:new PGlite(path.join(dataDir,'postgres'));
const pool=embedded?null:new pg.Pool({connectionString:process.env.DATABASE_URL});
function normalise(result){for(const row of result.rows||[])for(const field of result.fields||[]){const value=row[field.name];if(value instanceof Date)row[field.name]=field.dataTypeID===1082?value.toISOString().slice(0,10):value.toISOString()}return result}
export async function query(sql,args=[]){return normalise(await (embedded?embedded.query(sql,args):pool.query(sql,args)))}
export async function transaction(fn){
 if(embedded)return embedded.transaction(tx=>fn(async(s,a=[])=>normalise(await tx.query(s,a))));
 const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(async(s,a=[])=>normalise(await c.query(s,a)));await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
}
export async function close(){if(embedded)await embedded.close();else await pool.end()}
export const tables=['institutions','users','committees','conflicts','allocations','meetings','attendance','actions','votes','ballots','documents','notifications','outbox','audit','policy_history','declaration_requests','declarations','recusals','checklist_items','access_groups','access_group_members','template_records','report_schedules','report_deliveries','password_resets'];
export async function init(){
 const sql=fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
 if(embedded)await embedded.exec(sql);else await pool.query(sql);
}
