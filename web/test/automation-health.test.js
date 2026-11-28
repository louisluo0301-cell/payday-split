import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessAutomationHealth,collectAutomationHealth,serializeHealthReport,demoHealthReport} from '../src/automation-health.js';
const address=n=>'0x'+n.toString(16).padStart(40,'0');
const SYSTEM='0x8888888888888888888888888888888888888888';
const config={chainId:11155111,reactiveChainId:5318007,rpcUrl:'destination',lasnaRpc:'reactive',token:address(1),split:address(2),reactive:address(3),proxy:address(4)};
const account=address(5);
function base(patch={}){return {configured:true,mode:'payday',timestamp:86400,errors:[],chainErrors:[],codes:{token:true,split:true,reactive:true},reactiveAddress:config.reactive,proxy:config.proxy,reactiveService:SYSTEM,destinationService:config.proxy,boundReactive:config.reactive,reactiveBalance:100000000000000000n,reactiveReserves:0n,reactiveDebt:0n,destinationBalance:100000000000000000n,destinationReserves:0n,destinationDebt:0n,remaining:5n,...patch};}
function fakeReaders(overrides={}){
  const calls=[],closed=[];
  const makeReader=url=>({
    chain:async()=>overrides.chain?.(url)??(url==='destination'?11155111n:5318007n),
    code:async addr=>overrides.code?.(url,addr)??'0x6000',
    balance:async()=>100000000000000000n,timestamp:async()=>86400,
    call:async(addr,abi,method,args)=>{
      calls.push({url,addr,method,args});
      if(overrides.fail===method)throw new Error('private endpoint details must not be copied');
      if(overrides.values&&method in overrides.values)return overrides.values[method];
      return {debt:0n,reserves:0n,remaining:5n,paused:false,reactive:config.reactive,_SERVICE_PROVIDER:url==='destination'?config.proxy:SYSTEM,
        allowance:1000n,balanceOf:1000n,ruleVersion:3n,getBuckets:[{active:true}],policies:{reserve:0n,maxPerRun:0n,dailyLimit:0n,minIncome:0n,validUntil:0n,paused:false},dailySpend:{day:1n,amount:0n},cycleConfigs:{anchor:0n,duration:0n,revision:0n},userRemaining:5n,getRule:[[],[],[],[true],3n,true],count:1n,subscribed:false,OWNER:account,TOKEN:config.token}[method];
    },close:()=>closed.push(url),
  });return {makeReader,calls,closed};
}
const ids=report=>report.alerts.map(alert=>alert.id);
test('debt blocks execution despite a funded balance and supplies settlement guidance',()=>{
  const report=assessAutomationHealth(base({reactiveDebt:1n,destinationDebt:2n}));
  assert.equal(report.status,'blocked');assert.ok(ids(report).includes('reactive-debt'));assert.ok(ids(report).includes('destination-debt'));
  assert.match(report.alerts[0].action,/settle/);
});
test('prepaid reserves count as fee credit even when the contract balance is zero',()=>{
  const report=assessAutomationHealth(base({reactiveBalance:0n,reactiveReserves:100000000000000000n,destinationBalance:0n,destinationReserves:100000000000000000n}));
  assert.equal(report.status,'ready');assert.equal(report.alerts.length,0);
});
test('empty fee credit and callback slots are independent failure conditions',()=>{
  const report=assessAutomationHealth(base({reactiveBalance:0n,remaining:0n}));
  assert.ok(ids(report).includes('reactive-fuel'));assert.ok(ids(report).includes('platform-budget'));
  assert.equal(report.status,'blocked');
});
test('unknown RPC data is never reported healthy or replaced with a false zero balance',async()=>{
  const fake=fakeReaders({fail:'debt'});const report=await collectAutomationHealth(config,{makeReader:fake.makeReader});
  assert.equal(report.complete,false);assert.equal(report.status,'unavailable');
  assert.ok(report.alerts.some(alert=>alert.id==='read-reactiveDebt'));
  assert.ok(!ids(report).includes('reactive-fuel'));assert.doesNotMatch(serializeHealthReport(report),/private endpoint/);
  assert.equal(fake.closed.length,2);
});
test('a wrong chain stops contract reads and still closes RPC readers',async()=>{
  const fake=fakeReaders({chain:()=>1n});const report=await collectAutomationHealth(config,{makeReader:fake.makeReader});
  assert.equal(report.status,'blocked');assert.equal(report.complete,false);assert.equal(fake.calls.length,0);assert.equal(fake.closed.length,2);
});
test('missing contract code stops later calls and reports the invalid deployment',async()=>{
  const fake=fakeReaders({code:()=> '0x'});const report=await collectAutomationHealth(config,{makeReader:fake.makeReader});
  assert.equal(report.status,'blocked');assert.ok(ids(report).includes('code-split'));assert.equal(fake.calls.length,0);
});
test('unconfigured deployment does not create a provider or invent a ready state',async()=>{
  const report=await collectAutomationHealth({...config,split:''},{makeReader:()=>{throw new Error('should not be called');}});
  assert.equal(report.status,'unconfigured');assert.equal(report.complete,false);
});
test('saved-plan checks cover approval, mirror delay, pause, expiry and UTC daily limits',()=>{
  const report=assessAutomationHealth(base({account,activeBuckets:1,ruleVersion:3n,mirroredVersion:2n,subscribed:false,allowance:0n,userBudget:0n,tokenBalance:1000n,
    policy:{paused:true,validUntil:86400n,dailyLimit:500n,reserve:0n},dailySpend:{day:1n,amount:500n}}));
  for(const id of ['allowance','mirror','user-budget','plan-paused','expired','daily-limit'])assert.ok(ids(report).includes(id),id);
  assert.equal(report.status,'blocked');
});
test('a new UTC day clears yesterday daily limit, while a future payday anchor is visible',()=>{
  const report=assessAutomationHealth(base({account,activeBuckets:1,ruleVersion:3n,mirroredVersion:3n,subscribed:true,allowance:1n,userBudget:2n,tokenBalance:1000n,
    policy:{dailyLimit:500n,reserve:0n},dailySpend:{day:0n,amount:500n},cycle:{duration:604800n,anchor:90000n}}));
  assert.ok(!ids(report).includes('daily-limit'));assert.ok(ids(report).includes('cycle-pending'));assert.equal(report.status,'attention');
});
test('intentionally inactive plans do not request unnecessary token approval',()=>{
  const report=assessAutomationHealth(base({account,activeBuckets:0,allowance:0n}));
  assert.equal(report.status,'inactive');assert.ok(!ids(report).includes('allowance'));
});
test('a new wallet with no token balance can receive its first payment when no reserve is set',()=>{
  const plan={account,activeBuckets:1,ruleVersion:1n,mirroredVersion:1n,subscribed:true,allowance:1000n,userBudget:5n,tokenBalance:0n};
  assert.equal(assessAutomationHealth(base({...plan,policy:{reserve:0n}})).status,'ready');
  const withReserve=assessAutomationHealth(base({...plan,policy:{reserve:100n}}));
  assert.equal(withReserve.status,'attention');
  assert.ok(ids(withReserve).includes('reserve'));
});
test('a completed one-shot observer is not mistaken for an exhausted payment service',async()=>{
  const fake=fakeReaders({values:{remaining:0n}});
  const report=await collectAutomationHealth({...config,mode:'observer',expectedOwner:account},{makeReader:fake.makeReader});
  assert.equal(report.status,'completed');assert.ok(ids(report).includes('observer-completed'));assert.ok(!ids(report).includes('platform-budget'));
  assert.ok(!fake.calls.some(call=>call.method==='reactive'));
});
test('stopping an observer before any observation does not count as task completion',()=>{
  const report=assessAutomationHealth(base({mode:'observer',count:0n,remaining:0n,subscribed:false}));
  assert.equal(report.status,'attention');assert.ok(ids(report).includes('observer-stopped'));
});
test('collector exports exact integer units and scopes user checks to the requested account',async()=>{
  const fake=fakeReaders({values:{allowance:2n**256n-1n}});
  const report=await collectAutomationHealth(config,{account,makeReader:fake.makeReader});
  assert.equal(report.status,'ready');assert.equal(report.scope,'saved-plan');
  assert.equal(JSON.parse(serializeHealthReport(report)).snapshot.allowance,String(2n**256n-1n));
  assert.ok(fake.calls.filter(call=>['allowance','getRule','policies'].includes(call.method)).every(call=>call.args[0]===account));
});
test('demo checks explicitly retain simulation-only status even with sample failures',()=>{
  const report=demoHealthReport({allowance:0n,policy:{paused:true},activeBuckets:3});
  assert.equal(report.status,'demo');assert.equal(report.scope,'simulation-only');assert.equal(report.alerts.length,2);
});
