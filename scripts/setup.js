import fs from 'node:fs';
import crypto from 'node:crypto';
if(!fs.existsSync('.env')){
 const password=crypto.randomBytes(12).toString('base64url');
 let env=fs.readFileSync('.env.example','utf8').replace('replace-with-random-secret-at-least-32-characters',crypto.randomBytes(48).toString('hex')).replace('ADMIN_PASSWORD=','ADMIN_PASSWORD='+password);
 env+='\nPOSTGRES_PASSWORD='+crypto.randomBytes(24).toString('hex')+'\n';
 fs.writeFileSync('.env',env,{mode:0o600});console.log('Created .env. First administrator: admin@cms.local\nPassword: '+password+'\nKeep this password private; change it after login.');
}else console.log('Existing .env preserved.');
