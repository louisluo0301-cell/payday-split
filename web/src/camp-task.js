import {BrowserProvider,Contract,ContractFactory,Interface,JsonRpcProvider,formatEther,getAddress,parseEther,parseUnits,toBeHex,zeroPadValue} from 'ethers';

const EXPECTED=getAddress('0x90d2a64b86cb547d729ce61101fcd835d512e55a');
const FAUCET='0x9b9BB25f1A81078C544C829c5EB7822d747Cf434';
const SYSTEM='0x8888888888888888888888888888888888888888';
const networks={
  sepolia:{chainId:'0xaa36a7',chainName:'Sepolia',rpcUrls:['https://ethereum-sepolia-rpc.publicnode.com'],nativeCurrency:{name:'Sepolia ETH',symbol:'ETH',decimals:18},blockExplorerUrls:['https://sepolia.etherscan.io']},
  lasna:{chainId:'0x512577',chainName:'Reactive Lasna',rpcUrls:['https://lasna-rpc.rnk.dev/'],nativeCurrency:{name:'Lasna REACT',symbol:'lREACT',decimals:18},blockExplorerUrls:['https://lasna.reactscan.net']}
};
const readers={sepolia:new JsonRpcProvider(networks.sepolia.rpcUrls[0],11155111,{staticNetwork:true}),lasna:new JsonRpcProvider(networks.lasna.rpcUrls[0],5318007,{staticNetwork:true})};
const $=s=>document.querySelector(s);
const key=`paydaysplit.camp.v1:${EXPECTED.toLowerCase()}`;
let state;
try{state=JSON.parse(localStorage.getItem(key)||'{}');}catch{state={};}
let busy=false,connected=false,artifacts;
const injected=window.ethereum?.providers?.find(p=>p.isMetaMask)||window.ethereum;
function save(){localStorage.setItem(key,JSON.stringify(state));render();}
function status(text,error=false){$('#status').textContent=text;$('#status').classList.toggle('error',error);}
function render(){
  $('#connect').disabled=busy;
  $('#fund').disabled=busy||!connected||!!state.fundingTx;
  $('#deploy-token').disabled=busy||!connected||!!state.tokenTx||!artifacts;
  $('#deploy-monitor').disabled=busy||!connected||!state.token||!!state.monitorTx||!artifacts;
  $('#trigger').disabled=busy||!connected||!state.monitor||!!state.originTx;
  for(const [id,field] of [['fund-result','fundingTx'],['token-result','token'],['monitor-result','monitor'],['origin-result','originTx'],['react-result','reactTx']]) $("#"+id).textContent=state[field]||'';
  $('#results').replaceChildren();
  for(const [label,value] of Object.entries({代币:state.token||'待部署',监听合约:state.monitor||'待部署',成功计数:state.count??'待执行',剩余次数:state.remaining??'待执行',订阅状态:state.subscribed===undefined?'待查询':state.subscribed?'监听中':'已自动退订'})) {
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);$('#results').append(dt,dd);
  }
  if(state.reactTx&&state.count==='1'&&state.remaining==='0'&&state.subscribed===false) $('#proof').value=`合约：https://lasna.reactscan.net/address/${state.monitor}\nreact() 交易：https://lasna.reactscan.net/tx/${state.reactTx}\n来源转账：https://sepolia.etherscan.io/tx/${state.originTx}\n订阅条件：只监听 Sepolia 上我部署的 RCT 代币 ${state.token} 的 ERC20 Transfer，单笔金额严格超过 0.5 RCT 才计数，最多处理 1 次后自动退订；部署充值 0.1 lREACT。`;
}
async function signerFor(network){
  if(!injected) throw new Error('未检测到 MetaMask，请在装有钱包扩展的 Chrome 中打开。');
  const accounts=await injected.request({method:'eth_requestAccounts'});
  if(!accounts.some(a=>a.toLowerCase()===EXPECTED.toLowerCase())) throw new Error('请在 MetaMask 选择上方指定的测试钱包。');
  const config=networks[network];
  if(await injected.request({method:'eth_chainId'})!==config.chainId){
    try{await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:config.chainId}]});}
    catch(error){if(error.code!==4902) throw error;await injected.request({method:'wallet_addEthereumChain',params:[config]});await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:config.chainId}]});}
  }
  if(await injected.request({method:'eth_chainId'})!==config.chainId) throw new Error('网络切换尚未完成。');
  const signer=await new BrowserProvider(injected,'any').getSigner(EXPECTED);
  if((await signer.getAddress()).toLowerCase()!==EXPECTED.toLowerCase()) throw new Error('钱包账户不匹配。');
  return signer;
}
async function task(fn){
  if(busy)return;busy=true;render();
  try{await fn();}catch(error){status(error.shortMessage||error.message,true);}
  finally{busy=false;render();}
}
async function refresh(){
  const balances=await Promise.all([readers.sepolia.getBalance(EXPECTED),readers.lasna.getBalance(EXPECTED)]);
  $('#balances').textContent=`Sepolia：${formatEther(balances[0])} 测试 ETH · Lasna：${formatEther(balances[1])} lREACT`;
  for(const [network,field] of [['sepolia','token'],['lasna','monitor']]){
    if(state[field+'Tx']&&!state[field+'Block']){
      const receipt=await readers[network].getTransactionReceipt(state[field+'Tx']);
      if(receipt?.status===1){state[field]=receipt.contractAddress;state[field+'Block']=receipt.blockNumber;}
      else if(receipt?.status===0)throw new Error(`${field} 部署已回滚，请保留交易哈希供排查。`);
    }
  }
  if(state.monitor){
    const c=new Contract(state.monitor,artifacts.contracts.monitor.abi,readers.lasna);
    const [count,remaining,subscribed,reactBlock,origin]=await Promise.all([c.count(),c.remaining(),c.subscribed(),c.lastReactBlock(),c.lastOriginTxHash()]);
    state.count=String(count);state.remaining=String(remaining);state.subscribed=subscribed;
    if(count>0n&&reactBlock>0n){
      const logs=await c.queryFilter(c.filters.TransferObserved(),Number(reactBlock),Number(reactBlock));
      const event=logs.find(log=>log.args.originTxHash===origin);
      if(event){state.reactTx=event.transactionHash;state.observedOriginTx=zeroPadValue(toBeHex(origin),32);}
      if(state.reactTx&&state.observedOriginTx.toLowerCase()===state.originTx?.toLowerCase()) status('任务已由真实网络完成：react() 成功，计数 1，剩余 0，已自动退订。');
    }
  }
  save();
}
$('#expected-wallet').textContent=EXPECTED;
$('#connect').addEventListener('click',()=>task(async()=>{
  await signerFor('sepolia');connected=true;$('#connection').textContent='已连接指定测试钱包';status('已连接。每笔交易仍需在 MetaMask 确认。');await refresh();
}));
$('#refresh').addEventListener('click',()=>task(refresh));
$('#fund').addEventListener('click',()=>task(async()=>{
  if(await readers.lasna.getBalance(EXPECTED)>=parseEther('0.2')){status('Lasna 余额已足够本任务，无需再次兑换。');return;}
  status('请在 MetaMask 核对：Sepolia → 官方水龙头，0.005 测试 ETH，接收地址为本钱包。');
  const signer=await signerFor('sepolia');
  const iface=new Interface(['function request(address)']);
  const tx=await signer.sendTransaction({to:FAUCET,value:parseEther('0.005'),data:iface.encodeFunctionData('request',[EXPECTED])});
  state.fundingTx=tx.hash;save();await tx.wait();status('水龙头交易已确认，等待 lREACT 到达 Lasna。');await refresh();
}));
$('#deploy-token').addEventListener('click',()=>task(async()=>{
  status('请在 MetaMask 确认 Sepolia 上的 RCT 测试代币部署。');
  const signer=await signerFor('sepolia');
  const a=artifacts.contracts.token,c=await new ContractFactory(a.abi,a.bytecode,signer).deploy();
  state.tokenTx=c.deploymentTransaction().hash;save();
  const receipt=await c.deploymentTransaction().wait();state.token=receipt.contractAddress;state.tokenBlock=receipt.blockNumber;save();status('Sepolia 测试代币已部署。');await refresh();
}));
$('#deploy-monitor').addEventListener('click',()=>task(async()=>{
  if(!state.token||await readers.sepolia.getCode(state.token)==='0x')throw new Error('请先完成 Sepolia 测试代币部署。');
  if(await readers.lasna.getBalance(EXPECTED)<parseEther('0.2'))throw new Error('Lasna 测试币尚未到账，请稍后刷新。');
  if(await readers.lasna.getCode(SYSTEM)==='0x')throw new Error('Lasna 系统合约缺失，停止部署。');
  status('请在 MetaMask 确认 Lasna 网络切换和监听合约部署，附带 0.1 lREACT。');
  const signer=await signerFor('lasna');
  const a=artifacts.contracts.monitor,c=await new ContractFactory(a.abi,a.bytecode,signer).deploy(state.token,500000n,1n,{value:parseEther('0.1')});
  state.monitorTx=c.deploymentTransaction().hash;save();
  const receipt=await c.deploymentTransaction().wait();state.monitor=receipt.contractAddress;state.monitorBlock=receipt.blockNumber;save();status('监听合约已部署并充值，已订阅。现在可以发送测试转账。');await refresh();
}));
$('#trigger').addEventListener('click',()=>task(async()=>{
  const monitor=new Contract(state.monitor,artifacts.contracts.monitor.abi,readers.lasna);
  if(!(await monitor.subscribed())||await monitor.remaining()===0n)throw new Error('监听合约已停止；先刷新检查是否已完成任务。');
  status('请在 MetaMask 确认 Sepolia 网络和向自己转账 1 RCT；不需要 approve。');
  const signer=await signerFor('sepolia');
  const token=new Contract(state.token,artifacts.contracts.token.abi,signer);
  const tx=await token.transfer(EXPECTED,parseUnits('1',6));state.originTx=tx.hash;save();
  const receipt=await tx.wait();state.originBlock=receipt.blockNumber;save();status('Sepolia 转账已确认，等待 Reactive 系统自动调用 react()。页面会自动刷新。');await refresh();
}));
$('#download').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({wallet:EXPECTED,...state},null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='camp-transfer-monitor.json';a.click();URL.revokeObjectURL(url);
});
try{
  const response=await fetch('/camp-artifacts.json');if(!response.ok)throw new Error('部署产物尚未生成，请先运行 camp-build.mjs。');artifacts=await response.json();await refresh();
}catch(error){status(error.shortMessage||error.message,true);}
render();
setInterval(()=>{if(!busy)refresh().catch(error=>status(`状态查询失败：${error.shortMessage||error.message}`,true));},10000);
