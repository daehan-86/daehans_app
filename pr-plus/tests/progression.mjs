import {
  buildNextTarget,
  compareExerciseLogs,
  detectPersonalRecords,
  summarizeExerciseLog
} from '../progression.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const done = (weight, reps, rir = 2) => ({ weight, reps, rir, done: true });
const repConfig = { trackingMode: 'reps', loadMode: 'external', targetSets: 3, repMin: 6, repMax: 10, metricIncrement: 1, targetRIRMin: 1, targetRIRMax: 3 };

const repTarget = buildNextTarget({ sets: [done(80, 8), done(80, 8), done(80, 7)] }, repConfig);
assert(repTarget.kind === 'reps', '반복 범위 안에서는 다음 반복 목표를 만들어야 한다.');
assert(repTarget.sets.map(set => set.metric).join('/') === '9/8/7', '지난 총 수행보다 최소 1회 높은 목표여야 한다.');

const loadTarget = buildNextTarget({ sets: [done(80, 10), done(80, 10), done(80, 10)] }, { ...repConfig, weightIncrement: 2.5, weightStep: 2.5 });
assert(loadTarget.kind === 'load' && loadTarget.load === 82.5, '모든 세트 상단 달성 시 설정한 단위로 증량해야 한다.');
assert(loadTarget.sets.every(set => set.metric === 6), '증량 후 반복 목표는 범위 하단으로 돌아가야 한다.');
const roundedLoad = buildNextTarget({ sets: [done(81, 10), done(81, 10), done(81, 10)] }, { ...repConfig, weightIncrement: 2.5, weightStep: 2.5 });
assert(roundedLoad.load === 85, '추천 중량은 사용 가능한 기구 단위로 올림해야 한다.');

const unconfigured = buildNextTarget({ sets: [done(80, 10), done(80, 10), done(80, 10)] }, repConfig);
assert(unconfigured.kind === 'configure-load', '사용자가 증가폭을 정하지 않았다면 임의 증량하면 안 된다.');
const rirBlocked = buildNextTarget({ sets: [done(80, 10, 0), done(80, 10, 0), done(80, 10, 0)] }, { ...repConfig, weightIncrement: 2.5 });
assert(rirBlocked.kind === 'maintain-effort', '상단 반복을 달성해도 목표 RIR 미달이면 증량을 보류해야 한다.');

const assisted = buildNextTarget({ sets: [done(40, 10), done(40, 10), done(40, 10)] }, { ...repConfig, loadMode: 'assistance', weightIncrement: 2.5, weightStep: 2.5 });
assert(assisted.load === 37.5, 'Assisted Pull-Up은 보조 중량을 낮추는 방향으로 발전해야 한다.');

const durationConfig = { trackingMode: 'duration', loadMode: 'bodyweight', targetSets: 1, durationMin: 10, durationMax: 60, metricIncrement: 5 };
const durationTarget = buildNextTarget({ sets: [{ duration: 20, done: true }] }, durationConfig);
assert(durationTarget.kind === 'duration' && durationTarget.sets[0].metric === 25, 'Dead Hang은 초 단위 다음 목표를 만들어야 한다.');
assert(buildNextTarget({ sets: [{ duration: '', done: true }] }, durationConfig).kind === 'baseline', '시간이 없던 v3 완료 기록으로 임의 목표를 추측하면 안 된다.');
const durationSummary = summarizeExerciseLog({ sets: [{ duration: 25, done: true }] }, durationConfig);
assert(durationSummary.bestMetric === 25 && durationSummary.volume === 0, '시간 운동을 중량 볼륨으로 계산하면 안 된다.');

const improved = compareExerciseLogs({ sets: [done(80, 9), done(80, 8), done(80, 7)] }, { sets: [done(80, 8), done(80, 8), done(80, 7)] }, repConfig);
assert(improved.status === 'improved', '같은 중량의 반복 증가를 발전으로 판정해야 한다.');
const rirImproved = compareExerciseLogs({ sets: [done(80, 8, 3)] }, { sets: [done(80, 8, 2)] }, { ...repConfig, targetSets: 1 });
assert(rirImproved.status === 'improved', '같은 수행에서 더 높은 RIR을 발전으로 판정해야 한다.');

const durationRecords = detectPersonalRecords({ sets: [{ duration: 45, done: true }] }, [{ sets: [{ duration: 30, done: true }] }], durationConfig);
assert(durationRecords.includes('최장 시간 PR'), '시간 기반 운동의 최장 기록 PR을 감지해야 한다.');
const strengthRecords = detectPersonalRecords({ sets: [done(82.5, 8)] }, [{ sets: [done(80, 8)] }], repConfig);
assert(strengthRecords.includes('최고 중량 PR') && strengthRecords.includes('e1RM PR'), '중량 및 e1RM PR을 감지해야 한다.');

console.log('Progression calculations: OK');
