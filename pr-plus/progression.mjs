const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export const completedSets = log => (log?.sets || []).filter(set => set.done);
export const trackingModeOf = config => config?.trackingMode === 'duration' ? 'duration' : 'reps';
export const epley = (weight, reps) => number(weight) > 0 && number(reps) > 0 ? number(weight) * (1 + number(reps) / 30) : 0;

export function targetRange(config) {
  const duration = trackingModeOf(config) === 'duration';
  const min = duration ? number(config?.durationMin) : number(config?.repMin);
  const max = duration ? number(config?.durationMax) : number(config?.repMax);
  return { min, max: Math.max(min, max), unit: duration ? '초' : '회' };
}

export function metricOfSet(set, config) {
  return trackingModeOf(config) === 'duration' ? number(set?.duration) : number(set?.reps);
}

const measurableSets = (log, config) => completedSets(log).filter(set => set.setRole !== 'warmup' && metricOfSet(set, config) > 0);

export function summarizeExerciseLog(log, config = log) {
  const sets = measurableSets(log, config);
  const duration = trackingModeOf(config) === 'duration';
  const e1rmEligible = !duration && !['assistance', 'none'].includes(config?.loadMode);
  const metrics = sets.map(set => metricOfSet(set, config));
  const loads = sets.map(set => number(set.weight)).filter(value => value > 0);
  const rirs = sets.map(set => Number(set.rir)).filter(value => Number.isFinite(value));
  return {
    sets: sets.length,
    metrics,
    totalMetric: metrics.reduce((sum, value) => sum + value, 0),
    bestMetric: Math.max(0, ...metrics),
    totalReps: duration ? 0 : metrics.reduce((sum, value) => sum + value, 0),
    volume: duration ? 0 : sets.reduce((sum, set) => sum + number(set.weight) * number(set.reps), 0),
    maxLoad: Math.max(0, ...loads),
    minPositiveLoad: loads.length ? Math.min(...loads) : 0,
    bestE1RM: e1rmEligible ? Math.max(0, ...sets.map(set => epley(set.weight, set.reps))) : 0,
    averageRIR: rirs.length ? rirs.reduce((sum, value) => sum + value, 0) / rirs.length : null
  };
}

function nextLoad(previousSets, config) {
  const increment = number(config?.weightIncrement);
  const loadMode = config?.loadMode || 'external';
  if (increment <= 0 || ['none'].includes(loadMode)) return null;
  const loads = previousSets.map(set => number(set.weight)).filter(value => value > 0);
  if (!loads.length && loadMode !== 'bodyweight') return null;
  const base = loads.length ? loads[0] : 0;
  const raw = loadMode === 'assistance' ? Math.max(0, base - increment) : base + increment;
  const step = number(config?.weightStep);
  if (step <= 0) return raw;
  const rounded = loadMode === 'assistance' ? Math.floor(raw / step) * step : Math.ceil(raw / step) * step;
  return Number(Math.max(0, rounded).toFixed(3));
}

export function buildNextTarget(previousLog, config = previousLog) {
  const previousSets = measurableSets(previousLog, config);
  const duration = trackingModeOf(config) === 'duration';
  const { min, max, unit } = targetRange(config);
  const targetSets = Math.max(1, number(config?.targetSets) || previousSets.length || 1);
  if (!previousSets.length) {
    return { kind: 'baseline', unit, sets: [], message: '첫 완료 기록이 다음 목표의 기준이 돼.' };
  }

  const completedEnough = previousSets.length >= targetSets;
  const allAtTop = completedEnough && previousSets.slice(0, targetSets).every(set => metricOfSet(set, config) >= max);
  const targetRIRMin = number(config?.targetRIRMin);
  const effortReady = duration || previousSets.slice(0, targetSets).every(set => set.rir === '' || set.rir === null || set.rir === undefined || number(set.rir) >= targetRIRMin);
  if (allAtTop && !effortReady) {
    return {
      kind: 'maintain-effort', unit,
      sets: previousSets.slice(0, targetSets).map(set => ({ metric: metricOfSet(set, config), weight: number(set.weight) })),
      message: `반복 상단은 달성했지만 목표 RIR ${targetRIRMin} 이상이 아니어서 중량을 유지해.`
    };
  }
  const load = allAtTop && effortReady ? nextLoad(previousSets, config) : null;
  if (load !== null) {
    const verb = config?.loadMode === 'assistance' ? '보조 중량을 낮추고' : '중량을 올리고';
    return {
      kind: 'load', unit, load,
      sets: Array.from({ length: targetSets }, () => ({ metric: min, weight: load })),
      message: `${verb} 목표 범위 하단부터 다시 시작해.`
    };
  }
  if (allAtTop && effortReady) {
    return {
      kind: duration || config?.loadMode === 'none' ? 'maintain' : 'configure-load', unit,
      sets: previousSets.slice(0, targetSets).map(set => ({ metric: metricOfSet(set, config), weight: number(set.weight) })),
      message: duration || config?.loadMode === 'none'
        ? `상단 목표 ${max}${unit} 달성. 같은 품질로 유지하거나 목표 범위를 조정해.`
        : '상단 목표 달성. 운동 설정에서 중량 증가폭을 입력하면 다음 중량을 계산해.'
    };
  }

  const step = Math.max(1, number(config?.metricIncrement) || (duration ? 5 : 1));
  const sets = Array.from({ length: targetSets }, (_, index) => {
    const previous = previousSets[index] || {};
    return { metric: Math.max(min, metricOfSet(previous, config)), weight: number(previous.weight) };
  });
  const indexToBeat = sets.findIndex(set => set.metric < max);
  if (indexToBeat >= 0) sets[indexToBeat].metric = Math.min(max, sets[indexToBeat].metric + step);
  return {
    kind: duration ? 'duration' : 'reps', unit, sets,
    message: indexToBeat >= 0 ? `지난 기록보다 최소 ${step}${unit} 더 수행하는 목표야.` : `먼저 목표 세트 ${targetSets}개를 모두 완료해.`
  };
}

export function compareExerciseLogs(currentLog, previousLog, config = currentLog) {
  const current = summarizeExerciseLog(currentLog, config);
  const previous = summarizeExerciseLog(previousLog, config);
  if (!current.sets) return { status: 'pending', label: '기록 중', detail: '완료한 세트를 기준으로 비교해.' };
  if (!previous.sets) return { status: 'baseline', label: 'Baseline', detail: '첫 완료 기록을 저장하고 있어.' };
  if (trackingModeOf(config) === 'duration') {
    if (current.bestMetric > previous.bestMetric) return { status: 'improved', label: '발전', detail: `최장 유지 +${current.bestMetric - previous.bestMetric}초` };
    if (current.totalMetric > previous.totalMetric) return { status: 'improved', label: '발전', detail: `총 유지시간 +${current.totalMetric - previous.totalMetric}초` };
    if (current.bestMetric === previous.bestMetric && current.totalMetric === previous.totalMetric) return { status: 'same', label: '유지', detail: '지난 수행과 같아.' };
    return { status: 'below', label: '회복 필요', detail: '지난 시간보다 낮아. 컨디션과 자세를 우선해.' };
  }

  const loadMode = config?.loadMode || 'external';
  const harderLoad = loadMode === 'assistance'
    ? current.minPositiveLoad > 0 && previous.minPositiveLoad > 0 && current.minPositiveLoad < previous.minPositiveLoad
    : current.maxLoad > previous.maxLoad;
  if (harderLoad && current.totalReps >= previous.totalReps) return { status: 'improved', label: '발전', detail: loadMode === 'assistance' ? '보조 중량을 줄이고 반복을 유지했어.' : '더 무거운 중량에서 반복을 유지했어.' };
  if (current.bestE1RM > previous.bestE1RM + 0.05) return { status: 'improved', label: '발전', detail: `추정 1RM +${(current.bestE1RM - previous.bestE1RM).toFixed(1)}kg` };
  if (current.volume > previous.volume) return { status: 'improved', label: '발전', detail: `볼륨 +${Math.round(current.volume - previous.volume).toLocaleString()}kg` };
  if (current.totalReps > previous.totalReps && current.maxLoad >= previous.maxLoad) return { status: 'improved', label: '발전', detail: `같은 중량대에서 +${current.totalReps - previous.totalReps}회` };
  if (current.volume === previous.volume && current.totalReps === previous.totalReps && current.averageRIR !== null && previous.averageRIR !== null && current.averageRIR > previous.averageRIR) return { status: 'improved', label: '발전', detail: `같은 수행에서 RIR +${(current.averageRIR - previous.averageRIR).toFixed(1)}` };
  if (current.volume === previous.volume && current.totalReps === previous.totalReps) return { status: 'same', label: '유지', detail: '지난 수행과 같아.' };
  return { status: 'below', label: '회복 필요', detail: '지난 수행보다 낮아. 무리한 증량은 보류해.' };
}

export function detectPersonalRecords(currentLog, earlierLogs, config = currentLog) {
  const current = summarizeExerciseLog(currentLog, config);
  const earlier = (earlierLogs || []).map(log => summarizeExerciseLog(log, config)).filter(summary => summary.sets);
  if (!current.sets || !earlier.length) return [];
  if (trackingModeOf(config) === 'duration') {
    return current.bestMetric > Math.max(...earlier.map(summary => summary.bestMetric)) ? ['최장 시간 PR'] : [];
  }
  const records = [];
  if (current.bestE1RM > Math.max(...earlier.map(summary => summary.bestE1RM))) records.push('e1RM PR');
  if ((config?.loadMode || 'external') === 'assistance') {
    const previousLoads = earlier.map(summary => summary.minPositiveLoad).filter(Boolean);
    if (current.minPositiveLoad && previousLoads.length && current.minPositiveLoad < Math.min(...previousLoads)) records.push('최저 보조중량 PR');
  } else if (current.maxLoad > Math.max(...earlier.map(summary => summary.maxLoad))) records.push('최고 중량 PR');
  if (current.bestMetric > Math.max(...earlier.map(summary => summary.bestMetric))) records.push('최고 반복 PR');
  return [...new Set(records)];
}
