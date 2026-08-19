import {
  DATA_SCHEMA_VERSION,
  DEFAULT_EXERCISES,
  createDefaultRoutines,
  migrateBackupToLatest,
  migrateBackupV1ToV2,
  migrateBackupV2ToV3
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
  const chainedV1 = migrateBackupV2ToV3(migrateBackupV1ToV2(v1));
  assert(stable(v1) === originalV1, 'migration은 입력 백업을 직접 변경하면 안 된다.');
  assert(stable(migratedV1) === stable(chainedV1), 'v1은 v1→v2→v3 순서로 전이돼야 한다.');
  assert(migratedV1.schemaVersion === DATA_SCHEMA_VERSION, 'v1 백업은 최신 schema가 되어야 한다.');
  assert(migratedV1.exercises[0].id === 'default-1', '기존 exercise ID를 보존해야 한다.');
  assert(migratedV1.exercises[0].name === 'Barbell Bench Press', '기존 한글 운동명을 canonical name으로 보강해야 한다.');
  assert(migratedV1.sessions[0].exercises[0].sets[0].done === true, 'completed 필드는 done으로 전이돼야 한다.');

  const v2 = {
    app: 'PR+',
    version: 2,
    exercises: [{ id: 'custom-1', name: 'My Exercise', muscle: '기타', repMin: 8, repMax: 12 }],
    sessions: [{ id: 'session-v2', date: '2026-02-02', exercises: [] }],
    settings: []
  };
  const migratedV2 = migrateBackupToLatest(v2);
  assert(migratedV2.schemaVersion === 3, 'v2 백업은 v3로 전이돼야 한다.');
  assert(Array.isArray(migratedV2.routines), 'v3 백업에는 routines 배열이 있어야 한다.');
  assert(migratedV2.exercises[0].name === 'My Exercise', '사용자 운동명은 보존해야 한다.');
  assert(migratedV2.settings.some(setting => setting.key === 'schemaVersion' && setting.value === 3), '현재 schema 설정을 기록해야 한다.');

  const v3 = {
    app: 'PR+', schemaVersion: 3, version: 3,
    exercises: [{ id: 'exercise-v3', name: 'Current Exercise' }],
    routines: [{ id: 'routine-v3', name: 'Current', items: [] }],
    sessions: [{ id: 'session-v3', date: '2026-03-03', exercises: [] }],
    settings: [{ key: 'schemaVersion', value: 3 }]
  };
  assert(stable(migrateBackupToLatest(v3)) === stable(v3), '현재 schema 백업은 내용이 바뀌면 안 된다.');
  let futureRejected = false;
  try {
    migrateBackupToLatest({ ...v3, schemaVersion: 4, version: 4 });
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
