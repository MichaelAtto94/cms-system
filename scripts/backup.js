import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {query,init,close,tables,dataDir} from '../server/db.js';
await init();
const dest=path.resolve('backups',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dest,{recursive:true,mode:0o700});
// Stop the application first: a coherent database/file snapshot requires no concurrent writes.
const data={};for(const table of tables)data[table]=(await query('SELECT * FROM '+table)).rows;
fs.writeFileSync(path.join(dest,'database.json'),JSON.stringify(data,null,2),{mode:0o600});
if(fs.existsSync(path.join(dataDir,'documents')))fs.cpSync(path.join(dataDir,'documents'),path.join(dest,'documents'),{recursive:true});
await close();console.log('Backup created at '+dest+' (contains private data and password hashes).');
