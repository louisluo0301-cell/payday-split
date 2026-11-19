import {Contract,FetchRequest,JsonRpcProvider,isAddress} from 'ethers';
import { OBSERVER_ABI, REACTIVE_ABI, SPLIT_ABI, TOKEN_ABI } from './contract-abi.generated.js';

const SYSTEM='0x8888888888888888888888888888888888888888';
const ABI={
  fees:['function debt(address) view returns(uint256)','function reserves(address) view returns(uint256)'],
  split:SPLIT_ABI,
  reactive:REACTIVE_ABI,
  token:TOKEN_ABI,
  observer:OBSERVER_ABI,
};
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();

export function createHealthReader(url,chainId){
  const request=new FetchRequest(url);request.timeout=8000;
  const provider=new JsonRpcProvider(request,Number(chainId),{staticNetwork:true,batchMaxCount:1,cacheTimeout:0});
  return {
    // Explicitly read the RPC's actual chain; staticNetwork is never treated as chain verification.
    chain:async()=>BigInt(await provider.send('eth_chainId',[])),
    code:address=>provider.getCode(address),balance:address=>provider.getBalance(address),
    timestamp:async()=>Number((await provider.getBlock('latest')).timestamp),
    call:(address,abi,method,args=[])=>new Contract(address,abi,provider)[method](...args),
    close:()=>provider.destroy(),
  };
}

export function assessAutomationHealth(snapshot){
  const s=snapshot,alerts=[];
  const add=(id,severity,title,action)=>alerts.push({id,severity,title,action});
  if(!s.configured)return {status:'unconfigured',complete:false,scope:'configuration',alerts:[{id:'configuration',severity:'info',title:'Live deployment is not configured',action:'Use demo mode, or configure verified deployed contract addresses.'}]};
  for(const error of s.errors||[])add(`read-${error.key}`,'warning',`Could not verify ${error.label}`,'Refresh the check. Until it succeeds, the automation state is unknown.');
  for(const [key,value] of Object.entries(s.codes||{}))if(value===false)add(`code-${key}`,'blocked',`Contract code is missing: ${key}`,'Check the network and deployment address before enabling income routing.');
  for(const error of s.chainErrors||[])add(`chain-${error.network}`,'blocked',`${error.network} network does not match the deployment`,'Use the configured testnet RPC. Do not send transactions until the network matches.');
  const observer=s.mode==='observer';
  const completed=observer&&s.count>0n&&s.remaining===0n&&s.subscribed===false;
  const fees=(prefix,balance,reserves,debt,floor)=>{
    if(debt>0n)add(`${prefix}-debt`,'blocked',`${prefix==='reactive'?'Reactive':'Callback'} fees are overdue`,'Fund the fee account and settle outstanding debt. Adding balance alone may not restart execution.');
    if(balance!==undefined&&reserves!==undefined&&!completed){
      const credit=balance+reserves;
      if(credit===0n)add(`${prefix}-fuel`,'blocked',`${prefix==='reactive'?'Reactive':'Callback'} fee funding is empty`,'Top up the contract or its service-provider reserves before the next income.');
      else if(credit<floor)add(`${prefix}-fuel`,'warning',`${prefix==='reactive'?'Reactive':'Callback'} fee buffer is low`,'Replenish the configured fee buffer. This warning threshold is not a gas-price quote or execution guarantee.');
    }
  };
  fees('reactive',s.reactiveBalance,s.reactiveReserves,s.reactiveDebt,s.reactiveFeeFloor??50000000000000000n);
  if(observer){
    if(s.observerOwner!==undefined&&!same(s.observerOwner,s.expectedOwner))add('observer-owner','blocked','Observer owner differs from the recorded wallet','Verify the deployment provenance.');
    if(s.observerToken!==undefined&&!same(s.observerToken,s.token))add('observer-token','blocked','Observer watches a different token','Verify the source token address before generating proof.');
    if(completed)add('observer-completed','info','Observation completed and subscription stopped','The one-observation task is complete. No further event processing is expected.');
    else if(s.remaining===0n||s.subscribed===false)add('observer-stopped','warning','Observer stopped before recording a transfer','Review the subscription and observation evidence; do not claim completion from a stopped subscription alone.');
  } else {
    fees('destination',s.destinationBalance,s.destinationReserves,s.destinationDebt,s.destinationFeeFloor??20000000000000000n);
    if(s.boundReactive!==undefined&&!same(s.boundReactive,s.reactiveAddress))add('binding','blocked','Reactive contract binding does not match','Stop this deployment and verify the bound contract; the binding is immutable.');
    if(s.reactiveService!==undefined&&!same(s.reactiveService,SYSTEM))add('reactive-service','blocked','Reactive fee provider does not match the system','Verify the deployed contract and configured network.');
    if(s.destinationService!==undefined&&!same(s.destinationService,s.proxy))add('destination-service','blocked','Callback fee provider does not match the proxy','Verify the callback proxy and contract configuration.');
    if(s.reactivePaused||s.destinationPaused)add('platform-paused','blocked','Platform execution is paused','The contract owner must review and restore execution.');
    if(s.remaining===0n)add('platform-budget','blocked','Platform callback count is exhausted','The Reactive contract owner must replenish its application callback budget.');
    if(s.account){
      if(s.activeBuckets===0)add('plan-inactive','info','Your saved plan has no active destinations','Activate and save a destination when you want routing to resume.');
      if(s.activeBuckets>0){
        if(s.allowance===0n)add('allowance','blocked','Token allowance is zero','Approve a bounded amount for the verified split contract to resume routing.');
        if(s.userBudget===0n)add('user-budget','blocked','Your callback count is exhausted','Ask the Reactive contract owner to re-arm your callback budget.');
        if(s.subscribed===false||s.mirroredVersion===0n||s.mirroredVersion!==s.ruleVersion)add('mirror','warning','Your saved rule is not fully mirrored yet','Wait for the Reactive subscription and rule version to catch up before sending another income.');
        if(s.policy?.paused)add('plan-paused','blocked','Your spending plan is paused','Review the saved controls and resume when appropriate.');
        if(s.cycle?.duration>0n&&s.cycle.anchor>BigInt(s.timestamp))add('cycle-pending','warning','Your payday cycle has not started','Wait until the saved UTC anchor. Income received before it will remain in your wallet.');
        if(s.policy?.validUntil>0n&&s.policy.validUntil<=BigInt(s.timestamp))add('expired','blocked','Your spending plan has expired','Review and extend its expiry before the next income.');
        if(s.policy?.dailyLimit>0n&&s.dailySpend?.day===BigInt(Math.floor(s.timestamp/86400))&&s.dailySpend.amount>=s.policy.dailyLimit)add('daily-limit','warning','Today’s spending limit is reached','Wait until the next UTC day or review the saved limit.');
        if(s.tokenBalance!==undefined&&s.tokenBalance<=BigInt(s.policy?.reserve||0))add('reserve','warning','Current balance has no spendable amount above your reserve','A future income can restore spendable funds; the saved reserve remains protected.');
      }
    }
  }
  const complete=!(s.errors?.length||s.chainErrors?.length);
  const status=alerts.some(a=>a.severity==='blocked')?'blocked':!complete?'unavailable':alerts.some(a=>a.severity==='warning')?'attention':completed?'completed':s.account&&s.activeBuckets===0?'inactive':'ready';
  return {status,complete,scope:observer?'observer':s.account?'saved-plan':'platform-only',alerts};
}

export async function collectAutomationHealth(config,{account=null,makeReader=createHealthReader,now=Date.now}={}){
  const mode=config.mode==='observer'?'observer':'payday';
  const needed=mode==='observer'?['token','reactive']:['token','split','reactive','proxy'];
  const s={mode,account,token:config.token,reactiveAddress:config.reactive,proxy:config.proxy,expectedOwner:config.expectedOwner,checkedAt:new Date(now()).toISOString(),timestamp:Math.floor(now()/1000),errors:[],chainErrors:[],codes:{}};
  s.configured=needed.every(key=>isAddress(config[key]||''))&&!!config.rpcUrl&&!!config.lasnaRpc&&Number.isSafeInteger(Number(config.chainId))&&Number(config.chainId)>0;
  if(!s.configured)return {...assessAutomationHealth(s),snapshot:s};
  if(account&&!isAddress(account))throw new Error('Invalid wallet address for health check.');
  const destId=BigInt(config.chainId),reactiveId=BigInt(config.reactiveChainId||(destId===31337n?31337:5318007));
  const destination=makeReader(config.rpcUrl,destId),reactive=makeReader(config.lasnaRpc,reactiveId);
  const read=async(key,label,operation)=>{
    try{s[key]=await operation();}catch{s.errors.push({key,label});}
  };
  try{
    await Promise.all([read('destinationChain','destination RPC network',()=>destination.chain()),read('reactiveChain','Reactive RPC network',()=>reactive.chain())]);
    if(s.destinationChain!==undefined&&s.destinationChain!==destId)s.chainErrors.push({network:'Destination'});
    if(s.reactiveChain!==undefined&&s.reactiveChain!==reactiveId)s.chainErrors.push({network:'Reactive'});
    if(s.errors.length||s.chainErrors.length)return {...assessAutomationHealth(s),snapshot:s};
    const codeChecks=[['token',destination,config.token],['reactive',reactive,config.reactive],['system',reactive,SYSTEM],...(mode==='payday'?[['split',destination,config.split],['proxy',destination,config.proxy]]:[])];
    await Promise.all(codeChecks.map(([key,reader,address])=>read(`code_${key}`,`${key} deployment`,async()=>{s.codes[key]=(await reader.code(address))!=='0x';})));
    if(s.errors.length||Object.values(s.codes).some(value=>!value))return {...assessAutomationHealth(s),snapshot:s};
    const jobs=[
      ['reactiveBalance','Reactive fee balance',()=>reactive.balance(config.reactive)],
      ['reactiveDebt','Reactive fee debt',()=>reactive.call(SYSTEM,ABI.fees,'debt',[config.reactive])],
      ['reactiveReserves','Reactive fee reserves',()=>reactive.call(SYSTEM,ABI.fees,'reserves',[config.reactive])],
      ['remaining','remaining callback count',()=>reactive.call(config.reactive,mode==='observer'?ABI.observer:ABI.reactive,'remaining')],
    ];
    if(mode==='observer')jobs.push(
      ['count','observation count',()=>reactive.call(config.reactive,ABI.observer,'count')],
      ['subscribed','observer subscription',()=>reactive.call(config.reactive,ABI.observer,'subscribed')],
      ['observerOwner','observer owner',()=>reactive.call(config.reactive,ABI.observer,'OWNER')],
      ['observerToken','observer source token',()=>reactive.call(config.reactive,ABI.observer,'TOKEN')],
    );
    else jobs.push(
      ['destinationBalance','callback fee balance',()=>destination.balance(config.split)],
      ['destinationDebt','callback fee debt',()=>destination.call(config.proxy,ABI.fees,'debt',[config.split])],
      ['destinationReserves','callback fee reserves',()=>destination.call(config.proxy,ABI.fees,'reserves',[config.split])],
      ['destinationPaused','destination pause state',()=>destination.call(config.split,ABI.split,'paused')],
      ['reactivePaused','Reactive pause state',()=>reactive.call(config.reactive,ABI.reactive,'paused')],
      ['boundReactive','Reactive binding',()=>destination.call(config.split,ABI.split,'reactive')],
      ['destinationService','callback fee provider',()=>destination.call(config.split,ABI.split,'_SERVICE_PROVIDER')],
      ['reactiveService','Reactive fee provider',()=>reactive.call(config.reactive,ABI.reactive,'_SERVICE_PROVIDER')],
    );
    if(account&&mode==='payday')jobs.push(
      ['timestamp','destination block time',()=>destination.timestamp()],
      ['allowance','token allowance',()=>destination.call(config.token,ABI.token,'allowance',[account,config.split])],
      ['tokenBalance','wallet token balance',()=>destination.call(config.token,ABI.token,'balanceOf',[account])],
      ['ruleVersion','saved rule version',()=>destination.call(config.split,ABI.split,'ruleVersion',[account,config.token])],
      ['activeBuckets','active saved destinations',async()=>{const buckets=await destination.call(config.split,ABI.split,'getBuckets',[account,config.token]);return buckets.filter(bucket=>bucket.active).length;}],
      ['policy','saved spending controls',()=>destination.call(config.split,ABI.split,'policies',[account,config.token])],
      ['dailySpend','today’s spending',()=>destination.call(config.split,ABI.split,'dailySpend',[account,config.token])],
      ['cycle','saved payday cycle',()=>destination.call(config.split,ABI.split,'cycleConfigs',[account,config.token])],
      ['userBudget','user callback budget',()=>reactive.call(config.reactive,ABI.reactive,'userRemaining',[account,config.token])],
      ['mirroredRule','mirrored rule',()=>reactive.call(config.reactive,ABI.reactive,'getRule',[account,config.token])],
    );
    await Promise.all(jobs.map(job=>read(...job)));
    if(s.mirroredRule){s.mirroredVersion=s.mirroredRule.version??s.mirroredRule[4];s.subscribed=s.mirroredRule.subscribed??s.mirroredRule[5];}
    if(s.policy){const p=s.policy;s.policy={reserve:p.reserve??p[0],maxPerRun:p.maxPerRun??p[1],dailyLimit:p.dailyLimit??p[2],minIncome:p.minIncome??p[3],validUntil:p.validUntil??p[4],paused:p.paused??p[5]};}
    if(s.dailySpend){const d=s.dailySpend;s.dailySpend={day:d.day??d[0],amount:d.amount??d[1]};}
    if(s.cycle){const c=s.cycle;s.cycle={anchor:c.anchor??c[0],duration:c.duration??c[1],revision:c.revision??c[2]};}
    delete s.mirroredRule;
    for(const [key,value] of Object.entries(config.feeWarningWei||{})){
      if(!/^\d+$/.test(String(value)))throw new Error('Invalid fee warning threshold.');
      if(key==='destination')s.destinationFeeFloor=BigInt(value);
      if(key==='reactive')s.reactiveFeeFloor=BigInt(value);
    }
    return {...assessAutomationHealth(s),snapshot:s};
  }finally{await Promise.allSettled([destination.close(),reactive.close()]);}
}

export function serializeHealthReport(report){return JSON.stringify(report,(_,value)=>typeof value==='bigint'?String(value):value,2);}

export function demoHealthReport({allowance,policy={},activeBuckets,timestamp=Math.floor(Date.now()/1000)}){
  const alerts=[];
  if(policy.paused)alerts.push({id:'demo-paused',severity:'blocked',title:'Sample spending plan is paused',action:'Resume the demo controls to route the next sample income.'});
  if(allowance===0n)alerts.push({id:'demo-allowance',severity:'blocked',title:'Sample allowance is zero',action:'Set a demo approval amount to continue the simulation.'});
  if(policy.validUntil>0n&&policy.validUntil<=BigInt(timestamp))alerts.push({id:'demo-expired',severity:'blocked',title:'Sample spending plan has expired',action:'Update the demo expiry.'});
  if(activeBuckets===0)alerts.push({id:'demo-inactive',severity:'info',title:'Sample plan has no active destinations',action:'Activate a destination to preview routing.'});
  return {status:'demo',complete:true,scope:'simulation-only',alerts,snapshot:{checkedAt:new Date(timestamp*1000).toISOString(),mode:'demo'}};
}
