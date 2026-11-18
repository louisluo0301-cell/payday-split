import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=new URL('../../',import.meta.url);
const files={token:'CampTestToken',monitor:'CampTransferMonitor'};
const result={compiler:'0.8.29',generatedAt:new Date().toISOString(),contracts:{}};
for(const [key,name] of Object.entries(files)) {
  const a=JSON.parse(fs.readFileSync(new URL(`out/${name}.sol/${name}.json`,root),'utf8'));
  if(!a.bytecode?.object?.startsWith('0x') || a.bytecode.object.length<10) throw new Error(`Missing bytecode: ${name}`);
  result.contracts[key]={name,abi:a.abi,bytecode:a.bytecode.object};
}
const target=new URL('../public/camp-artifacts.json',import.meta.url);
fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n');
console.log(`Prepared wallet deployment artifacts: ${fileURLToPath(target)}`);
// A standalone page avoids stale development-module handlers during wallet/network switches.
await build({entryPoints:[fileURLToPath(new URL('../src/camp-task.js',import.meta.url))],outfile:fileURLToPath(new URL('../public/camp-task-ready.js',import.meta.url)),bundle:true,format:'esm',platform:'browser',target:'esnext'});
const html=fs.readFileSync(new URL('../camp-task.html',import.meta.url),'utf8').replace(/\/src\/camp-task\.js[^"\s]*/, '/camp-task-ready.js');
fs.writeFileSync(new URL('../public/camp-task-ready.html',import.meta.url),html);
console.log('Standalone wallet page: /camp-task-ready.html');
