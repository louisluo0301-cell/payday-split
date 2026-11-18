import fs from 'node:fs';
import {ContractFactory,JsonRpcProvider,formatEther,parseEther} from 'ethers';
const token=process.argv[2];if(!token)throw new Error('Provide the deployed Sepolia token address.');
const owner='0x90D2A64b86cB547d729ce61101FcD835d512e55a';
const a=JSON.parse(fs.readFileSync(new URL('../public/camp-artifacts.json',import.meta.url),'utf8')).contracts.monitor;
const rpc=new JsonRpcProvider('https://lasna-rpc.rnk.dev/',5318007,{staticNetwork:true});
try{
  const deploy=await new ContractFactory(a.abi,a.bytecode).getDeployTransaction(token,500000n,1n,{value:parseEther('0.1')});
  const gasPrice=BigInt(await rpc.send('eth_gasPrice',[]));
  const [gas,balance,nonce,pendingNonce]=await Promise.all([rpc.estimateGas({...deploy,from:owner,type:0,gasPrice}),rpc.getBalance(owner),rpc.getTransactionCount(owner,'latest'),rpc.getTransactionCount(owner,'pending')]);
  console.log(JSON.stringify({status:'simulation-passed',gas:String(gas),gasPrice:String(gasPrice),maxCost:formatEther(gas*gasPrice*12n/10n+parseEther('0.1')),balance:formatEther(balance),nonce,pendingNonce},null,2));
}catch(error){console.log(JSON.stringify({code:error.code,message:error.message,info:error.info},null,2));process.exitCode=1;}
finally{await rpc.destroy();}
