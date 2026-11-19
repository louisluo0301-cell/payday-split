export function createBudgetControls(ctx) {
  const {state,deployment,$,toast} = ctx;
  let cycleDirty = false;
  function cycleFields(cycle) {
    const select=$('#cycle-duration');
    if(![...select.options].some(o=>o.value===String(cycle.duration))) {
      const option=document.createElement('option');option.value=String(cycle.duration);option.textContent=`Every ${cycle.duration/86400} days (custom)`;select.append(option);
    }
    select.value=String(cycle.duration);
    $('#cycle-anchor').value=Number(cycle.anchor) ? new Date(Number(cycle.anchor)*1000).toISOString().slice(0,19) : '';
  }
  function stage(plan) {
    state.draftAllocationMode=plan.allocationMode;
    $('#allocation-mode').value=String(plan.allocationMode);
    cycleFields(plan.cycle);
    cycleDirty = Number(plan.cycle.duration) !== state.cycleConfig.duration
      || Number(plan.cycle.anchor) !== state.cycleConfig.anchor;
  }
  function show(draftMode = null, reset = false) {
    if (reset) cycleDirty = false;
    state.draftAllocationMode=draftMode ?? state.allocationMode;
    $('#allocation-mode').value=String(state.draftAllocationMode);
    if (!cycleDirty) cycleFields(state.cycleConfig);
    $('#budget-status').textContent=`${state.allocationMode===1?'Pro-rata: shares use the available budget':'Waterfall: priority, percentages of gross income'} · ${state.cycleConfig.duration ? `Automatic ${state.cycleConfig.duration/86400}-day cycles (UTC)` : 'Manual goal cycles'}`;
  }
  async function saveMode() {
    if(state.busy) return;
    const mode=Number($('#allocation-mode').value);
    try {
      if(mode===1 && state.buckets.some(b=>b.active && Number(b.fixed)>0)) throw new Error('Remove fixed amounts and save destinations before switching to pro-rata.');
      if(state.demoMode) {state.allocationMode=mode; state.draftAllocationMode=mode;state.ruleVersion++;}
      else {
        if(!state.signer || state.dirty) throw new Error('Connect and save destination changes first.');
        state.busy=true;
        await (await state.split.connect(state.signer).setAllocationMode(deployment.token,mode)).wait();
        await ctx.refresh();
      }
      show();ctx.update();await ctx.planner.preview();toast('Allocation mode saved. Goals keep their progress.');
    } catch(err) {toast(err.shortMessage||err.message,true);}
    finally {state.busy=false;}
  }
  async function saveCycle() {
    if(state.busy) return;
    try {
      const duration=Number($('#cycle-duration').value);
      const anchor=duration ? Math.floor(Date.parse($('#cycle-anchor').value+'Z')/1000) : 0;
      if(!Number.isSafeInteger(anchor) || anchor<0 || anchor>253402300799) throw new Error('Choose a valid UTC anchor.');
      if(state.demoMode) {
        const old=state.cycleConfig;
        if(old.duration!==duration || old.anchor!==anchor) state.cycleConfig={anchor,duration,revision:old.revision+1};
        cycleDirty=false;
      } else {
        if(!state.signer) throw new Error('Connect to configure cycles.');
        state.busy=true;
        await (await state.split.connect(state.signer).setCycleConfig(deployment.token,anchor,duration)).wait();
        cycleDirty=false;
        await ctx.refresh();
      }
      show();ctx.update();await ctx.planner.preview();toast('Cycle saved. A changed schedule starts fresh progress.');
    } catch(err) {toast(err.shortMessage||err.message,true);}
    finally {state.busy=false;}
  }
  function wire() {
    $('#save-allocation').addEventListener('click',saveMode);
    $('#save-cycle').addEventListener('click',saveCycle);
    $('#allocation-mode').addEventListener('change',()=>{state.draftAllocationMode=Number($('#allocation-mode').value);ctx.update();});
    for (const id of ['#cycle-duration', '#cycle-anchor']) {
      $(id).addEventListener('input', () => { cycleDirty = true; });
    }
    show();
  }
  return {show,wire,stage,hasCycleDraft:()=>cycleDirty};
}
