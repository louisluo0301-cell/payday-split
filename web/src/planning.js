import {formatUnits, parseUnits} from 'ethers';
import {calculateRun} from './waterfall.js';
import {parsePlan} from './plan-backup.js';

export function createPlanning(ctx) {
  const {state, deployment, chainId, $, toast, bucketFromEditor} = ctx;
  let goals = [], targets = [], signature = '', previewRequest = 0, goalsRequest = 0, pendingImport = false;
  let previousIds = [], previousKeys = [], nextDraftId = 0, cycleKey = '';
  const context = () => ({chainId, decimals:state.decimals, token:deployment.token || '0x0000000000000000000000000000000000000000'});
  const units = value => {
    const amount = parseUnits(value || '0', state.decimals);
    if (amount < 0n || amount >= 2n ** 96n) throw new Error('Target must be a non-negative amount within uint96.');
    return amount;
  };
  const goalAt = i => goals[i] || {target:0n, paid:0n, cycle:0n};
  function syncCycles() {
    if(!state.demoMode) return;
    const c=state.cycleConfig;
    const now=Math.floor(Date.now()/1000);
    const period=c.duration && now>=c.anchor ? Math.floor((now-c.anchor)/c.duration) : 0;
    const key=`${c.revision}:${period}`;
    if(cycleKey && cycleKey!==key) goals=goals.map(g=>({...g,paid:0n}));
    if(c.duration) goals=goals.map(g=>({...g,cycle:BigInt(period+1)}));
    cycleKey=key;
  }
  function sync() {
    const oldTargets=[...targets];
    const goalMap=new Map(previousIds.map((id,i)=>[id,goalAt(i)]));
    const targetMap=new Map(previousIds.map((id,i)=>[id,targets[i]]));
    state.buckets.forEach(b=>{
      const payee=b.payee.toLowerCase();
      if(!b.id || (b.identityPayee!==undefined && b.identityPayee!==payee)) b.id=`draft-${++nextDraftId}`;
      b.identityPayee=payee;
    });
    const ids=state.buckets.map(b=>b.id);
    const keys=state.buckets.map(b=>{
      try { const value=bucketFromEditor(b); return `${value.payee.toLowerCase()}:${value.fixedAmount}:${value.bps}:${value.active}`; }
      catch { return JSON.stringify([b.payee,b.fixed,b.bps,b.active]); }
    });
    goals=ids.map(id=>goalMap.get(id)||{target:0n,paid:0n,cycle:0n});
    targets=ids.map((id,i)=>targetMap.get(id) ?? (pendingImport && keys[i]===previousKeys[i] ? oldTargets[i] : undefined));
    previousIds=ids;
    previousKeys=keys;
    // Canonical units keep imported goal drafts when saved rules return formatted values (0 -> 0.0).
    let next;
    try {
      next = JSON.stringify(state.buckets.map(bucket => {
        const b = bucketFromEditor(bucket);
        return [bucket.id,b.payee.toLowerCase(),String(b.fixedAmount),b.bps,b.active];
      }));
    } catch {
      next = JSON.stringify(state.buckets.map(({payee,fixed,bps,active}) => [payee.toLowerCase(),fixed,bps,active]));
    }
    if (signature && next !== signature) {
      if (state.demoMode) state.ruleVersion += 1;
    }
    signature = next;
    syncCycles();
    render();
  }
  function render() {
    const list = $('#goals-list');
    if (!list) return;
    list.replaceChildren();
    $('#goals-status').textContent = state.demoMode ? 'Demo goals · progress updates after each sample income.' :
      state.dirty ? 'Save destination changes first. Saved identities retain goals; a new payee starts fresh.' :
      state.account ? `Targets for saved rule v${state.ruleVersion}.` : 'Connect to manage saved onchain goals.';
    state.buckets.forEach((bucket, i) => {
      const goal = goalAt(i);
      const row = document.createElement('div'); row.className = 'goal-row';
      const progress = document.createElement('div'); progress.className = 'goal-progress';
      const title = document.createElement('strong'); title.textContent = `${i+1}. ${bucket.label || 'Destination'}`;
      const detail = document.createElement('span');
      detail.textContent = `${formatUnits(goal.paid,state.decimals)} / ${formatUnits(goal.target,state.decimals)} ${state.symbol} · cycle ${goal.cycle}${goal.target>0n && goal.paid>=goal.target?' · Funded':''}${goal.target===0n?' · No target':''}`;
      const bar = document.createElement('progress'); bar.max = 100;
      bar.value = goal.target > 0n ? Number((goal.paid>goal.target?goal.target:goal.paid)*10000n/goal.target)/100 : 0;
      bar.setAttribute('aria-label',`${bucket.label || 'Destination'} funding progress`);
      progress.append(title,detail,bar);
      const label=document.createElement('label'); label.textContent='Target amount';
      const input=document.createElement('input'); input.type='number'; input.min='0'; input.step='any';
      input.dataset.goal=String(i); input.setAttribute('aria-label',`Target for destination ${i+1}`);
      input.value=targets[i] ?? formatUnits(goal.target,state.decimals);
      input.addEventListener('input',()=>{targets[i]=input.value;}); label.append(input);
      const cycleLabel=document.createElement('label'); cycleLabel.className='goal-cycle';
      const cycle=document.createElement('input'); cycle.type='checkbox'; cycle.dataset.cycle=String(i);
      cycle.disabled=state.cycleConfig.duration>0;
      cycleLabel.append(cycle,document.createTextNode('Start new cycle'));
      const button=document.createElement('button'); button.type='button'; button.className='btn btn-small btn-outline';
      button.textContent='Save target'; button.dataset.saveGoal=String(i);
      button.disabled=!state.demoMode && (!state.signer || state.dirty || !state.ruleVersion);
      button.addEventListener('click',()=>save(i,input.value,cycle.checked));
      row.append(progress,label,cycleLabel,button); list.append(row);
    });
  }
  async function save(index, value, reset) {
    if(state.busy) return;
    try {
      const target=units(value);
      if(state.demoMode) {
        syncCycles();
        if(reset && state.cycleConfig.duration>0) throw new Error('Automatic cycles reset at the configured boundary.');
        const old=goalAt(index);
        goals[index]={target,paid:reset?0n:old.paid,cycle:reset||old.cycle===0n?old.cycle+1n:old.cycle};
      } else {
        if(!state.signer || state.dirty) throw new Error('Save destinations before setting goals.');
        state.busy=true;
        const signer = state.signer;
        const tx=await state.split.connect(signer).setBucketGoal(deployment.token,index,state.ruleVersion,target,reset);
        const receipt = await tx.wait();
        if (signer !== state.signer) return;
        targets[index] = undefined;
        await load({ blockTag: receipt.blockNumber });
      }
      if (state.demoMode) targets[index]=formatUnits(target,state.decimals);
      render(); await preview();
      toast(reset?'New funding cycle started.':'Funding target saved. Paid progress preserved.');
    } catch(err) {toast(err.shortMessage||err.message,true);}
    finally {state.busy=false;}
  }
  async function load(at = {}) {
    if(!state.split || state.dirty || state.demoMode) return;
    const { account, signer, split, ruleVersion: version } = state;
    const request = ++goalsRequest;
    try {
      const values=await Promise.all(state.buckets.map((_,i)=>split.bucketGoals(account,deployment.token,version,i,at)));
      if(request!==goalsRequest || signer!==state.signer || version!==state.ruleVersion || state.dirty) return;
      goals=values.map(g=>({target:g.target,paid:g.paid,cycle:g.cycle}));
      render();
    } catch {
      if(request===goalsRequest && signer===state.signer) $('#goals-status').textContent='Goals could not be read. Check the connection and try again.';
    }
  }
  async function preview(at = {}) {
    const request=++previewRequest;
    try {
      const paycheck=parseUnits(String(state.samplePaycheck),state.decimals);
      let paid,retained,reason=0;
      if(state.demoMode) {
        syncCycles();
        const result=calculateRun(state.buckets.map(bucketFromEditor),paycheck,state.balance+paycheck,state.allowance,ctx.getPolicy(),ctx.getSpent(),undefined,goals,state.allocationMode,state.cycleConfig);
        paid=result.paid; retained=result.retained;
        $('#execution-title').textContent='Next sample income';
      } else {
        if(!state.split || state.dirty) throw new Error('Connect and save destinations to check the current onchain execution.');
        const result=await state.split.previewExecution(state.account,deployment.token,paycheck,at);
        retained=result[1]; paid=paycheck-retained; reason=Number(result[2]);
      }
      if(request!==previewRequest) return;
      const reasons=['','User paused','Rule expired','Below minimum income','Protocol paused','Cycle has not started'];
      $('#execution-result').textContent=`${formatUnits(paid,state.decimals)} ${state.symbol} routed · ${formatUnits(retained,state.decimals)} retained${reason?` · ${reasons[reason]}`:''}`;
    } catch(err) { if(request===previewRequest) $('#execution-result').textContent=err.shortMessage||err.message; }
  }
  function record(splits) {
    for(const payment of splits) {
      const goal=goals[payment.bucketIndex];
      if(goal?.target>0n) goal.paid+=payment.amount;
    }
    render(); preview();
  }
  function exportPlan() {
    try {
      const p=ctx.readPolicy();
      const policy=Object.fromEntries(Object.entries(p).map(([key,value])=>[key,typeof value==='bigint' ? (key==='validUntil'?String(value):formatUnits(value,state.decimals)) : value]));
      const duration=Number($('#cycle-duration').value);
      const anchor=duration ? String(Math.floor(Date.parse($('#cycle-anchor').value+'Z')/1000)) : '0';
      const plan={schema:'paydaysplit.plan',version:2,...context(),createdAt:new Date().toISOString(),
        allocationMode:Number($('#allocation-mode').value),cycle:{duration,anchor},
        buckets:state.buckets.map(b=>({...b,label:b.label||'',fixed:b.fixed||'0',bps:b.bps||'0'})),policy,
        goalTargets:state.buckets.map((_,i)=>targets[i]||formatUnits(goalAt(i).target,state.decimals))};
      const text=JSON.stringify(plan,null,2); parsePlan(text,context());
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
      const link=document.createElement('a'); link.href=url; link.download='paydaysplit-plan.json'; link.click(); URL.revokeObjectURL(url);
      toast('Plan backup downloaded. It contains no keys or allowance approvals.');
    } catch(err) {toast(err.message,true);}
  }
  function importPlan() {
    if(state.busy) return;
    try {
      const plan=parsePlan($('#plan-json').value,context());
      plan.buckets.forEach(bucketFromEditor); // also reject this user's wallet and this split contract
      state.buckets=plan.buckets; state.dirty=true;
      ctx.writeBudget(plan);
      ctx.writePolicy(plan.policy); ctx.renderBuckets(); ctx.updateSummary();
      targets=plan.goalTargets; pendingImport=true; render(); preview();
      toast('Draft restored. Review and save destinations, mode, cycle, controls and each goal separately.');
    } catch(err) {toast(err.message,true);}
  }
  function wire() {
    $('#execution-refresh').addEventListener('click',()=>preview());
    $('#plan-export').addEventListener('click',exportPlan);
    $('#plan-import').addEventListener('click',importPlan);
  }
  function clear() {goals=[];targets=[];previousIds=[];previousKeys=[];signature='';cycleKey='';pendingImport=false;++previewRequest;++goalsRequest;}
  return {sync,load,preview,record,wire,clear,getGoals:()=>{syncCycles();return goals;}};
}
