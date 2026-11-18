import {formatEther} from 'ethers';
import {serializeHealthReport} from './automation-health.js';

export function createHealthPanel({$,toast=()=>{},refresh=async()=>{},now=Date.now}){
  let report=null,confirmed=new Map(),history=[],lastOutage=false,lastList='';
  function appendHistory(message){history.unshift({at:new Date(now()).toISOString(),message});history=history.slice(0,20);}
  function render(current){
    const labels={ready:current.scope==='platform-only'?'Platform checks passed':'Saved plan checks passed',blocked:'Action needed',attention:'Review recommended',unavailable:'Live status unavailable',unconfigured:'Live deployment not configured',inactive:'Saved plan is inactive',completed:'Observation task completed',demo:'Demo checks · simulation only'};
    const summary=$('#health-summary');summary.textContent=labels[current.status]||'Status unknown';summary.dataset.status=current.status;
    $('#health-scope').textContent=current.scope==='simulation-only'?'No live fee balance or delivery has been checked.':current.scope==='platform-only'?'Connect a wallet to include your saved rule, allowance and spending limits.':'Checks reflect saved onchain state. They do not guarantee the next transaction will succeed.';
    $('#health-checked').textContent=current.snapshot?.checkedAt?`Checked ${new Date(current.snapshot.checkedAt).toLocaleTimeString()}`:'Not checked';
    const items=[...current.alerts];
    if(!current.complete)for(const [id,alert] of confirmed)if(!items.some(item=>item.id===id))items.push({...alert,title:`Last confirmed: ${alert.title}`,action:'Live recheck is unavailable; this issue has not been confirmed resolved.'});
    const signature=JSON.stringify(items);
    if(signature!==lastList){
      const list=$('#health-items');list.replaceChildren();
      for(const alert of items){
        const item=document.createElement('li');item.className=`health-issue health-${alert.severity}`;
        const title=document.createElement('strong');title.textContent=alert.title;
        const action=document.createElement('span');action.textContent=alert.action;item.append(title,action);list.append(item);
      }
      if(!items.length){const item=document.createElement('li');item.className='health-clear';item.textContent='No issues found in the checks above.';list.append(item);}
      lastList=signature;
    }
    const metrics=$('#health-metrics');metrics.replaceChildren();
    const s=current.snapshot||{};
    for(const [label,balance,reserves] of [['Reactive fee credit',s.reactiveBalance,s.reactiveReserves],['Callback fee credit',s.destinationBalance,s.destinationReserves]]){
      if(balance===undefined||reserves===undefined)continue;
      const row=document.createElement('div');const name=document.createElement('span');name.textContent=label;
      const value=document.createElement('b');value.textContent=formatEther(balance+reserves)+' native units';row.append(name,value);metrics.append(row);
    }
    const log=$('#health-history');log.replaceChildren();
    for(const entry of history){const li=document.createElement('li');li.textContent=`${new Date(entry.at).toLocaleTimeString()} · ${entry.message}`;log.append(li);}
    $('#health-export').disabled=false;
  }
  function apply(current,{notify=true}={}){
    const next=new Map(current.alerts.filter(alert=>alert.severity!=='info').map(alert=>[alert.id,alert]));
    const fresh=[...next.values()].filter(alert=>confirmed.get(alert.id)?.severity!==alert.severity);
    const resolved=current.complete?[...confirmed.values()].filter(alert=>!next.has(alert.id)):[];
    const messages=[];
    if(!current.complete&&current.status!=='unconfigured'){
      if(!lastOutage){appendHistory('Live checks became unavailable.');messages.push('Live checks are unavailable; previous issues are not confirmed resolved.');}
      lastOutage=true;
    }else if(current.complete){
      if(lastOutage){appendHistory('Live checks restored.');messages.push('Live checks restored.');}
      lastOutage=false;
      for(const alert of fresh){appendHistory(alert.title);messages.push(alert.title);}
      for(const alert of resolved){appendHistory(`Resolved: ${alert.title}`);messages.push(`Resolved: ${alert.title}`);}
      confirmed=next;
    }
    report=current;render(current);
    if(notify&&messages.length)toast(messages.join(' · '),current.alerts.some(alert=>alert.severity==='blocked'));
  }
  function wire(){
    $('#health-refresh').addEventListener('click',()=>refresh());
    $('#health-export').addEventListener('click',()=>{
      if(!report)return;
      const url=URL.createObjectURL(new Blob([serializeHealthReport({...report,history})],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='paydaysplit-health.json';link.click();URL.revokeObjectURL(url);
    });
  }
  function reset(){report=null;confirmed.clear();history=[];lastOutage=false;lastList='';$('#health-summary').textContent='Not checked';for(const id of ['health-items','health-history','health-metrics'])$('#'+id).replaceChildren();$('#health-export').disabled=true;}
  return {apply,wire,reset,getHistory:()=>history.slice()};
}
