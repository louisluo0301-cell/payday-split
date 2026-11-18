// Read-only verification of the real Sepolia -> Lasna deployment task. Never submits transactions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Contract,Interface,JsonRpcProvider,getAddress,toBeHex,zeroPadValue} from 'ethers';

const [address,monitorDeployTx,tokenDeployTx,fundingTx]=process.argv.slice(2);
if(!address)throw new Error('Usage: node web/script/camp-verify.mjs MONITOR [MONITOR_DEPLOY_TX] [TOKEN_DEPLOY_TX] [FUNDING_TX]');
const monitorAddress=getAddress(address);
const expected=getAddress('0x90d2a64b86cb547d729ce61101fcd835d512e55a');
const system='0x8888888888888888888888888888888888888888';
const lasna=new JsonRpcProvider('https://lasna-rpc.rnk.dev/',5318007,{staticNetwork:true});
const sepolia=new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com',11155111,{staticNetwork:true});
const artifacts=JSON.parse(fs.readFileSync(new URL('../public/camp-artifacts.json',import.meta.url),'utf8'));
assert.equal(BigInt(await lasna.send('eth_chainId',[])),5318007n);
assert.equal(BigInt(await sepolia.send('eth_chainId',[])),11155111n);
assert.notEqual(await lasna.getCode(monitorAddress),'0x');
const monitor=new Contract(monitorAddress,artifacts.contracts.monitor.abi,lasna);
const [owner,token,threshold,count,remaining,subscribed,originHash,originIndex,originBlock,reactBlock,volume]=await Promise.all([
  monitor.OWNER(),monitor.TOKEN(),monitor.THRESHOLD(),monitor.count(),monitor.remaining(),monitor.subscribed(),
  monitor.lastOriginTxHash(),monitor.lastOriginLogIndex(),monitor.lastOriginBlock(),monitor.lastReactBlock(),monitor.totalVolume()
]);
assert.equal(owner,expected);assert.equal(threshold,500000n);
if(count===0n){
  console.log(JSON.stringify({status:'waiting-for-react',monitor:monitorAddress,token,count:String(count),remaining:String(remaining),subscribed},null,2));
  process.exitCode=2;
} else {
  assert.equal(count,1n);assert.equal(remaining,0n);assert.equal(subscribed,false);assert.equal(volume,1000000n);
  const originTx=zeroPadValue(toBeHex(originHash),32);
  const originReceipt=await sepolia.getTransactionReceipt(originTx);
  assert.ok(originReceipt);assert.equal(originReceipt.status,1);assert.equal(originReceipt.blockNumber,Number(originBlock));
  const tokenInterface=new Interface(artifacts.contracts.token.abi);
  const sourceLog=originReceipt.logs.find(log=>log.address.toLowerCase()===token.toLowerCase()&&log.index===Number(originIndex));
  assert.ok(sourceLog,'Origin Transfer is present at the recorded log index');
  const transfer=tokenInterface.parseLog(sourceLog);
  assert.equal(transfer.name,'Transfer');assert.equal(transfer.args.from,expected);assert.equal(transfer.args.to,expected);assert.equal(transfer.args.value,1000000n);
  const events=await monitor.queryFilter(monitor.filters.TransferObserved(),Number(reactBlock),Number(reactBlock));
  const observed=events.find(event=>event.args.originTxHash===originHash&&event.args.originLogIndex===originIndex);
  assert.ok(observed,'Real Lasna observation event exists');
  const reactReceipt=await lasna.getTransactionReceipt(observed.transactionHash);
  assert.equal(reactReceipt.status,1);
  assert.equal(observed.args.token,token);assert.equal(observed.args.amount,1000000n);
  const stopped=await monitor.queryFilter(monitor.filters.SubscriptionStopped(),Number(reactBlock),Number(reactBlock));
  assert.ok(stopped.some(event=>event.transactionHash===observed.transactionHash),'Automatic unsubscribe is in the same real transaction');
  const feeContract=new Contract(system,['function debt(address) view returns(uint256)','function reserves(address) view returns(uint256)'],lasna);
  const [balance,debt,reserves]=await Promise.all([lasna.getBalance(monitorAddress),feeContract.debt(monitorAddress),feeContract.reserves(monitorAddress)]);
  assert.equal(debt,0n);
  const deployments={};
  for(const [name,hash,reader,target] of [['monitor',monitorDeployTx,lasna,monitorAddress],['token',tokenDeployTx,sepolia,token]]){
    if(!hash)continue;
    const [receipt,tx]=await Promise.all([reader.getTransactionReceipt(hash),reader.getTransaction(hash)]);
    assert.ok(receipt&&tx);assert.equal(receipt.status,1);assert.equal(receipt.contractAddress,target);assert.equal(tx.from,expected);
    if(name==='monitor')assert.equal(tx.value,100000000000000000n);
    deployments[name]={address:target,tx:hash,block:receipt.blockNumber,value:String(tx.value)};
  }
  const evidence={status:'verified-real-testnet',verifiedAt:new Date().toISOString(),wallet:expected,
    networks:{origin:{name:'Ethereum Sepolia',chainId:11155111},reactive:{name:'Lasna',chainId:5318007}},
    monitor:monitorAddress,token,threshold:String(threshold),count:String(count),remaining:String(remaining),subscribed,totalVolume:String(volume),
    origin:{tx:originTx,logIndex:String(originIndex),block:Number(originBlock),amount:String(transfer.args.value)},
    react:{tx:observed.transactionHash,block:Number(reactBlock),status:reactReceipt.status},
    fees:{balance:String(balance),debt:String(debt),reserves:String(reserves)},deployments,
    ...(fundingTx?{fundingTx}:{}),
    links:{contract:`https://lasna.reactscan.net/address/${monitorAddress}`,react:`https://lasna.reactscan.net/tx/${observed.transactionHash}`,origin:`https://sepolia.etherscan.io/tx/${originTx}`}
  };
  fs.writeFileSync(new URL('../../deployments/camp-transfer-monitor.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
}
await Promise.all([lasna.destroy(),sepolia.destroy()]);
