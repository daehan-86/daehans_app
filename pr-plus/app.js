import {
  APP_VERSION, RELEASE_ID, DATA_SCHEMA_VERSION, DB_NAME, DB_VERSION, STORES, DEFAULT_EXERCISES,
  createDefaultRoutines, defaultRoutineIdForMuscle, findDefaultExercise, migrateBackupToLatest, muscleLabel,
  nextTrainingDayBoundary, localDateKey, normalizeExercise, normalizeRoutine, normalizeSession,
  trainingDayKey
} from './data.mjs';
import {
  buildNextTarget, compareExerciseLogs, completedSets, detectPersonalRecords,
  epley, summarizeExerciseLog, targetRange, trackingModeOf
} from './progression.mjs';

const state = {
  view: 'today', db: null, exercises: [], routines: [], sessions: [], settings: [], currentSession: null,
  deferredInstall: null, exerciseDialogMode: 'session', exerciseDialogRoutineId: null,
  editRoutineId: null, expandedSessionId: null, libraryQuery: '', libraryFilter: 'all',
  swRegistration: null, waitingWorker: null, updateStatus: 'idle', updateMessage: '',
  latestRelease: null, applyingUpdate: false, lastUpdateCheck: 0,
  detailExerciseId: null, restTimerEnd: 0, restTimerInterval: null,
  durationTimer: null, durationTimerInterval: null, activeTrainingDay: null,
  trainingDayTimer: null, historyLimit: 31, editingSession: null, editingSessionIsNew: false,
  editTodayOrder: false, historyPeriod: 'all', historyAnchor: null, historyExerciseId: null
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
function deleteRecord(store, key) {
  return new Promise((resolve, reject) => {
    const request = objectStore(store, 'readwrite').delete(key);
    request.onsuccess = () => resolve();
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

const todayKey = () => trainingDayKey(new Date());
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatKg = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
const dayKo = date => ['일', '월', '화', '수', '목', '금', '토'][new Date(`${date}T12:00:00`).getDay()];
const dateFromKey = key => new Date(`${key}T12:00:00`);
const shiftDateKey = (key, days) => {
  const date = dateFromKey(key); date.setDate(date.getDate() + days); return localDateKey(date);
};
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
  const settings = await getAll(STORES.settings);
  const missingRoutines = createDefaultRoutines(exercises).filter(routine =>
    !routines.some(existing => existing.id === routine.id)
  );
  const transaction = state.db.transaction([STORES.exercises, STORES.routines, STORES.settings], 'readwrite');
  missingExercises.forEach(exercise => transaction.objectStore(STORES.exercises).put(exercise));
  missingRoutines.forEach(routine => transaction.objectStore(STORES.routines).put(routine));
  transaction.objectStore(STORES.settings).put({ key: 'schemaVersion', value: DATA_SCHEMA_VERSION });
  if (!settings.some(setting => setting.key === 'restTimerSeconds')) transaction.objectStore(STORES.settings).put({ key: 'restTimerSeconds', value: 120 });
  if (!settings.some(setting => setting.key === 'bodyWeightEntries')) transaction.objectStore(STORES.settings).put({ key: 'bodyWeightEntries', value: [] });
  await transactionComplete(transaction);
}

async function refreshData() {
  const [exercises, routines, sessions, settings] = await Promise.all([
    getAll(STORES.exercises), getAll(STORES.routines), getAll(STORES.sessions), getAll(STORES.settings)
  ]);
  state.exercises = exercises.map(normalizeExercise).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  state.routines = routines.map(normalizeRoutine).sort((a, b) => num(a.order) - num(b.order) || a.name.localeCompare(b.name));
  state.sessions = sessions.map(normalizeSession).sort((a, b) => b.date.localeCompare(a.date) || num(b.updatedAt) - num(a.updatedAt));
  state.settings = settings;
  state.currentSession = state.sessions.find(session => session.date === todayKey()) || null;
}

async function synchronizeTrainingDay(notify = false) {
  const nextDay = todayKey();
  if (!state.activeTrainingDay) { state.activeTrainingDay = nextDay; return false; }
  if (state.activeTrainingDay === nextDay) return false;
  if (state.durationTimer && state.currentSession) {
    const { exerciseIndex, setIndex, startedAt } = state.durationTimer;
    const set = state.currentSession.exercises[exerciseIndex]?.sets[setIndex];
    if (set) { set.duration = Math.max(1, Math.floor((Date.now() - startedAt) / 1000)); set.done = true; }
    clearInterval(state.durationTimerInterval); state.durationTimerInterval = null; state.durationTimer = null;
    await saveCurrentSession();
  }
  state.activeTrainingDay = nextDay;
  await refreshData(); render();
  if (notify) toast('오전 7시가 지나 새 운동일로 갱신했어. 이전 기록은 전날에 저장됐어.');
  return true;
}

function scheduleTrainingDayRefresh() {
  clearTimeout(state.trainingDayTimer);
  const delay = Math.max(250, nextTrainingDayBoundary(new Date()).getTime() - Date.now() + 50);
  state.trainingDayTimer = setTimeout(async () => {
    try { await synchronizeTrainingDay(true); } catch (error) { console.error(error); }
    scheduleTrainingDayRefresh();
  }, Math.min(delay, 2_147_000_000));
}

function settingValue(key, fallback) {
  return state.settings.find(setting => setting.key === key)?.value ?? fallback;
}
async function saveSetting(key, value) {
  await put(STORES.settings, { key, value });
  const existing = state.settings.find(setting => setting.key === key);
  if (existing) existing.value = value;
  else state.settings.push({ key, value });
}

function isWarmupLog(log) {
  return log.type === 'warmup' || exerciseById(log.exerciseId)?.type === 'warmup';
}
function isDuration(config) { return trackingModeOf(config) === 'duration'; }
function targetText(config) {
  const range = targetRange(config);
  return `${range.min}–${range.max}${range.unit}`;
}
function loadHeader(config) {
  if (config.loadMode === 'assistance') return '보조KG';
  if (config.loadMode === 'bodyweight') return '추가KG';
  return 'KG';
}
function exerciseLogsBefore(exerciseId, currentDate = '9999-12-31') {
  return state.sessions.filter(session => session.date < currentDate).flatMap(session =>
    (session.exercises || []).filter(log => log.exerciseId === exerciseId && completedSets(log).length)
      .map(log => ({ ...log, sessionDate: session.date, sessionId: session.id }))
  );
}
function logVolume(log) {
  const exercise = exerciseById(log.exerciseId) || log;
  if (isDuration(log) || ['assistance', 'none'].includes(log.loadMode || exercise.loadMode)) return 0;
  return log.sets.reduce((sum, set) => sum + (set.done ? num(set.weight) * num(set.reps) : 0), 0);
}
function sessionVolume(session) {
  return (session?.exercises || []).reduce((total, log) => total + logVolume(log), 0);
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
function bestE1RMForExercise(exerciseId) {
  const exercise = exerciseById(exerciseId);
  if (!exercise || isDuration(exercise) || ['assistance', 'none'].includes(exercise.loadMode)) return 0;
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
  const date = dateFromKey(todayKey());
  const dateLabel = `${date.getMonth() + 1}월 ${date.getDate()}일 ${['일', '월', '화', '수', '목', '금', '토'][date.getDay()]}요일`;
  let html = `<div class="section-head"><div><h2>오늘의 훈련</h2><p>운동일은 오전 7시에 바뀐다.</p></div><div class="date-chip">${dateLabel}</div></div>`;
  if (!session || !session.exercises.length) {
    html += `<div class="card hero-card"><p class="eyebrow">PR+ 0.3 · BEAT YOUR LAST</p><div class="hero-value">START TRUE.</div><p class="muted small">실제 수행을 기록하면 다음 세션의 중량 · 횟수 · 시간을 계산해.</p></div>`;
    html += `<div class="routine-start-grid">${state.routines.map(routineStartCard).join('')}</div>`;
    html += `<button class="secondary-btn wide manual-start" data-action="add-exercise">루틴 없이 운동 추가</button>`;
  } else {
    const routineLabel = session.routineName ? `<span class="badge pr-badge">${esc(session.routineName)}</span>` : '';
    html += `<div class="session-title-row"><div>${routineLabel}${session.finishedAt ? '<span class="badge">완료됨</span>' : '<span class="badge">기록 중</span>'}</div><button class="secondary-btn compact-btn ${state.editTodayOrder ? 'active-edit-btn' : ''}" data-action="toggle-session-edit">${state.editTodayOrder ? '편집 완료' : '운동 순서 편집'}</button></div>`;
    html += `<div class="stats-grid"><div class="stat-card"><span>오늘 완료 세트</span><b>${hardSets(session)}</b></div><div class="stat-card"><span>총 볼륨</span><b>${Math.round(sessionVolume(session)).toLocaleString()}<small> kg</small></b></div></div>`;
    html += `<div class="baseline-banner"><b>Progressive Overload</b><span>LAST와 NEXT를 참고하고, 오늘 실제 수행값과 RIR을 기록해.</span></div>`;
    if (state.editTodayOrder) html += '<div class="session-edit-banner">화살표로 순서를 바꾸거나 이 세션에서 운동을 삭제할 수 있어. 루틴 원본은 바뀌지 않아.</div>';
    session.exercises.forEach((log, index) => { html += exerciseCard(log, index); });
    html += `<label class="session-note"><span>오늘 메모</span><textarea class="text-input" data-session-note placeholder="컨디션, 자세, 통증 없이 느낀 점…">${esc(session.notes || '')}</textarea></label>`;
    html += `<div class="session-actions"><button class="secondary-btn wide" data-action="add-exercise">＋ 운동 추가</button><button class="secondary-btn wide" data-action="feedback-today">GPT 피드백용 텍스트</button><button class="primary-btn wide" data-action="finish-session">오늘 운동 완료</button></div>`;
  }
  app.innerHTML = html;
}

function formatCompletedSet(set, config) {
  if (isDuration(config)) {
    const duration = num(set.duration) > 0 ? `${num(set.duration)}초` : '시간 미기록';
    return num(set.weight) > 0 ? `${config.loadMode === 'assistance' ? '보조 ' : ''}${formatKg(set.weight)}kg · ${duration}` : duration;
  }
  const load = num(set.weight);
  const loadText = config.loadMode === 'assistance' ? `보조 ${formatKg(load)}kg` : config.loadMode === 'bodyweight' && !load ? '맨몸' : `${formatKg(load)}kg`;
  return `${loadText} × ${num(set.reps)}${set.rir !== '' ? ` @${set.rir}` : ''}`;
}
function formatNextTarget(target, config) {
  if (!target.sets.length) return 'Baseline을 먼저 기록해';
  if (isDuration(config)) {
    const time = `${target.sets.map(set => set.metric).join(' / ')}초`;
    return target.load !== null && target.load !== undefined ? `${config.loadMode === 'assistance' ? '보조 ' : ''}${formatKg(target.load)}kg · ${time}` : time;
  }
  const metrics = target.sets.map(set => set.metric).join(' / ');
  const load = target.load ?? target.sets[0]?.weight ?? 0;
  const rir = ` · RIR ${num(config.targetRIRMin)}–${num(config.targetRIRMax)}`;
  if (config.loadMode === 'bodyweight' && !load) return `맨몸 · ${metrics}회${rir}`;
  if (config.loadMode === 'none') return `${metrics}회${rir}`;
  return `${config.loadMode === 'assistance' ? '보조 ' : ''}${formatKg(load)}kg · ${metrics}회${rir}`;
}

function exerciseCard(log, exerciseIndex) {
  const exercise = exerciseById(log.exerciseId) || {
    name: log.name || '삭제된 운동', displayName: log.displayName || '', muscleGroup: log.muscleGroup || 'other', repMin: 8, repMax: 12, trackingMode: log.trackingMode || 'reps'
  };
  const config = {
    ...exercise, ...log,
    weightIncrement: exercise.weightIncrement, weightStep: exercise.weightStep, metricIncrement: exercise.metricIncrement,
    targetRIRMin: exercise.targetRIRMin, targetRIRMax: exercise.targetRIRMax
  };
  const previous = previousExerciseLog(log.exerciseId, state.currentSession?.date || todayKey());
  const previousText = previous
    ? completedSets(previous).map(set => formatCompletedSet(set, config)).join(' · ')
    : '첫 기록 · 오늘 기록이 baseline이 돼';
  const earlierLogs = exerciseLogsBefore(log.exerciseId, state.currentSession?.date || todayKey());
  const comparison = compareExerciseLogs(log, previous, config);
  const records = detectPersonalRecords(log, earlierLogs, config);
  const next = buildNextTarget(state.currentSession?.finishedAt && completedSets(log).length ? log : previous, config);
  const status = completedSets(log).length ? `<span class="performance-badge ${comparison.status}">${esc(comparison.label)}</span>` : '';
  const recordBadges = records.map(record => `<span class="badge pr-badge">${esc(record)}</span>`).join('');
  const orderControls = state.editTodayOrder ? `<div class="session-order-bar"><span>오늘 운동 ${exerciseIndex + 1}/${state.currentSession.exercises.length}</span><div><button data-action="move-session-exercise" data-direction="up" data-eidx="${exerciseIndex}" ${exerciseIndex === 0 ? 'disabled' : ''} aria-label="위로 이동">↑ 위로</button><button data-action="move-session-exercise" data-direction="down" data-eidx="${exerciseIndex}" ${exerciseIndex === state.currentSession.exercises.length - 1 ? 'disabled' : ''} aria-label="아래로 이동">↓ 아래로</button><button class="remove-session-exercise" data-action="remove-exercise" data-eidx="${exerciseIndex}">삭제</button></div></div>` : '';
  const rows = isDuration(config) ? log.sets.map((set, setIndex) => {
    const timerActive = state.durationTimer?.exerciseIndex === exerciseIndex && state.durationTimer?.setIndex === setIndex;
    return `<tr>
      <td class="set-num">${setIndex + 1}</td>
      ${config.loadMode === 'none' ? '' : `<td><input class="set-input" inputmode="decimal" data-field="weight" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.weight ?? '')}" placeholder="kg" aria-label="${setIndex + 1}세트 중량"></td>`}
      <td><input class="set-input" inputmode="numeric" data-field="duration" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.duration ?? '')}" placeholder="초" aria-label="${setIndex + 1}세트 유지 시간"></td>
      <td><button class="timer-set-btn ${timerActive ? 'active' : ''}" data-action="toggle-duration-timer" data-eidx="${exerciseIndex}" data-sidx="${setIndex}">${timerActive ? '정지' : '시작'}</button></td>
      <td><input class="done-check" type="checkbox" data-field="done" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" ${set.done ? 'checked' : ''} aria-label="${setIndex + 1}세트 완료"></td>
      <td><button class="set-remove-btn" data-action="remove-set" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" aria-label="${setIndex + 1}세트 삭제">×</button></td>
    </tr>`;
  }).join('') : log.sets.map((set, setIndex) => `<tr>
      <td class="set-num">${setIndex + 1}</td>
      ${config.loadMode === 'none' ? '' : `<td><input class="set-input" inputmode="decimal" data-field="weight" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.weight ?? '')}" placeholder="kg" aria-label="${setIndex + 1}세트 중량"></td>`}
      <td><input class="set-input" inputmode="numeric" data-field="reps" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.reps ?? '')}" placeholder="회" aria-label="${setIndex + 1}세트 반복수"></td>
      <td><input class="set-input" inputmode="decimal" data-field="rir" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.rir ?? '')}" placeholder="RIR" aria-label="${setIndex + 1}세트 RIR"></td>
      <td><input class="done-check" type="checkbox" data-field="done" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" ${set.done ? 'checked' : ''} aria-label="${setIndex + 1}세트 완료"></td>
      <td><button class="set-remove-btn" data-action="remove-set" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" aria-label="${setIndex + 1}세트 삭제">×</button></td>
    </tr>`).join('');
  const headers = isDuration(config)
    ? `<tr><th>SET</th>${config.loadMode === 'none' ? '' : `<th>${loadHeader(config)}</th>`}<th>SEC</th><th>TIMER</th><th>✓</th><th></th></tr>`
    : `<tr><th>SET</th>${config.loadMode === 'none' ? '' : `<th>${loadHeader(config)}</th>`}<th>REPS</th><th>RIR</th><th>✓</th><th></th></tr>`;
  return `<section class="card exercise-card">
    <div class="exercise-head"><div>${isWarmupLog(log) ? '<p class="eyebrow">WARMUP / MOBILITY</p>' : ''}<h3>${esc(exercise.name)}</h3><div class="exercise-display-name">${esc(exercise.displayName || '')}</div><div class="exercise-meta">${esc(muscleLabel(exercise.muscleGroup))} · 목표 ${targetText(config)}${log.optional ? ' · 선택' : ''}</div></div><div class="exercise-head-actions">${status}</div></div>
    ${orderControls}
    <div class="last-performance"><b>LAST</b><span>${esc(previousText)}</span></div>
    <div class="next-target"><div><b>NEXT</b><strong>${esc(formatNextTarget(next, config))}</strong></div><span>${esc(next.message)}</span></div>
    ${recordBadges ? `<div class="record-row">${recordBadges}</div>` : ''}
    <table class="set-table"><thead>${headers}</thead><tbody>${rows}</tbody></table>
    <div class="exercise-actions"><button class="secondary-btn" data-action="add-set" data-eidx="${exerciseIndex}">＋ 세트</button><button class="ghost-btn" data-action="copy-prev" data-eidx="${exerciseIndex}">지난 기록 복사</button><button class="ghost-btn" data-action="exercise-detail" data-exercise-id="${esc(log.exerciseId)}">기록·설정</button></div>
    <div class="baseline-note ${comparison.status}">${esc(comparison.detail)}${exercise.notes ? ` · ${esc(exercise.notes)}` : ''}</div>
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
    const duration = isDuration(item);
    const controls = `<div class="routine-targets">
      <label>세트<input type="number" min="1" max="12" inputmode="numeric" data-routine-field="targetSets" data-routine-id="${routineId}" data-item-index="${index}" value="${item.targetSets}"></label>
      <label>최소${duration ? '초' : '회'}<input type="number" min="1" max="600" inputmode="numeric" data-routine-field="${duration ? 'durationMin' : 'repMin'}" data-routine-id="${routineId}" data-item-index="${index}" value="${duration ? item.durationMin : item.repMin}"></label>
      <label>최대${duration ? '초' : '회'}<input type="number" min="1" max="600" inputmode="numeric" data-routine-field="${duration ? 'durationMax' : 'repMax'}" data-routine-id="${routineId}" data-item-index="${index}" value="${duration ? item.durationMax : item.repMax}"></label>
    </div>`;
    return `<div class="routine-item ${editing ? 'editing' : ''}">
      ${editing ? `<div class="routine-order"><button data-action="move-routine-item" data-direction="up" data-routine-id="${routineId}" data-item-index="${index}" ${index === 0 ? 'disabled' : ''} aria-label="위로 이동">↑</button><button data-action="move-routine-item" data-direction="down" data-routine-id="${routineId}" data-item-index="${index}" ${index === routine.items.length - 1 ? 'disabled' : ''} aria-label="아래로 이동">↓</button></div>` : ''}
      <div class="routine-item-main"><b>${esc(exercise.name)}</b><small>${esc(exercise.displayName || '')}${item.type === 'warmup' ? ' · Warmup' : ''}${item.optional ? ' · 선택 운동' : ''}</small>${editing ? controls : `<span>${item.targetSets}세트 · ${targetText(item)}</span>`}</div>
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
  if (!state.historyAnchor) state.historyAnchor = todayKey();
  const range = historyPeriodRange();
  const timeline = historyTimeline(range);
  const visible = state.historyPeriod === 'all' ? timeline.slice(0, state.historyLimit) : timeline;
  const trainingDays = timeline.filter(item => item.session?.exercises?.some(log => completedSets(log).length)).length;
  const restDays = timeline.filter(item => !item.session).length;
  app.innerHTML = `<div class="section-head"><div><h2>운동 기록</h2><p>${trainingDays}일 훈련 · ${restDays}일 휴식</p></div><button class="primary-btn compact-btn" data-action="feedback-history">GPT 상담용 요약</button></div>` +
    historyPeriodControls(range) + progressMarkup(range) + exerciseProgressMarkup() +
    `<div class="subsection-head"><h3>${esc(range.label)} 기록</h3><p>미등록일은 휴식으로 표시하고, 휴식일에도 과거 기록을 추가할 수 있어.</p></div>` +
    (timeline.length ? `<div class="card history-card">${visible.map(item => item.session ? historyItem(item.session) : restDayItem(item.date)).join('')}</div>${visible.length < timeline.length ? `<button class="secondary-btn wide history-more" data-action="load-more-history">이전 기록 더 보기 (${timeline.length - visible.length}일)</button>` : '<p class="history-end muted small">첫 기록까지 모두 불러왔어.</p>'}` : '<div class="card empty-state"><h3>아직 기록이 없어</h3><p>첫 운동을 시작하면 이후 미기록일이 휴식으로 정리돼.</p></div>');
}
function historyPeriodRange(period = state.historyPeriod, anchorKey = state.historyAnchor || todayKey()) {
  const today = todayKey(); const anchor = dateFromKey(anchorKey > today ? today : anchorKey);
  const validDates = state.sessions.map(session => session.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today);
  if (period === 'all') return { from: validDates.length ? validDates.sort()[0] : today, to: today, label: '전체 기간', unit: 'month' };
  if (period === 'day') { const key = localDateKey(anchor); return { from: key, to: key, label: `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월 ${anchor.getDate()}일`, unit: 'day' }; }
  if (period === 'week') {
    const start = new Date(anchor); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { from: localDateKey(start), to: localDateKey(end) > today ? today : localDateKey(end), label: `${start.getMonth() + 1}/${start.getDate()}–${end.getMonth() + 1}/${end.getDate()}`, unit: 'day' };
  }
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12); const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12);
  return { from: localDateKey(start), to: localDateKey(end) > today ? today : localDateKey(end), label: `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월`, unit: 'day' };
}
function historyPeriodControls(range) {
  const options = [['all', '전체'], ['day', '일'], ['week', '주'], ['month', '월']];
  const navigator = state.historyPeriod === 'all' ? '' : `<div class="period-navigator"><button class="secondary-btn compact-btn" data-action="shift-history-period" data-direction="prev" aria-label="이전 기간">‹</button><b>${esc(range.label)}</b><button class="secondary-btn compact-btn" data-action="shift-history-period" data-direction="next" ${range.to >= todayKey() ? 'disabled' : ''} aria-label="다음 기간">›</button></div>`;
  return `<div class="history-period-card"><div class="period-tabs">${options.map(([key, label]) => `<button class="filter-chip ${state.historyPeriod === key ? 'active' : ''}" data-action="history-period" data-period="${key}">${label}</button>`).join('')}</div>${navigator}</div>`;
}
function shiftHistoryPeriod(direction) {
  const amount = direction === 'prev' ? -1 : 1; const date = dateFromKey(state.historyAnchor || todayKey());
  if (state.historyPeriod === 'day') date.setDate(date.getDate() + amount);
  if (state.historyPeriod === 'week') date.setDate(date.getDate() + amount * 7);
  if (state.historyPeriod === 'month') { date.setDate(1); date.setMonth(date.getMonth() + amount); }
  state.historyAnchor = localDateKey(date) > todayKey() ? todayKey() : localDateKey(date); state.historyLimit = 31;
}
function sessionsInRange(range, completedOnly = false) {
  return state.sessions.filter(session => session.date >= range.from && session.date <= range.to && (!completedOnly || session.exercises?.some(log => completedSets(log).length)));
}
function historyTimeline(range = historyPeriodRange()) {
  const validSessions = sessionsInRange(range).filter(session => /^\d{4}-\d{2}-\d{2}$/.test(session.date));
  if (state.historyPeriod === 'all' && !validSessions.length) return [];
  const byDate = new Map(validSessions.map(session => [session.date, session]));
  const entries = [];
  for (let date = range.to; date >= range.from; date = shiftDateKey(date, -1)) entries.push({ date, session: byDate.get(date) || null });
  return entries;
}
function restDayItem(dateKey) {
  const date = dateFromKey(dateKey);
  return `<div class="history-entry rest-entry"><div class="history-item"><span class="history-date"><b>${date.getDate()}</b><span>${date.getMonth() + 1}월 · ${dayKo(dateKey)}</span></span><span class="history-main"><strong>휴식</strong><small>등록된 운동 없음</small></span><button class="ghost-btn compact-btn" data-action="add-past-session" data-date="${esc(dateKey)}">기록 추가</button></div></div>`;
}
function historyItem(session) {
  const date = new Date(`${session.date}T12:00:00`);
  const completedLogs = session.exercises.filter(log => log.sets.some(set => set.done));
  const names = completedLogs.map(exerciseNameFromLog).join(', ');
  const expanded = state.expandedSessionId === session.id;
  const detail = expanded ? `<div class="history-detail">${completedLogs.map(log => {
    const exercise = exerciseById(log.exerciseId) || log;
    const sets = completedSets(log).map(set => formatCompletedSet(set, { ...exercise, ...log })).join(' · ');
    return `<button class="history-exercise" data-action="exercise-detail" data-exercise-id="${esc(log.exerciseId)}"><b>${esc(exerciseNameFromLog(log))}</b><span>${esc(sets)}</span></button>`;
  }).join('') || '<p class="muted small">완료 체크된 세트가 아직 없어.</p>'}${session.notes ? `<p class="history-note">${esc(session.notes)}</p>` : ''}<button class="secondary-btn compact-btn history-edit-btn" data-action="edit-session" data-session-id="${esc(session.id)}">이 기록 편집</button></div>` : '';
  return `<div class="history-entry"><button class="history-item" data-action="toggle-history" data-session-id="${esc(session.id)}"><span class="history-date"><b>${date.getDate()}</b><span>${date.getMonth() + 1}월 · ${dayKo(session.date)}</span></span><span class="history-main"><strong>${esc(session.routineName || names || '개별 운동')}</strong><small>${hardSets(session)}세트 · ${Math.round(sessionVolume(session)).toLocaleString()}kg</small></span><span class="badge">${session.finishedAt ? '완료' : '기록'}</span></button>${detail}</div>`;
}

function showSessionEditor(session, isNew = false) {
  state.editingSession = JSON.parse(JSON.stringify(session)); state.editingSessionIsNew = isNew;
  renderSessionEditor();
  const dialog = document.querySelector('#sessionEditDialog'); if (!dialog.open) dialog.showModal();
}
function showExistingSessionEditor(sessionId) {
  const session = state.sessions.find(candidate => candidate.id === sessionId);
  if (!session) return toast('기록을 찾을 수 없어.');
  showSessionEditor(session, false);
}
function showNewSessionEditor(date) {
  if (state.sessions.some(session => session.date === date)) return toast('이 날짜에는 이미 기록이 있어.');
  const now = Date.now();
  showSessionEditor({ id: uid(`session-${date}`), date, routineName: '', exercises: [], notes: '', createdAt: now, startedAt: now, updatedAt: now, finishedAt: now }, true);
}
function editSetMarkup(set, log, exerciseIndex, setIndex) {
  const exercise = exerciseById(log.exerciseId) || log; const config = { ...exercise, ...log };
  const weight = config.loadMode !== 'none' ? `<label>${loadHeader(config)}<input class="set-input" type="number" step="0.25" inputmode="decimal" data-edit-set-field="weight" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.weight)}"></label>` : '';
  const metric = isDuration(config)
    ? `<label>초<input class="set-input" type="number" min="0" inputmode="numeric" data-edit-set-field="duration" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.duration)}"></label>`
    : `<label>횟수<input class="set-input" type="number" min="0" inputmode="numeric" data-edit-set-field="reps" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.reps)}"></label><label>RIR<input class="set-input" type="number" min="0" max="10" inputmode="numeric" data-edit-set-field="rir" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" value="${esc(set.rir)}"></label>`;
  return `<div class="edit-set-row"><b>${setIndex + 1}</b>${weight}${metric}<label class="edit-done">완료<input type="checkbox" data-edit-set-field="done" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" ${set.done ? 'checked' : ''}></label><button class="remove-item-btn" data-edit-action="remove-set" data-eidx="${exerciseIndex}" data-sidx="${setIndex}" aria-label="세트 삭제">×</button></div>`;
}
function renderSessionEditor() {
  const session = state.editingSession; if (!session) return;
  document.querySelector('#sessionEditTitle').textContent = state.editingSessionIsNew ? '과거 기록 추가' : '기록 편집';
  const logs = session.exercises.map((log, exerciseIndex) => {
    const exercise = exerciseById(log.exerciseId) || log;
    return `<section class="edit-log"><div class="edit-log-head"><div><b>${esc(exerciseNameFromLog(log))}</b><small>${esc(exerciseSubtitle(exercise))} · ${isDuration({ ...exercise, ...log }) ? '시간' : '횟수'} 기록</small></div><button class="ghost-btn compact-btn" data-edit-action="remove-log" data-eidx="${exerciseIndex}">운동 삭제</button></div><div class="edit-sets">${log.sets.map((set, setIndex) => editSetMarkup(set, log, exerciseIndex, setIndex)).join('')}</div><button class="secondary-btn compact-btn" data-edit-action="add-set" data-eidx="${exerciseIndex}">＋ 세트 추가</button></section>`;
  }).join('');
  document.querySelector('#sessionEditContent').innerHTML = `<div class="form-grid session-edit-meta"><label>운동 날짜 (오전 7시 기준)<input id="editSessionDate" class="text-input" type="date" max="${todayKey()}" value="${esc(session.date)}"></label><label>루틴 / 기록 이름<input id="editSessionName" class="text-input" value="${esc(session.routineName || '')}" placeholder="예: Back 또는 새벽 운동"></label></div>
    <div class="edit-log-list">${logs || '<div class="card empty-state compact-empty"><h3>운동을 추가해줘</h3><p>운동과 실제 수행 세트를 입력할 수 있어.</p></div>'}</div>
    <button class="secondary-btn wide edit-add-exercise" data-edit-action="add-exercise">＋ 운동 추가</button>
    <label class="session-note"><span>메모</span><textarea id="editSessionNotes" class="text-input" placeholder="컨디션, 자세, 통증 없이 느낀 점…">${esc(session.notes || '')}</textarea></label>
    <div class="session-edit-actions">${state.editingSessionIsNew ? '' : '<button class="danger-btn" data-edit-action="delete-session">기록 삭제</button>'}<button class="primary-btn" data-edit-action="save-session">저장</button></div>`;
}
function addExerciseToEditingSession(exerciseId) {
  const session = state.editingSession; const exercise = exerciseById(exerciseId);
  if (!session || !exercise) return toast('운동을 찾을 수 없어.');
  if (session.exercises.some(log => log.exerciseId === exerciseId)) return toast('이미 이 기록에 있는 운동이야.');
  session.exercises.push(createSessionLog(exercise, { targetSets: exercise.type === 'warmup' ? 1 : 3, type: exercise.type }));
  renderSessionEditor();
  const dialog = document.querySelector('#sessionEditDialog'); if (!dialog.open) dialog.showModal();
}
async function saveEditedSession() {
  const session = state.editingSession; if (!session) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date) || session.date > todayKey()) return toast('오늘 운동일보다 미래 날짜는 저장할 수 없어.');
  if (!session.exercises.length) return toast('운동을 하나 이상 추가해줘.');
  if (state.sessions.some(candidate => candidate.id !== session.id && candidate.date === session.date)) return toast('이 날짜에는 이미 다른 기록이 있어.');
  session.updatedAt = Date.now();
  if (!session.createdAt) session.createdAt = session.updatedAt;
  session.finishedAt = session.exercises.some(log => completedSets(log).length) ? session.finishedAt || Date.now() : null;
  await put(STORES.sessions, normalizeSession(session));
  document.querySelector('#sessionEditDialog').close(); state.editingSession = null;
  await refreshData(); renderHistory(); toast('운동 기록을 저장했어.');
}
async function deleteEditedSession() {
  const session = state.editingSession; if (!session || state.editingSessionIsNew) return;
  if (!await confirmAsk('이 기록 삭제', `${session.date} 운동 기록을 삭제할까? 백업이 없으면 되돌릴 수 없어.`)) return;
  await deleteRecord(STORES.sessions, session.id);
  document.querySelector('#sessionEditDialog').close(); state.editingSession = null;
  await refreshData(); renderHistory(); toast('기록을 삭제했어. 백업이 없으면 복구할 수 없어.');
}
function lineChartMarkup(values, suffix = '') {
  if (!values.length) return '<p class="muted small">표시할 기록이 없어.</p>';
  const width = 300; const height = 90; const padding = 8;
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(1, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + index * (width - padding * 2) / (values.length - 1);
    const y = height - padding - (value - min) / span * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${min}${suffix}에서 ${max}${suffix} 범위의 변화"><polyline points="${points}"></polyline>${points.split(' ').map(point => { const [x, y] = point.split(','); return `<circle cx="${x}" cy="${y}" r="3"></circle>`; }).join('')}</svg><div class="chart-range"><span>${formatKg(min)}${suffix}</span><span>${formatKg(max)}${suffix}</span></div>`;
}
function progressMarkup(range = historyPeriodRange()) {
  const completed = sessionsInRange(range, true);
  const muscleSets = {};
  const muscleVolumes = {};
  completed.forEach(session => session.exercises.forEach(log => {
    const exercise = exerciseById(log.exerciseId);
    if (exercise && !isWarmupLog(log)) {
      muscleSets[exercise.muscleGroup] = (muscleSets[exercise.muscleGroup] || 0) + log.sets.filter(set => set.done).length;
      muscleVolumes[exercise.muscleGroup] = (muscleVolumes[exercise.muscleGroup] || 0) + logVolume(log);
    }
  }));
  const topExercises = state.exercises.map(exercise => ({ exercise, e1rm: bestE1RMInSessions(exercise.id, completed) })).filter(item => item.e1rm > 0).sort((a, b) => b.e1rm - a.e1rm).slice(0, 5);
  const bodyWeights = [...settingValue('bodyWeightEntries', [])].filter(entry => entry.date >= range.from && entry.date <= range.to).sort((a, b) => a.date.localeCompare(b.date));
  const todayWeight = settingValue('bodyWeightEntries', []).find(entry => entry.date === todayKey())?.weight || '';
  const totals = periodTotals(completed, range.from, range.to); const previous = previousPeriodTotals(range);
  const buckets = periodBuckets(range, completed);
  const comparisonLabel = state.historyPeriod === 'all' ? '전체 누적' : '직전 같은 기간 대비';
  return `<div class="subsection-head"><h3>${esc(range.label)} 성장 지표</h3><p>위에서 고른 기간에 맞춰 목록과 모든 합계를 다시 계산해.</p></div>
    <div class="growth-grid">${growthMetric('훈련일', totals.days, previous?.days, '일', comparisonLabel)}${growthMetric('Hard sets', totals.sets, previous?.sets, '세트', comparisonLabel)}${growthMetric('볼륨', Math.round(totals.volume), previous ? Math.round(previous.volume) : null, 'kg', comparisonLabel)}</div>
    ${periodTrendCard('VOLUME TREND', buckets, 'volume', 'kg')}${periodTrendCard('HARD SET TREND', buckets, 'sets', '세트')}${periodTrendCard('TRAINING DAY TREND', buckets, 'days', '일')}
    <div class="card"><p class="eyebrow">MUSCLE · SETS / VOLUME</p>${Object.keys(muscleSets).length ? Object.entries(muscleSets).sort((a, b) => b[1] - a[1]).map(([muscle, value]) => `<div class="progress-row"><div class="progress-row-head"><span>${esc(muscleLabel(muscle))}</span><b>${value}세트 · ${Math.round(muscleVolumes[muscle] || 0).toLocaleString()}kg</b></div><div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, value / Math.max(1, totals.sets) * 100)}%"></div></div></div>`).join('') : '<p class="muted small">선택 기간에 완료 세트가 없어.</p>'}</div>
    <div class="card"><p class="eyebrow">ESTIMATED 1RM</p>${topExercises.length ? topExercises.map(item => `<button class="metric-row" data-action="exercise-detail" data-exercise-id="${esc(item.exercise.id)}"><span><b>${esc(item.exercise.name)}</b><small>최고 세트 기반 Epley 추정</small></span><strong>${formatKg(item.e1rm)} kg</strong></button>`).join('') : '<p class="muted small">운동 기록을 입력하면 표시된다.</p>'}</div>
    <div class="card body-weight-card"><div class="body-weight-head"><div><p class="eyebrow">BODY WEIGHT</p><h3>체중 변화</h3></div><div class="body-weight-input"><input id="bodyWeightInput" class="set-input" inputmode="decimal" value="${esc(todayWeight)}" placeholder="kg"><button class="secondary-btn compact-btn" data-action="save-body-weight">저장</button></div></div>${lineChartMarkup(bodyWeights.map(entry => num(entry.weight)), 'kg')}</div>`;
}

function periodTotals(sessions, from, to) {
  const period = sessions.filter(session => session.date >= from && session.date <= to);
  return { days: new Set(period.map(session => session.date)).size, sets: period.reduce((sum, session) => sum + hardSets(session), 0), volume: period.reduce((sum, session) => sum + sessionVolume(session), 0) };
}
function previousPeriodTotals(range) {
  if (state.historyPeriod === 'all') return null;
  const length = Math.round((dateFromKey(range.to) - dateFromKey(range.from)) / 86400000) + 1;
  const to = shiftDateKey(range.from, -1); const from = shiftDateKey(to, -(length - 1));
  return periodTotals(state.sessions.filter(session => session.exercises?.some(log => completedSets(log).length)), from, to);
}
function periodBuckets(range, sessions) {
  if (state.historyPeriod !== 'all') {
    const buckets = [];
    for (let date = range.from; date <= range.to; date = shiftDateKey(date, 1)) {
      const day = dateFromKey(date); buckets.push({ ...periodTotals(sessions, date, date), label: `${day.getMonth() + 1}/${day.getDate()}` });
    }
    return buckets;
  }
  const buckets = []; const cursor = dateFromKey(range.from); cursor.setDate(1); const last = dateFromKey(range.to);
  while (cursor <= last) {
    const start = localDateKey(cursor); const endDate = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 12); const end = localDateKey(endDate) > range.to ? range.to : localDateKey(endDate);
    buckets.push({ ...periodTotals(sessions, start, end), label: `${cursor.getFullYear()}.${cursor.getMonth() + 1}` }); cursor.setMonth(cursor.getMonth() + 1);
  }
  return buckets;
}
function bestE1RMInSessions(exerciseId, sessions) {
  const exercise = exerciseById(exerciseId);
  if (!exercise || isDuration(exercise) || ['assistance', 'none'].includes(exercise.loadMode)) return 0;
  return sessions.reduce((best, session) => {
    const estimates = (session.exercises || []).filter(log => log.exerciseId === exerciseId).flatMap(log => completedSets(log).map(set => epley(num(set.weight), num(set.reps))));
    return Math.max(best, ...estimates, 0);
  }, 0);
}
function growthMetric(label, current, previous, suffix, comparisonLabel) {
  const hasComparison = previous !== null && previous !== undefined;
  const change = hasComparison && previous > 0 ? Math.round((current - previous) / previous * 100) : hasComparison && current > 0 ? null : 0;
  const changeText = !hasComparison ? '누적' : change === null ? '새 기록' : `${change > 0 ? '+' : ''}${change}%`;
  const tone = !hasComparison || change === null || change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return `<div class="growth-card"><span>${label}</span><b>${Number(current).toLocaleString()}<small>${suffix}</small></b><em class="${tone}">${changeText}</em><small>${comparisonLabel}</small></div>`;
}
function periodTrendCard(title, buckets, field, suffix) {
  const values = buckets.map(bucket => num(bucket[field])); const total = values.reduce((sum, value) => sum + value, 0);
  return `<div class="card trend-card"><div class="trend-head"><p class="eyebrow">${title}</p><b>${formatKg(total)} ${suffix}</b></div>${lineChartMarkup(values, suffix)}<div class="chart-range"><span>${buckets[0]?.label || ''}</span><span>${buckets.at(-1)?.label || ''}</span></div></div>`;
}

function seriesCard(title, pairs, suffix, hint = '') {
  if (!pairs.length) return '';
  return `<div class="card trend-card"><div class="trend-head"><div><p class="eyebrow">${title}</p>${hint ? `<small>${esc(hint)}</small>` : ''}</div><b>${formatKg(pairs.at(-1).value)} ${suffix}</b></div>${lineChartMarkup(pairs.map(pair => pair.value), suffix)}<div class="chart-range"><span>${esc(pairs[0].date)}</span><span>${esc(pairs.at(-1).date)}</span></div></div>`;
}
function exerciseProgressMarkup() {
  const available = state.exercises.map(exercise => ({ exercise, count: exerciseHistory(exercise.id).length })).filter(item => item.count).sort((a, b) => b.count - a.count || a.exercise.name.localeCompare(b.exercise.name));
  if (!available.length) return `<div class="subsection-head"><h3>운동별 변화</h3><p>완료 기록이 쌓이면 종목별 중량과 횟수 흐름이 표시돼.</p></div>`;
  if (!available.some(item => item.exercise.id === state.historyExerciseId)) state.historyExerciseId = available[0].exercise.id;
  const exercise = exerciseById(state.historyExerciseId); const history = exerciseHistory(state.historyExerciseId);
  const items = history.map(({ session, log }) => ({ date: session.date, summary: summarizeExerciseLog(log, { ...exercise, ...log }) })).filter(item => item.summary.sets);
  const duration = isDuration(exercise);
  const reps = items.map(item => ({ date: item.date, value: item.summary.bestMetric }));
  const loads = items.map(item => ({ date: item.date, value: exercise.loadMode === 'assistance' ? item.summary.minPositiveLoad : item.summary.maxLoad })).filter(item => item.value > 0);
  const e1rms = items.map(item => ({ date: item.date, value: item.summary.bestE1RM })).filter(item => item.value > 0 && !['assistance', 'none'].includes(exercise.loadMode));
  const charts = duration ? seriesCard('HOLD TIME', reps, '초') : `${seriesCard('BEST REPS', reps, '회')}${seriesCard(exercise.loadMode === 'assistance' ? 'ASSISTANCE LOAD' : 'WORKING LOAD', loads, 'kg', exercise.loadMode === 'assistance' ? '낮아질수록 더 강한 수행' : '')}${seriesCard('ESTIMATED 1RM', e1rms, 'kg', 'Epley 추정치')}`;
  return `<div class="subsection-head"><h3>운동별 변화</h3><p>선택 기간과 별개로 이 종목의 전체 기록 흐름을 보여줘.</p></div><div class="exercise-trend-picker"><select id="historyExerciseSelect" class="text-input">${available.map(item => `<option value="${esc(item.exercise.id)}" ${item.exercise.id === exercise.id ? 'selected' : ''}>${esc(item.exercise.name)} · ${item.count}회</option>`).join('')}</select><button class="secondary-btn compact-btn" data-action="exercise-detail" data-exercise-id="${esc(exercise.id)}">상세</button></div>${charts || '<div class="card"><p class="muted small">그래프로 표시할 완료값이 없어.</p></div>'}`;
}

function feedbackPromptForRange(range) {
  const sessions = sessionsInRange(range, true).sort((a, b) => a.date.localeCompare(b.date));
  if (!sessions.length) return '';
  const totals = periodTotals(sessions, range.from, range.to);
  const totalDays = Math.round((dateFromKey(range.to) - dateFromKey(range.from)) / 86400000) + 1;
  const bodyWeights = [...settingValue('bodyWeightEntries', [])].filter(entry => entry.date <= range.to).sort((a, b) => a.date.localeCompare(b.date));
  const latestWeight = bodyWeights.at(-1);
  const sessionText = sessions.map(session => {
    const logs = session.exercises.filter(log => completedSets(log).length).map(log => {
      const exercise = exerciseById(log.exerciseId) || log; const config = { ...exercise, ...log };
      const sets = completedSets(log).map((set, index) => `${index + 1}세트 ${formatCompletedSet(set, config)}`).join(' / ');
      const previous = previousExerciseLog(log.exerciseId, session.date); const comparison = compareExerciseLogs(log, previous, config);
      const next = buildNextTarget(log, config);
      return `- ${exerciseNameFromLog(log)} (${muscleLabel(exercise.muscleGroup)}, 목표 ${targetText(config)}${isWarmupLog(log) ? ', 준비운동' : ''})\n  수행: ${sets}\n  판정: ${comparison.label} — ${comparison.detail}\n  앱의 다음 목표: ${formatNextTarget(next, config)}`;
    }).join('\n');
    return `### ${session.date} · ${session.routineName || '개별 운동'}\n세션 합계: ${hardSets(session)} hard sets, ${Math.round(sessionVolume(session)).toLocaleString()}kg volume${session.notes ? `\n메모: ${session.notes}` : ''}\n${logs}`;
  }).join('\n\n');
  return `너는 근거 중심의 운동 코치야. 아래 기록을 분석하되, 기록에 없는 사실은 추측하지 말고 통증이나 부상 신호가 있으면 증량보다 안전을 우선해줘.

[기록 조건]
- 앱: PR+ v${APP_VERSION}
- 분석 기간: ${range.label} (${range.from} ~ ${range.to})
- 운동일 경계: 오전 7시. 00:00~06:59 운동은 전날 기록으로 계산됨
- 볼륨은 중량 × 반복수의 합이며 시간 운동과 보조 중량 운동은 볼륨에서 제외됨

[기간 요약]
- 훈련일: ${totals.days}일
- 휴식/미등록일: ${Math.max(0, totalDays - totals.days)}일
- Hard sets: ${totals.sets}세트
- 총 볼륨: ${Math.round(totals.volume).toLocaleString()}kg
- 최근 체중: ${latestWeight ? `${latestWeight.weight}kg (${latestWeight.date})` : '기록 없음'}

[운동 기록]
${sessionText}

[피드백 요청]
1. 종목별 중량·횟수·RIR·유지시간이 실제로 발전 중인지 구분해줘.
2. 정체, 과도한 피로, 세트 수 불균형 가능성을 기록 근거와 함께 알려줘.
3. 다음 운동에서 유지/증량/반복 추가/감량 중 무엇을 선택할지 종목별로 제안해줘.
4. 자세나 통증은 기록만으로 판단할 수 없다는 한계를 분명히 하고, 내가 추가로 알려줘야 할 질문을 해줘.
5. 마지막에 다음 세션용 간단한 체크리스트를 만들어줘.`;
}
function showFeedbackPrompt(range) {
  const prompt = feedbackPromptForRange(range);
  if (!prompt) return toast('완료된 운동 기록이 있어야 요약할 수 있어.');
  document.querySelector('#feedbackPrompt').value = prompt;
  document.querySelector('#feedbackPromptRange').textContent = `${range.label} · 기록은 자동 전송되지 않아.`;
  document.querySelector('#feedbackDialog').showModal();
}
async function copyFeedbackPrompt() {
  const field = document.querySelector('#feedbackPrompt');
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(field.value);
    else { field.focus(); field.select(); if (!document.execCommand('copy')) throw new Error('copy failed'); }
    toast('GPT 상담용 텍스트를 복사했어. ChatGPT에 붙여넣으면 돼.');
  } catch (error) {
    console.error(error); field.focus(); field.select(); toast('자동 복사가 막혔어. 선택된 텍스트를 직접 복사해줘.');
  }
}

function renderLibrary() {
  app.innerHTML = `<div class="section-head"><div><h2>Exercise Library</h2><p>운동 목록과 루틴은 서로 독립적으로 관리돼.</p></div><button class="primary-btn compact-btn" data-action="create-library-exercise">＋ 추가</button></div>
    <input id="librarySearch" class="text-input library-search" type="search" value="${esc(state.libraryQuery)}" placeholder="운동 이름 검색" autocomplete="off">
    <div class="filter-chips" aria-label="부위 필터">${[['all', 'All'], ['favorites', '★ Favorite'], ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['legs', 'Legs'], ['arms', 'Arms'], ['other', 'Other']].map(([key, label]) => `<button class="filter-chip ${state.libraryFilter === key ? 'active' : ''}" data-action="filter-library" data-filter="${key}">${label}</button>`).join('')}</div>
    <div id="libraryList" class="library-list"></div>`;
  renderLibraryList();
}
function renderLibraryList() {
  const list = document.querySelector('#libraryList');
  if (!list) return;
  const query = state.libraryQuery.trim().toLowerCase();
  const filtered = state.exercises.filter(exercise => {
    const filterMatch = state.libraryFilter === 'all' || (state.libraryFilter === 'favorites' && exercise.favorite) || exercise.muscleGroup === state.libraryFilter ||
      (state.libraryFilter === 'arms' && ['biceps', 'triceps'].includes(exercise.muscleGroup)) ||
      (state.libraryFilter === 'other' && ['core', 'other'].includes(exercise.muscleGroup));
    return filterMatch && (!query || exerciseSearchText(exercise).includes(query));
  }).sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, 'en'));
  list.innerHTML = filtered.length ? filtered.map(exercise => {
    const preferred = preferredRoutineId(exercise);
    const options = `${preferred ? '' : '<option value="" selected>루틴 선택</option>'}${state.routines.map(routine => `<option value="${esc(routine.id)}" ${routine.id === preferred ? 'selected' : ''}>${esc(routine.name)}</option>`).join('')}`;
    return `<article class="library-item"><div class="library-item-main"><div class="library-title-row"><button class="favorite-btn ${exercise.favorite ? 'active' : ''}" data-action="toggle-favorite" data-exercise-id="${esc(exercise.id)}" aria-label="즐겨찾기">★</button><button class="library-detail-btn" data-action="exercise-detail" data-exercise-id="${esc(exercise.id)}"><b>${esc(exercise.name)}</b><span>${esc(exerciseSubtitle(exercise))}</span></button></div><small>${isDuration(exercise) ? `시간 · ${targetText(exercise)}` : `횟수 · ${targetText(exercise)}`}${exercise.type === 'warmup' ? ' · Warmup / Mobility' : ''}</small></div><div class="library-add-row"><select class="mini-select" aria-label="추가할 루틴">${options}</select><button class="secondary-btn compact-btn" data-action="add-library-to-routine" data-exercise-id="${esc(exercise.id)}">루틴에 추가</button></div></article>`;
  }).join('') : '<div class="card empty-state"><h3>검색 결과가 없어</h3><p>새 운동을 직접 추가할 수 있어.</p></div>';
}

function preferredRoutineId(exercise) {
  const defaultRoutineId = defaultRoutineIdForMuscle(exercise.muscleGroup);
  if (state.routines.some(routine => routine.id === defaultRoutineId)) return defaultRoutineId;
  const ranked = state.routines.map(routine => ({ routine, score: routine.items.reduce((score, item) => score + Number(exerciseById(item.exerciseId)?.muscleGroup === exercise.muscleGroup), 0) })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].routine.id : null;
}

function exerciseHistory(exerciseId) {
  return state.sessions.flatMap(session => (session.exercises || []).filter(log => log.exerciseId === exerciseId && completedSets(log).length)
    .map(log => ({ session, log }))).sort((a, b) => a.session.date.localeCompare(b.session.date));
}
function syncDetailFormMode() {
  const duration = document.querySelector('#detailTrackingMode')?.value === 'duration';
  document.querySelectorAll('[data-detail-mode]').forEach(element => element.classList.toggle('hidden', element.dataset.detailMode !== (duration ? 'duration' : 'reps')));
}
function showExerciseDetail(exerciseId) {
  const exercise = exerciseById(exerciseId);
  if (!exercise) return toast('운동 정보를 찾을 수 없어.');
  state.detailExerciseId = exerciseId;
  const history = exerciseHistory(exerciseId);
  const summaries = history.map(item => summarizeExerciseLog(item.log, { ...exercise, ...item.log })).filter(summary => summary.sets);
  const duration = isDuration(exercise);
  const hasE1RM = summaries.some(summary => summary.bestE1RM > 0) && !['assistance', 'none'].includes(exercise.loadMode);
  const series = summaries.map(summary => duration ? summary.bestMetric : hasE1RM ? summary.bestE1RM : summary.bestMetric);
  const suffix = duration ? '초' : hasE1RM ? 'kg' : '회';
  const repSeries = summaries.map(summary => summary.bestMetric);
  const loadSeries = summaries.map(summary => exercise.loadMode === 'assistance' ? summary.minPositiveLoad : summary.maxLoad).filter(value => value > 0);
  const progressCharts = duration
    ? `<div class="card detail-chart"><p class="eyebrow">HOLD TIME</p>${lineChartMarkup(series, '초')}</div>`
    : `${hasE1RM ? `<div class="card detail-chart"><p class="eyebrow">ESTIMATED 1RM</p>${lineChartMarkup(series, 'kg')}</div>` : ''}<div class="card detail-chart"><p class="eyebrow">REP PROGRESSION</p>${lineChartMarkup(repSeries, '회')}</div>${loadSeries.length ? `<div class="card detail-chart"><p class="eyebrow">${exercise.loadMode === 'assistance' ? 'ASSISTANCE (LOWER IS HARDER)' : 'LOAD PROGRESSION'}</p>${lineChartMarkup(loadSeries, 'kg')}</div>` : ''}`;
  const latest = summaries.at(-1);
  document.querySelector('#exerciseDetailTitle').textContent = exercise.name;
  document.querySelector('#exerciseDetailContent').innerHTML = `<p class="detail-subtitle">${esc(exerciseSubtitle(exercise))}</p>
    <div class="detail-stats"><div><span>세션</span><b>${history.length}</b></div><div><span>${duration ? '최장 유지' : hasE1RM ? '최고 e1RM' : '최고 반복'}</span><b>${latest ? formatKg(Math.max(...series)) : '—'}${latest ? suffix : ''}</b></div></div>
    ${progressCharts}
    <div class="detail-history"><h3>최근 기록</h3>${history.length ? [...history].reverse().slice(0, 8).map(({ session, log }) => `<div><time>${esc(session.date)}</time><span>${completedSets(log).map(set => esc(formatCompletedSet(set, { ...exercise, ...log }))).join(' · ')}</span></div>`).join('') : '<p class="muted small">완료 기록이 없어.</p>'}</div>
    <div class="divider"></div><h3>운동 설정</h3>
    <div class="form-grid detail-form">
      <label class="favorite-toggle"><input id="detailFavorite" type="checkbox" ${exercise.favorite ? 'checked' : ''}> 즐겨찾기</label>
      <label>기록 방식<select id="detailTrackingMode" class="text-input"><option value="reps" ${!duration ? 'selected' : ''}>횟수</option><option value="duration" ${duration ? 'selected' : ''}>시간(초)</option></select></label>
      <label>중량 방식<select id="detailLoadMode" class="text-input"><option value="external" ${exercise.loadMode === 'external' ? 'selected' : ''}>외부 중량</option><option value="assistance" ${exercise.loadMode === 'assistance' ? 'selected' : ''}>보조 중량</option><option value="bodyweight" ${exercise.loadMode === 'bodyweight' ? 'selected' : ''}>맨몸 / 추가 중량</option><option value="none" ${exercise.loadMode === 'none' ? 'selected' : ''}>중량 없음</option></select></label>
      <div class="range-grid" data-detail-mode="reps"><label>최소 반복<input id="detailRepMin" class="text-input" type="number" min="1" value="${exercise.repMin}"></label><label>최대 반복<input id="detailRepMax" class="text-input" type="number" min="1" value="${exercise.repMax}"></label></div>
      <div class="range-grid" data-detail-mode="duration"><label>최소 시간(초)<input id="detailDurationMin" class="text-input" type="number" min="1" value="${exercise.durationMin || 10}"></label><label>최대 시간(초)<input id="detailDurationMax" class="text-input" type="number" min="1" value="${exercise.durationMax || 60}"></label></div>
      <label data-detail-mode="duration">시간 목표 증가폭(초)<input id="detailMetricIncrement" class="text-input" type="number" min="1" value="${exercise.metricIncrement || 5}"></label>
      <label>중량 증가/감소폭(kg, 선택)<input id="detailWeightIncrement" class="text-input" type="number" min="0" step="0.25" value="${exercise.weightIncrement ?? ''}" placeholder="직접 설정 전에는 자동 증량 안 함"></label>
      <label>사용 가능한 중량 단위(kg, 선택)<input id="detailWeightStep" class="text-input" type="number" min="0" step="0.25" value="${exercise.weightStep ?? ''}" placeholder="예: 2.5"></label>
      <div class="range-grid" data-detail-mode="reps"><label>목표 RIR 최소<input id="detailRIRMin" class="text-input" type="number" min="0" max="10" value="${exercise.targetRIRMin}"></label><label>목표 RIR 최대<input id="detailRIRMax" class="text-input" type="number" min="0" max="10" value="${exercise.targetRIRMax}"></label></div>
      <label>운동 메모<textarea id="detailNotes" class="text-input" placeholder="자세 cue, 기구 세팅 등">${esc(exercise.notes || '')}</textarea></label>
    </div><button class="primary-btn wide" data-action="save-exercise-settings">설정 저장</button>`;
  syncDetailFormMode();
  const dialog = document.querySelector('#exerciseDetailDialog');
  if (!dialog.open) dialog.showModal();
}

function renderSettings() {
  const completed = state.sessions.filter(session => session.exercises?.some(log => completedSets(log).length)).length;
  const updateAvailable = state.updateStatus === 'available';
  const updateAction = updateAvailable ? 'apply-update' : 'check-update';
  const updateButton = updateAvailable ? '업데이트' : state.updateStatus === 'checking' || state.updateStatus === 'downloading' ? '확인 중…' : '업데이트 확인';
  const updateDisabled = ['checking', 'downloading', 'applying'].includes(state.updateStatus) ? 'disabled' : '';
  app.innerHTML = `<div class="section-head"><div><h2>설정</h2><p>데이터는 이 기기에 저장된다.</p></div></div>
    <div class="card setting-group"><h3>백업</h3><div class="setting-row"><div><b>JSON 백업 만들기</b><p>운동 · 루틴 · 세션 · 설정 전체 저장</p></div><button class="secondary-btn" data-action="export">내보내기</button></div><div class="setting-row"><div><b>백업 복원</b><p>구버전 데이터도 순서대로 변환 후 복원</p></div><button class="secondary-btn" data-action="import">가져오기</button></div></div>
    <div class="card setting-group"><h3>업데이트</h3><div class="setting-row"><div><b>${esc(updateStatusTitle())}</b><p>${esc(updateStatusMessage())}</p></div><button class="${updateAvailable ? 'primary-btn' : 'secondary-btn'} compact-btn" data-action="${updateAction}" ${updateDisabled}>${updateButton}</button></div><div class="setting-row"><div><b>현재 앱 버전</b><p>릴리스 ${esc(RELEASE_ID)} · 기록은 업데이트 후에도 유지</p></div><span class="badge">v${esc(APP_VERSION)}</span></div></div>
    <div class="card setting-group"><h3>운동</h3><div class="setting-row"><div><b>운동일 갱신</b><p>매일 오전 7시 · 00:00–06:59 기록은 전날로 저장</p></div><span class="badge">07:00</span></div><div class="setting-row"><div><b>세트 간 휴식 타이머</b><p>세트 완료 체크 시 자동 시작</p></div><label class="inline-number"><input id="restTimerSetting" type="number" min="30" max="600" step="15" value="${num(settingValue('restTimerSeconds', 120))}"><span>초</span></label></div><div class="setting-row"><div><b>Progressive Overload</b><p>운동별 반복 범위 · RIR · 중량 증가폭으로 계산</p></div><span class="badge">Double Progression</span></div></div>
    <div class="card setting-group"><h3>아이폰</h3><div class="setting-row"><div><b>아이폰 홈 화면</b><p>PWA로 설치해서 전체 화면 사용</p></div><button class="secondary-btn" data-action="install">설치 안내</button></div><div class="setting-row"><div><b>Dynamic Island 타이머</b><p>웹앱은 ActivityKit을 사용할 수 없어 미지원 · 앱 복귀 시 남은 시간은 즉시 보정</p></div><span class="badge limitation-badge">네이티브 필요</span></div></div>
    <div class="card setting-group"><h3>앱</h3><div class="setting-row"><div><b>로컬 데이터</b><p>${state.exercises.length}개 운동 · ${state.routines.length}개 루틴 · ${completed}개 완료 세션</p></div><span class="badge">기기 전용</span></div><div class="setting-row"><div><b>데이터 schema</b><p>v1부터 순차 migration 지원</p></div><span class="badge">v${DATA_SCHEMA_VERSION}</span></div></div>
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
  const targetSets = Math.max(1, num(options.targetSets || (options.type === 'warmup' ? 1 : 3)));
  return {
    exerciseId: exercise.id, name: exercise.name, displayName: exercise.displayName || '', muscleGroup: exercise.muscleGroup,
    type: options.type || exercise.type || 'strength', targetSets, repMin: num(options.repMin ?? exercise.repMin),
    repMax: num(options.repMax ?? exercise.repMax), durationMin: num(options.durationMin ?? exercise.durationMin),
    durationMax: num(options.durationMax ?? exercise.durationMax), trackingMode: options.trackingMode || exercise.trackingMode || 'reps',
    loadMode: options.loadMode || exercise.loadMode || 'external', metricIncrement: num(exercise.metricIncrement || 1),
    weightIncrement: exercise.weightIncrement ?? null, weightStep: exercise.weightStep ?? null,
    targetRIRMin: num(exercise.targetRIRMin ?? 1), targetRIRMax: num(exercise.targetRIRMax ?? 3),
    optional: Boolean(options.optional),
    sets: Array.from({ length: targetSets }, () => ({ weight: '', reps: '', duration: '', rir: '', done: false }))
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
  session.exercises.push(createSessionLog(exercise, { targetSets: exercise.type === 'warmup' ? 1 : 3, repMin: exercise.repMin, repMax: exercise.repMax, durationMin: exercise.durationMin, durationMax: exercise.durationMax, trackingMode: exercise.trackingMode, loadMode: exercise.loadMode, type: exercise.type }));
  await saveCurrentSession(); await refreshData(); render(); toast('오늘 운동에 추가했어.');
}
async function saveCurrentSession() {
  if (!state.currentSession) return;
  state.currentSession.updatedAt = Date.now(); await put(STORES.sessions, state.currentSession);
}
function clearDurationTimer() {
  clearInterval(state.durationTimerInterval); state.durationTimerInterval = null; state.durationTimer = null;
}
async function moveCurrentExercise(index, direction) {
  const exercises = state.currentSession?.exercises; const target = direction === 'up' ? index - 1 : index + 1;
  if (!exercises || target < 0 || target >= exercises.length) return;
  [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
  if (state.durationTimer?.exerciseIndex === index) state.durationTimer.exerciseIndex = target;
  else if (state.durationTimer?.exerciseIndex === target) state.durationTimer.exerciseIndex = index;
  await saveCurrentSession(); renderToday();
}
async function removeCurrentSet(exerciseIndex, setIndex) {
  const log = state.currentSession?.exercises[exerciseIndex]; const set = log?.sets[setIndex];
  if (!set) return;
  const hasRecord = set.done || [set.weight, set.reps, set.duration, set.rir].some(value => value !== '' && value !== null && value !== undefined);
  if (hasRecord && !await confirmAsk('세트 삭제', `${setIndex + 1}세트에 입력한 기록도 함께 삭제할까?`)) return;
  if (state.durationTimer?.exerciseIndex === exerciseIndex) {
    if (state.durationTimer.setIndex === setIndex) clearDurationTimer();
    else if (state.durationTimer.setIndex > setIndex) state.durationTimer.setIndex -= 1;
  }
  log.sets.splice(setIndex, 1); log.targetSets = log.sets.length;
  await saveCurrentSession(); renderToday(); toast('세트를 삭제했어.');
}
async function saveRoutine(routine) {
  routine.items = routine.items.map((item, order) => ({ ...item, order }));
  routine.updatedAt = Date.now(); await put(STORES.routines, routine);
}
async function addExerciseToRoutine(routineId, exerciseId) {
  const routine = routineById(routineId); const exercise = exerciseById(exerciseId);
  if (!routine || !exercise) return toast('루틴 또는 운동을 찾을 수 없어.');
  if (routine.items.some(item => item.exerciseId === exerciseId)) return toast('이미 이 루틴에 있는 운동이야.');
  routine.items.push({ exerciseId, order: routine.items.length, targetSets: exercise.type === 'warmup' ? 1 : 3, repMin: exercise.repMin, repMax: exercise.repMax, durationMin: exercise.durationMin, durationMax: exercise.durationMax, trackingMode: exercise.trackingMode, loadMode: exercise.loadMode, optional: false, type: exercise.type || 'strength' });
  await saveRoutine(routine); await refreshData(); render(); toast(`${routine.name} 루틴에 추가했어.`);
}

async function saveExerciseSettings() {
  const exercise = exerciseById(state.detailExerciseId);
  if (!exercise) return;
  const trackingMode = document.querySelector('#detailTrackingMode').value;
  const repMin = num(document.querySelector('#detailRepMin').value);
  const repMax = num(document.querySelector('#detailRepMax').value);
  const durationMin = num(document.querySelector('#detailDurationMin').value);
  const durationMax = num(document.querySelector('#detailDurationMax').value);
  const targetRIRMin = num(document.querySelector('#detailRIRMin').value);
  const targetRIRMax = num(document.querySelector('#detailRIRMax').value);
  if (trackingMode === 'reps' && (!repMin || repMin > repMax)) return toast('반복 범위를 확인해줘.');
  if (trackingMode === 'duration' && (!durationMin || durationMin > durationMax)) return toast('시간 범위를 확인해줘.');
  if (targetRIRMin > targetRIRMax) return toast('목표 RIR 범위를 확인해줘.');
  const updated = normalizeExercise({
    ...exercise, trackingMode, repMin, repMax, durationMin, durationMax,
    loadMode: document.querySelector('#detailLoadMode').value,
    metricIncrement: num(document.querySelector('#detailMetricIncrement').value) || 1,
    weightIncrement: document.querySelector('#detailWeightIncrement').value,
    weightStep: document.querySelector('#detailWeightStep').value,
    targetRIRMin, targetRIRMax, favorite: document.querySelector('#detailFavorite').checked,
    notes: document.querySelector('#detailNotes').value.trim(), updatedAt: Date.now()
  });
  const transaction = state.db.transaction([STORES.exercises, STORES.routines], 'readwrite');
  transaction.objectStore(STORES.exercises).put(updated);
  state.routines.forEach(routine => {
    let changed = false;
    routine.items.forEach(item => {
      if (item.exerciseId !== exercise.id) return;
      if (item.trackingMode !== trackingMode) {
        item.repMin = updated.repMin; item.repMax = updated.repMax;
        item.durationMin = updated.durationMin; item.durationMax = updated.durationMax;
      }
      item.trackingMode = trackingMode; item.loadMode = updated.loadMode; changed = true;
    });
    if (changed) transaction.objectStore(STORES.routines).put(routine);
  });
  await transactionComplete(transaction);
  await refreshData(); render(); showExerciseDetail(updated.id); toast('운동 설정을 저장했어.');
}
async function toggleFavorite(exerciseId) {
  const exercise = exerciseById(exerciseId);
  if (!exercise) return;
  await put(STORES.exercises, { ...exercise, favorite: !exercise.favorite, updatedAt: Date.now() });
  await refreshData(); render();
}
async function saveBodyWeight() {
  const input = document.querySelector('#bodyWeightInput');
  const weight = num(input?.value);
  if (weight <= 0 || weight > 500) return toast('체중 값을 확인해줘.');
  const entries = [...settingValue('bodyWeightEntries', [])].filter(entry => entry.date !== todayKey());
  entries.push({ date: todayKey(), weight });
  await saveSetting('bodyWeightEntries', entries.sort((a, b) => a.date.localeCompare(b.date)));
  renderHistory(); toast('오늘 체중을 저장했어.');
}

function updateRestTimer() {
  const timer = document.querySelector('#restTimer');
  if (!timer || !state.restTimerEnd) return;
  const remaining = Math.max(0, Math.ceil((state.restTimerEnd - Date.now()) / 1000));
  document.querySelector('#restTimerValue').textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  timer.classList.remove('hidden');
  if (remaining > 0) return;
  clearInterval(state.restTimerInterval); state.restTimerInterval = null; state.restTimerEnd = 0;
  timer.classList.add('finished');
  document.querySelector('#restTimerValue').textContent = 'READY';
  if (navigator.vibrate) navigator.vibrate([150, 100, 150]);
}
function startRestTimer() {
  const seconds = Math.max(30, num(settingValue('restTimerSeconds', 120)));
  state.restTimerEnd = Date.now() + seconds * 1000;
  clearInterval(state.restTimerInterval);
  document.querySelector('#restTimer')?.classList.remove('finished');
  updateRestTimer(); state.restTimerInterval = setInterval(updateRestTimer, 1000);
}
function dismissRestTimer() {
  clearInterval(state.restTimerInterval); state.restTimerInterval = null; state.restTimerEnd = 0;
  document.querySelector('#restTimer')?.classList.add('hidden');
}
function addRestTime(seconds = 30) {
  state.restTimerEnd = Math.max(Date.now(), state.restTimerEnd || Date.now()) + seconds * 1000;
  document.querySelector('#restTimer')?.classList.remove('finished');
  if (!state.restTimerInterval) state.restTimerInterval = setInterval(updateRestTimer, 1000);
  updateRestTimer();
}
function updateDurationTimerDisplay() {
  if (!state.durationTimer) return;
  const elapsed = Math.max(1, Math.floor((Date.now() - state.durationTimer.startedAt) / 1000));
  const { exerciseIndex, setIndex } = state.durationTimer;
  const input = document.querySelector(`[data-field="duration"][data-eidx="${exerciseIndex}"][data-sidx="${setIndex}"]`);
  const button = document.querySelector(`[data-action="toggle-duration-timer"][data-eidx="${exerciseIndex}"][data-sidx="${setIndex}"]`);
  if (input) input.value = elapsed;
  if (button) button.textContent = `정지 ${elapsed}초`;
}
async function toggleDurationTimer(exerciseIndex, setIndex) {
  if (state.durationTimer?.exerciseIndex === exerciseIndex && state.durationTimer?.setIndex === setIndex) {
    const elapsed = Math.max(1, Math.floor((Date.now() - state.durationTimer.startedAt) / 1000));
    const set = state.currentSession?.exercises[exerciseIndex]?.sets[setIndex];
    clearInterval(state.durationTimerInterval); state.durationTimerInterval = null; state.durationTimer = null;
    if (set) { set.duration = elapsed; set.done = true; await saveCurrentSession(); startRestTimer(); }
    await refreshData(); renderToday(); return;
  }
  clearInterval(state.durationTimerInterval);
  state.durationTimer = { exerciseIndex, setIndex, startedAt: Date.now() };
  state.durationTimerInterval = setInterval(updateDurationTimerDisplay, 250);
  renderToday(); updateDurationTimerDisplay();
}

function showExerciseDialog(mode = 'session', routineId = null) {
  state.exerciseDialogMode = mode; state.exerciseDialogRoutineId = routineId;
  const dialog = document.querySelector('#exerciseDialog'); const search = document.querySelector('#exerciseSearch');
  const title = document.querySelector('#exerciseDialogTitle'); const hint = document.querySelector('#exerciseDialogHint');
  if (mode === 'routine') { title.textContent = '루틴에 운동 추가'; hint.textContent = `${routineById(routineId)?.name || ''} 템플릿에만 추가돼.`; }
  else if (mode === 'editing-session') { title.textContent = '과거 기록에 운동 추가'; hint.textContent = '편집 중인 날짜의 기록에 추가돼.'; }
  else if (mode === 'library') { title.textContent = 'Exercise Library'; hint.textContent = '새 운동을 만들거나 기존 운동을 확인해.'; }
  else { title.textContent = '오늘 운동 추가'; hint.textContent = '현재 세션에만 운동을 추가해.'; }
  function fill(query = '') {
    const normalized = query.trim().toLowerCase();
    document.querySelector('#exerciseList').innerHTML = state.exercises.filter(exercise => !normalized || exerciseSearchText(exercise).includes(normalized)).slice(0, 40).map(exercise => `<button type="button" class="picker-item" data-pick="${esc(exercise.id)}"><span><b>${esc(exercise.name)}</b><br><small>${esc(exerciseSubtitle(exercise))} · ${targetText(exercise)}${exercise.type === 'warmup' ? ' · Warmup' : ''}</small></span><span>＋</span></button>`).join('');
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
  anchor.href = url; anchor.download = `pr-plus-backup-${localDateKey(new Date())}.json`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); toast(`schema v${DATA_SCHEMA_VERSION} 백업 파일을 만들었어.`);
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
  if (!settings.some(setting => setting.key === 'restTimerSeconds')) settings.push({ key: 'restTimerSeconds', value: 120 });
  if (!settings.some(setting => setting.key === 'bodyWeightEntries')) settings.push({ key: 'bodyWeightEntries', value: [] });
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
  if (element.matches('[data-session-note]') && state.currentSession) { state.currentSession.notes = element.value; await saveCurrentSession(); return; }
  if (!element.matches('[data-field]') || !state.currentSession) return;
  const set = state.currentSession.exercises[num(element.dataset.eidx)]?.sets[num(element.dataset.sidx)];
  if (!set) return;
  set[element.dataset.field] = element.dataset.field === 'done' ? element.checked : element.value;
  await saveCurrentSession();
});
app.addEventListener('change', async event => {
  const element = event.target;
  if (element.id === 'historyExerciseSelect') { state.historyExerciseId = element.value; renderHistory(); return; }
  if (element.matches('[data-field="done"]')) {
    const set = state.currentSession?.exercises[num(element.dataset.eidx)]?.sets[num(element.dataset.sidx)];
    if (set) { set.done = element.checked; await saveCurrentSession(); }
    if (element.checked) startRestTimer(); await refreshData(); renderToday(); return;
  }
  if (element.matches('[data-routine-field]')) {
    const routine = routineById(element.dataset.routineId); const item = routine?.items[num(element.dataset.itemIndex)];
    if (!item) return;
    const field = element.dataset.routineField; item[field] = Math.max(1, num(element.value));
    if (field.endsWith('Min')) { const maxField = field.replace('Min', 'Max'); if (item[field] > item[maxField]) item[maxField] = item[field]; }
    if (field.endsWith('Max')) { const minField = field.replace('Max', 'Min'); if (item[field] < item[minField]) item[minField] = item[field]; }
    await saveRoutine(routine); await refreshData(); renderRoutines();
  }
  if (element.id === 'restTimerSetting') {
    const seconds = Math.min(600, Math.max(30, num(element.value)));
    await saveSetting('restTimerSeconds', seconds); element.value = seconds; toast('휴식 시간을 저장했어.');
  }
  if (element.id === 'detailTrackingMode') syncDetailFormMode();
});

app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  if (action === 'add-exercise') showExerciseDialog('session');
  if (action === 'toggle-session-edit') { state.editTodayOrder = !state.editTodayOrder; renderToday(); }
  if (action === 'move-session-exercise') await moveCurrentExercise(num(button.dataset.eidx), button.dataset.direction);
  if (action === 'start-routine') await startRoutine(button.dataset.routineId);
  if (action === 'add-set') {
    const log = state.currentSession.exercises[num(button.dataset.eidx)]; const last = log.sets.at(-1) || {};
    log.sets.push({ weight: last.weight ?? '', reps: '', duration: '', rir: '', done: false }); log.targetSets = log.sets.length; await saveCurrentSession(); renderToday();
  }
  if (action === 'remove-set') await removeCurrentSet(num(button.dataset.eidx), num(button.dataset.sidx));
  if (action === 'copy-prev') {
    const log = state.currentSession.exercises[num(button.dataset.eidx)]; const previous = previousExerciseLog(log.exerciseId, state.currentSession.date);
    if (!previous) return toast('복사할 이전 기록이 없어.');
    log.sets = previous.sets.filter(set => set.done).map(set => ({ weight: set.weight, reps: set.reps, duration: set.duration ?? '', rir: set.rir, done: false }));
    await saveCurrentSession(); renderToday(); toast('지난 기록을 불러왔어. 완료 체크는 비워뒀어.');
  }
  if (action === 'remove-exercise' && await confirmAsk('운동 삭제', '오늘 세션에서 이 운동과 입력한 세트를 삭제할까?')) {
    const exerciseIndex = num(button.dataset.eidx);
    if (state.durationTimer?.exerciseIndex === exerciseIndex) clearDurationTimer();
    else if (state.durationTimer?.exerciseIndex > exerciseIndex) state.durationTimer.exerciseIndex -= 1;
    state.currentSession.exercises.splice(exerciseIndex, 1); await saveCurrentSession(); await refreshData(); render();
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
  if (action === 'toggle-favorite') await toggleFavorite(button.dataset.exerciseId);
  if (action === 'exercise-detail') showExerciseDetail(button.dataset.exerciseId);
  if (action === 'save-exercise-settings') await saveExerciseSettings();
  if (action === 'toggle-duration-timer') await toggleDurationTimer(num(button.dataset.eidx), num(button.dataset.sidx));
  if (action === 'save-body-weight') await saveBodyWeight();
  if (action === 'history-period') { state.historyPeriod = button.dataset.period; state.historyAnchor = todayKey(); state.historyLimit = 31; renderHistory(); }
  if (action === 'shift-history-period') { shiftHistoryPeriod(button.dataset.direction); renderHistory(); }
  if (action === 'feedback-history') showFeedbackPrompt(historyPeriodRange());
  if (action === 'feedback-today') showFeedbackPrompt(historyPeriodRange('day', state.currentSession?.date || todayKey()));
  if (action === 'add-library-to-routine') {
    const routineId = button.closest('.library-item')?.querySelector('.mini-select')?.value;
    if (routineId) await addExerciseToRoutine(routineId, button.dataset.exerciseId);
    else toast('이 부위의 기본 루틴이 없어. 추가할 루틴을 선택해줘.');
  }
  if (action === 'toggle-history') { state.expandedSessionId = state.expandedSessionId === button.dataset.sessionId ? null : button.dataset.sessionId; renderHistory(); }
  if (action === 'edit-session') showExistingSessionEditor(button.dataset.sessionId);
  if (action === 'add-past-session') showNewSessionEditor(button.dataset.date);
  if (action === 'load-more-history') { state.historyLimit += 31; renderHistory(); }
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
  else if (state.exerciseDialogMode === 'editing-session') addExerciseToEditingSession(button.dataset.pick);
  else toast('이미 Exercise Library에 등록된 운동이야.');
});
document.querySelector('#exerciseDialog').addEventListener('close', () => {
  if (state.exerciseDialogMode !== 'editing-session' || !state.editingSession) return;
  renderSessionEditor();
  const dialog = document.querySelector('#sessionEditDialog'); if (!dialog.open) dialog.showModal();
});
document.querySelector('#createExerciseBtn').addEventListener('click', async () => {
  const name = document.querySelector('#customExerciseName').value.trim();
  const displayName = document.querySelector('#customExerciseDisplayName').value.trim();
  const muscleGroup = document.querySelector('#customExerciseMuscle').value;
  const trackingMode = document.querySelector('#customTrackingMode').value;
  const loadMode = document.querySelector('#customLoadMode').value;
  const match = document.querySelector('#customTargetRange').value.trim().match(/(\d+)\s*[-~]\s*(\d+)/);
  if (!name || !match) return toast('이름과 목표 범위를 확인해줘.');
  if (findDefaultExercise(name) || findDefaultExercise(displayName) || state.exercises.some(exercise => exercise.name.toLowerCase() === name.toLowerCase())) return toast('같은 운동이 이미 Library에 있어.');
  const exercise = normalizeExercise({ id: uid('exercise'), name, displayName, muscleGroup, trackingMode, loadMode,
    repMin: trackingMode === 'reps' ? num(match[1]) : 0, repMax: trackingMode === 'reps' ? num(match[2]) : 0,
    durationMin: trackingMode === 'duration' ? num(match[1]) : 0, durationMax: trackingMode === 'duration' ? num(match[2]) : 0,
    metricIncrement: trackingMode === 'duration' ? 5 : 1, type: 'strength', builtIn: false, createdAt: Date.now() });
  if (num(match[1]) > num(match[2])) return toast('최소 목표는 최대 목표보다 클 수 없어.');
  await put(STORES.exercises, exercise); await refreshData(); document.querySelector('#exerciseDialog').close();
  document.querySelector('#customExerciseName').value = ''; document.querySelector('#customExerciseDisplayName').value = '';
  if (state.exerciseDialogMode === 'routine') await addExerciseToRoutine(state.exerciseDialogRoutineId, exercise.id);
  else if (state.exerciseDialogMode === 'session') await addExerciseToSession(exercise.id);
  else if (state.exerciseDialogMode === 'editing-session') addExerciseToEditingSession(exercise.id);
  else { render(); toast('Exercise Library에 추가했어.'); }
});

document.querySelector('#customTrackingMode').addEventListener('change', event => {
  const duration = event.target.value === 'duration';
  document.querySelector('#customTargetRangeLabel').firstChild.textContent = duration ? '시간 범위(초)' : '반복 범위';
  document.querySelector('#customTargetRange').value = duration ? '10-60' : '8-12';
  if (duration && document.querySelector('#customLoadMode').value === 'external') document.querySelector('#customLoadMode').value = 'none';
  if (!duration && document.querySelector('#customLoadMode').value === 'none') document.querySelector('#customLoadMode').value = 'external';
});

document.querySelector('#installBtn').addEventListener('click', showInstall);
document.querySelector('#versionBtn').addEventListener('click', () => state.updateStatus === 'available' ? applyUpdate() : checkForUpdate(true));
document.querySelector('#applyUpdateBtn').addEventListener('click', applyUpdate);
document.querySelector('#closeInstallDialog').addEventListener('click', () => document.querySelector('#installDialog').close());
document.querySelector('#closeExerciseDetailDialog').addEventListener('click', () => document.querySelector('#exerciseDetailDialog').close());
document.querySelector('#exerciseDetailDialog').addEventListener('click', async event => {
  const button = event.target.closest('[data-action="save-exercise-settings"]');
  if (button) await saveExerciseSettings();
});
document.querySelector('#exerciseDetailDialog').addEventListener('change', event => {
  if (event.target.id === 'detailTrackingMode') syncDetailFormMode();
});
document.querySelector('#closeSessionEditDialog').addEventListener('click', () => {
  document.querySelector('#sessionEditDialog').close(); state.editingSession = null;
});
document.querySelector('#closeFeedbackDialog').addEventListener('click', () => document.querySelector('#feedbackDialog').close());
document.querySelector('#copyFeedbackPrompt').addEventListener('click', copyFeedbackPrompt);
document.querySelector('#sessionEditDialog').addEventListener('input', event => {
  const session = state.editingSession; if (!session) return;
  if (event.target.id === 'editSessionDate') session.date = event.target.value;
  if (event.target.id === 'editSessionName') session.routineName = event.target.value;
  if (event.target.id === 'editSessionNotes') session.notes = event.target.value;
  if (event.target.matches('[data-edit-set-field]')) {
    const set = session.exercises[num(event.target.dataset.eidx)]?.sets[num(event.target.dataset.sidx)];
    if (set) set[event.target.dataset.editSetField] = event.target.dataset.editSetField === 'done' ? event.target.checked : event.target.value;
  }
});
document.querySelector('#sessionEditDialog').addEventListener('click', async event => {
  const button = event.target.closest('[data-edit-action]'); if (!button || !state.editingSession) return;
  const action = button.dataset.editAction; const exerciseIndex = num(button.dataset.eidx); const setIndex = num(button.dataset.sidx);
  if (action === 'add-exercise') {
    document.querySelector('#sessionEditDialog').close(); showExerciseDialog('editing-session'); return;
  }
  if (action === 'add-set') {
    state.editingSession.exercises[exerciseIndex]?.sets.push({ weight: '', reps: '', duration: '', rir: '', done: false }); renderSessionEditor(); return;
  }
  if (action === 'remove-set') {
    state.editingSession.exercises[exerciseIndex]?.sets.splice(setIndex, 1); renderSessionEditor(); return;
  }
  if (action === 'remove-log') {
    state.editingSession.exercises.splice(exerciseIndex, 1); renderSessionEditor(); return;
  }
  if (action === 'save-session') await saveEditedSession();
  if (action === 'delete-session') await deleteEditedSession();
});
document.querySelector('#restAddBtn').addEventListener('click', () => addRestTime(30));
document.querySelector('#restDismissBtn').addEventListener('click', dismissRestTimer);
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
  if (document.visibilityState !== 'visible') return;
  synchronizeTrainingDay(true).catch(console.error);
  scheduleTrainingDayRefresh();
  updateRestTimer(); updateDurationTimerDisplay();
  if (Date.now() - state.lastUpdateCheck > 30 * 60 * 1000) checkForUpdate(false);
});

(async function init() {
  try {
    state.db = await openDB(); await migrateStoredData(); await seedDefaults(); await refreshData();
    state.activeTrainingDay = todayKey(); scheduleTrainingDayRefresh(); render();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="card"><h2>저장소를 열 수 없어</h2><p class="muted">${esc(error.message || '브라우저의 사이트 데이터/개인정보 보호 설정을 확인해줘.')}</p></div>`;
  }
})();
