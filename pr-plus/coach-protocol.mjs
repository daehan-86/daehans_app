export const COACH_PROTOCOL_VERSION = '1.1';
export const COACH_REQUEST_START = '<<<PRPLUS_COACH_REQUEST>>>';
export const COACH_REQUEST_END = '<<<END_PRPLUS_COACH_REQUEST>>>';
export const COACH_PLAN_START = '<<<PRPLUS_COACH_PLAN>>>';
export const COACH_PLAN_END = '<<<END_PRPLUS_COACH_PLAN>>>';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SET_ROLES = new Set(['warmup', 'working', 'backoff']);
const TRACKING_MODES = new Set(['reps', 'duration']);
const LOAD_MODES = new Set(['external', 'assistance', 'bodyweight', 'none']);
const DIRECTIONS = new Set([
  'maintain', 'increase_reps', 'increase_load', 'decrease_assistance',
  'increase_duration', 'deload', 'reduce_sets', 'technique_focus'
]);

const clone = value => JSON.parse(JSON.stringify(value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

function protocolError(message) {
  const error = new Error(message);
  error.name = 'CoachProtocolError';
  return error;
}

function requiredText(value, label, maximum = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw protocolError(`${label}이(가) 비어 있어.`);
  if (value.length > maximum) throw protocolError(`${label}은(는) ${maximum}자를 넘을 수 없어.`);
  return value.trim();
}

function optionalText(value, label, maximum = 1000) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') throw protocolError(`${label}은(는) 문자열이어야 해.`);
  if (value.length > maximum) throw protocolError(`${label}은(는) ${maximum}자를 넘을 수 없어.`);
  return value.trim();
}

function stringList(value, label) {
  if (!Array.isArray(value)) throw protocolError(`${label}은(는) 배열이어야 해.`);
  return value.map((item, index) => optionalText(item, `${label} ${index + 1}`)).filter(Boolean);
}

function dateText(value, label) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || Number.isNaN(new Date(`${value}T12:00:00`).getTime())) {
    throw protocolError(`${label} 날짜 형식이 올바르지 않아.`);
  }
  return value;
}

function boundedNumber(value, label, minimum, maximum, nullable = false, integer = false) {
  if (nullable && (value === null || value === undefined)) return null;
  if (!finite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw protocolError(`${label} 값은 ${minimum}~${maximum}${integer ? ' 정수' : ''}여야 해.`);
  }
  return value;
}

function extractSingleBlock(text, start, end) {
  if (typeof text !== 'string') throw protocolError('붙여넣은 추천이 텍스트가 아니야.');
  const firstStart = text.indexOf(start);
  const firstEnd = text.indexOf(end);
  if (firstStart < 0 || firstEnd < 0 || firstEnd < firstStart) throw protocolError('GPT 추천 계획의 시작·종료 표식을 찾을 수 없어.');
  if (text.indexOf(start, firstStart + start.length) >= 0 || text.indexOf(end, firstEnd + end.length) >= 0) {
    throw protocolError('GPT 추천 계획 블록은 정확히 하나만 있어야 해.');
  }
  return text.slice(firstStart + start.length, firstEnd).trim();
}

export function parseCoachPlanText(text) {
  const json = extractSingleBlock(text, COACH_PLAN_START, COACH_PLAN_END);
  try {
    return JSON.parse(json);
  } catch {
    throw protocolError('GPT 추천 계획의 JSON 문법이 올바르지 않아.');
  }
}

function normalizeTargetSet(set, exercise, index) {
  if (!plainObject(set)) throw protocolError(`${exercise.exerciseName} ${index + 1}세트가 객체가 아니야.`);
  const setNumber = boundedNumber(set.set, `${exercise.exerciseName} 세트 번호`, 1, 12, false, true);
  if (setNumber !== index + 1) throw protocolError(`${exercise.exerciseName} 세트 번호는 1부터 연속이어야 해.`);
  const setRole = set.setRole === null || set.setRole === undefined ? null : set.setRole;
  if (setRole !== null && !SET_ROLES.has(setRole)) throw protocolError(`${exercise.exerciseName}의 setRole이 올바르지 않아.`);
  const targetRir = boundedNumber(set.targetRir, `${exercise.exerciseName} 목표 RIR`, 0, 10, true);
  let targetReps = null;
  let targetDurationSec = null;
  if (exercise.trackingMode === 'reps') {
    targetReps = boundedNumber(set.targetReps, `${exercise.exerciseName} 목표 반복`, 1, 200, false, true);
    if (set.targetDurationSec !== null && set.targetDurationSec !== undefined) throw protocolError(`${exercise.exerciseName} 반복 운동에 시간 목표가 함께 들어 있어.`);
  } else {
    targetDurationSec = boundedNumber(set.targetDurationSec, `${exercise.exerciseName} 목표 시간`, 1, 600, false, true);
    if (set.targetReps !== null && set.targetReps !== undefined) throw protocolError(`${exercise.exerciseName} 시간 운동에 반복 목표가 함께 들어 있어.`);
  }
  const weighted = ['external', 'assistance'].includes(exercise.loadMode);
  const targetWeightKg = boundedNumber(set.targetWeightKg, `${exercise.exerciseName} 목표 중량`, 0, 1000, !weighted);
  if (weighted && targetWeightKg === null) throw protocolError(`${exercise.exerciseName}의 목표 중량이 없어.`);
  if (!weighted && targetWeightKg !== null) throw protocolError(`${exercise.exerciseName}의 중량 방식에는 목표 중량을 사용할 수 없어.`);
  return { set: setNumber, setRole, targetWeightKg, targetReps, targetDurationSec, targetRir };
}

function normalizePlanExercise(exercise, index, catalog) {
  if (!plainObject(exercise)) throw protocolError(`추천 운동 ${index + 1}이 객체가 아니야.`);
  const exerciseId = requiredText(exercise.exerciseId, `추천 운동 ${index + 1} ID`, 200);
  const known = catalog.get(exerciseId);
  if (!known) throw protocolError(`Exercise Library에 없는 운동 ID야: ${exerciseId}`);
  const exerciseName = requiredText(exercise.exerciseName, `${exerciseId} 이름`, 200);
  if (!TRACKING_MODES.has(exercise.trackingMode) || exercise.trackingMode !== known.trackingMode) throw protocolError(`${exerciseName}의 기록 방식이 요청 데이터와 달라.`);
  if (!LOAD_MODES.has(exercise.loadMode) || exercise.loadMode !== known.loadMode) throw protocolError(`${exerciseName}의 중량 방식이 요청 데이터와 달라.`);
  if (!DIRECTIONS.has(exercise.direction)) throw protocolError(`${exerciseName}의 추천 방향이 올바르지 않아.`);
  if (!Array.isArray(exercise.sets) || exercise.sets.length < 1 || exercise.sets.length > 12) throw protocolError(`${exerciseName}은(는) 1~12세트여야 해.`);
  const normalized = {
    order: boundedNumber(exercise.order, `${exerciseName} 운동 순서`, 1, 20, false, true),
    exerciseId,
    exerciseName,
    trackingMode: exercise.trackingMode,
    loadMode: exercise.loadMode,
    direction: exercise.direction,
    reason: requiredText(exercise.reason, `${exerciseName} 추천 이유`)
  };
  normalized.sets = exercise.sets.map((set, setIndex) => normalizeTargetSet(set, normalized, setIndex));
  return normalized;
}

function normalizePlanSession(session, index, request) {
  if (!plainObject(session)) throw protocolError(`추천 세션 ${index + 1}이 객체가 아니야.`);
  const trainingDate = dateText(session.trainingDate, `추천 세션 ${index + 1}`);
  const baseRoutineId = session.baseRoutineId === null || session.baseRoutineId === undefined ? null : requiredText(session.baseRoutineId, '기반 루틴 ID', 200);
  if (baseRoutineId && !request.routines?.some(routine => routine.routineId === baseRoutineId)) throw protocolError(`요청에 없는 기반 루틴이야: ${baseRoutineId}`);
  if (!Array.isArray(session.exercises) || session.exercises.length < 1 || session.exercises.length > 20) throw protocolError(`${trainingDate} 추천은 운동 1~20개여야 해.`);
  const catalog = new Map(request.exerciseCatalog.map(exercise => [exercise.exerciseId, exercise]));
  const exercises = session.exercises.map((exercise, exerciseIndex) => normalizePlanExercise(exercise, exerciseIndex, catalog));
  if (new Set(exercises.map(exercise => exercise.exerciseId)).size !== exercises.length) throw protocolError(`${trainingDate} 추천에 같은 운동이 중복됐어.`);
  exercises.forEach((exercise, exerciseIndex) => {
    if (exercise.order !== exerciseIndex + 1) throw protocolError(`${trainingDate} 운동 순서는 1부터 연속이어야 해.`);
  });
  return {
    trainingDate,
    name: requiredText(session.name, `${trainingDate} 세션 이름`, 200),
    baseRoutineId,
    rationale: requiredText(session.rationale, `${trainingDate} 추천 근거`),
    exercises
  };
}

export function validateCoachPlan(raw, request, existingPlanIds = []) {
  if (!plainObject(raw)) throw protocolError('GPT 추천 계획이 JSON 객체가 아니야.');
  if (!plainObject(request) || request.protocol !== 'PRPLUS_COACH_REQUEST') throw protocolError('이 추천의 원본 PR+ 요청을 찾을 수 없어.');
  if (request.protocolVersion !== COACH_PROTOCOL_VERSION) throw protocolError('원본 PR+ 요청의 protocol version을 지원하지 않아.');
  if (raw.protocol !== 'PRPLUS_COACH_PLAN') throw protocolError('PRPLUS_COACH_PLAN 응답이 아니야.');
  if (raw.protocolVersion !== COACH_PROTOCOL_VERSION) throw protocolError(`지원하지 않는 Coach Protocol v${raw.protocolVersion || '?'}이야.`);
  if (raw.requestId !== request.requestId) throw protocolError('추천의 requestId가 원본 요청과 달라.');
  if (raw.contextHash !== request.contextHash) throw protocolError('추천의 contextHash가 원본 요청과 달라.');
  const planId = requiredText(raw.planId, 'planId', 200);
  if (existingPlanIds.includes(planId)) throw protocolError('이미 가져온 GPT 추천 계획이야.');
  if (!['ready', 'needs_input'].includes(raw.status)) throw protocolError('계획 status는 ready 또는 needs_input이어야 해.');
  const warnings = stringList(raw.warnings, 'warnings');
  const questions = stringList(raw.questions, 'questions');
  if (!Array.isArray(raw.sessions)) throw protocolError('sessions가 배열이 아니야.');
  if (raw.status === 'ready' && (raw.sessions.length < 1 || raw.sessions.length > 14)) throw protocolError('ready 계획에는 1~14개의 세션이 필요해.');
  if (raw.status === 'needs_input' && raw.sessions.length) throw protocolError('needs_input 계획의 sessions는 비어 있어야 해.');
  if (raw.status === 'needs_input' && !warnings.length && !questions.length) throw protocolError('needs_input 계획에는 보류 이유나 질문이 필요해.');
  const validFrom = dateText(raw.validFrom, '계획 시작일');
  const validThrough = dateText(raw.validThrough, '계획 종료일');
  if (validFrom > validThrough) throw protocolError('계획 시작일이 종료일보다 늦어.');
  const sessions = raw.sessions.map((session, index) => normalizePlanSession(session, index, request));
  if (new Set(sessions.map(session => session.trainingDate)).size !== sessions.length) throw protocolError('같은 운동일에 추천 세션이 두 개 이상 있어.');
  sessions.forEach(session => {
    if (session.trainingDate < validFrom || session.trainingDate > validThrough) throw protocolError(`${session.trainingDate} 세션이 계획 유효기간 밖에 있어.`);
    if (request.requestedPeriod?.from && session.trainingDate < request.requestedPeriod.from) throw protocolError(`${session.trainingDate} 세션이 요청한 기간보다 앞에 있어.`);
    if (request.requestedPeriod?.through && session.trainingDate > request.requestedPeriod.through) throw protocolError(`${session.trainingDate} 세션이 요청한 기간보다 뒤에 있어.`);
  });
  if (request.requestedPeriod?.maximumSessions && sessions.length > request.requestedPeriod.maximumSessions) throw protocolError('요청한 최대 세션 수를 초과했어.');
  return {
    id: planId,
    protocol: 'PRPLUS_COACH_PLAN',
    protocolVersion: COACH_PROTOCOL_VERSION,
    requestId: raw.requestId,
    contextHash: raw.contextHash,
    planId,
    status: raw.status,
    title: requiredText(raw.title, '계획 제목', 200),
    createdAt: requiredText(raw.createdAt, '계획 생성 시각', 100),
    validFrom,
    validThrough,
    coachMessage: requiredText(raw.coachMessage, '코치 메시지'),
    sessions,
    warnings,
    questions
  };
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!plainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}

export function stableCoachJSON(value) {
  return JSON.stringify(sortObject(value));
}

export async function hashCoachContext(value) {
  const bytes = new TextEncoder().encode(stableCoachJSON(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function coachRequestBlock(request) {
  return `${COACH_REQUEST_START}\n${JSON.stringify(request, null, 2)}\n${COACH_REQUEST_END}`;
}

export function coachRequestText(request) {
  return `첨부된 PR+ Coach Text Protocol v${COACH_PROTOCOL_VERSION}을 적용해 내 운동 기록을 분석해줘.\n기록에 없는 사실은 추측하지 말고, 답변 마지막에 복사 가능한 PRPLUS_COACH_PLAN 블록을 정확히 하나 만들어줘.\n\n${coachRequestBlock(clone(request))}`;
}
