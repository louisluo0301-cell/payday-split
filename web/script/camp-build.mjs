import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
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
