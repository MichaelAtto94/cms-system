import {init,close} from '../server/db.js';
try{await init();console.log('Governance schema ready. Existing institutional records preserved.')}catch(e){console.error('Schema upgrade failed: '+e.message);process.exitCode=1}finally{await close()}
