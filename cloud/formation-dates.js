export function parseBuildDate(value) {
  let text=String(value||'').trim();
  text=text.replace(/^(\d{2})(?=[\/-]|$)/,(_,year)=>(Number(year)>=50?'19':'20')+year);
  const parts=text.match(/^(\d{4})[\/-](\d{1,2})(?:[\/-](\d{1,2}))?$/);
  if(parts)text=`${parts[1]}-${parts[2].padStart(2,'0')}${parts[3]?'-'+parts[3].padStart(2,'0'):''}`;
  if(!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text))return null;
  const year=Number(text.slice(0,4));if(year<1800||year>2999)return null;
  const precision=text.length===4?'year':text.length===7?'month':'day';
  const start=precision==='year'?`${text}-01-01`:precision==='month'?`${text}-01`:text;
  const stamp=Date.parse(`${start}T00:00:00Z`);
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==start)return null;
  const end=precision==='year'?Date.UTC(year,11,31):precision==='month'?Date.UTC(year,Number(text.slice(5,7)),0):stamp;
  return {text,start:stamp,end,precision,approximate:precision!=='day'};
}
export function formationNames(train,subseries='') {
  return [...new Set((subseries?train?.formations_by_subseries?.[subseries]:train?.formations)||[])];
}
export function parseFourGousya(text) {
  const blocks=[];let current=null;
  for(const line of String(text).normalize('NFKC').split(/\r?\n/)){
    const match=line.trim().match(/^([A-Za-z0-9][A-Za-z0-9_-]*(?:F|編成))(?=\s|\d{2}\/|$)/);
    if(match){current={formation:match[1],raw:line};blocks.push(current);}
    else if(current)current.raw+='\n'+line;
  }
  const seen=new Set();
  return blocks.map(row=>{
    const matches=[...row.raw.matchAll(/全車新製\s*(\d{2,4}[\/-]\d{1,2}(?:[\/-]\d{1,2})?)/g)];
    // Numeric formations identify the first vehicle independently of later conversion dates.
    const vehicle=/^(\d+)F$/.exec(row.formation)?.[1];
    const firstCar=vehicle?new RegExp(`(?:^|[\\s|])${vehicle}[\\s\\u25a0\\u25a1]*[\\r\\n\\t ]+(\\d{2,4}[/-]\\d{1,2}[/-]\\d{1,2})(?=\\s|[|]|$)`).exec(row.raw):null;
    const firstCarSource=matches.length===0&&!!firstCar;
    const rawDate=matches.length===1?matches[0][1]:firstCarSource?firstCar[1]:'';
    const short=/^\d{2}\//.test(rawDate)||/^\d{2}-/.test(rawDate);
    const candidate=rawDate;
    const parsed=parseBuildDate(candidate);
    let reason=!parsed?'全車新製日期未能確認':'';
    if(matches.length>1||(!firstCarSource&&/改造|組成変更|一部新製/.test(row.raw)))reason='涉及多個日期／改造，請核對新製資料';
    if(seen.has(row.formation))reason='重複編成，請核對';
    seen.add(row.formation);
    return {...row,built:parsed?.text||'',reason,centuryOnly:short&&!reason,dateBasis:firstCarSource?'first_vehicle':'whole_formation'};
  });
}
export function previewBuildDates(train,subseries,text,defaultDate='',allowNew=false) {
  const known=new Set(formationNames(train,subseries)),seen=new Set(),changes=[],errors=[];
  String(text).split(/\r?\n/).forEach((line,index)=>{
    if(!line.trim())return;
    const parts=line.split('\t').map(value=>value.trim());
    const formation=parts[0];
    const existing=(train.formation_build_dates||[]).find(row=>row.formation===formation&&(row.subseries||'')===subseries);
    const built=parts[1]||(existing?.built?'':defaultDate.trim());
    if(parts.length>2){errors.push(`第 ${index+1} 行：只接受編成、出廠日期兩欄`);return;}
    if(!formation||(!allowNew&&!known.has(formation))){errors.push(`第 ${index+1} 行：找不到 ${formation}，請先登記編成或選擇正確番台`);return;}
    if(seen.has(formation)){errors.push(`第 ${index+1} 行：${formation} 重複`);return;}
    seen.add(formation);
    if(!built){if(allowNew&&!known.has(formation))changes.push({formation,subseries,built:''});return;}
    if(built!=='-'&&!parseBuildDate(built)){errors.push(`第 ${index+1} 行：${formation} 日期無效`);return;}
    changes.push({formation,subseries,built:built==='-'?built:parseBuildDate(built).text});
  });
  return {changes,errors};
}
export function applyBuildDates(train,changes) {
  const rows=Array.isArray(train.formation_build_dates)?train.formation_build_dates:[];
  const keys=new Set(changes.map(row=>JSON.stringify([row.subseries,row.formation])));
  const next=rows.filter(row=>!keys.has(JSON.stringify([row.subseries||'',row.formation])));
  next.push(...changes.filter(row=>row.built&&row.built!=='-').map(row=>({...rows.find(old=>old.formation===row.formation&&(old.subseries||'')===(row.subseries||'')),...row})));
  if(next.length)train.formation_build_dates=next;else delete train.formation_build_dates;
}
export function formationRange(from,to) {
  const a=String(from).trim().match(/^(.*?)(\d+)$/),b=String(to).trim().match(/^(.*?)(\d+)$/);
  if(!a||!b||a[1]!==b[1])throw new Error('起止編成需使用相同前綴，例如 N1 至 N100');
  const start=Number(a[2]),end=Number(b[2]);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||end-start>=5000)throw new Error('範圍需由小至大，每批最多 5000 個');
  const width=a[2].startsWith('0')?a[2].length:0;
  return Array.from({length:end-start+1},(_,i)=>a[1]+String(start+i).padStart(width,'0'));
}
export function tripFormationAge(trip,train) {
  const formation=String(trip.train_formation||'').trim();
  const ride=parseBuildDate(trip.date);
  if(!formation||!ride||ride.approximate)return null;
  const rows=(Array.isArray(train?.formation_build_dates)?train.formation_build_dates:[]).filter(row=>row&&row.formation===formation);
  let subseries=trip.train_subseries||'';
  if(!subseries){
    const groups=Object.entries(train?.formations_by_subseries||{}).filter(([,ids])=>Array.isArray(ids)&&ids.includes(formation));
    if(groups.length>1)return null;
    if(groups.length===1)subseries=groups[0][0];
  }
  let matches=rows.filter(row=>(row.subseries||'')===subseries);
  if(!matches.length&&subseries)matches=rows.filter(row=>!row.subseries);
  if(matches.length!==1)return null;
  const build=parseBuildDate(matches[0].built);
  if(!build||build.start>ride.start)return null;
  const minimum=Math.max(0,(ride.start-build.end)/86400000),maximum=(ride.start-build.start)/86400000;
  return {formation,subseries,built:build.text,date:trip.date,precision:build.precision,approximate:build.approximate,minDays:minimum,maxDays:maximum,days:(minimum+maximum)/2};
}
