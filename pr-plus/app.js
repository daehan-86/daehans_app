const DB_NAME = 'overload-db';
const DB_VERSION = 1;
const STORES = { exercises: 'exercises', sessions: 'sessions', settings: 'settings' };

const DEFAULT_EXERCISES = [
  ['벤치프레스','가슴',6,10,2.5], ['인클라인 덤벨프레스','가슴',8,12,2], ['체스트프레스','가슴',8,12,5], ['케이블 플라이','가슴',10,15,2.5],
  ['랫풀다운','등',8,12,5], ['시티드 로우','등',8,12,5], ['바벨 로우','등',6,10,2.5], ['풀업','등',5,10,1],
  ['오버헤드프레스','어깨',6,10,2.5], ['머신 숄더프레스','어깨',8,12,5], ['레터럴 레이즈','어깨',12,20,1], ['리버스 펙덱','어깨',12,20,5],
  ['스쿼트','하체',5,10,2.5], ['레그프레스','하체',8,12,10], ['레그 익스텐션','하체',10,15,5], ['레그 컬','하체',10,15,5], ['루마니안 데드리프트','하체',6,10,2.5],
  ['바벨 컬','이두',8,12,2.5], ['덤벨 컬','이두',8,12,2], ['트라이셉스 푸시다운','삼두',10,15,2.5], ['오버헤드 익스텐션','삼두',10,15,2.5]
].map((x,i)=>({id:`default-${i+1}`, name:x[0], muscle:x[1], repMin:x[2], repMax:x[3], increment:x[4], createdAt:0}));

const state = { view: 'today', db: null, exercises: [], sessions: [], currentSession: null, deferredInstall: null };
const app = document.querySelector('#app');

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORES.exercises)) db.createObjectStore(STORES.exercises, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.sessions)) db.createObjectStore(STORES.sessions, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode='readonly') { return state.db.transaction(store, mode).objectStore(store); }
function getAll(store) { return new Promise((res, rej) => { const r=tx(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function put(store, value) { return new Promise((res, rej) => { const r=tx(store,'readwrite').put(value); r.onsuccess=()=>res(value); r.onerror=()=>rej(r.error); }); }
function del(store, key) { return new Promise((res, rej) => { const r=tx(store,'readwrite').delete(key); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }
function clearStore(store) { return new Promise((res, rej) => { const r=tx(store,'readwrite').clear(); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); }); }

const todayKey = () => new Date().toLocaleDateString('en-CA');
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const formatKg = v => Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
const dayKo = d => ['일','월','화','수','목','금','토'][new Date(d+'T12:00:00').getDay()];

async function seedExercises() {
  const existing = await getAll(STORES.exercises);
  if (!existing.length) await Promise.all(DEFAULT_EXERCISES.map(e => put(STORES.exercises, e)));
}
async function refreshData() {
  state.exercises = (await getAll(STORES.exercises)).sort((a,b)=>a.name.localeCompare(b.name,'ko'));
  state.sessions = (await getAll(STORES.sessions)).sort((a,b)=>b.date.localeCompare(a.date));
  state.currentSession = state.sessions.find(s=>s.date===todayKey()) || null;
}

function sessionVolume(session) {
  return (session?.exercises || []).reduce((sum,e)=> sum + e.sets.reduce((a,s)=>a + (s.done ? num(s.weight)*num(s.reps) : 0),0),0);
}
function hardSets(session) { return (session?.exercises || []).reduce((a,e)=>a+e.sets.filter(s=>s.done).length,0); }
function exerciseById(id) { return state.exercises.find(e=>e.id===id); }
function previousExerciseLog(exerciseId, currentDate=todayKey()) {
  const s = state.sessions.find(x => x.date < currentDate && x.exercises?.some(e=>e.exerciseId===exerciseId && e.sets.some(set=>set.done)));
  return s?.exercises.find(e=>e.exerciseId===exerciseId) || null;
}
function epley(weight,reps) { return reps > 0 ? weight * (1 + reps/30) : 0; }
function bestE1RMForExercise(exerciseId) {
  let best = 0;
  state.sessions.forEach(s => s.exercises?.filter(e=>e.exerciseId===exerciseId).forEach(e=>e.sets.filter(x=>x.done).forEach(x=>best=Math.max(best,epley(num(x.weight),num(x.reps))))));
  return best;
}
function overloadSuggestion(log) {
  const ex = exerciseById(log.exerciseId);
  const done = log.sets.filter(s=>s.done && num(s.reps)>0);
  if (!ex || !done.length) return '세트를 완료하면 다음 운동 목표를 계산해줄게.';
  const allTop = done.length >= 2 && done.every(s=>num(s.reps)>=ex.repMax && num(s.rir)>=1);
  if (allTop) {
    const w = Math.max(...done.map(s=>num(s.weight)));
    return `다음 운동: ${formatKg(w + num(ex.increment || 2.5))}kg로 증량하고 ${ex.repMin}–${ex.repMax}회 범위에서 다시 시작.`;
  }
  const sameWeight = done.every(s=>num(s.weight)===num(done[0].weight));
  if (sameWeight) {
    const target = done.map(s=>Math.min(ex.repMax, num(s.reps)+1)).join(' / ');
    return `다음 운동: ${formatKg(done[0].weight)}kg 유지 · 목표 반복 ${target}.`;
  }
  return `다음 운동: 현재 중량을 유지하며 각 세트에서 총 반복 수를 1회 이상 늘리는 걸 우선.`;
}

function render() {
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  if (state.view==='today') renderToday();
  if (state.view==='history') renderHistory();
  if (state.view==='progress') renderProgress();
  if (state.view==='settings') renderSettings();
}

function renderToday() {
  const s = state.currentSession;
  const date = new Date();
  const dateLabel = `${date.getMonth()+1}월 ${date.getDate()}일 ${['일','월','화','수','목','금','토'][date.getDay()]}요일`;
  let html = `<div class="section-head"><div><h2>오늘의 훈련</h2><p>지난번보다 딱 하나만 더.</p></div><div class="date-chip">${dateLabel}</div></div>`;
  if (!s || !s.exercises.length) {
    html += `<div class="card hero-card"><p class="eyebrow">PROGRESSIVE OVERLOAD</p><div class="hero-value">+1 REP</div><p class="muted small">같은 자세와 RIR을 유지하면서 반복 수 또는 중량을 조금씩 올려가자.</p></div>`;
    html += `<div class="card empty-state"><div class="empty-icon">＋</div><h3>첫 운동을 추가해</h3><p>세트별 중량 · 반복 · RIR을 기록하면 다음 목표를 자동 계산해준다.</p><button class="primary-btn" data-action="add-exercise">운동 추가</button></div>`;
  } else {
    html += `<div class="stats-grid"><div class="stat-card"><span>오늘 완료 세트</span><b>${hardSets(s)}</b></div><div class="stat-card"><span>총 볼륨</span><b>${Math.round(sessionVolume(s)).toLocaleString()}<small> kg</small></b></div></div>`;
    s.exercises.forEach((log,idx)=> html += exerciseCard(log, idx));
    html += `<div class="session-actions"><button class="secondary-btn wide" data-action="add-exercise">＋ 운동 추가</button><button class="primary-btn wide" data-action="finish-session">오늘 운동 완료</button></div>`;
  }
  app.innerHTML = html;
}

function exerciseCard(log, idx) {
  const ex = exerciseById(log.exerciseId) || {name:log.name||'삭제된 운동',muscle:'-',repMin:8,repMax:12};
  const prev = previousExerciseLog(log.exerciseId, state.currentSession?.date || todayKey());
  const prevText = prev ? prev.sets.filter(s=>s.done).map(s=>`${formatKg(s.weight)}×${s.reps}`).join(' · ') : '이전 기록 없음';
  const rows = log.sets.map((set,i)=>`<tr>
    <td class="set-num">${i+1}</td>
    <td><input class="set-input" inputmode="decimal" data-field="weight" data-eidx="${idx}" data-sidx="${i}" value="${esc(set.weight ?? '')}" placeholder="kg"></td>
    <td><input class="set-input" inputmode="numeric" data-field="reps" data-eidx="${idx}" data-sidx="${i}" value="${esc(set.reps ?? '')}" placeholder="회"></td>
    <td><input class="set-input" inputmode="decimal" data-field="rir" data-eidx="${idx}" data-sidx="${i}" value="${esc(set.rir ?? '')}" placeholder="RIR"></td>
    <td><input class="done-check" type="checkbox" data-field="done" data-eidx="${idx}" data-sidx="${i}" ${set.done?'checked':''}></td>
  </tr>`).join('');
  return `<section class="card exercise-card">
    <div class="exercise-head"><div><h3>${esc(ex.name)}</h3><div class="exercise-meta">${esc(ex.muscle)} · ${ex.repMin}–${ex.repMax}회</div></div><button class="menu-btn" data-action="remove-exercise" data-eidx="${idx}" aria-label="운동 삭제">×</button></div>
    <div class="last-performance">지난번 · ${esc(prevText)}</div>
    <table class="set-table"><thead><tr><th>SET</th><th>KG</th><th>REPS</th><th>RIR</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="exercise-actions"><button class="secondary-btn" data-action="add-set" data-eidx="${idx}">＋ 세트</button><button class="ghost-btn" data-action="copy-prev" data-eidx="${idx}">지난 기록 복사</button></div>
    <div class="overload-note">↗ ${esc(overloadSuggestion(log))}</div>
  </section>`;
}

function renderHistory() {
  const sessions = state.sessions.filter(s=>s.exercises?.some(e=>e.sets.some(set=>set.done)));
  app.innerHTML = `<div class="section-head"><div><h2>운동 기록</h2><p>${sessions.length}개의 훈련 세션</p></div></div>` +
    (sessions.length ? `<div class="card">${sessions.map(s=>{
      const d=new Date(s.date+'T12:00:00'); const names=s.exercises.filter(e=>e.sets.some(x=>x.done)).map(e=>exerciseById(e.exerciseId)?.name||e.name).join(', ');
      return `<div class="history-item"><div class="history-date"><b>${d.getDate()}</b><span>${d.getMonth()+1}월 · ${dayKo(s.date)}</span></div><div class="history-main"><strong>${esc(names || '운동')}</strong><small>${hardSets(s)}세트 · ${Math.round(sessionVolume(s)).toLocaleString()}kg</small></div><span class="badge">${s.finishedAt?'완료':'기록'}</span></div>`;
    }).join('')}</div>` : `<div class="card empty-state"><h3>아직 기록이 없어</h3><p>첫 운동을 완료하면 여기에 쌓인다.</p></div>`);
}

function renderProgress() {
  const completed = state.sessions.filter(s=>hardSets(s)>0);
  const last7 = Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); const key=d.toLocaleDateString('en-CA'); const s=completed.find(x=>x.date===key); return {label:['일','월','화','수','목','금','토'][d.getDay()], volume:s?sessionVolume(s):0}; });
  const maxV = Math.max(1,...last7.map(x=>x.volume));
  const muscleSets = {};
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-6);
  completed.filter(s=>new Date(s.date+'T12:00:00')>=cutoff).forEach(s=>s.exercises.forEach(e=>{ const ex=exerciseById(e.exerciseId); if(ex) muscleSets[ex.muscle]=(muscleSets[ex.muscle]||0)+e.sets.filter(x=>x.done).length; }));
  const topExercises = state.exercises.map(ex=>({ex,e1rm:bestE1RMForExercise(ex.id)})).filter(x=>x.e1rm>0).sort((a,b)=>b.e1rm-a.e1rm).slice(0,5);
  app.innerHTML = `<div class="section-head"><div><h2>성장</h2><p>기록이 쌓일수록 더 정확해진다.</p></div></div>
    <div class="card"><p class="eyebrow">LAST 7 DAYS · VOLUME</p><div class="chart">${last7.map(x=>`<div class="chart-col"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(2,(x.volume/maxV)*100)}%"></div></div><div class="chart-label">${x.label}</div></div>`).join('')}</div></div>
    <div class="card"><p class="eyebrow">WEEKLY HARD SETS</p>${Object.keys(muscleSets).length ? Object.entries(muscleSets).sort((a,b)=>b[1]-a[1]).map(([m,v])=>`<div class="progress-row"><div class="progress-row-head"><span>${esc(m)}</span><b>${v}세트</b></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,v/14*100)}%"></div></div></div>`).join('') : `<p class="muted small">최근 7일 완료 세트가 없어.</p>`}</div>
    <div class="card"><p class="eyebrow">ESTIMATED 1RM</p>${topExercises.length ? topExercises.map(x=>`<div class="setting-row"><div><b>${esc(x.ex.name)}</b><p>최고 세트 기반 Epley 추정</p></div><strong>${formatKg(x.e1rm)} kg</strong></div>`).join('') : `<p class="muted small">운동 기록을 입력하면 표시된다.</p>`}</div>`;
}

function renderSettings() {
  const total = state.sessions.length;
  const completed = state.sessions.filter(s=>hardSets(s)>0).length;
  app.innerHTML = `<div class="section-head"><div><h2>설정</h2><p>데이터는 이 기기에 저장된다.</p></div></div>
  <div class="card setting-group"><h3>백업</h3>
    <div class="setting-row"><div><b>JSON 백업 만들기</b><p>운동 종목 · 기록 · 설정 전체 저장</p></div><button class="secondary-btn" data-action="export">내보내기</button></div>
    <div class="setting-row"><div><b>백업 복원</b><p>기존 데이터를 백업 파일 내용으로 교체</p></div><button class="secondary-btn" data-action="import">가져오기</button></div>
  </div>
  <div class="card setting-group"><h3>앱</h3>
    <div class="setting-row"><div><b>아이폰 홈 화면</b><p>PWA로 설치해서 전체 화면 사용</p></div><button class="secondary-btn" data-action="install">설치 안내</button></div>
    <div class="setting-row"><div><b>로컬 데이터</b><p>${state.exercises.length}개 운동 · ${completed}개 완료 세션 (${total}개 저장)</p></div><span class="badge">기기 전용</span></div>
  </div>
  <div class="card setting-group"><h3>위험 구역</h3>
    <div class="setting-row"><div><b>모든 기록 초기화</b><p>운동 기록만 삭제하고 운동 종목은 유지</p></div><button class="danger-btn" data-action="clear-sessions">초기화</button></div>
  </div>
  <p class="muted small">PR+ v1.1 · IndexedDB · Offline PWA</p>`;
}

async function ensureTodaySession() {
  if (state.currentSession) return state.currentSession;
  const s = { id:`session-${todayKey()}`, date:todayKey(), exercises:[], createdAt:Date.now(), updatedAt:Date.now(), finishedAt:null };
  await put(STORES.sessions,s); await refreshData(); return state.currentSession;
}
async function addExercise(exerciseId) {
  const s = await ensureTodaySession();
  if (s.exercises.some(e=>e.exerciseId===exerciseId)) return toast('이미 오늘 추가한 운동이야.');
  const prev = previousExerciseLog(exerciseId, s.date);
  const baseSets = prev?.sets?.filter(x=>x.done).slice(0,3).map(x=>({weight:x.weight,reps:'',rir:'',done:false})) || Array.from({length:3},()=>({weight:'',reps:'',rir:'',done:false}));
  s.exercises.push({exerciseId, sets:baseSets}); s.updatedAt=Date.now();
  await put(STORES.sessions,s); await refreshData(); render(); toast('운동을 추가했어.');
}
async function saveCurrentSession() {
  if (!state.currentSession) return;
  state.currentSession.updatedAt=Date.now(); await put(STORES.sessions,state.currentSession);
}

function showExerciseDialog() {
  const dlg=document.querySelector('#exerciseDialog'); const search=document.querySelector('#exerciseSearch');
  function fill(q='') { document.querySelector('#exerciseList').innerHTML = state.exercises.filter(e=>e.name.toLowerCase().includes(q.toLowerCase())||e.muscle.includes(q)).slice(0,30).map(e=>`<button type="button" class="picker-item" data-pick="${e.id}"><span><b>${esc(e.name)}</b><br><small>${esc(e.muscle)} · ${e.repMin}–${e.repMax}회</small></span><span>＋</span></button>`).join(''); }
  search.value=''; fill(); search.oninput=()=>fill(search.value); dlg.showModal(); setTimeout(()=>search.focus(),150);
}
function showInstall() { document.querySelector('#installDialog').showModal(); }
function confirmAsk(title,message) { return new Promise(resolve=>{ const d=document.querySelector('#confirmDialog'); document.querySelector('#confirmTitle').textContent=title; document.querySelector('#confirmMessage').textContent=message; const ok=document.querySelector('#confirmOk'), cancel=document.querySelector('#confirmCancel'); const finish=v=>{ok.onclick=null;cancel.onclick=null;d.close();resolve(v)}; ok.onclick=()=>finish(true); cancel.onclick=()=>finish(false); d.showModal(); }); }
function toast(msg) { let t=document.querySelector('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)} t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),1800); }

async function exportBackup() {
  const backup = { app:'PR+', version:2, exportedAt:new Date().toISOString(), exercises:await getAll(STORES.exercises), sessions:await getAll(STORES.sessions), settings:await getAll(STORES.settings) };
  const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`pr-plus-backup-${todayKey()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('백업 파일을 만들었어.');
}
async function importBackup(file) {
  let data; try { data=JSON.parse(await file.text()); } catch { return toast('JSON 파일을 읽을 수 없어.'); }
  if (!['PR+','OVERLOAD'].includes(data?.app) || !Array.isArray(data.exercises) || !Array.isArray(data.sessions)) return toast('PR+ 백업 파일이 아니야.');
  if (!await confirmAsk('백업 복원','현재 로컬 데이터가 백업 파일 내용으로 교체돼. 계속할까?')) return;
  await Promise.all([clearStore(STORES.exercises),clearStore(STORES.sessions),clearStore(STORES.settings)]);
  await Promise.all(data.exercises.map(x=>put(STORES.exercises,x))); await Promise.all(data.sessions.map(x=>put(STORES.sessions,x))); await Promise.all((data.settings||[]).map(x=>put(STORES.settings,x)));
  await refreshData(); render(); toast('백업을 복원했어.');
}

app.addEventListener('input', async e=>{
  const el=e.target; if(!el.matches('[data-field]') || !state.currentSession) return;
  const set=state.currentSession.exercises[num(el.dataset.eidx)]?.sets[num(el.dataset.sidx)]; if(!set) return;
  set[el.dataset.field] = el.dataset.field==='done' ? el.checked : el.value;
  await saveCurrentSession();
});
app.addEventListener('change', async e=>{
  if(e.target.matches('[data-field="done"]')) { await refreshData(); renderToday(); }
});
app.addEventListener('click', async e=>{
  const b=e.target.closest('[data-action]'); if(!b) return; const action=b.dataset.action;
  if(action==='add-exercise') showExerciseDialog();
  if(action==='add-set') { const s=state.currentSession.exercises[num(b.dataset.eidx)]; const last=s.sets.at(-1)||{}; s.sets.push({weight:last.weight||'',reps:'',rir:'',done:false}); await saveCurrentSession(); render(); }
  if(action==='copy-prev') { const log=state.currentSession.exercises[num(b.dataset.eidx)]; const prev=previousExerciseLog(log.exerciseId,state.currentSession.date); if(!prev) return toast('복사할 이전 기록이 없어.'); log.sets=prev.sets.filter(x=>x.done).map(x=>({weight:x.weight,reps:x.reps,rir:x.rir,done:false})); await saveCurrentSession(); render(); toast('지난 기록을 불러왔어.'); }
  if(action==='remove-exercise') { if(await confirmAsk('운동 삭제','오늘 세션에서 이 운동과 입력한 세트를 삭제할까?')) { state.currentSession.exercises.splice(num(b.dataset.eidx),1); await saveCurrentSession(); await refreshData(); render(); } }
  if(action==='finish-session') { state.currentSession.finishedAt=Date.now(); await saveCurrentSession(); await refreshData(); render(); toast('오늘 운동 완료.'); }
  if(action==='export') exportBackup();
  if(action==='import') document.querySelector('#importFile').click();
  if(action==='install') showInstall();
  if(action==='clear-sessions') { if(await confirmAsk('모든 기록 초기화','운동 세션 기록을 전부 삭제해. 이 작업은 되돌릴 수 없어. 먼저 백업하는 걸 권장해.')) { await clearStore(STORES.sessions); await refreshData(); render(); toast('운동 기록을 초기화했어.'); } }
});

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render();window.scrollTo({top:0,behavior:'smooth'});}));
document.querySelector('#exerciseList').addEventListener('click',async e=>{ const b=e.target.closest('[data-pick]'); if(!b)return; document.querySelector('#exerciseDialog').close(); await addExercise(b.dataset.pick); });
document.querySelector('#createExerciseBtn').addEventListener('click',async()=>{ const name=document.querySelector('#customExerciseName').value.trim(); const muscle=document.querySelector('#customExerciseMuscle').value; const rr=document.querySelector('#customRepRange').value.trim().match(/(\d+)\s*[-~]\s*(\d+)/); if(!name||!rr)return toast('이름과 반복 범위를 확인해줘.'); const ex={id:uid('exercise'),name,muscle,repMin:num(rr[1]),repMax:num(rr[2]),increment:2.5,createdAt:Date.now()}; await put(STORES.exercises,ex); await refreshData(); document.querySelector('#exerciseDialog').close(); document.querySelector('#customExerciseName').value=''; await addExercise(ex.id); });
document.querySelector('#installBtn').addEventListener('click',showInstall);
document.querySelector('#closeInstallDialog').addEventListener('click',()=>document.querySelector('#installDialog').close());
document.querySelector('#importFile').addEventListener('change',e=>{ if(e.target.files[0]) importBackup(e.target.files[0]); e.target.value=''; });

window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); state.deferredInstall=e; const b=document.querySelector('#nativeInstallBtn'); b.classList.remove('hidden'); b.onclick=async()=>{ await state.deferredInstall.prompt(); state.deferredInstall=null; document.querySelector('#installDialog').close(); }; });
window.addEventListener('appinstalled',()=>toast('PR+ 설치 완료.'));

if ('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(console.error));

(async function init(){
  try { state.db=await openDB(); await seedExercises(); await refreshData(); render(); }
  catch(err) { console.error(err); app.innerHTML='<div class="card"><h2>저장소를 열 수 없어</h2><p class="muted">브라우저의 사이트 데이터/개인정보 보호 설정을 확인해줘.</p></div>'; }
})();
