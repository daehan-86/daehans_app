import {
  COACH_PROTOCOL_VERSION, COACH_PLAN_START, COACH_PLAN_END,
  parseCoachPlanText, validateCoachPlan
} from '../coach-protocol.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rejects(action, message) {
  let rejected = false;
  try { action(); } catch { rejected = true; }
  assert(rejected, message);
}

const request = {
  protocol: 'PRPLUS_COACH_REQUEST', protocolVersion: '1.1', requestId: 'request-test-1', contextHash: 'sha256:test',
  exerciseCatalog: [
    { exerciseId: 'exercise-bench', name: 'Bench Press', trackingMode: 'reps', loadMode: 'external', weightBasis: 'total' },
    { exerciseId: 'exercise-hang', name: 'Dead Hang', trackingMode: 'duration', loadMode: 'none', weightBasis: null }
  ],
  routines: [{ routineId: 'routine-chest', name: 'Chest', items: [] }]
};

const ready = {
  protocol: 'PRPLUS_COACH_PLAN', protocolVersion: '1.1', requestId: request.requestId, contextHash: request.contextHash,
  planId: 'plan-test-1', status: 'ready', title: 'GPT 추천', createdAt: '2026-08-25T18:00:00+09:00',
  validFrom: '2026-08-25', validThrough: '2026-08-31', coachMessage: '반복 증가에 집중합니다.', warnings: [], questions: [],
  sessions: [{
    trainingDate: '2026-08-26', name: '추천 가슴', baseRoutineId: 'routine-chest', rationale: '직전 기록을 기준으로 합니다.',
    exercises: [{
      order: 1, exerciseId: 'exercise-bench', exerciseName: 'Bench Press', trackingMode: 'reps', loadMode: 'external',
      direction: 'increase_reps', reason: '중량을 유지하고 반복수를 높입니다.',
      sets: [{ set: 1, setRole: 'working', targetWeightKg: 60, targetReps: 10, targetDurationSec: null, targetRir: 2 }]
    }]
  }]
};

function run() {
  assert(COACH_PROTOCOL_VERSION === '1.1', 'Coach Protocol은 v1.1이어야 한다.');
  const text = `설명\n\`\`\`text\n${COACH_PLAN_START}\n${JSON.stringify(ready)}\n${COACH_PLAN_END}\n\`\`\``;
  const parsed = parseCoachPlanText(text);
  const normalized = validateCoachPlan(parsed, request);
  assert(normalized.status === 'ready' && normalized.sessions.length === 1, 'ready 추천 계획을 가져와야 한다.');
  assert(normalized.sessions[0].exercises[0].sets[0].setRole === 'working', 'setRole을 보존해야 한다.');
  assert(normalized.sessions[0].exercises[0].sets[0].targetWeightKg === 60, '세트별 GPT 목표를 보존해야 한다.');

  const needsInput = {
    ...ready, planId: 'plan-needs-input', status: 'needs_input', sessions: [],
    coachMessage: '통증 정보를 먼저 확인합니다.', warnings: ['어깨 통증 때문에 계획을 보류했습니다.'], questions: ['통증 강도를 알려주세요.']
  };
  const held = validateCoachPlan(needsInput, request);
  assert(held.status === 'needs_input' && held.sessions.length === 0, 'needs_input은 빈 세션 계획을 허용해야 한다.');

  rejects(() => validateCoachPlan({ ...needsInput, warnings: [], questions: [] }, request), '보류 이유가 없는 needs_input은 거부해야 한다.');
  rejects(() => validateCoachPlan({ ...ready, sessions: [] }, request), '세션이 없는 ready 계획은 거부해야 한다.');
  rejects(() => validateCoachPlan({ ...ready, contextHash: 'sha256:wrong' }, request), 'contextHash가 다른 계획은 거부해야 한다.');
  rejects(() => validateCoachPlan({ ...ready, sessions: [{ ...ready.sessions[0], exercises: [{ ...ready.sessions[0].exercises[0], exerciseId: 'invented' }] }] }, request), '요청에 없는 운동 ID는 거부해야 한다.');
  rejects(() => validateCoachPlan({ ...ready, sessions: [{ ...ready.sessions[0], exercises: [{ ...ready.sessions[0].exercises[0], sets: [{ ...ready.sessions[0].exercises[0].sets[0], setRole: 'unknown' }] }] }] }, request), '알 수 없는 setRole은 거부해야 한다.');
  rejects(() => parseCoachPlanText(`${text}\n${COACH_PLAN_START}\n{}\n${COACH_PLAN_END}`), '추천 계획 블록이 두 개면 거부해야 한다.');
  return 'Coach protocol v1.1: OK';
}

try {
  const result = run();
  if (typeof document !== 'undefined') document.querySelector('#result').textContent = result;
  console.log(result);
} catch (error) {
  if (typeof document !== 'undefined') document.querySelector('#result').textContent = `FAIL: ${error.message}`;
  console.error(error);
  throw error;
}
