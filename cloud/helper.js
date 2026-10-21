import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,GoogleAuthProvider,signInWithPopup} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {cloudApp,companyCall,companyCloudEnabled} from './client.js';
const auth=getAuth(cloudApp()),root=document.getElementById('companyCloudPanel');
let context=null,busy=false;
const status=text=>root.querySelector('[data-status]').textContent=text;
const call=data=>companyCall('companyAdmin',data);
function updateButtons(){
  root.querySelectorAll('[data-admin]').forEach(button=>button.disabled=busy||root.dataset.editor!=='true'||!companyCloudEnabled);
  root.querySelectorAll('[data-login-form] button,[data-signout]').forEach(button=>button.disabled=busy);
}
function errorMessage(error){
  const messages={
    'auth/popup-closed-by-user':'已取消 Google 登入',
    'auth/cancelled-popup-request':'已取消 Google 登入，請重新嘗試',
    'auth/popup-blocked':'瀏覽器封鎖登入視窗，請允許此網站的彈出式視窗後重試',
    'auth/unauthorized-domain':'此網址未獲 Firebase 登入授權，請在 Authentication 的 Authorized domains 加入目前網域',
    'auth/operation-not-allowed':'Firebase 尚未啟用此登入方式，請檢查 Authentication 登入供應商設定',
    'auth/account-exists-with-different-credential':'此電郵已有其他登入方式，請用原有方式登入；請勿另建帳戶',
    'auth/network-request-failed':'登入連線失敗，請檢查網絡後重試'
  };
  return messages[error.code]||error.message||String(error);
}
async function run(work){if(busy)return;busy=true;updateButtons();try{await work();}catch(error){status(errorMessage(error));}finally{busy=false;updateButtons();}}
async function list(){
  const items=await call({action:'list'}),select=root.querySelector('select'),selected=select.value;
  select.replaceChildren(new Option('選擇雲端公司',''));
  items.sort((a,b)=>a.id.localeCompare(b.id)).forEach(item=>select.add(new Option(`${item.name||item.id} (${item.id})`,item.id)));
  select.value=selected;
}
async function logs(id){
  const entries=await call({action:'log',id}),list=root.querySelector('[data-log]');list.replaceChildren();
  const labels={lines:'路線',stations:'車站',trains:'車型',services:'運行列車'};
  for(const entry of entries){
    const item=document.createElement('li');
    const parts=Object.entries(entry.diff?.changes||{}).filter(([,v])=>v.added||v.removed||v.updated).map(([key,v])=>`${labels[key]} +${v.added} / 修改${v.updated} / 移除${v.removed}`);
    if(entry.diff?.metadataChanged)parts.unshift('公司資料更新');
    item.textContent=`${entry.createdAt?new Date(entry.createdAt).toLocaleString():''} · ${entry.action==='publish'?'發佈':'草稿'} · ${parts.join('；')||'無資料變更'}`;
    list.appendChild(item);
  }
  if(!entries.length){const item=document.createElement('li');item.textContent='暫無修改記錄';list.appendChild(item);}
}
root.querySelector('[data-login-form]').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
  const email=root.querySelector('[type=email]'),password=root.querySelector('[type=password]');
  try{await signInWithEmailAndPassword(auth,email.value,password.value);}finally{password.value='';}
});});
root.querySelector('[data-google-login]').onclick=()=>run(async()=>{
  const provider=new GoogleAuthProvider();
  provider.setCustomParameters({prompt:'select_account'});
  await signInWithPopup(auth,provider);
});
root.querySelector('[data-signout]').onclick=()=>run(()=>signOut(auth));
root.querySelector('[data-refresh]').onclick=()=>run(list);
root.querySelector('[data-load]').onclick=()=>run(async()=>{
  const id=root.querySelector('select').value;if(!id)throw new Error('請選擇公司');
  if(window.railCompanyEditor.get()&&!confirm('載入雲端草稿會取代目前編輯內容，繼續？'))return;
  const result=await call({action:'load',id});if(!result.data)throw new Error('公司尚未有草稿');
  window.railCompanyEditor.load(result.data);context={id,version:result.state.draftVersion||null};
  await logs(id);status(`已載入 ${id} 草稿`);
});
root.querySelector('[data-draft]').onclick=()=>run(async()=>{
  const data=window.railCompanyEditor.get();if(!data)throw new Error('請先載入本機JSON或雲端公司');
  if(context&&context.id!==data.company_id)throw new Error('雲端編輯不可更改公司ID；請重新載入對應公司');
  const result=await call({action:'draft',id:data.company_id,baseVersion:context?.version||null,data});
  context={id:data.company_id,version:result.state.draftVersion};await list();await logs(data.company_id);
  status(result.unchanged?'草稿沒有變更':'草稿已儲存，尚未發佈');
});
root.querySelector('[data-publish]').onclick=()=>run(async()=>{
  const data=window.railCompanyEditor.get();if(!context||data?.company_id!==context.id)throw new Error('請先儲存草稿');
  // Save first, so Publish cannot silently publish an older draft than the visible editor.
  if(!confirm(`發佈 ${context.id}？所有index使用者將收到更新。`))return;
  const saved=await call({action:'draft',id:context.id,baseVersion:context.version,data});context.version=saved.state.draftVersion;
  await call({action:'publish',id:context.id,baseVersion:context.version});await logs(context.id);status('已發佈，index會於背景取得更新');
});
root.querySelector('[data-log-refresh]').onclick=()=>run(()=>logs(context?.id||root.querySelector('select').value));
onAuthStateChanged(auth,async user=>{
  context=null;root.dataset.editor='false';
  updateButtons();
  root.querySelector('[data-login-form]').hidden=!!user;root.querySelector('[data-signout]').hidden=!user;
  try{
    const token=user?await user.getIdTokenResult(true):null;root.dataset.editor=String(token?.claims.companyEditor===true);
    status(!companyCloudEnabled?'公司雲端未啟用（本機JSON仍可使用）':!user?'請登入編輯帳戶':root.dataset.editor==='true'?`已登入 ${user.email||user.uid}`:'已登入，但帳戶未獲編輯權限');
    if(companyCloudEnabled&&root.dataset.editor==='true')await list();
  }catch(error){status(error.message);}finally{updateButtons();}
});
window.addEventListener('rail-company-local-load',()=>{context=null;});
