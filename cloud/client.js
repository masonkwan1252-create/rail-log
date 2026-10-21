import {getApps,initializeApp} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js';
import {companyFirebaseConfig,companyCloudRegion,companyCloudEnabled} from './config.js';
export {companyCloudEnabled};
export function cloudApp(){return getApps()[0]||initializeApp(companyFirebaseConfig);}
export async function companyCall(name,data){
  if(!companyCloudEnabled)throw new Error('公司雲端未啟用：請先完成後台部署及編輯權限設定');
  return (await httpsCallable(getFunctions(cloudApp(),companyCloudRegion),name,{timeout:120000})(data)).data;
}
let memory={},cachePromise,cacheLoaded=false;
function openCache(){
  return cachePromise ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('raillog-company-published',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('cache');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function readCompanyCache(){
  if(!companyCloudEnabled)return {};
  if(cacheLoaded)return memory;
  try{
    const db=await openCache();
    memory=await new Promise((resolve,reject)=>{const request=db.transaction('cache').objectStore('cache').get('bundle');request.onsuccess=()=>resolve(request.result||{});request.onerror=()=>reject(request.error);});
  }catch(error){console.warn('Company cache unavailable',error);}
  cacheLoaded=true;
  return memory;
}
async function writeCache(bundle){
  memory=bundle;cacheLoaded=true;
  try{const db=await openCache();await new Promise((resolve,reject)=>{const tx=db.transaction('cache','readwrite');tx.objectStore('cache').put(bundle,'bundle');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  catch(error){console.warn('Company cache not persisted',error);}
}
export function mergeCompanySources(local,bundle){
  const companies=new Map();
  for(const source of local)for(const company of (Array.isArray(source)?source:[source]))if(company?.company_id)companies.set(company.company_id,company);
  for(const [id,entry]of Object.entries(bundle))if(entry?.data?.company_id===id)companies.set(id,entry.data);
  // The existing loader enriches its input; cached source documents must remain immutable.
  return structuredClone([...companies.values()]);
}
export function watchCompanyUpdates(onUpdate,onError=console.warn){
  if(!companyCloudEnabled)return ()=>{};
  let stopped=false,running=false;
  const check=async()=>{
    if(stopped||running||document.hidden)return;
    running=true;
    try{
      const catalog=await companyCall('companyPublic',{}),old=await readCompanyCache(),next={...old};
      let changed=false;
      for(const entry of catalog){
        if(old[entry.id]?.version===entry.version)continue;
        const result=await companyCall('companyPublic',{id:entry.id});
        if(result.id!==entry.id||result.data?.company_id!==entry.id)throw new Error('Invalid published company');
        next[entry.id]={version:result.version,data:result.data};changed=true;
      }
      if(changed&&!stopped){await writeCache(next);await onUpdate();}
    }catch(error){if(!stopped)onError(error);}finally{running=false;}
  };
  check();const timer=setInterval(check,300000);document.addEventListener('visibilitychange',check);
  return ()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',check);};
}
