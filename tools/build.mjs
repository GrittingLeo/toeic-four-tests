import {cp,mkdir,readFile,readdir} from 'node:fs/promises';
const allowed=['index.html','application.js','engine.js','vocabulary.js','styles.css','data','images','media'];
await mkdir('dist/client',{recursive:true});
for(const name of allowed)await cp(`web/${name}`,`dist/client/${name}`,{recursive:true});
const config=JSON.parse(await readFile('.openai/hosting.json','utf8'));
if(config.static?.directory!=='dist/client'||config.d1||config.r2)throw new Error('Expected public static site configuration');
const unexpected=(await readdir('dist/client')).filter(n=>!allowed.includes(n));
if(unexpected.length)throw Error(`Unexpected deployment files: ${unexpected.join(', ')}`);
console.log('Built static practice site; no user records, credentials or original PDF included.');
