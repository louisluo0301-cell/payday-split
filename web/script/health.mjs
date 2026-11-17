import {readFile} from 'node:fs/promises';
import {Contract, JsonRpcProvider, formatEther} from 'ethers';
const local = process.argv.includes('--local');
const file = new URL(local ? '../public/deployments.local.json' : '../public/deployments.json', import.meta.url);
const config = JSON.parse(await readFile(file,'utf8'));
const report = {checkedAt:new Date().toISOString(),environment:local?'local Anvil':'testnet',checks:{},warnings:[]};
const dest = new JsonRpcProvider(config.rpcUrl);
const lasna = new JsonRpcProvider(config.lasnaRpc);
try {
  for(const key of ['token','split','reactive']) if(!config[key]) throw new Error(`Missing ${key} deployment address`);
  const [dn,rn] = await Promise.all([dest.getNetwork(),lasna.getNetwork()]);
  if(Number(dn.chainId)!==Number(config.chainId)) throw new Error('Destination chain mismatch');
  if(Number(rn.chainId)!==(local?31337:5318007)) throw new Error('Reactive chain mismatch');
  const split = new Contract(config.split,['function paused() view returns(bool)','function reactive() view returns(address)'],dest);
  const reactive = new Contract(config.reactive,['function paused() view returns(bool)','function remaining() view returns(uint256)'],lasna);
  const system = new Contract('0x8888888888888888888888888888888888888888',['function debt(address) view returns(uint256)'],lasna);
  const proxy = new Contract(config.proxy,['function debt(address) view returns(uint256)'],dest);
  const callbackDebt = await proxy.debt(config.split);
  if(callbackDebt>0n) report.warnings.push('Destination callback debt > 0: settle proxy debt.');
  const [splitCode,reactiveCode,splitBalance,reactiveBalance,debt,remaining,splitPaused,reactivePaused,bound] = await Promise.all([
    dest.getCode(config.split),lasna.getCode(config.reactive),dest.getBalance(config.split),lasna.getBalance(config.reactive),
    system.debt(config.reactive),reactive.remaining(),split.paused(),reactive.paused(),split.reactive()
  ]);
  report.checks = {splitCode:splitCode!=='0x',reactiveCode:reactiveCode!=='0x',
    boundCorrectly:bound.toLowerCase()===config.reactive.toLowerCase(),splitBalance:formatEther(splitBalance),
    reactiveBalance:formatEther(reactiveBalance),debtWei:debt.toString(),callbackDebtWei:callbackDebt.toString(),callbackCountRemaining:remaining.toString(),splitPaused,reactivePaused};
  if(debt>0n) report.warnings.push('Reactive debt > 0: event delivery may be suspended; fund and settle debt.');
  if(splitBalance===0n || reactiveBalance===0n) report.warnings.push('Native fee balance is zero.');
  if(remaining===0n) report.warnings.push('Application callback count is exhausted.');
  if(splitPaused || reactivePaused) report.warnings.push('Execution is paused.');
  if(!report.checks.splitCode || !report.checks.reactiveCode || !report.checks.boundCorrectly) report.warnings.push('Deployment code or binding is invalid.');
  process.exitCode=report.warnings.length?1:0;
} catch(err) { report.error=err.shortMessage||err.message; process.exitCode=1; }
finally { dest.destroy(); lasna.destroy(); }
console.log(JSON.stringify(report,null,2));
