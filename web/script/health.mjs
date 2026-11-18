import {readFile} from 'node:fs/promises';
import {collectAutomationHealth,serializeHealthReport} from '../src/automation-health.js';
const local = process.argv.includes('--local');
const file = new URL(local ? '../public/deployments.local.json' : '../public/deployments.json', import.meta.url);
const camp=process.argv.includes('--camp');
const userIndex=process.argv.indexOf('--user');
try {
  if(local&&camp)throw new Error('Choose either --local or --camp.');
  if(userIndex>=0&&!/^0x[0-9a-fA-F]{40}$/.test(process.argv[userIndex+1]||''))throw new Error('Provide a wallet address after --user.');
  let config;
  if(camp){
    const evidence=JSON.parse(await readFile(new URL('../../deployments/camp-transfer-monitor.json',import.meta.url),'utf8'));
    config={mode:'observer',chainId:11155111,reactiveChainId:5318007,rpcUrl:'https://ethereum-sepolia-rpc.publicnode.com',lasnaRpc:'https://lasna-rpc.rnk.dev/',token:evidence.token,reactive:evidence.monitor,expectedOwner:evidence.wallet};
  }else config={lasnaRpc:'https://lasna-rpc.rnk.dev/',...JSON.parse(await readFile(file,'utf8')),reactiveChainId:local?31337:5318007};
  const report=await collectAutomationHealth(config,{account:userIndex>=0?process.argv[userIndex+1]:null});
  console.log(serializeHealthReport(report));
  process.exitCode=['ready','completed','inactive'].includes(report.status)?0:['unconfigured','unavailable'].includes(report.status)?2:1;
}catch{console.log(JSON.stringify({status:'unavailable',error:'Check the deployment JSON, addresses, CLI options and RPC availability.'},null,2));process.exitCode=2;}
