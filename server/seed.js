import bcrypt from 'bcryptjs';
import {query} from './db.js';
export async function seed(){
 if((await query('SELECT id FROM institutions LIMIT 1')).rows.length)return;
 if(!process.env.ADMIN_PASSWORD||process.env.ADMIN_PASSWORD.length<12)throw Error('Run npm run setup first; ADMIN_PASSWORD must have at least 12 characters');
 await query('INSERT INTO institutions VALUES ($1,$2,$3)', ['nipa','Your institution',{primary:'#167568',font:'Arial',fontSize:15,density:'Comfortable',logo:'',aiEnabled:false,reportFooter:'Committee governance • Institutional record'}]);
 await query('INSERT INTO users(id,tenant,name,email,password,role,department,skills) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',['admin','nipa','Mwale Michael',process.env.ADMIN_EMAIL||'admin@cms.local',await bcrypt.hash(process.env.ADMIN_PASSWORD,12),'ADMIN','Administration','governance,technology']);
}
