import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,signOut,GoogleAuthProvider,signInWithPopup} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import {cloudApp,companyCall,companyCloudEnabled} from './client.js';
const auth=getAuth(cloudApp()),root=document.getElementById('companyCloudPanel');
let context=null,busy=false;
let savedSnapshot=null,savedVersion=null,publishedVersion=null;
const saveState=document.createElement('div');
saveState.dataset.saveState='';saveState.setAttribute('role','status');saveState.setAttribute('aria-live','polite');
root.querySelector('[data-status]').before(saveState);
function editorSnapshot(){return JSON.stringify(window.railCompanyEditor.get());}
function hasUnsavedChanges(){return window.railCompanyEditor.get()!==null&&editorSnapshot()!==savedSnapshot;}
function renderSaveState(){
  const dirty=hasUnsavedChanges(),exists=window.railCompanyEditor.get()!==null;
  const text=!exists?'尚未載入公司':`${dirty?'● 未儲存修改':'✓ 草稿已儲存'}${savedVersion?` · 草稿版本 ${savedVersion} · ${savedVersion===publishedVersion?'已發佈':'尚未發佈'}`:' · 尚未儲存雲端草稿'}`;
  if(saveState.textContent!==text)saveState.textContent=text;
  saveState.style.cssText=`overflow-wrap:anywhere;font-size:12px;padding:8px 0;color:${dirty?'#b87500':'var(--primary, #57a900)'}`;
}
function markSaved(data,version,published){
  savedSnapshot=JSON.stringify(data);savedVersion=version||null;publishedVersion=published||null;renderSaveState();
}
window.railCompanyConfirmDiscard=()=>!hasUnsavedChanges()||confirm('目前有未儲存修改，確定放棄並切換公司／載入資料？');
window.addEventListener('beforeunload',event=>{if(hasUnsavedChanges()){event.preventDefault();event.returnValue='';}});
window.addEventListener('rail-company-change',renderSaveState);
document.addEventListener('input',()=>queueMicrotask(renderSaveState));
renderSaveState();
let batchRows=[],batchStopped=false,sessionUid=null;
let publishRows=[],publishStopped=false;
const publishResults=new Map();
function failureStorageKey(uid){return `raillog:rail-log-v1-41134:publish-failures:v1:${uid}`;}
function persistPublishFailures(){
  if(!sessionUid)return;
  try{
    const failures=[...publishResults.values()].filter(row=>row.state==='failed').map(({id,name,message})=>({id,name,message}));
    if(failures.length)localStorage.setItem(failureStorageKey(sessionUid),JSON.stringify(failures));
    else localStorage.removeItem(failureStorageKey(sessionUid));
    root.querySelector('[data-publish-storage-status]').textContent='';
  }catch(error){root.querySelector('[data-publish-storage-status]').textContent='瀏覽器無法保存失敗清單，關閉此頁後可能遺失';}
}
function restorePublishFailures(){
  try{
    const rows=JSON.parse(localStorage.getItem(failureStorageKey(sessionUid))||'[]');
    if(!Array.isArray(rows))throw new Error('Invalid saved failure list');
    for(const row of rows){
      if(typeof row?.id!=='string'||! /^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(row.id))continue;
      publishResults.set(row.id,{id:row.id,name:typeof row.name==='string'?row.name:row.id,message:typeof row.message==='string'?row.message:'上次發佈失敗',state:'failed'});
    }
    root.querySelector('[data-publish-storage-status]').textContent='';
  }catch(error){root.querySelector('[data-publish-storage-status]').textContent='無法讀取已保存的失敗清單';}
  renderPublishResults();
}
const status=text=>root.querySelector('[data-status]').textContent=text;
const call=data=>companyCall('companyAdmin',data);
function updateButtons(){
  root.querySelectorAll('[data-admin]').forEach(button=>button.disabled=busy||root.dataset.editor!=='true'||!companyCloudEnabled);
  root.querySelectorAll('[data-login-form] button,[data-signout]').forEach(button=>button.disabled=busy);
  const start=root.querySelector('[data-batch-start]');
  start.disabled=start.disabled||!batchRows.some(row=>['pending','failed'].includes(row.state));
  const selected=publishRows.filter(row=>row.selected).length;
  const publishStart=root.querySelector('[data-publish-start]'),all=root.querySelector('[data-publish-all]');
  publishStart.disabled=publishStart.disabled||!selected;
  const retry=root.querySelector('[data-publish-retry]');
  retry.disabled=retry.disabled||!publishRows.some(row=>publishResults.get(row.id)?.state==='failed');
  all.disabled=all.disabled||!publishRows.length;
  all.checked=!!publishRows.length&&selected===publishRows.length;
  all.indeterminate=selected>0&&selected<publishRows.length;
  root.querySelector('[data-publish-count]').textContent=root.dataset.editor==='true'?
    (publishRows.length?`${publishRows.length} 間有未發佈草稿 · 已選 ${selected}`:'沒有未發佈草稿'):'請登入編輯帳戶';
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
  const uid=sessionUid;
  const items=await call({action:'list'}),select=root.querySelector('select'),selected=select.value;
  if(uid!==sessionUid||root.dataset.editor!=='true')return;
  const currentCompany=items.find(item=>item.id===context?.id);
  if(currentCompany&&Object.hasOwn(currentCompany,'publishedVersion')){publishedVersion=currentCompany.publishedVersion||null;renderSaveState();}
  select.replaceChildren(new Option('選擇雲端公司',''));
  items.sort((a,b)=>a.id.localeCompare(b.id)).forEach(item=>select.add(new Option(`${item.name||item.id} (${item.id})`,item.id)));
  select.value=selected;
  const previous=new Map(publishRows.map(row=>[row.id,row]));
  publishRows=items.filter(item=>item.draftVersion&&item.draftVersion!==item.publishedVersion).map(item=>({
    id:item.id,name:item.name||item.id,version:item.draftVersion,
    selected:previous.get(item.id)?.version===item.draftVersion&&previous.get(item.id).selected
  }));
  for(const [id,result] of publishResults){
    const current=items.find(item=>item.id===id);
    if(result.state==='failed'&&current?.draftVersion&&current.draftVersion===current.publishedVersion){
      publishResults.set(id,{...result,state:'published',message:'已發佈'});
    }
  }
  persistPublishFailures();renderPublishResults();
  renderPublishCandidates();
}
function renderPublishCandidates(){
  root.querySelector('[data-publish-candidates]').replaceChildren(...publishRows.map(row=>{
    const li=document.createElement('li'),label=document.createElement('label'),checkbox=document.createElement('input'),text=document.createElement('span');
    checkbox.type='checkbox';checkbox.checked=!!row.selected;checkbox.dataset.admin='';checkbox.dataset.publishId=row.id;
    text.textContent=row.name===row.id?row.id:`${row.name} · ${row.id}`;
    checkbox.onchange=()=>{row.selected=checkbox.checked;updateButtons();};
    label.append(checkbox,text);li.append(label);return li;
  }));
  updateButtons();
}
root.querySelector('[data-publish-all]').onchange=event=>{
  publishRows.forEach(row=>{row.selected=event.target.checked;});renderPublishCandidates();
};
root.querySelector('[data-publish-refresh]').onclick=()=>run(list);
async function loadCloudDraft(id){
  if(!id)throw new Error('請選擇公司');
  if(!window.railCompanyConfirmDiscard())return;
  const previous=editorSnapshot();
  const result=await call({action:'load',id});if(!result.data)throw new Error('公司尚未有草稿');
  if(editorSnapshot()!==previous&&!window.railCompanyConfirmDiscard())return;
  window.railCompanyEditor.load(result.data);context={id,version:result.state.draftVersion||null};
  markSaved(window.railCompanyEditor.get(),context.version,result.state.publishedVersion);
  root.querySelector('select').value=id;
  await logs(id);status(`已載入 ${id} 草稿`);
}
function renderPublishResults(){
  root.querySelector('[data-publish-results]').replaceChildren(...[...publishResults.values()].map(row=>{
    const li=document.createElement('li');li.dataset.state=row.state;
    if(row.state==='failed'){
      const button=document.createElement('button');button.type='button';button.className='ghost mini-btn';button.dataset.admin='';button.dataset.publishEdit=row.id;
      button.textContent=row.name;button.title=`載入 ${row.id} 草稿修改`;button.setAttribute('aria-label',button.title);
      button.onclick=()=>run(()=>loadCloudDraft(row.id));li.append(button,document.createTextNode(` · ${row.message}`));
    }else li.textContent=`${row.name} · ${row.message}`;
    return li;
  }));
  updateButtons();
}
root.querySelector('[data-publish-stop]').onclick=()=>{
  publishStopped=true;root.querySelector('[data-publish-stop]').disabled=true;
  root.querySelector('[data-publish-status]').textContent='正在停止，等待目前請求完成';
};
async function publishSelected(retry=false){
  if(root.dataset.editor!=='true'||!companyCloudEnabled)throw new Error('請先登入編輯帳戶');
  if(retry)await list();
  const queue=publishRows.filter(row=>retry?publishResults.get(row.id)?.state==='failed':row.selected).map(row=>({...row}));
  if(!queue.length){root.querySelector('[data-publish-status]').textContent='沒有需要重試的失敗草稿';return;}
  if(!confirm(`${retry?'重試失敗項目：發佈最新已儲存草稿':'發佈所選雲端草稿'}，共 ${queue.length} 間公司？index 將收到更新；不會儲存目前編輯器內的未存修改。`))return;
  const uid=sessionUid,stop=root.querySelector('[data-publish-stop]'),info=root.querySelector('[data-publish-status]'),progress=root.querySelector('[data-publish-progress]');
  publishStopped=false;stop.hidden=false;stop.disabled=false;
  progress.hidden=false;progress.max=queue.length;progress.value=0;
  let completed=0,succeeded=0,failed=0;
  try{
    for(const row of queue){
      if(publishStopped||sessionUid!==uid||root.dataset.editor!=='true')break;
      info.textContent=`發佈 ${completed+1} / ${queue.length} · ${row.id}`;
      let outcome;
      try{
        await call({action:'publish',id:row.id,baseVersion:row.version});
        succeeded++;outcome={...row,state:'published',message:'已發佈'};
        publishRows=publishRows.filter(item=>item.id!==row.id||item.version!==row.version);
        renderPublishCandidates();
      }catch(error){
        failed++;outcome={...row,state:'failed',message:errorMessage(error)};
        if(['functions/unauthenticated','functions/permission-denied'].includes(error.code))publishStopped=true;
      }
      if(sessionUid===uid){publishResults.set(row.id,outcome);persistPublishFailures();renderPublishResults();}
      completed++;progress.value=completed;
    }
  }finally{
    stop.hidden=true;
    info.textContent=`${completed<queue.length?'已停止':'已完成'} · 已發佈 ${succeeded} · 失敗 ${failed} · 未處理 ${queue.length-completed}`;
    if(sessionUid===uid&&root.dataset.editor==='true')await list();
  }
}
root.querySelector('[data-publish-start]').onclick=()=>run(()=>publishSelected());
root.querySelector('[data-publish-retry]').onclick=()=>run(()=>publishSelected(true));
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
async function prepareCompanyBatch(files){
  const rows=[];
  for(const file of files){
    try{
      if(file.size>12*1024*1024)throw new Error('檔案超過 12 MiB');
      const parsed=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
      const companies=Array.isArray(parsed)?parsed:[parsed];
      if(!companies.length)throw new Error('檔案沒有公司資料');
      for(const data of companies){
        const id=data?.company_id;
        const valid=data&&typeof data==='object'&&!Array.isArray(data)&&typeof id==='string'&&/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(id)&&['lines','stations','trains','services'].every(key=>data[key]===undefined||Array.isArray(data[key]));
        rows.push({file:file.name,id:typeof id==='string'?id:'',data,state:valid?'pending':'invalid',message:valid?'等待匯入':'公司 ID 或資料格式不正確'});
      }
    }catch(error){rows.push({file:file.name,id:'',state:'invalid',message:error.message});}
  }
  const counts=new Map();
  rows.forEach(row=>{if(row.id)counts.set(row.id,(counts.get(row.id)||0)+1);});
  rows.forEach(row=>{if(counts.get(row.id)>1){row.state='invalid';row.message='同批公司 ID 重複，請移除重複檔案後重新選取';}});
  return rows;
}
function renderBatch(){
  const list=root.querySelector('[data-batch-results]');
  list.replaceChildren(...batchRows.map(row=>{
    const li=document.createElement('li');li.dataset.state=row.state;
    li.textContent=`${row.id||row.file}${row.id?' · '+row.file:''} — ${row.message}`;
    return li;
  }));
}
root.querySelector('[data-batch-files]').onchange=()=>run(async()=>{
  const uid=sessionUid;
  batchRows=await prepareCompanyBatch([...root.querySelector('[data-batch-files]').files]);
  if(sessionUid!==uid){batchRows=[];return;}
  renderBatch();
  root.querySelector('[data-batch-progress]').hidden=true;
  root.querySelector('[data-batch-status]').textContent=`${batchRows.filter(row=>row.state==='pending').length} 間待匯入；${batchRows.filter(row=>row.state==='invalid').length} 項需修正`;
});
root.querySelector('[data-batch-stop]').onclick=()=>{
  batchStopped=true;root.querySelector('[data-batch-stop]').disabled=true;
  root.querySelector('[data-batch-status]').textContent='正在停止，等待目前請求完成';
};
root.querySelector('[data-batch-start]').onclick=()=>run(async()=>{
  if(root.dataset.editor!=='true'||!companyCloudEnabled)throw new Error('請先登入編輯帳戶');
  const publish=root.querySelector('[data-batch-publish]').checked;
  const queue=batchRows.filter(row=>['pending','failed'].includes(row.state));
  if(!queue.length)return;
  if(!confirm(`匯入 ${queue.length} 間公司${publish?'並發佈至 index':'為草稿（不發佈）'}？已存在的公司會跳過。`))return;
  const existing=new Set((await call({action:'list'})).map(item=>item.id));
  const uid=sessionUid,stop=root.querySelector('[data-batch-stop]'),progress=root.querySelector('[data-batch-progress]'),info=root.querySelector('[data-batch-status]');
  batchStopped=false;stop.hidden=false;stop.disabled=false;progress.hidden=false;progress.max=queue.length;progress.value=0;
  let completed=0;
  const active=()=>!batchStopped&&sessionUid===uid&&root.dataset.editor==='true';
  try{
    for(const row of queue){
      if(!active())break;
      info.textContent=`處理 ${completed+1} / ${queue.length} · ${row.id}`;
      if(existing.has(row.id)&&!row.version){row.state='skipped';row.message='已存在雲端，保留原有資料';}
      else{
        try{
          if(!row.version){
            row.message='正在儲存草稿';renderBatch();
            const saved=await call({action:'draft',id:row.id,baseVersion:null,data:row.data});
            row.version=saved.state.draftVersion;existing.add(row.id);
          }
          row.state='saved';row.message='草稿已儲存，未發佈';
          if(publish&&active()){
            await call({action:'publish',id:row.id,baseVersion:row.version});
            row.state='published';row.message='已發佈';
          }
        }catch(error){
          row.state='failed';row.message=(row.version?'草稿已儲存；發佈失敗：':'匯入失敗：')+errorMessage(error);
          if(['functions/unauthenticated','functions/permission-denied'].includes(error.code))batchStopped=true;
        }
      }
      completed++;progress.value=completed;renderBatch();
    }
  }finally{
    stop.hidden=true;
    const count=state=>batchRows.filter(row=>row.state===state).length;
    info.textContent=`${completed<queue.length?'已停止':'已完成'} · 草稿 ${count('saved')} · 已發佈 ${count('published')} · 跳過 ${count('skipped')} · 失敗 ${count('failed')} · 無效 ${count('invalid')}`;
    if(sessionUid===uid&&root.dataset.editor==='true')await list();
  }
});
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
root.querySelector('[data-load]').onclick=()=>run(()=>loadCloudDraft(root.querySelector('select').value));
root.querySelector('[data-draft]').onclick=()=>run(async()=>{
  const data=window.railCompanyEditor.get();if(!data)throw new Error('請先載入本機JSON或雲端公司');
  if(context&&context.id!==data.company_id)throw new Error('雲端編輯不可更改公司ID；請重新載入對應公司');
  const result=await call({action:'draft',id:data.company_id,baseVersion:context?.version||null,data});
  context={id:data.company_id,version:result.version||result.state.draftVersion};
  markSaved(data,context.version,result.state.publishedVersion);
  const savedMessage=result.unchanged?'草稿沒有變更，可繼續編輯':'草稿已儲存，尚未發佈，可繼續編輯';
  status(savedMessage);
  try{await list();await logs(data.company_id);}catch(error){status(`${savedMessage}；清單更新失敗：${errorMessage(error)}`);}
});
root.querySelector('[data-publish]').onclick=()=>run(async()=>{
  const data=window.railCompanyEditor.get();if(!context||data?.company_id!==context.id)throw new Error('請先儲存草稿');
  // Save first, so Publish cannot silently publish an older draft than the visible editor.
  if(!confirm(`發佈 ${context.id}？所有index使用者將收到更新。`))return;
  const saved=await call({action:'draft',id:context.id,baseVersion:context.version,data});context.version=saved.version||saved.state.draftVersion;
  markSaved(data,context.version,saved.state.publishedVersion);
  await call({action:'publish',id:context.id,baseVersion:context.version});publishedVersion=context.version;renderSaveState();await logs(context.id);status('已發佈，index會於背景取得更新');
});
root.querySelector('[data-log-refresh]').onclick=()=>run(()=>logs(context?.id||root.querySelector('select').value));
onAuthStateChanged(auth,async user=>{
  const accountChanged=sessionUid!==(user?.uid||null);
  if(accountChanged){
    batchStopped=true;publishStopped=true;publishRows=[];publishResults.clear();
    root.querySelector('[data-publish-candidates]').replaceChildren();
    root.querySelector('[data-publish-results]').replaceChildren();
    root.querySelector('[data-publish-storage-status]').textContent='';
  }
  sessionUid=user?.uid||null;
  if(accountChanged)context=null;
  root.dataset.editor='false';
  updateButtons();
  root.querySelector('[data-login-form]').hidden=!!user;root.querySelector('[data-signout]').hidden=!user;
  const account=root.querySelector('.cloud-account');
  if(account){account.hidden=!!user;account.open=!user;}
  try{
    const token=user?await user.getIdTokenResult(true):null;
    if(sessionUid!==(user?.uid||null))return;
    root.dataset.editor=String(token?.claims.companyEditor===true);
    if(accountChanged&&root.dataset.editor==='true')restorePublishFailures();
    status(!companyCloudEnabled?'公司雲端未啟用（本機JSON仍可使用）':!user?'請登入編輯帳戶':root.dataset.editor==='true'?`已登入 ${user.email||user.uid}`:'已登入，但帳戶未獲編輯權限');
    if(companyCloudEnabled&&root.dataset.editor==='true')await list();
  }catch(error){status(error.message);}finally{updateButtons();}
});
window.addEventListener('rail-company-local-load',()=>{
  const data=window.railCompanyEditor.get();
  if(context?.id!==data?.company_id)context=null;
  savedSnapshot=null;savedVersion=null;publishedVersion=null;renderSaveState();
});
