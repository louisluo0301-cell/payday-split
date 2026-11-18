import {formatUnits, parseUnits} from 'ethers';
import {calculateRun} from './waterfall.js';
import {parsePlan} from './plan-backup.js';

export function createPlanning(ctx) {
  const {state, deployment, chainId, $, toast, bucketFromEditor} = ctx;
  let goals = [], targets = [], signature = '', previewRequest = 0, pendingImport = false;
  const context = () => ({chainId, decimals:state.decimals, token:deployment.token || '0x0000000000000000000000000000000000000000'});
  const units = value => {
    const amount = parseUnits(value || '0', state.decimals);
    if (amount < 0n || amount >= 2n ** 96n) throw new Error('Target must be a non-negative amount within uint96.');
    return amount;
  };
  const goalAt = i => goals[i] || {target:0n, paid:0n, cycle:0n};
  function sync() {
    // Canonical units keep imported goal drafts when saved rules return formatted values (0 -> 0.0).
    let next;
    try {
      next = JSON.stringify(state.buckets.map(bucket => {
        const b = bucketFromEditor(bucket);
        return [b.payee.toLowerCase(),String(b.fixedAmount),b.bps,b.active];
      }));
    } catch {
      next = JSON.stringify(state.buckets.map(({payee,fixed,bps,active}) => [payee.toLowerCase(),fixed,bps,active]));
    }
    if (signature && next !== signature) {
      goals = []; targets = [];
      pendingImport = false;
      if (state.demoMode) state.ruleVersion += 1;
    }
    signature = next;
    render();
  }
  function render() {
    const list = $('#goals-list');
    if (!list) return;
    list.replaceChildren();
    $('#goals-status').textContent = state.demoMode ? 'Demo goals · progress updates after each sample income.' :
      state.dirty ? 'Save destination changes first. A new rule version starts with no targets.' :
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
        const old=goalAt(index);
        goals[index]={target,paid:reset?0n:old.paid,cycle:reset||old.cycle===0n?old.cycle+1n:old.cycle};
      } else {
        if(!state.signer || state.dirty) throw new Error('Save destinations before setting goals.');
        state.busy=true;
        const tx=await state.split.connect(state.signer).setBucketGoal(deployment.token,index,state.ruleVersion,target,reset);
        await tx.wait();
        await load();
      }
      targets[index]=formatUnits(target,state.decimals);
      render(); await preview();
      toast(reset?'New funding cycle started.':'Funding target saved. Paid progress preserved.');
    } catch(err) {toast(err.shortMessage||err.message,true);}
    finally {state.busy=false;}
  }
  async function load() {
    if(!state.split || state.dirty || state.demoMode) return;
    const account=state.account, version=state.ruleVersion;
    try {
      const values=await Promise.all(state.buckets.map((_,i)=>state.split.bucketGoals(account,deployment.token,version,i)));
      if(account!==state.account || version!==state.ruleVersion || state.dirty) return;
      goals=values.map(g=>({target:g.target,paid:g.paid,cycle:g.cycle}));
      if(!pendingImport) targets=[];
      render();
    } catch { $('#goals-status').textContent='Goals could not be read. Verify the connection and that your deployment supports v6.'; }
  }
  async function preview() {
    const request=++previewRequest;
    try {
      const paycheck=parseUnits(String(state.samplePaycheck),state.decimals);
      let paid,retained,reason=0;
      if(state.demoMode) {
        const result=calculateRun(state.buckets.map(bucketFromEditor),paycheck,state.balance+paycheck,state.allowance,ctx.getPolicy(),ctx.getSpent(),undefined,goals);
        paid=result.paid; retained=result.retained;
        $('#execution-title').textContent='Next sample income';
      } else {
        if(!state.split || state.dirty) throw new Error('Connect and save destinations to check the current onchain execution.');
        const result=await state.split.previewExecution(state.account,deployment.token,paycheck);
        retained=result[1]; paid=paycheck-retained; reason=Number(result[2]);
      }
      if(request!==previewRequest) return;
      const reasons=['','User paused','Rule expired','Below minimum income','Protocol paused'];
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
      const plan={schema:'paydaysplit.plan',version:1,...context(),createdAt:new Date().toISOString(),
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
      ctx.writePolicy(plan.policy); ctx.renderBuckets(); ctx.updateSummary();
      targets=plan.goalTargets; pendingImport=true; render(); preview();
      toast('Draft restored. Review and save destinations, spending controls and each goal separately.');
    } catch(err) {toast(err.message,true);}
  }
  function wire() {
    $('#execution-refresh').addEventListener('click',preview);
    $('#plan-export').addEventListener('click',exportPlan);
    $('#plan-import').addEventListener('click',importPlan);
  }
  function clear() {goals=[];targets=[];signature='';pendingImport=false;++previewRequest;}
  return {sync,load,preview,record,wire,clear,getGoals:()=>goals};
}
