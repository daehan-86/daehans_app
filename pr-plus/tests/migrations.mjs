import {
  DATA_SCHEMA_VERSION,
  DEFAULT_EXERCISES,
  createDefaultRoutines,
  defaultRoutineIdForMuscle,
  nextTrainingDayBoundary,
  trainingDayKey,
  migrateBackupToLatest,
  migrateBackupV1ToV2,
  migrateBackupV2ToV3,
  migrateBackupV3ToV4,
  migrateBackupV4ToV5
} from '../data.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function stable(value) {
  return JSON.stringify(value);
}

function run() {
  assert(DEFAULT_EXERCISES.length === 29, 'Exercise Library에는 기본 운동 29개가 있어야 한다.');
  const names = new Set(DEFAULT_EXERCISES.map(exercise => exercise.name));
  [
    'Barbell Bench Press', 'Incline Machine Chest Press', 'Dead Hang',
    'Iso-Lateral Front Lat Pulldown', 'Barbell Front Raise', 'Back Squat',
    'Seated Calf Raise'
  ].forEach(name => assert(names.has(name), `기본 운동이 누락됐다: ${name}`));

  const routines = createDefaultRoutines(DEFAULT_EXERCISES);
  assert(routines.length === 4, '기본 루틴은 4개여야 한다.');
  const chest = routines.find(routine => routine.id === 'routine-chest');
  const back = routines.find(routine => routine.id === 'routine-back');
  const shoulders = routines.find(routine => routine.id === 'routine-shoulders');
  const legs = routines.find(routine => routine.id === 'routine-legs');
  assert(chest.items.reduce((sum, item) => sum + item.targetSets, 0) === 13, 'Chest 루틴은 13세트여야 한다.');
  assert(back.items[0].type === 'warmup', 'Back 루틴은 Dead Hang 준비운동으로 시작해야 한다.');
  assert(back.items[0].trackingMode === 'duration' && back.items[0].durationMin === 10 && back.items[0].durationMax === 60, 'Dead Hang은 10–60초 시간 기반이어야 한다.');
  assert(DEFAULT_EXERCISES.find(exercise => exercise.name === 'Dead Hang').trackingMode === 'duration', 'Dead Hang 운동은 시간 기반이어야 한다.');
  assert(DEFAULT_EXERCISES.filter(exercise => exercise.trackingMode === 'reps').length === 28, '나머지 기본 운동 28개는 횟수 기반이어야 한다.');
  assert(defaultRoutineIdForMuscle('chest') === 'routine-chest', '가슴 운동의 기본 선택은 Chest여야 한다.');
  assert(defaultRoutineIdForMuscle('triceps') === 'routine-chest', '삼두 운동의 기본 선택은 Chest여야 한다.');
  assert(defaultRoutineIdForMuscle('back') === 'routine-back' && defaultRoutineIdForMuscle('biceps') === 'routine-back', '등과 이두 운동의 기본 선택은 Back이어야 한다.');
  assert(defaultRoutineIdForMuscle('shoulders') === 'routine-shoulders', '어깨 운동의 기본 선택은 Shoulders여야 한다.');
  assert(defaultRoutineIdForMuscle('legs') === 'routine-legs', '하체 운동의 기본 선택은 Legs여야 한다.');
  assert(defaultRoutineIdForMuscle('core') === null, '전용 루틴이 없는 부위는 잘못된 기본 루틴을 선택하면 안 된다.');
  assert(trainingDayKey(new Date(2026, 7, 19, 6, 59)) === '2026-08-18', '오전 6:59 기록은 전날 운동이어야 한다.');
  assert(trainingDayKey(new Date(2026, 7, 19, 7, 0)) === '2026-08-19', '오전 7:00부터 새 운동일이어야 한다.');
  const nextBoundary = nextTrainingDayBoundary(new Date(2026, 7, 19, 7, 0));
  assert(nextBoundary.getDate() === 20 && nextBoundary.getHours() === 7, '오전 7시 이후 다음 갱신은 다음 날 오전 7시여야 한다.');
  assert(back.items.find(item => item.exerciseId === 'exercise-straight-arm-pulldown')?.optional, 'Straight-Arm Pulldown은 선택 운동이어야 한다.');
  assert(shoulders.items.length === 4, 'Shoulders 기본 루틴은 4개 운동이어야 한다.');
  assert(legs.items[0].exerciseId === 'exercise-hack-squat', 'Legs 기본 첫 운동은 Hack Squat이어야 한다.');

  const v1 = {
    app: 'OVERLOAD',
    version: 1,
    exercises: [{ id: 'default-1', name: '벤치프레스', muscle: '가슴', repMin: 6, repMax: 10, createdAt: 0 }],
    sessions: [{ id: 'session-old', date: '2026-01-01', exercises: [{ exerciseId: 'default-1', sets: [{ weight: 80, reps: 8, rir: 2, completed: true }] }] }]
  };
  const originalV1 = stable(v1);
  const migratedV1 = migrateBackupToLatest(v1);
  const chainedV1 = migrateBackupV4ToV5(migrateBackupV3ToV4(migrateBackupV2ToV3(migrateBackupV1ToV2(v1))));
  assert(stable(v1) === originalV1, 'migration은 입력 백업을 직접 변경하면 안 된다.');
  assert(stable(migratedV1) === stable(chainedV1), 'v1은 v1→v2→v3 순서로 전이돼야 한다.');
  assert(migratedV1.schemaVersion === DATA_SCHEMA_VERSION, 'v1 백업은 최신 schema가 되어야 한다.');
  assert(migratedV1.exercises[0].id === 'default-1', '기존 exercise ID를 보존해야 한다.');
  assert(migratedV1.exercises[0].name === 'Barbell Bench Press', '기존 한글 운동명을 canonical name으로 보강해야 한다.');
  assert(migratedV1.sessions[0].exercises[0].sets[0].done === true, 'completed 필드는 done으로 전이돼야 한다.');
  assert(migratedV1.sessions[0].exercises[0].sets[0].setRole === null, '알 수 없는 legacy 세트 역할은 추측하면 안 된다.');

  const v2 = {
    app: 'PR+',
    version: 2,
    exercises: [{ id: 'custom-1', name: 'My Exercise', muscle: '기타', repMin: 8, repMax: 12 }],
    sessions: [{ id: 'session-v2', date: '2026-02-02', exercises: [] }],
    settings: []
  };
  const migratedV2 = migrateBackupToLatest(v2);
  assert(migratedV2.schemaVersion === 5, 'v2 백업은 v5로 전이돼야 한다.');
  assert(Array.isArray(migratedV2.routines), 'v5 백업에는 routines 배열이 있어야 한다.');
  assert(migratedV2.exercises[0].name === 'My Exercise', '사용자 운동명은 보존해야 한다.');
  assert(migratedV2.settings.some(setting => setting.key === 'schemaVersion' && setting.value === 5), '현재 schema 설정을 기록해야 한다.');
  assert(Array.isArray(migratedV2.coachPlans), 'v5 백업에는 GPT 추천 계획 배열이 있어야 한다.');

  const v3 = {
    app: 'PR+', schemaVersion: 3, version: 3,
    exercises: [{ id: 'exercise-dead-hang', name: 'Dead Hang', type: 'warmup' }],
    routines: [{ id: 'routine-v3', name: 'Current', items: [{ exerciseId: 'exercise-dead-hang', targetSets: 1, repMin: 0, repMax: 0, type: 'warmup' }] }],
    sessions: [{ id: 'session-v3', date: '2026-03-03', exercises: [{ exerciseId: 'exercise-dead-hang', sets: [{ completed: true }] }] }],
    settings: [{ key: 'schemaVersion', value: 3 }]
  };
  const originalV3 = stable(v3);
  const migratedV3 = migrateBackupToLatest(v3);
  assert(stable(v3) === originalV3, 'v3→v4 migration은 입력을 직접 변경하면 안 된다.');
  assert(migratedV3.schemaVersion === 5, 'v3 백업은 v5로 전이돼야 한다.');
  assert(migratedV3.exercises[0].trackingMode === 'duration', 'v3 Dead Hang은 시간 기반으로 전이돼야 한다.');
  assert(migratedV3.routines[0].items[0].durationMax === 60, 'v3 Dead Hang 루틴은 초 단위 목표를 받아야 한다.');
  assert(migratedV3.sessions[0].exercises[0].sets[0].duration === '', '기존 완료 기록은 보존하고 빈 시간 필드를 추가해야 한다.');
  assert(migratedV3.settings.some(setting => setting.key === 'restTimerSeconds' && setting.value === 120), 'v4 휴식 타이머 기본 설정을 추가해야 한다.');
  assert(migratedV3.settings.some(setting => setting.key === 'bodyWeightEntries' && Array.isArray(setting.value)), 'v4 체중 기록 설정을 추가해야 한다.');

  const v4 = {
    app: 'PR+', schemaVersion: 4, version: 4,
    exercises: [{ id: 'exercise-v4', name: 'Current Exercise', trackingMode: 'reps' }],
    routines: [{ id: 'routine-v4', name: 'Current', items: [] }],
    sessions: [{ id: 'session-v4', date: '2026-04-04', exercises: [] }],
    settings: [{ key: 'schemaVersion', value: 4 }]
  };
  const originalV4 = stable(v4);
  const migratedV4 = migrateBackupToLatest(v4);
  assert(stable(v4) === originalV4, 'v4→v5 migration은 입력을 직접 변경하면 안 된다.');
  assert(migratedV4.schemaVersion === 5 && Array.isArray(migratedV4.coachPlans), 'v4는 빈 coachPlans를 가진 v5로 전이돼야 한다.');
  assert(migratedV4.exercises[0].weightBasis === null, '기존 중량 표시 기준은 추측하면 안 된다.');
  assert(Array.isArray(migratedV4.sessions[0].symptoms), 'v5 세션에는 구조화된 증상 배열이 있어야 한다.');
  let invalidV4Rejected = false;
  try {
    migrateBackupToLatest({ ...v4, exercises: [{ ...v4.exercises[0], trackingMode: 'duration', durationMin: 60, durationMax: 10 }] });
  } catch {
    invalidV4Rejected = true;
  }
  assert(invalidV4Rejected, '손상된 v4 시간 범위를 복원하면 안 된다.');
  const v5 = {
    app: 'PR+', schemaVersion: 5, version: 5,
    exercises: [{ id: 'exercise-v5', name: 'Current Exercise', trackingMode: 'reps', loadMode: 'external', weightBasis: 'per_hand', repMin: 8, repMax: 12 }],
    routines: [{ id: 'routine-v5', name: 'Current', items: [] }],
    sessions: [{ id: 'session-v5', date: '2026-05-05', symptoms: [{ exerciseId: 'exercise-v5', location: 'right_shoulder', severity: 3, note: '' }], exercises: [{ exerciseId: 'exercise-v5', trackingMode: 'reps', sets: [{ weight: 10, reps: 10, duration: '', rir: 2, setRole: 'working', done: true }] }] }],
    settings: [{ key: 'schemaVersion', value: 5 }], coachPlans: []
  };
  assert(stable(migrateBackupToLatest(v5)) === stable(v5), '현재 v5 schema 백업은 내용이 바뀌면 안 된다.');
  let invalidV5Rejected = false;
  try { migrateBackupToLatest({ ...v5, sessions: [{ ...v5.sessions[0], symptoms: [{ location: 'shoulder', severity: 11 }] }] }); } catch { invalidV5Rejected = true; }
  assert(invalidV5Rejected, '범위를 벗어난 증상 강도는 복원하면 안 된다.');
  let futureRejected = false;
  try {
    migrateBackupToLatest({ ...v5, schemaVersion: 6, version: 6 });
  } catch {
    futureRejected = true;
  }
  assert(futureRejected, '알 수 없는 미래 schema를 구버전으로 잘못 변환하면 안 된다.');
  return 'Migration fixtures: OK';
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
