import {
  APP_VERSION, RELEASE_ID, DATA_SCHEMA_VERSION, DB_NAME, DB_VERSION, STORES, DEFAULT_EXERCISES,
  createDefaultRoutines, findDefaultExercise, migrateBackupToLatest, muscleLabel,
  normalizeExercise, normalizeRoutine, normalizeSession
} from './data.mjs';

const state = {
  view: 'today', db: null, exercises: [], routines: [], sessions: [], currentSession: null,
  deferredInstall: null, exerciseDialogMode: 'session', exerciseDialogRoutineId: null,
  editRoutineId: null, expandedSessionId: null, libraryQuery: '', libraryFilter: 'all',
  swRegistration: null, waitingWorker: null, updateStatus: 'idle', updateMessage: '',
  latestRelease: null, applyingUpdate: false, lastUpdateCheck: 0
};
const app = document.querySelector('#app');

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (event.oldVersion < 1) {
        db.createObjectStore(STORES.exercises, { keyPath: 'id' });
        db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
      if (event.oldVersion < 2 && !db.objectStoreNames.contains(STORES.routines)) {
        db.createObjectStore(STORES.routines, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 PR+ 창이 데이터베이스 업데이트를 막고 있어.'));
  });
}

function objectStore(store, mode = 'readonly') {
  return state.db.transaction(store, mode).objectStore(store);
}
function getAll(store) {
  return new Promise((resolve, reject) => {
    const request = objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function put(store, value) {
  return new Promise((resolve, reject) => {
    const request = objectStore(store, 'readwrite').put(value);
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}
function clearStore(store) {
  return new Promise((resolve, reject) => {
    const request = objectStore(store, 'readwrite').clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('데이터 저장 transaction이 취소됐어.'));
  });
}
async function writeMigratedRecords(data) {
  const transaction = state.db.transaction(Object.values(STORES), 'readwrite');
  data.exercises.forEach(record => transaction.objectStore(STORES.exercises).put(record));
  data.routines.forEach(record => transaction.objectStore(STORES.routines).put(record));
  data.sessions.forEach(record => transaction.objectStore(STORES.sessions).put(record));
  data.settings.forEach(record => transaction.objectStore(STORES.settings).put(record));
  await transactionComplete(transaction);
}
async function replaceAllData(data) {
  const transaction = state.db.transaction(Object.values(STORES), 'readwrite');
  Object.values(STORES).forEach(store => transaction.objectStore(store).clear());
  data.exercises.forEach(record => transaction.objectStore(STORES.exercises).put(record));
  data.routines.forEach(record => transaction.objectStore(STORES.routines).put(record));
  data.sessions.forEach(record => transaction.objectStore(STORES.sessions).put(record));
  data.settings.forEach(record => transaction.objectStore(STORES.settings).put(record));
  await transactionComplete(transaction);
}

const todayKey = () => new Date().toLocaleDateString('en-CA');
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatKg = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dayKo = date => ['일', '월', '화', '수', '목', '금', '토'][new Date(`${date}T12:00:00`).getDay()];
const exerciseById = id => state.exercises.find(exercise => exercise.id === id);
const routineById = id => state.routines.find(routine => routine.id === id);

function exerciseSearchText(exercise) {
  return `${exercise.name} ${exercise.displayName || ''} ${muscleLabel(exercise.muscleGroup)}`.toLowerCase();
}
function exerciseSubtitle(exercise) {
  const display = exercise.displayName ? `${exercise.displayName} · ` : '';
  return `${display}${muscleLabel(exercise.muscleGroup)}`;
}
function exerciseNameFromLog(log) {
  return exerciseById(log.exerciseId)?.name || log.name || '삭제된 운동';
}

async function migrateStoredData() {
  const [exercises, routines, sessions, settings] = await Promise.all([
    getAll(STORES.exercises), getAll(STORES.routines), getAll(STORES.sessions), getAll(STORES.settings)
  ]);
  const schemaSetting = settings.find(setting => setting.key === 'schemaVersion');
  const schemaVersion = Number(schemaSetting?.value || 2);
  if (schemaVersion > DATA_SCHEMA_VERSION) throw new Error(`이 앱보다 새로운 데이터 schema v${schemaVersion}이 저장되어 있어.`);
  if (schemaVersion === DATA_SCHEMA_VERSION) return;
  const migrated = migrateBackupToLatest({ app: 'PR+', schemaVersion, exercises, routines, sessions, settings });
  await writeMigratedRecords(migrated);
}

async function seedDefaults() {
  const exercises = (await getAll(STORES.exercises)).map(normalizeExercise);
  const missingExercises = DEFAULT_EXERCISES.filter(definition =>
    !exercises.some(exercise => exercise.name.toLowerCase() === definition.name.toLowerCase())
  );
  exercises.push(...missingExercises);
  const routines = await getAll(STORES.routines);
  const missingRoutines = createDefaultRoutines(exercises).filter(routine =>
    !routines.some(existing => existing.id === routine.id)
  );
  const transaction = state.db.transaction([STORES.exercises, STORES.routines, STORES.settings], 'readwrite');
  missingExercises.forEach(exercise => transaction.objectStore(STORES.exercises).put(exercise));
  missingRoutines.forEach(routine => transaction.objectStore(STORES.routines).put(routine));
  transaction.objectStore(STORES.settings).put({ key: 'schemaVersion', value: DATA_SCHEMA_VERSION });
  await transactionComplete(transaction);
}

async function refreshData() {
  const [exercises, routines, sessions] = await Promise.all([
    getAll(STORES.exercises), getAll(STORES.routines), getAll(STORES.sessions)
  ]);
  state.exercises = exercises.map(normalizeExercise).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  state.routines = routines.map(normalizeRoutine).sort((a, b) => num(a.order) - num(b.order) || a.name.localeCompare(b.name));
  state.sessions = sessions.map(normalizeSession).sort((a, b) => b.date.localeCompare(a.date) || num(b.updatedAt) - num(a.updatedAt));
  state.currentSession = state.sessions.find(session => session.date === todayKey()) || null;
}

function isWarmupLog(log) {
  return log.type === 'warmup' || exerciseById(log.exerciseId)?.type === 'warmup';
}
function sessionVolume(session) {
  return (session?.exercises || []).reduce((total, log) => total + log.sets.reduce((sum, set) =>
    sum + (set.done ? num(set.weight) * num(set.reps) : 0), 0), 0);
}
function hardSets(session) {
  return (session?.exercises || []).reduce((total, log) =>
    total + (isWarmupLog(log) ? 0 : log.sets.filter(set => set.done).length), 0);
}
function routineWorkingSets(routine) {
  return routine.items.reduce((total, item) => total + (item.type === 'warmup' ? 0 : num(item.targetSets)), 0);
}
function previousExerciseLog(exerciseId, currentDate = todayKey()) {
  const session = state.sessions.find(candidate => candidate.date < currentDate && candidate.exercises?.some(log =>
    log.exerciseId === exerciseId && log.sets.some(set => set.done)
  ));
  return session?.exercises.find(log => log.exerciseId === exerciseId) || null;
}
function epley(weight, reps) { return reps > 0 ? weight * (1 + reps / 30) : 0; }
function bestE1RMForExercise(exerciseId) {
  let best = 0;
  state.sessions.forEach(session => session.exercises?.filter(log => log.exerciseId === exerciseId).forEach(log =>
    log.sets.filter(set => set.done).forEach(set => { best = Math.max(best, epley(num(set.weight), num(set.reps))); })
  ));
  return best;
}

function render() {
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
  if (state.view === 'today') renderToday();
  if (state.view === 'routines') renderRoutines();
  if (state.view === 'history') renderHistory();
  if (state.view === 'library') renderLibrary();
  if (state.view === 'settings') renderSettings();
  syncUpdateUI();
}

function routineStartCard(routine) {
  const names = routine.items.slice(0, 3).map(item => exerciseById(item.exerciseId)?.name).filter(Boolean).join(' · ');
  return `<article class="routine-start-card">
    <div><p class="eyebrow">${esc(routine.name)}</p><h3>${esc(routine.displayName || routine.name)}</h3></div>
    <p>${routine.items.length}개 운동 · ${routineWorkingSets(routine)} working sets</p>
    <small>${esc(names)}${routine.items.length > 3 ? ' 외' : ''}</small>
    <button class="primary-btn wide" data-action="start-routine" data-routine-id="${esc(routine.id)}">운동 시작</button>
  </article>`;
}

function renderToday() {
  const session = state.currentSession;
  const date = new Date();
  const dateLabel = `${date.getMonth() + 1}월 ${date.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][date.getDay()]}요일`;
  let html = `<div class="section-head"><div><h2>오늘의 훈련</h2><p>이번 기록이 다음 발전의 기준이 된다.</p></div><div class="date-chip">${dateLabel}</div></div>`;
  if (!session || !session.exercises.length) {
    html += `<div class="card hero-card"><p class="eyebrow">PR+ 0.1 · BASELINE</p><div class="hero-value">START TRUE.</div><p class="muted small">추천 중량 없이 실제 수행 중량 · 반복 · RIR을 그대로 기록해.</p></div>`;
    html += `<div class="routine-start-grid">${state.routines.map(routineStartCard).join('')}</div>`;
    html += `<button class="secondary-btn wide manual-start" data-action="add-exercise">루틴 없이 운동 추가</button>`;
  } else {
    const routineLabel = session.routineName ? `<span class="badge pr-badge">${esc(session.routineName)}</span>` : '';
    html += `<div class="session-title-row">${routineLabel}${session.finishedAt ? '<span class="badge">완료됨</span>' : '<span class="badge">기록 중</span>'}</div>`;
    html += `<div class="stats-grid"><div class="stat-card"><span>오늘 완료 세트</span><b>${hardSets(session)}</b></div><div class="stat-card"><span>총 볼륨</span><b>${Math.round(sessionVolume(session)).toLocaleString()}<small> kg</small></b></div></div>`;
    html += `<div class="baseline-banner"><b>Baseline 기록</b><span>중량은 추천값이 아니라 오늘 실제 수행값을 입력해.</span></div>`;
    session.exercises.forEach((log, index) => { html += exerciseCard(log, index); });
    html += `<div class="session-actions"><button class="secondary-btn wide" data-action="add-exercise">＋ 운동 추가</button><button class="primary-btn wide" data-action="finish-session">오늘 운동 완료</button></div>`;
  }
  app.innerHTML = html;
}

function exerciseCard(log, exerciseIndex) {
  const exercise = exerciseById(log.exerciseId) || {
    name: log.name || '삭제된 운동', displayName: log.displayName || '', muscleGroup: log.muscleGroup || 'other', repMin: 8, repMax: 12
  };
  const repMin = num(log.repMin ?? exercise.repMin);
  const repMax = num(log.repMax ?? exercise.repMax);
  const previous = previousExerciseLog(log.exerciseId, state.currentSession?.date || todayKey());
  const previousText = previous
    ? previous.sets.filter(set => set.done).map(set => `${formatKg(set.weight)}×${set.reps}${set.rir !== '' ? ` @${set.rir}` : ''}`).join(' · ')
    : '첫 기록 · 오늘 기록이 baseline이 돼';
  if (isWarmupLog(log)) {
    const done = Boolean(log.sets[0]?.done);
    return `<section class="card exercise-card warmup-card">
      <div class="exercise-head"><div><p class="eyebrow">WARMUP / STRETCH</p><h3>${esc(exercise.name)}</h3><div class="exercise-meta">${esc(exercise.displayName || '')}</div></div><button class="menu-btn" data-action="remove-exercise" data-eidx="${exerciseIndex}" aria-label="운동 삭제">×</button></div>
      <label class="warmup-check"><span>준비운동 완료</span><input class="done-check" type="checkbox" data-field="done" data-eidx="${exerciseIndex}" data-sidx="0" ${done ? 'checked' : ''}></label>
    </section>`;
  }
  const rows = log.sets.map((set, setIndex) => `<tr>
    <td class="set-num">${setIndex + 1}</td>
    <td><input class="set-input" inputmode="decimal" data-field="weight" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.weight ?? '')}" placeholder="kg" aria-label="${setIndex + 1}세트 중량"></td>
    <td><input class="set-input" inputmode="numeric" data-field="reps" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.reps ?? '')}" placeholder="회" aria-label="${setIndex + 1}세트 반복수"></td>
    <td><input class="set-input" inputmode="decimal" data-field="rir" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.rir ?? '')}" placeholder="RIR" aria-label="${setIndex + 1}세트 RIR"></td>
    <td><input class="done-check" type="checkbox" data-field="done" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" ${set.done ? 'checked' : ''} aria-label="${setIndex + 1}세트 완료"></td>
  </tr>`).join('');
  return `<section class="card exercise-card">
    <div class="exercise-head"><div><h3>${esc(exercise.name)}</h3><div class="exercise-display-name">${esc(exercise.displayName || '')}</div><div class="exercise-meta">${esc(muscleLabel(exercise.muscleGroup))} · 목표 ${repMin}–${repMax}회${log.optional ? ' · 선택' : ''}</div></div><button class="menu-btn" data-action="remove-exercise" data-eidx="${exerciseIndex}" aria-label="운동 삭제">×</button></div>
    <div class="last-performance">지난 기록 · ${esc(previousText)}</div>
    <table class="set-table"><thead><tr><th>SET</th><th>KG</th><th>REPS</th><th>RIR</th><th>✓</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="exercise-actions"><button class="secondary-btn" data-action="add-set" data-eidx="${exerciseIndex}">＋ 세트</button><button class="ghost-btn" data-action="copy-prev" data-eidx="${exerciseIndex}">지난 기록 복사</button></div>
    <div class="baseline-note">${previous ? '지난 기록을 참고하되 오늘 실제 수행값을 기록해.' : '첫 완료 기록이 다음 세션 비교 기준으로 저장돼.'}</div>
  </section>`;
}

function renderRoutines() {
  app.innerHTML = `<div class="section-head"><div><h2>운동 루틴</h2><p>운동 순서와 목표 세트 · 반복 범위를 관리해.</p></div></div><div class="routine-list">${state.routines.map(routineCard).join('')}</div>`;
}
function routineCard(routine) {
  const editing = state.editRoutineId === routine.id;
  const routineId = esc(routine.id);
  const items = routine.items.map((item, index) => {
    const exercise = exerciseById(item.exerciseId) || { name: '삭제된 운동', displayName: '' };
    const controls = item.type === 'warmup' ? '<span class="badge">준비운동</span>' : `<div class="routine-targets">
      <label>세트<input type="number" min="1" max="12" inputmode="numeric" data-routine-field="targetSets" data-routine-id="${routineId}" data-item-index="${index}" value="${item.targetSets}"></label>
      <label>최소<input type="number" min="1" max="50" inputmode="numeric" data-routine-field="repMin" data-routine-id="${routineId}" data-item-index="${index}" value="${item.repMin}"></label>
      <label>최대<input type="number" min="1" max="50" inputmode="numeric" data-routine-field="repMax" data-routine-id="${routineId}" data-item-index="${index}" value="${item.repMax}"></label>
    </div>`;
    return `<div class="routine-item ${editing ? 'editing' : ''}">
      ${editing ? `<div class="routine-order"><button data-action="move-routine-item" data-direction="up" data-routine-id="${routineId}" data-item-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="위로 이동">↑</button><button data-action="move-routine-item" data-direction="down" data-routine-id="${routineId}" data-item-index="${index}" ${index === routine.items.length - 1 ? 'disabled' : ''} aria-label="아래로 이동">↓</button></div>` : ''}
      <div class="routine-item-main"><b>${esc(exercise.name)}</b><small>${esc(exercise.displayName || '')}${item.optional ? ' · 선택 운동' : ''}</small>${editing ? controls : `<span>${item.type === 'warmup' ? 'Warmup / Stretch' : `${item.targetSets}세트 · ${item.repMin}–${item.repMax}회`}</span>`}</div>
      ${editing ? `<button class="remove-item-btn" data-action="remove-routine-item" data-routine-id="${routineId}" data-item-index="${index}" aria-label="루틴에서 제거">×</button>` : ''}
    </div>`;
  }).join('');
  return `<section class="card routine-card">
    <div class="routine-card-head"><div><p class="eyebrow">${esc(routine.name)}</p><h3>${esc(routine.displayName || routine.name)}</h3><span>${routine.items.length}개 운동 · ${routineWorkingSets(routine)} working sets</span></div><button class="secondary-btn compact-btn" data-action="edit-routine" data-routine-id="${routineId}">${editing ? '완료' : '편집'}</button></div>
    <div class="routine-items">${items}</div>
    <div class="routine-card-actions"><button class="secondary-btn" data-action="add-routine-exercise" data-routine-id="${routineId}">＋ 운동 추가</button><button class="primary-btn" data-action="start-routine" data-routine-id="${routineId}">시작</button></div>
  </section>`;
}

function renderHistory() {
  const sessions = state.sessions.filter(session => session.exercises?.some(log => log.sets.some(set => set.done)));
  app.innerHTML = `<div class="section-head"><div><h2>운동 기록</h2><p>${sessions.length}개의 훈련 세션</p></div></div>` +
    (sessions.length ? `<div class="card history-card">${sessions.map(historyItem).join('')}</div>` : '<div class="card empty-state"><h3>아직 기록이 없어</h3><p>첫 운동을 완료하면 여기에 쌓인다.</p></div>') + progressMarkup();
}
function historyItem(session) {
  const date = new Date(`${session.date}T12:00:00`);
  const completedLogs = session.exercises.filter(log => log.sets.some(set => set.done));
  const names = completedLogs.map(exerciseNameFromLog).join(', ');
  const expanded = state.expandedSessionId === session.id;
  const detail = expanded ? `<div class="history-detail">${completedLogs.map(log => {
    const sets = log.sets.filter(set => set.done).map(set => isWarmupLog(log) ? '완료' : `${formatKg(set.weight)}kg × ${set.reps}${set.rir !== '' ? ` @${set.rir}` : ''}`).join(' · ');
    return `<div><b>${esc(exerciseNameFromLog(log))}</b><span>${esc(sets)}</span></div>`;
  }).join('')}</div>` : '';
  return `<div class="history-entry"><button class="history-item" data-action="toggle-history" data-session-id="${esc(session.id)}"><span class="history-date"><b>${date.getDate()}</b><span>${date.getMonth() + 1}월 · ${dayKo(session.date)}</span></span><span class="history-main"><strong>${esc(session.routineName || names || '운동')}</strong><small>${hardSets(session)}세트 · ${Math.round(sessionVolume(session)).toLocaleString()}kg</small></span><span class="badge">${session.finishedAt ? '완료' : '기록'}</span></button>${detail}</div>`;
}
function progressMarkup() {
  const completed = state.sessions.filter(session => hardSets(session) > 0);
  const last7 = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (6 - index));
    const key = date.toLocaleDateString('en-CA');
    return { label: ['일', '월', '화', '수', '목', '금', '토'][date.getDay()], volume: completed.filter(session => session.date === key).reduce((sum, session) => sum + sessionVolume(session), 0) };
  });
  const maxVolume = Math.max(1, ...last7.map(item => item.volume));
  const muscleSets = {};
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6);
  completed.filter(session => new Date(`${session.date}T12:00:00`) >= cutoff).forEach(session => session.exercises.forEach(log => {
    const exercise = exerciseById(log.exerciseId);
    if (exercise && !isWarmupLog(log)) muscleSets[exercise.muscleGroup] = (muscleSets[exercise.muscleGroup] || 0) + log.sets.filter(set => set.done).length;
  }));
  const topExercises = state.exercises.map(exercise => ({ exercise, e1rm: bestE1RMForExercise(exercise.id) })).filter(item => item.e1rm > 0).sort((a, b) => b.e1rm - a.e1rm).slice(0, 5);
  return `<div class="subsection-head"><h3>최근 성장 지표</h3><p>Baseline 기록이 쌓이면 변화가 보이기 시작해.</p></div>
    <div class="card"><p class="eyebrow">LAST 7 DAYS · VOLUME</p><div class="chart">${last7.map(item => `<div class="chart-col"><div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(2, item.volume / maxVolume * 100)}%"></div></div><div class="chart-label">${item.label}</div></div>`).join('')}</div></div>
    <div class="card"><p class="eyebrow">WEEKLY HARD SETS</p>${Object.keys(muscleSets).length ? Object.entries(muscleSets).sort((a, b) => b[1] - a[1]).map(([muscle, value]) => `<div class="progress-row"><div class="progress-row-head"><span>${esc(muscleLabel(muscle))}</span><b>${value}세트</b></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, value / 14 * 100)}%"></div></div></div>`).join('') : '<p class="muted small">최근 7일 완료 세트가 없어.</p>'}</div>
    <div class="card"><p class="eyebrow">ESTIMATED 1RM</p>${topExercises.length ? topExercises.map(item => `<div class="setting-row"><div><b>${esc(item.exercise.name)}</b><p>최고 세트 기반 Epley 추정</p></div><strong>${formatKg(item.e1rm)} kg</strong></div>`).join('') : '<p class="muted small">운동 기록을 입력하면 표시된다.</p>'}</div>`;
}

function renderLibrary() {
  app.innerHTML = `<div class="section-head"><div><h2>Exercise Library</h2><p>운동 목록과 루틴은 서로 독립적으로 관리돼.</p></div><button class="primary-btn compact-btn" data-action="create-library-exercise">＋ 추가</button></div>
    <input id="librarySearch" class="text-input library-search" type="search" value="${esc(state.libraryQuery)}" placeholder="운동 이름 검색" autocomplete="off">
    <div class="filter-chips" aria-label="부위 필터">${[['all', 'All'], ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['legs', 'Legs'], ['arms', 'Arms'], ['other', 'Other']].map(([key, label]) => `<button class="filter-chip ${state.libraryFilter === key ? 'active' : ''}" data-action="filter-library" data-filter="${key}">${label}</button>`).join('')}</div>
    <div id="libraryList" class="library-list"></div>`;
  renderLibraryList();
}
function renderLibraryList() {
  const list = document.querySelector('#libraryList');
  if (!list) return;
  const query = state.libraryQuery.trim().toLowerCase();
  const filtered = state.exercises.filter(exercise => {
    const filterMatch = state.libraryFilter === 'all' || exercise.muscleGroup === state.libraryFilter ||
      (state.libraryFilter === 'arms' && ['biceps', 'triceps'].includes(exercise.muscleGroup)) ||
      (state.libraryFilter === 'other' && ['core', 'other'].includes(exercise.muscleGroup));
    return filterMatch && (!query || exerciseSearchText(exercise).includes(query));
  });
  list.innerHTML = filtered.length ? filtered.map(exercise => `<article class="library-item"><div class="library-item-main"><b>${esc(exercise.name)}</b><span>${esc(exerciseSubtitle(exercise))}</span>${exercise.type === 'warmup' ? '<small>Warmup / Mobility</small>' : ''}</div><div class="library-add-row"><select class="mini-select" aria-label="추가할 루틴">${state.routines.map(routine => `<option value="${esc(routine.id)}">${esc(routine.name)}</option>`).join('')}</select><button class="secondary-btn compact-btn" data-action="add-library-to-routine" data-exercise-id="${esc(exercise.id)}">루틴에 추가</button></div></article>`).join('') : '<div class="card empty-state"><h3>검색 결과가 없어</h3><p>새 운동을 직접 추가할 수 있어.</p></div>';
}

function renderSettings() {
  const completed = state.sessions.filter(session => hardSets(session) > 0).length;
  const updateAvailable = state.updateStatus === 'available';
  const updateAction = updateAvailable ? 'apply-update' : 'check-update';
  const updateButton = updateAvailable ? '업데이트' : state.updateStatus === 'checking' || state.updateStatus === 'downloading' ? '확인 중…' : '업데이트 확인';
  const updateDisabled = ['checking', 'downloading', 'applying'].includes(state.updateStatus) ? 'disabled' : '';
  app.innerHTML = `<div class="section-head"><div><h2>설정</h2><p>데이터는 이 기기에 저장된다.</p></div></div>
    <div class="card setting-group"><h3>백업</h3><div class="setting-row"><div><b>JSON 백업 만들기</b><p>운동 · 루틴 · 세션 · 설정 전체 저장</p></div><button class="secondary-btn" data-action="export">내보내기</button></div><div class="setting-row"><div><b>백업 복원</b><p>구버전 데이터도 순서대로 변환 후 복원</p></div><button class="secondary-btn" data-action="import">가져오기</button></div></div>
    <div class="card setting-group"><h3>업데이트</h3><div class="setting-row"><div><b>${esc(updateStatusTitle())}</b><p>${esc(updateStatusMessage())}</p></div><button class="${updateAvailable ? 'primary-btn' : 'secondary-btn'} compact-btn" data-action="${updateAction}" ${updateDisabled}>${updateButton}</button></div><div class="setting-row"><div><b>현재 앱 버전</b><p>릴리스 ${esc(RELEASE_ID)} · 기록은 업데이트 후에도 유지</p></div><span class="badge">v${esc(APP_VERSION)}</span></div></div>
    <div class="card setting-group"><h3>앱</h3><div class="setting-row"><div><b>아이폰 홈 화면</b><p>PWA로 설치해서 전체 화면 사용</p></div><button class="secondary-btn" data-action="install">설치 안내</button></div><div class="setting-row"><div><b>로컬 데이터</b><p>${state.exercises.length}개 운동 · ${state.routines.length}개 루틴 · ${completed}개 완료 세션</p></div><span class="badge">기기 전용</span></div><div class="setting-row"><div><b>데이터 schema</b><p>순차 migration 지원</p></div><span class="badge">v${DATA_SCHEMA_VERSION}</span></div></div>
    <div class="card setting-group"><h3>위험 구역</h3><div class="setting-row"><div><b>모든 기록 초기화</b><p>운동 세션만 삭제하고 운동과 루틴은 유지</p></div><button class="danger-btn" data-action="clear-sessions">초기화</button></div></div>
    <p class="muted small">PR+ v${APP_VERSION} · IndexedDB · Offline PWA</p>`;
}

function updateStatusTitle() {
  if (state.updateStatus === 'checking') return '업데이트 확인 중';
  if (state.updateStatus === 'downloading') return '새 버전 받는 중';
  if (state.updateStatus === 'available') return state.latestRelease?.appVersion && state.latestRelease.appVersion !== APP_VERSION
    ? `PR+ v${state.latestRelease.appVersion} 준비 완료` : '새 업데이트 준비 완료';
  if (state.updateStatus === 'applying') return '업데이트 적용 중';
  if (state.updateStatus === 'current') return '최신 버전 사용 중';
  if (state.updateStatus === 'offline') return '오프라인 상태';
  if (state.updateStatus === 'unsupported') return '자동 업데이트 미지원';
  if (state.updateStatus === 'error') return '업데이트 확인 실패';
  return '앱 업데이트';
}
function updateStatusMessage() {
  if (state.updateMessage) return state.updateMessage;
  if (state.updateStatus === 'available') return '버튼을 누르면 앱이 한 번 다시 열려. 저장된 기록은 유지돼.';
  if (state.updateStatus === 'applying') return '새 파일로 전환하고 있어. 잠시만 기다려줘.';
  if (state.updateStatus === 'current') return `PR+ v${APP_VERSION}이 최신 상태야.`;
  if (state.updateStatus === 'checking') return '배포 사이트에서 최신 릴리스를 확인하고 있어.';
  if (state.updateStatus === 'downloading') return '새 앱 파일을 안전하게 내려받고 있어.';
  if (state.updateStatus === 'offline') return '인터넷에 연결한 뒤 다시 확인해줘.';
  if (state.updateStatus === 'unsupported') return 'Safari에서 사이트를 다시 열어 최신 버전을 받아줘.';
  if (state.updateStatus === 'error') return '잠시 뒤 사이트에 연결해서 다시 시도해줘.';
  return '사이트에 배포된 새 버전이 있는지 확인할 수 있어.';
}
function syncUpdateUI() {
  const versionButton = document.querySelector('#versionBtn');
  const banner = document.querySelector('#updateBanner');
  if (versionButton) {
    versionButton.textContent = state.updateStatus === 'available' ? '업데이트' : `v${APP_VERSION}`;
    versionButton.classList.toggle('has-update', state.updateStatus === 'available');
    versionButton.setAttribute('aria-label', state.updateStatus === 'available' ? '새 업데이트 적용' : `PR+ v${APP_VERSION}, 업데이트 확인`);
  }
  if (!banner) return;
  const available = state.updateStatus === 'available';
  banner.classList.toggle('hidden', !available);
  document.querySelector('#updateBannerTitle').textContent = updateStatusTitle();
  document.querySelector('#updateBannerMessage').textContent = updateStatusMessage();
}
function setUpdateStatus(status, message = '') {
  state.updateStatus = status;
  state.updateMessage = message;
  if (state.view === 'settings' && state.db) renderSettings();
  syncUpdateUI();
}
function markUpdateAvailable(worker) {
  if (!worker) return;
  state.waitingWorker = worker;
  setUpdateStatus('available');
}

function watchInstallingWorker(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) markUpdateAvailable(worker);
  });
}
async function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setUpdateStatus('unsupported');
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    state.swRegistration = registration;
    if (registration.waiting && navigator.serviceWorker.controller) markUpdateAvailable(registration.waiting);
    registration.addEventListener('updatefound', () => {
      if (navigator.serviceWorker.controller) setUpdateStatus('downloading');
      watchInstallingWorker(registration.installing);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!state.applyingUpdate) return;
      state.applyingUpdate = false;
      window.location.reload();
    });
    return registration;
  } catch (error) {
    console.error(error);
    setUpdateStatus(navigator.onLine ? 'error' : 'offline');
    return null;
  }
}
async function checkForUpdate(notify = true) {
  if (!('serviceWorker' in navigator)) {
    setUpdateStatus('unsupported');
    if (notify) toast(updateStatusMessage());
    return;
  }
  if (state.updateStatus === 'available') {
    if (notify) toast('새 업데이트가 준비되어 있어. 업데이트 버튼을 눌러줘.');
    return;
  }
  setUpdateStatus('checking');
  try {
    const response = await fetch(`./version.json?check=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`version.json ${response.status}`);
    const release = await response.json();
    if (!release.releaseId || !release.appVersion) throw new Error('버전 정보 형식이 올바르지 않아.');
    state.latestRelease = release;
    state.lastUpdateCheck = Date.now();
    const registration = state.swRegistration || await setupServiceWorker();
    if (!registration) return;
    await registration.update();
    if (registration.waiting && navigator.serviceWorker.controller) {
      markUpdateAvailable(registration.waiting);
      return;
    }
    if (release.releaseId !== RELEASE_ID) {
      setUpdateStatus('downloading');
      if (notify) toast('새 버전을 받고 있어. 준비되면 알려줄게.');
      return;
    }
    setUpdateStatus('current');
    if (notify) toast(`PR+ v${APP_VERSION}이 최신 버전이야.`);
  } catch (error) {
    console.error(error);
    setUpdateStatus(navigator.onLine ? 'error' : 'offline');
    if (notify) toast(updateStatusMessage());
  }
}
async function applyUpdate() {
  const worker = state.swRegistration?.waiting || state.waitingWorker;
  if (!worker) {
    toast('준비된 업데이트가 없어. 다시 확인할게.');
    await checkForUpdate(false);
    return;
  }
  try {
    await saveCurrentSession();
  } catch (error) {
    console.error(error);
    toast('현재 운동 기록 저장을 확인하지 못해서 업데이트를 멈췄어.');
    return;
  }
  state.applyingUpdate = true;
  setUpdateStatus('applying');
  worker.postMessage({ type: 'SKIP_WAITING' });
}

async function ensureTodaySession() {
  if (state.currentSession) return state.currentSession;
  const session = { id: `session-${todayKey()}`, date: todayKey(), exercises: [], createdAt: Date.now(), startedAt: Date.now(), updatedAt: Date.now(), finishedAt: null };
  await put(STORES.sessions, session); await refreshData(); return state.currentSession;
}
function createSessionLog(exercise, options = {}) {
  const targetSets = options.type === 'warmup' ? 1 : Math.max(1, num(options.targetSets || 3));
  return {
    exerciseId: exercise.id, name: exercise.name, displayName: exercise.displayName || '', muscleGroup: exercise.muscleGroup,
    type: options.type || exercise.type || 'strength', targetSets, repMin: num(options.repMin ?? exercise.repMin),
    repMax: num(options.repMax ?? exercise.repMax), optional: Boolean(options.optional),
    sets: Array.from({ length: targetSets }, () => ({ weight: '', reps: '', rir: '', done: false }))
  };
}
async function startRoutine(routineId) {
  const routine = routineById(routineId);
  if (!routine) return toast('루틴을 찾을 수 없어.');
  const session = await ensureTodaySession();
  if (session.exercises.length) return toast('오늘 진행 중인 세션이 이미 있어.');
  session.routineId = routine.id; session.routineName = routine.name; session.startedAt = Date.now(); session.finishedAt = null;
  session.exercises = routine.items.map(item => {
    const exercise = exerciseById(item.exerciseId);
    return exercise ? createSessionLog(exercise, item) : null;
  }).filter(Boolean);
  await saveCurrentSession(); await refreshData(); state.view = 'today'; render();
  window.scrollTo({ top: 0, behavior: 'smooth' }); toast(`${routine.name} 루틴을 시작했어.`);
}
async function addExerciseToSession(exerciseId) {
  const session = await ensureTodaySession();
  if (session.exercises.some(log => log.exerciseId === exerciseId)) return toast('이미 오늘 추가한 운동이야.');
  const exercise = exerciseById(exerciseId);
  if (!exercise) return toast('운동을 찾을 수 없어.');
  session.exercises.push(createSessionLog(exercise, { targetSets: 3, repMin: exercise.repMin, repMax: exercise.repMax, type: exercise.type }));
  await saveCurrentSession(); await refreshData(); render(); toast('오늘 운동에 추가했어.');
}
async function saveCurrentSession() {
  if (!state.currentSession) return;
  state.currentSession.updatedAt = Date.now(); await put(STORES.sessions, state.currentSession);
}
async function saveRoutine(routine) {
  routine.items = routine.items.map((item, order) => ({ ...item, order }));
  routine.updatedAt = Date.now(); await put(STORES.routines, routine);
}
async function addExerciseToRoutine(routineId, exerciseId) {
  const routine = routineById(routineId); const exercise = exerciseById(exerciseId);
  if (!routine || !exercise) return toast('루틴 또는 운동을 찾을 수 없어.');
  if (routine.items.some(item => item.exerciseId === exerciseId)) return toast('이미 이 루틴에 있는 운동이야.');
  routine.items.push({ exerciseId, order: routine.items.length, targetSets: exercise.type === 'warmup' ? 1 : 3, repMin: exercise.repMin, repMax: exercise.repMax, optional: false, type: exercise.type || 'strength' });
  await saveRoutine(routine); await refreshData(); render(); toast(`${routine.name} 루틴에 추가했어.`);
}

function showExerciseDialog(mode = 'session', routineId = null) {
  state.exerciseDialogMode = mode; state.exerciseDialogRoutineId = routineId;
  const dialog = document.querySelector('#exerciseDialog'); const search = document.querySelector('#exerciseSearch');
  const title = document.querySelector('#exerciseDialogTitle'); const hint = document.querySelector('#exerciseDialogHint');
  if (mode === 'routine') { title.textContent = '루틴에 운동 추가'; hint.textContent = `${routineById(routineId)?.name || ''} 템플릿에만 추가돼.`; }
  else if (mode === 'library') { title.textContent = 'Exercise Library'; hint.textContent = '새 운동을 만들거나 기존 운동을 확인해.'; }
  else { title.textContent = '오늘 운동 추가'; hint.textContent = '현재 세션에만 운동을 추가해.'; }
  function fill(query = '') {
    const normalized = query.trim().toLowerCase();
    document.querySelector('#exerciseList').innerHTML = state.exercises.filter(exercise => !normalized || exerciseSearchText(exercise).includes(normalized)).slice(0, 40).map(exercise => `<button type="button" class="picker-item" data-pick="${esc(exercise.id)}"><span><b>${esc(exercise.name)}</b><br><small>${esc(exerciseSubtitle(exercise))}${exercise.type === 'warmup' ? ' · Warmup' : ` · ${exercise.repMin}–${exercise.repMax}회`}</small></span><span>＋</span></button>`).join('');
  }
  search.value = ''; fill(); search.oninput = () => fill(search.value); dialog.showModal(); setTimeout(() => search.focus(), 150);
}
function showInstall() { document.querySelector('#installDialog').showModal(); }
function confirmAsk(title, message) {
  return new Promise(resolve => {
    const dialog = document.querySelector('#confirmDialog');
    document.querySelector('#confirmTitle').textContent = title; document.querySelector('#confirmMessage').textContent = message;
    const ok = document.querySelector('#confirmOk'); const cancel = document.querySelector('#confirmCancel');
    const finish = value => { ok.onclick = null; cancel.onclick = null; dialog.close(); resolve(value); };
    ok.onclick = () => finish(true); cancel.onclick = () => finish(false); dialog.showModal();
  });
}
function toast(message) {
  let element = document.querySelector('.toast');
  if (!element) { element = document.createElement('div'); element.className = 'toast'; document.body.appendChild(element); }
  element.textContent = message; element.classList.add('show'); clearTimeout(element._timer);
  element._timer = setTimeout(() => element.classList.remove('show'), 1800);
}

async function exportBackup() {
  const backup = {
    app: 'PR+', appVersion: APP_VERSION, version: DATA_SCHEMA_VERSION, schemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(), exercises: await getAll(STORES.exercises), routines: await getAll(STORES.routines),
    sessions: await getAll(STORES.sessions), settings: await getAll(STORES.settings)
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `pr-plus-backup-${todayKey()}.json`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast('schema v3 백업 파일을 만들었어.');
}
function prepareRestoredData(data) {
  const exercises = data.exercises.map(normalizeExercise);
  DEFAULT_EXERCISES.forEach(definition => {
    if (!exercises.some(exercise => exercise.name.toLowerCase() === definition.name.toLowerCase())) exercises.push(definition);
  });
  const routines = data.routines.map(normalizeRoutine);
  createDefaultRoutines(exercises).forEach(definition => {
    if (!routines.some(routine => routine.id === definition.id)) routines.push(definition);
  });
  const settings = data.settings.filter(setting => setting?.key !== 'schemaVersion');
  settings.push({ key: 'schemaVersion', value: DATA_SCHEMA_VERSION });
  return {
    ...data,
    exercises,
    routines,
    sessions: data.sessions.map(normalizeSession),
    settings
  };
}
async function importBackup(file) {
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { return toast('JSON 파일을 읽을 수 없어.'); }
  let migrated;
  try { migrated = migrateBackupToLatest(parsed); } catch (error) { console.error(error); return toast(error.message || '백업 구조를 확인할 수 없어.'); }
  const prepared = prepareRestoredData(migrated);
  if (!await confirmAsk('백업 복원', `schema v${prepared.schemaVersion}로 검증했어. 현재 로컬 데이터를 이 백업으로 교체할까?`)) return;
  try {
    await replaceAllData(prepared); await refreshData(); render(); toast('백업을 안전하게 복원했어.');
  } catch (error) { console.error(error); toast('복원에 실패해서 기존 데이터를 유지했어.'); }
}

app.addEventListener('input', async event => {
  const element = event.target;
  if (element.id === 'librarySearch') { state.libraryQuery = element.value; renderLibraryList(); return; }
  if (!element.matches('[data-field]') || !state.currentSession) return;
  const set = state.currentSession.exercises[num(element.dataset.eidx)]?.sets[num(element.dataset.sidx)];
  if (!set) return;
  set[element.dataset.field] = element.dataset.field === 'done' ? element.checked : element.value;
  await saveCurrentSession();
});
app.addEventListener('change', async event => {
  const element = event.target;
  if (element.matches('[data-field="done"]')) { await refreshData(); renderToday(); return; }
  if (element.matches('[data-routine-field]')) {
    const routine = routineById(element.dataset.routineId); const item = routine?.items[num(element.dataset.itemIndex)];
    if (!item) return;
    const field = element.dataset.routineField; item[field] = Math.max(1, num(element.value));
    if (field === 'repMin' && item.repMin > item.repMax) item.repMax = item.repMin;
    if (field === 'repMax' && item.repMax < item.repMin) item.repMin = item.repMax;
    await saveRoutine(routine); await refreshData(); renderRoutines();
  }
});

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'add-exercise') showExerciseDialog('session');
  if (action === 'start-routine') await startRoutine(button.dataset.routineId);
  if (action === 'add-set') {
    const log = state.currentSession.exercises[num(button.dataset.eidx)]; const last = log.sets.at(-1) || {};
    log.sets.push({ weight: last.weight || '', reps: '', rir: '', done: false }); await saveCurrentSession(); renderToday();
  }
  if (action === 'copy-prev') {
    const log = state.currentSession.exercises[num(button.dataset.eidx)]; const previous = previousExerciseLog(log.exerciseId, state.currentSession.date);
    if (!previous) return toast('복사할 이전 기록이 없어.');
    log.sets = previous.sets.filter(set => set.done).map(set => ({ weight: set.weight, reps: set.reps, rir: set.rir, done: false }));
    await saveCurrentSession(); renderToday(); toast('지난 기록을 불러왔어. 완료 체크는 비워뒀어.');
  }
  if (action === 'remove-exercise' && await confirmAsk('운동 삭제', '오늘 세션에서 이 운동과 입력한 세트를 삭제할까?')) {
    state.currentSession.exercises.splice(num(button.dataset.eidx), 1); await saveCurrentSession(); await refreshData(); render();
  }
  if (action === 'finish-session') { state.currentSession.finishedAt = Date.now(); await saveCurrentSession(); await refreshData(); renderToday(); toast('오늘 운동을 완료했어.'); }
  if (action === 'edit-routine') { state.editRoutineId = state.editRoutineId === button.dataset.routineId ? null : button.dataset.routineId; renderRoutines(); }
  if (action === 'add-routine-exercise') showExerciseDialog('routine', button.dataset.routineId);
  if (action === 'move-routine-item') {
    const routine = routineById(button.dataset.routineId); const index = num(button.dataset.itemIndex); const target = button.dataset.direction === 'up' ? index - 1 : index + 1;
    if (!routine || target < 0 || target >= routine.items.length) return;
    [routine.items[index], routine.items[target]] = [routine.items[target], routine.items[index]];
    await saveRoutine(routine); await refreshData(); renderRoutines();
  }
  if (action === 'remove-routine-item') {
    const routine = routineById(button.dataset.routineId); if (!routine) return;
    if (await confirmAsk('루틴에서 제거', 'Exercise Library와 과거 기록은 유지돼. 이 루틴에서만 제거할까?')) {
      routine.items.splice(num(button.dataset.itemIndex), 1); await saveRoutine(routine); await refreshData(); renderRoutines();
    }
  }
  if (action === 'filter-library') { state.libraryFilter = button.dataset.filter; renderLibrary(); }
  if (action === 'create-library-exercise') showExerciseDialog('library');
  if (action === 'add-library-to-routine') {
    const routineId = button.closest('.library-item')?.querySelector('.mini-select')?.value;
    if (routineId) await addExerciseToRoutine(routineId, button.dataset.exerciseId);
  }
  if (action === 'toggle-history') { state.expandedSessionId = state.expandedSessionId === button.dataset.sessionId ? null : button.dataset.sessionId; renderHistory(); }
  if (action === 'export') await exportBackup();
  if (action === 'import') document.querySelector('#importFile').click();
  if (action === 'install') showInstall();
  if (action === 'check-update') await checkForUpdate(true);
  if (action === 'apply-update') await applyUpdate();
  if (action === 'clear-sessions' && await confirmAsk('모든 기록 초기화', '운동 세션을 전부 삭제해. 이 작업은 되돌릴 수 없으니 먼저 백업하는 걸 권장해.')) {
    await clearStore(STORES.sessions); await refreshData(); render(); toast('운동 기록을 초기화했어.');
  }
});

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  state.view = button.dataset.view; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
}));
document.querySelector('#exerciseList').addEventListener('click', async event => {
  const button = event.target.closest('[data-pick]'); if (!button) return;
  document.querySelector('#exerciseDialog').close();
  if (state.exerciseDialogMode === 'routine') await addExerciseToRoutine(state.exerciseDialogRoutineId, button.dataset.pick);
  else if (state.exerciseDialogMode === 'session') await addExerciseToSession(button.dataset.pick);
  else toast('이미 Exercise Library에 등록된 운동이야.');
});
document.querySelector('#createExerciseBtn').addEventListener('click', async () => {
  const name = document.querySelector('#customExerciseName').value.trim();
  const displayName = document.querySelector('#customExerciseDisplayName').value.trim();
  const muscleGroup = document.querySelector('#customExerciseMuscle').value;
  const match = document.querySelector('#customRepRange').value.trim().match(/(\d+)\s*[-~]\s*(\d+)/);
  if (!name || !match) return toast('이름과 반복 범위를 확인해줘.');
  if (findDefaultExercise(name) || findDefaultExercise(displayName) || state.exercises.some(exercise => exercise.name.toLowerCase() === name.toLowerCase())) return toast('같은 운동이 이미 Library에 있어.');
  const exercise = normalizeExercise({ id: uid('exercise'), name, displayName, muscleGroup, repMin: num(match[1]), repMax: num(match[2]), type: 'strength', builtIn: false, createdAt: Date.now() });
  if (exercise.repMin > exercise.repMax) return toast('최소 반복수는 최대 반복수보다 클 수 없어.');
  await put(STORES.exercises, exercise); await refreshData(); document.querySelector('#exerciseDialog').close();
  document.querySelector('#customExerciseName').value = ''; document.querySelector('#customExerciseDisplayName').value = '';
  if (state.exerciseDialogMode === 'routine') await addExerciseToRoutine(state.exerciseDialogRoutineId, exercise.id);
  else if (state.exerciseDialogMode === 'session') await addExerciseToSession(exercise.id);
  else { render(); toast('Exercise Library에 추가했어.'); }
});

document.querySelector('#installBtn').addEventListener('click', showInstall);
document.querySelector('#versionBtn').addEventListener('click', () => state.updateStatus === 'available' ? applyUpdate() : checkForUpdate(true));
document.querySelector('#applyUpdateBtn').addEventListener('click', applyUpdate);
document.querySelector('#closeInstallDialog').addEventListener('click', () => document.querySelector('#installDialog').close());
document.querySelector('#importFile').addEventListener('change', event => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ''; });
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); state.deferredInstall = event;
  const button = document.querySelector('#nativeInstallBtn'); button.classList.remove('hidden');
  button.onclick = async () => { await state.deferredInstall.prompt(); state.deferredInstall = null; document.querySelector('#installDialog').close(); };
});
window.addEventListener('appinstalled', () => toast('PR+ 설치 완료.'));
window.addEventListener('load', async () => {
  await setupServiceWorker();
  await checkForUpdate(false);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastUpdateCheck > 30 * 60 * 1000) checkForUpdate(false);
});

(async function init() {
  try {
    state.db = await openDB(); await migrateStoredData(); await seedDefaults(); await refreshData(); render();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><h2>저장소를 열 수 없어</h2><p class="muted">${esc(error.message || '브라우저의 사이트 데이터/개인정보 보호 설정을 확인해줘.')}</p></div>`;
  }
})();
