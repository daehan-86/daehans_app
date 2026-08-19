export const APP_VERSION = '0.1.0';
export const RELEASE_ID = '0.1.0-r2';
export const DATA_SCHEMA_VERSION = 3;
export const DB_NAME = 'overload-db';
export const DB_VERSION = 2;
export const STORES = {
  exercises: 'exercises',
  routines: 'routines',
  sessions: 'sessions',
  settings: 'settings'
};

const MUSCLE_LABELS = {
  chest: '가슴',
  back: '등',
  shoulders: '어깨',
  legs: '하체',
  biceps: '이두',
  triceps: '삼두',
  core: '코어',
  other: '기타'
};

const LEGACY_MUSCLES = {
  가슴: 'chest', 등: 'back', 어깨: 'shoulders', 하체: 'legs',
  이두: 'biceps', 삼두: 'triceps', 코어: 'core', 기타: 'other'
};

export const DEFAULT_EXERCISES = [
  ['barbell-bench-press', 'Barbell Bench Press', '벤치프레스', 'chest', 6, 10],
  ['incline-dumbbell-press', 'Incline Dumbbell Press', '인클라인 덤벨프레스', 'chest', 8, 12],
  ['incline-machine-chest-press', 'Incline Machine Chest Press', '인클라인 머신 체스트프레스', 'chest', 8, 12],
  ['machine-chest-press', 'Machine Chest Press', '머신 체스트프레스', 'chest', 8, 12],
  ['pec-deck-fly', 'Pec Deck Fly', '펙덱 플라이', 'chest', 10, 15],
  ['lying-triceps-extension', 'Lying Triceps Extension', '라잉 트라이셉스 익스텐션', 'triceps', 8, 12],
  ['dead-hang', 'Dead Hang', '데드 행', 'back', 0, 0, 'warmup'],
  ['assisted-pull-up', 'Assisted Pull-Up', '어시스트 풀업', 'back', 6, 10],
  ['pull-up', 'Pull-Up', '풀업', 'back', 5, 10],
  ['straight-arm-pulldown', 'Straight-Arm Pulldown', '스트레이트 암 풀다운', 'back', 12, 15],
  ['lat-pulldown', 'Lat Pulldown', '랫풀다운', 'back', 8, 12],
  ['barbell-row', 'Barbell Row', '바벨 로우', 'back', 6, 10],
  ['seated-cable-row', 'Seated Cable Row', '시티드 케이블 로우', 'back', 8, 12],
  ['iso-lateral-front-lat-pulldown', 'Iso-Lateral Front Lat Pulldown', '아이소 래터럴 프론트 랫풀다운', 'back', 8, 12],
  ['barbell-curl', 'Barbell Curl', '바벨 컬', 'biceps', 8, 12],
  ['barbell-overhead-press', 'Barbell Overhead Press', '바벨 오버헤드프레스', 'shoulders', 6, 10],
  ['machine-shoulder-press', 'Machine Shoulder Press', '머신 숄더프레스', 'shoulders', 8, 12],
  ['barbell-front-raise', 'Barbell Front Raise', '바벨 프론트 레이즈', 'shoulders', 10, 15],
  ['dumbbell-lateral-raise', 'Dumbbell Lateral Raise', '덤벨 레터럴 레이즈', 'shoulders', 10, 20],
  ['cable-lateral-raise', 'Cable Lateral Raise', '케이블 레터럴 레이즈', 'shoulders', 12, 20],
  ['reverse-pec-deck-fly', 'Reverse Pec Deck Fly', '리버스 펙덱 플라이', 'shoulders', 12, 20],
  ['back-squat', 'Back Squat', '백 스쿼트', 'legs', 6, 10],
  ['hack-squat', 'Hack Squat', '핵 스쿼트', 'legs', 6, 10],
  ['romanian-deadlift', 'Romanian Deadlift', '루마니안 데드리프트', 'legs', 6, 10],
  ['leg-press', 'Leg Press', '레그프레스', 'legs', 8, 12],
  ['leg-curl', 'Leg Curl', '레그 컬', 'legs', 10, 15],
  ['leg-extension', 'Leg Extension', '레그 익스텐션', 'legs', 10, 15],
  ['standing-calf-raise', 'Standing Calf Raise', '스탠딩 카프 레이즈', 'legs', 8, 15],
  ['seated-calf-raise', 'Seated Calf Raise', '시티드 카프 레이즈', 'legs', 8, 15]
].map(([slug, name, displayName, muscleGroup, repMin, repMax, type = 'strength']) => ({
  id: `exercise-${slug}`,
  name,
  displayName,
  muscleGroup,
  muscle: MUSCLE_LABELS[muscleGroup],
  repMin,
  repMax,
  type,
  builtIn: true,
  createdAt: 0
}));

const LEGACY_NAMES = {
  '벤치프레스': 'Barbell Bench Press',
  '인클라인 덤벨프레스': 'Incline Dumbbell Press',
  '체스트프레스': 'Machine Chest Press',
  '랫풀다운': 'Lat Pulldown',
  '시티드 로우': 'Seated Cable Row',
  '바벨 로우': 'Barbell Row',
  '풀업': 'Pull-Up',
  '오버헤드프레스': 'Barbell Overhead Press',
  '머신 숄더프레스': 'Machine Shoulder Press',
  '레터럴 레이즈': 'Dumbbell Lateral Raise',
  '리버스 펙덱': 'Reverse Pec Deck Fly',
  '스쿼트': 'Back Squat',
  '레그프레스': 'Leg Press',
  '레그 익스텐션': 'Leg Extension',
  '레그 컬': 'Leg Curl',
  '루마니안 데드리프트': 'Romanian Deadlift',
  '바벨 컬': 'Barbell Curl'
};

const ROUTINE_DEFINITIONS = [
  {
    id: 'routine-chest', name: 'Chest', displayName: '가슴',
    items: [
      ['Barbell Bench Press', 3, 6, 10],
      ['Incline Dumbbell Press', 3, 8, 12],
      ['Machine Chest Press', 2, 8, 12],
      ['Pec Deck Fly', 2, 10, 15],
      ['Lying Triceps Extension', 3, 8, 12]
    ]
  },
  {
    id: 'routine-back', name: 'Back', displayName: '등',
    items: [
      ['Dead Hang', 1, 0, 0, false, 'warmup'],
      ['Assisted Pull-Up', 3, 6, 10],
      ['Barbell Row', 3, 6, 10],
      ['Lat Pulldown', 3, 8, 12],
      ['Seated Cable Row', 2, 8, 12],
      ['Straight-Arm Pulldown', 2, 12, 15, true],
      ['Barbell Curl', 3, 8, 12]
    ]
  },
  {
    id: 'routine-shoulders', name: 'Shoulders', displayName: '어깨',
    items: [
      ['Barbell Overhead Press', 3, 6, 10],
      ['Dumbbell Lateral Raise', 4, 10, 20],
      ['Cable Lateral Raise', 3, 12, 20],
      ['Reverse Pec Deck Fly', 3, 12, 20]
    ]
  },
  {
    id: 'routine-legs', name: 'Legs', displayName: '하체',
    items: [
      ['Hack Squat', 3, 6, 10],
      ['Romanian Deadlift', 3, 6, 10],
      ['Leg Press', 2, 8, 12],
      ['Leg Curl', 3, 10, 15],
      ['Leg Extension', 2, 10, 15],
      ['Standing Calf Raise', 4, 8, 15]
    ]
  }
];

const clone = value => JSON.parse(JSON.stringify(value));
const asArray = value => Array.isArray(value) ? value : [];
const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function muscleLabel(muscleGroup) {
  return MUSCLE_LABELS[muscleGroup] || muscleGroup || MUSCLE_LABELS.other;
}

export function normalizeMuscleGroup(value) {
  if (!value) return 'other';
  const normalized = String(value).toLowerCase();
  if (MUSCLE_LABELS[normalized]) return normalized;
  return LEGACY_MUSCLES[value] || 'other';
}

export function findDefaultExercise(value) {
  const name = String(value || '').trim().toLowerCase();
  const canonical = LEGACY_NAMES[value] || value;
  return DEFAULT_EXERCISES.find(exercise =>
    exercise.name.toLowerCase() === String(canonical || '').toLowerCase() ||
    exercise.displayName.toLowerCase() === name
  ) || null;
}

export function normalizeExercise(exercise) {
  const source = clone(exercise || {});
  const matched = findDefaultExercise(source.name) || findDefaultExercise(source.displayName);
  const name = matched?.name || String(source.name || source.displayName || 'Unnamed Exercise').trim();
  const displayName = matched?.displayName || String(source.displayName || '').trim();
  const muscleGroup = matched?.muscleGroup || normalizeMuscleGroup(source.muscleGroup || source.muscle);
  return {
    ...source,
    id: String(source.id || matched?.id || `exercise-${Date.now()}`),
    name,
    displayName,
    muscleGroup,
    muscle: muscleLabel(muscleGroup),
    repMin: finiteNumber(source.repMin, matched?.repMin ?? 8),
    repMax: finiteNumber(source.repMax, matched?.repMax ?? 12),
    type: source.type || matched?.type || 'strength',
    builtIn: Boolean(source.builtIn || matched),
    createdAt: finiteNumber(source.createdAt, 0)
  };
}

export function normalizeSession(session) {
  const source = clone(session || {});
  return {
    ...source,
    id: String(source.id || ''),
    date: String(source.date || '').slice(0, 10),
    exercises: asArray(source.exercises).map(log => ({
      ...log,
      exerciseId: String(log.exerciseId || ''),
      sets: asArray(log.sets).map(set => ({
        ...set,
        weight: set.weight ?? '',
        reps: set.reps ?? '',
        rir: set.rir ?? '',
        done: Boolean(set.done ?? set.completed)
      }))
    }))
  };
}

export function normalizeRoutine(routine) {
  const source = clone(routine || {});
  return {
    ...source,
    id: String(source.id || ''),
    name: String(source.name || 'Routine'),
    displayName: String(source.displayName || ''),
    order: Math.max(0, finiteNumber(source.order, 0)),
    items: asArray(source.items).map((item, index) => ({
      exerciseId: String(item.exerciseId || ''),
      order: index,
      targetSets: Math.max(1, finiteNumber(item.targetSets, 3)),
      repMin: Math.max(0, finiteNumber(item.repMin, 8)),
      repMax: Math.max(0, finiteNumber(item.repMax, 12)),
      optional: Boolean(item.optional),
      type: item.type || 'strength'
    }))
  };
}

export function createDefaultRoutines(exercises) {
  const records = asArray(exercises);
  return ROUTINE_DEFINITIONS.map((definition, routineOrder) => ({
    id: definition.id,
    name: definition.name,
    displayName: definition.displayName,
    order: routineOrder,
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
    items: definition.items.map(([name, targetSets, repMin, repMax, optional = false, type = 'strength'], order) => {
      const exercise = records.find(candidate => candidate.name === name) || DEFAULT_EXERCISES.find(candidate => candidate.name === name);
      return { exerciseId: exercise.id, order, targetSets, repMin, repMax, optional, type };
    })
  }));
}

export function detectBackupSchemaVersion(data) {
  if (Number.isInteger(data?.schemaVersion)) return data.schemaVersion;
  if (Number.isInteger(data?.version)) return data.version;
  return data?.app === 'OVERLOAD' ? 1 : 2;
}

export function migrateBackupV1ToV2(data) {
  return {
    ...clone(data),
    app: data?.app || 'OVERLOAD',
    version: 2,
    schemaVersion: 2,
    exercises: asArray(data?.exercises),
    sessions: asArray(data?.sessions),
    settings: asArray(data?.settings)
  };
}

export function migrateBackupV2ToV3(data) {
  return {
    ...clone(data),
    app: 'PR+',
    version: 3,
    schemaVersion: 3,
    exercises: asArray(data?.exercises).map(normalizeExercise),
    routines: asArray(data?.routines).map(normalizeRoutine),
    sessions: asArray(data?.sessions).map(normalizeSession),
    settings: asArray(data?.settings).filter(setting => setting?.key !== 'schemaVersion')
      .concat({ key: 'schemaVersion', value: 3 })
  };
}

const BACKUP_MIGRATIONS = {
  1: migrateBackupV1ToV2,
  2: migrateBackupV2ToV3
};

function validateRecordIds(records, label) {
  const ids = new Set();
  records.forEach(record => {
    if (!record || typeof record !== 'object' || !String(record.id || '')) throw new Error(`${label} 항목의 ID가 없어.`);
    if (ids.has(record.id)) throw new Error(`${label}에 중복 ID가 있어: ${record.id}`);
    ids.add(record.id);
  });
}

export function validateBackup(data) {
  if (!['PR+', 'OVERLOAD'].includes(data?.app)) throw new Error('PR+ 또는 OVERLOAD 백업 파일이 아니야.');
  if (!Array.isArray(data.exercises) || !Array.isArray(data.sessions)) throw new Error('운동 또는 세션 데이터가 올바르지 않아.');
  if (data.schemaVersion === DATA_SCHEMA_VERSION && !Array.isArray(data.routines)) throw new Error('루틴 데이터가 올바르지 않아.');
  validateRecordIds(data.exercises, '운동 목록');
  validateRecordIds(data.sessions, '세션 목록');
  if (Array.isArray(data.routines)) validateRecordIds(data.routines, '루틴 목록');
  data.sessions.forEach(session => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ''))) throw new Error(`세션 날짜가 올바르지 않아: ${session.id}`);
    if (!Array.isArray(session.exercises)) throw new Error(`세션 운동 목록이 올바르지 않아: ${session.id}`);
  });
  asArray(data.routines).forEach(routine => {
    if (!Array.isArray(routine.items)) throw new Error(`루틴 운동 목록이 올바르지 않아: ${routine.id}`);
  });
  return true;
}

export function migrateBackupToLatest(input) {
  const original = clone(input);
  validateBackup(original);
  let version = detectBackupSchemaVersion(original);
  if (version < 1 || version > DATA_SCHEMA_VERSION) throw new Error(`지원하지 않는 백업 schema v${version}이야.`);
  let migrated = original;
  while (version < DATA_SCHEMA_VERSION) {
    const migrate = BACKUP_MIGRATIONS[version];
    if (!migrate) throw new Error(`schema v${version}에서 다음 버전으로 가는 migration이 없어.`);
    migrated = migrate(migrated);
    version = migrated.schemaVersion;
  }
  validateBackup(migrated);
  return migrated;
}
