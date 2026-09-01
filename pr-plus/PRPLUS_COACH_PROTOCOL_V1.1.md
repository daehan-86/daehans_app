# PR+ Coach Text Protocol v1.1

> Protocol ID: `PRPLUS_COACH_PROTOCOL`  
> Protocol version: `1.1`  
> Status: Stable  
> Language: Korean coaching text + JSON data  
> Transport: Manual copy and paste

이 문서는 PR+와 GPT 사이에서 운동 기록과 추천 계획을 안전하게 주고받기 위한 텍스트 프로토콜의 전체 명세다. 이 문서를 GPT의 참고 자료로 제공한 뒤, PR+가 생성한 요청문을 보내면 GPT는 이 명세에 맞는 추천 계획을 반환해야 한다. v1.1은 v1.0의 전체 구조를 유지하면서 세트 역할, 구조화된 증상, 중량 표시 기준과 안전한 계획 보류를 추가한다.

프로토콜 버전은 PR+ 앱 버전이나 PR+ 백업 데이터 schema version과 독립적이다. 호환되지 않는 변경이 필요하면 protocol version을 `2.0`으로 올려야 한다.

---

## 1. 목적

이 프로토콜은 다음 왕복 과정을 지원한다.

1. PR+가 사용자의 프로필, 운동 라이브러리, 루틴, 실제 운동 기록과 앱 자체 추천을 텍스트로 내보낸다.
2. 사용자가 요청문 전체를 GPT에 복사한다.
3. GPT는 기록에 근거해 다음 운동의 날짜, 종목, 세트별 중량·횟수·유지시간·목표 RIR을 제안한다.
4. 사용자는 GPT 답변의 `PRPLUS_COACH_PLAN` 블록 전체를 PR+에 붙여넣는다.
5. PR+는 내용을 검증하고 미리보기를 제공한 뒤 사용자가 승인한 계획만 저장한다.
6. 추천 목표와 실제 수행 결과는 서로 분리되어 저장된다.
7. 실제 수행 결과와 추천 달성 여부는 다음 요청에 다시 포함될 수 있다.

PR+와 GPT는 이 프로토콜을 통해 자동 연결되지 않는다. 사용자가 직접 복사하고 붙여넣으며, PR+는 사용자의 명시적인 승인 없이 추천을 저장하거나 운동 기록을 변경하지 않는다.

---

## 2. 반드시 지켜야 하는 원칙

### 2.1 기록 근거

- GPT는 요청문에 포함된 데이터만 사실로 사용한다.
- 기록에 없는 중량, 횟수, 통증, 회복 상태, 장비 또는 운동 경험을 추측하지 않는다.
- 정보가 부족하면 `questions`에 질문을 추가한다.
- 계산된 추정 1RM은 실제 1RM으로 단정하지 않는다.
- 시간 운동과 보조 중량 운동은 PR+의 일반 중량 볼륨 합계에서 제외된다는 점을 유지한다.

### 2.2 안전

- 통증, 부상 또는 비정상적인 증상이 언급되면 증량보다 중단, 감량 또는 전문가 확인을 우선한다.
- 의학적 진단이나 치료를 제공하지 않는다.
- 명확한 근거 없이 급격한 중량·볼륨 증가를 제안하지 않는다.
- 실패 지점까지의 반복을 일괄적으로 강요하지 않는다.
- 사용자가 직접 제공한 제한사항은 모든 추천보다 우선한다.

### 2.3 데이터 보존

- GPT 추천은 사용자의 기존 루틴을 직접 수정하거나 덮어쓰지 않는다.
- GPT 추천은 별도의 계획으로 저장되며, 운동 시작 시 해당 세션에 추천 스냅샷이 복사된다.
- 추천값은 실제 수행값이 아니다. 실제 세트는 사용자가 직접 입력하고 완료해야 한다.
- 같은 `planId`를 가진 계획은 중복 계획으로 취급한다.
- 과거 운동 기록을 수정하거나 삭제하라는 명령은 이 프로토콜에서 지원하지 않는다.

### 2.4 운동 식별

- 추천하는 모든 운동은 요청문의 `exerciseCatalog`에 존재해야 한다.
- `exerciseId`를 가장 우선적인 식별자로 사용한다.
- 이름이 같아 보여도 ID가 다르면 같은 운동으로 단정하지 않는다.
- GPT는 새로운 `exerciseId`를 만들지 않는다.
- 필요한 운동이 카탈로그에 없다면 추천 계획에 임의로 추가하지 말고 `questions`에 필요한 운동을 설명한다.

---

## 3. 공통 값 규칙

### 3.1 날짜와 운동일

- 날짜는 `YYYY-MM-DD` 형식을 사용한다.
- 시각은 시간대가 포함된 ISO 8601 형식을 사용한다.
- PR+ 운동일은 `Asia/Seoul` 오전 7시에 바뀐다.
- 오전 0시부터 6시 59분까지 수행한 운동은 전날 운동일에 속한다.
- `trainingDate`는 달력 날짜가 아니라 이 운동일 규칙이 적용된 날짜다.

### 3.2 단위

- 중량: `kg`
- 시간: 정수 `seconds`
- 반복수: 정수 `reps`
- RIR: `0`부터 `10` 사이의 숫자
- 소수는 마침표를 사용한다. 예: `62.5`
- 값이 적용되지 않거나 알 수 없으면 빈 문자열 대신 JSON `null`을 사용한다.

### 3.3 운동 기록 방식

`trackingMode`는 다음 중 하나다.

- `reps`: 반복 횟수로 기록
- `duration`: 유지시간으로 기록

`loadMode`는 다음 중 하나다.

- `external`: 바벨, 덤벨, 머신 등 외부 중량
- `assistance`: 어시스트 머신의 보조 중량. 값이 낮을수록 더 강한 수행
- `bodyweight`: 체중 운동. PR+ v0.3.1 protocol 1.1에서는 추가 중량을 별도로 처방하지 않음
- `none`: 중량을 사용하지 않음

`direction`은 다음 중 하나다.

- `maintain`: 현재 목표 유지
- `increase_reps`: 중량을 유지하고 반복수 증가
- `increase_load`: 외부 중량 증가
- `decrease_assistance`: 보조 중량 감소
- `increase_duration`: 유지시간 증가
- `deload`: 중량 또는 전체 강도 감소
- `reduce_sets`: 세트 수 감소
- `technique_focus`: 수치 증가보다 자세와 수행 품질 우선

`setRole`은 선택 필드이며 다음 중 하나다.

- `warmup`: 워밍업 세트
- `working`: 점진적 과부하와 정체 판단의 중심이 되는 본 세트
- `backoff`: 주 작업 뒤 중량을 낮춘 백오프 세트

역할을 알 수 없는 과거 세트는 추측하지 않고 `null` 또는 필드 생략으로 전달한다. GPT는 역할이 명시된 경우 `working` 세트를 중심으로 점진적 과부하와 피로를 판단하고, `warmup` 세트를 working volume으로 계산하지 않는다.

---

## 4. PR+에서 GPT로 보내는 요청

PR+ 요청은 아래 시작·종료 표식을 정확히 한 번씩 포함한다.

```text
<<<PRPLUS_COACH_REQUEST>>>
{유효한 JSON 객체}
<<<END_PRPLUS_COACH_REQUEST>>>
```

GPT는 시작·종료 표식 사이의 JSON을 요청 데이터로 읽어야 한다. 표식 밖의 문장은 추가 설명으로만 취급한다.

### 4.1 요청 최상위 구조

```json
{
  "protocol": "PRPLUS_COACH_REQUEST",
  "protocolVersion": "1.1",
  "requestId": "request-20260825-ab12cd34",
  "contextHash": "sha256:0123456789abcdef",
  "generatedAt": "2026-08-25T18:00:00+09:00",
  "appVersion": "0.3.1",
  "trainingDay": {
    "timeZone": "Asia/Seoul",
    "startsAtHour": 7
  },
  "units": {
    "weight": "kg",
    "duration": "seconds"
  },
  "requestedPeriod": {
    "from": "2026-08-26",
    "through": "2026-09-01",
    "maximumSessions": 4
  },
  "athleteProfile": {
    "goal": "근비대와 점진적 과부하",
    "experienceLevel": "",
    "bodyWeightKg": 75.2,
    "availableDays": ["2026-08-26", "2026-08-28", "2026-08-30"],
    "equipment": [],
    "sessionDurationMinutes": null,
    "limitations": [],
    "notes": ""
  },
  "exerciseCatalog": [],
  "routines": [],
  "recentSessions": [],
  "scheduleChanges": [],
  "appSuggestions": [],
  "coachRequest": {
    "focus": "다음 운동의 세트별 목표를 정해줘.",
    "questions": []
  }
}
```

### 4.2 `exerciseCatalog` 항목

```json
{
  "exerciseId": "exercise-barbell-bench-press",
  "name": "Barbell Bench Press",
  "displayName": "벤치프레스",
  "muscleGroup": "chest",
  "type": "strength",
  "trackingMode": "reps",
  "loadMode": "external",
  "weightBasis": "total",
  "targetRange": {
    "minimum": 6,
    "maximum": 10,
    "unit": "reps"
  },
  "weightIncrementKg": 2.5,
  "metricIncrement": 1,
  "targetRirRange": {
    "minimum": 1,
    "maximum": 3
  }
}
```

`weightBasis`는 선택 필드이며 `total`, `per_hand`, `per_side`, `machine_stack` 중 하나 또는 `null`이다. 같은 운동의 과거 기록을 비교할 때 동일한 표시 기준을 유지해야 하며, 기준이 다른 중량을 직접 비교하거나 합산하지 않는다.

### 4.3 `routines` 항목

```json
{
  "routineId": "routine-chest",
  "name": "Chest",
  "displayName": "가슴",
  "items": [
    {
      "order": 1,
      "exerciseId": "exercise-barbell-bench-press",
      "targetSets": 3,
      "targetMinimum": 6,
      "targetMaximum": 10,
      "targetUnit": "reps",
      "optional": false
    }
  ]
}
```

### 4.4 `recentSessions` 항목

`completed`가 `true`인 세트만 완료된 수행으로 판단한다.

```json
{
  "trainingDate": "2026-08-24",
  "routineId": "routine-chest",
  "routineName": "Chest",
  "coachPlanRef": {
    "planId": "gpt-plan-example",
    "requestId": "request-example",
    "scheduledTrainingDate": "2026-08-22",
    "actualTrainingDate": "2026-08-24",
    "scheduleOffsetDays": 2,
    "scheduleStatus": "delayed",
    "summary": "원래 2026-08-22 예정 · 2026-08-24에 2일 미뤄서 수행"
  },
  "notes": "특이사항 없음",
  "symptoms": [
    {
      "exerciseId": "exercise-barbell-bench-press",
      "location": "right_shoulder",
      "severity": 3,
      "note": "내리는 구간에서 불편함"
    }
  ],
  "exercises": [
    {
      "exerciseId": "exercise-barbell-bench-press",
      "trackingMode": "reps",
      "loadMode": "external",
      "sets": [
        {
          "set": 1,
          "setRole": "working",
          "weightKg": 60,
          "reps": 10,
          "durationSec": null,
          "rir": 2,
          "completed": true
        }
      ]
    }
  ]
}
```

- `symptoms`는 선택 배열이며 증상이 없으면 빈 배열 또는 필드 생략을 허용한다.
- `location`은 증상 위치, `severity`는 0~10, `note`는 발생 구간이나 느낌이다.
- GPT는 증상이 있으면 증량보다 안전, 감량, 운동 변경 또는 추가 질문을 우선하며 의학적 진단을 하지 않는다.
- `setRole`이 없는 legacy 세트는 역할을 추측하지 않는다.

### 4.5 `scheduleChanges` 항목

GPT 추천 세션을 원래 날짜와 다른 운동일에 수행한 경우 PR+는 일정 변경을 구조화해서 전달한다.

```json
{
  "planId": "gpt-plan-example",
  "requestId": "request-example",
  "scheduledTrainingDate": "2026-08-22",
  "actualTrainingDate": "2026-08-24",
  "scheduleOffsetDays": 2,
  "scheduleStatus": "delayed",
  "summary": "원래 2026-08-22 예정 · 2026-08-24에 2일 미뤄서 수행"
}
```

- `scheduleOffsetDays`는 `actualTrainingDate - scheduledTrainingDate`다.
- 양수는 `delayed`, 음수는 `early`, 0은 `on_time`이다.
- GPT는 일정 변경을 수행 누락으로 단정하지 않고 실제 회복 간격, 가능한 운동일과 다음 일정의 현실성을 판단하는 근거로 사용한다.
- 일정 변경 이유가 기록에 없으면 추측하지 말고 필요한 경우 `questions`로 묻는다.

### 4.6 `appSuggestions` 항목

이 값은 PR+의 점진적 과부하 계산 결과이며 GPT가 반드시 따를 필요는 없다. 다르게 추천한다면 `reason`에 기록 근거를 설명해야 한다.

```json
{
  "exerciseId": "exercise-barbell-bench-press",
  "direction": "increase_reps",
  "message": "지난 기록보다 최소 1회 더 수행하는 목표야.",
  "sets": [
    {
      "set": 1,
      "targetWeightKg": 60,
      "targetReps": 10,
      "targetDurationSec": null
    }
  ]
}
```

---

## 5. GPT가 PR+로 돌려주는 추천 계획

GPT는 사용자에게 한국어 분석과 설명을 제공할 수 있다. 그러나 앱이 읽을 추천 데이터는 답변 마지막에 있는 `PRPLUS_COACH_PLAN` 블록 하나뿐이다.

사용자가 한 번에 복사할 수 있도록 시작 표식부터 종료 표식까지 반드시 하나의 코드 블록 안에 출력한다. JSON에는 주석, 말줄임표, Markdown 또는 후행 쉼표를 넣지 않는다.

```text
<<<PRPLUS_COACH_PLAN>>>
{유효한 JSON 객체}
<<<END_PRPLUS_COACH_PLAN>>>
```

### 5.1 완전한 응답 예시

아래 예시는 형식 설명용이다. GPT는 예시의 수치를 복사하지 말고 실제 요청 기록을 분석해 값을 결정해야 한다.

```text
<<<PRPLUS_COACH_PLAN>>>
{
  "protocol": "PRPLUS_COACH_PLAN",
  "protocolVersion": "1.1",
  "requestId": "request-20260825-ab12cd34",
  "contextHash": "sha256:0123456789abcdef",
  "planId": "gpt-plan-request-20260825-ab12cd34-1",
  "status": "ready",
  "title": "GPT 추천 운동 · 8월 26일~9월 1일",
  "createdAt": "2026-08-25T18:05:00+09:00",
  "validFrom": "2026-08-26",
  "validThrough": "2026-09-01",
  "coachMessage": "이번 계획은 직전 수행을 기준으로 반복수를 먼저 높이는 데 집중합니다.",
  "sessions": [
    {
      "trainingDate": "2026-08-26",
      "name": "GPT 추천 가슴 운동",
      "baseRoutineId": "routine-chest",
      "rationale": "직전 가슴 운동에서 목표 반복 범위 상단에 근접했습니다.",
      "exercises": [
        {
          "order": 1,
          "exerciseId": "exercise-barbell-bench-press",
          "exerciseName": "Barbell Bench Press",
          "trackingMode": "reps",
          "loadMode": "external",
          "direction": "increase_reps",
          "reason": "중량을 유지하면서 첫 세트 이후의 반복수를 점진적으로 높입니다.",
          "sets": [
            {
              "set": 1,
              "setRole": "working",
              "targetWeightKg": 60,
              "targetReps": 10,
              "targetDurationSec": null,
              "targetRir": 2
            },
            {
              "set": 2,
              "setRole": "working",
              "targetWeightKg": 60,
              "targetReps": 9,
              "targetDurationSec": null,
              "targetRir": 2
            },
            {
              "set": 3,
              "setRole": "working",
              "targetWeightKg": 60,
              "targetReps": 8,
              "targetDurationSec": null,
              "targetRir": 2
            }
          ]
        },
        {
          "order": 2,
          "exerciseId": "exercise-dead-hang",
          "exerciseName": "Dead Hang",
          "trackingMode": "duration",
          "loadMode": "none",
          "direction": "increase_duration",
          "reason": "최근 유지시간에서 5초만 추가합니다.",
          "sets": [
            {
              "set": 1,
              "setRole": "warmup",
              "targetWeightKg": null,
              "targetReps": null,
              "targetDurationSec": 35,
              "targetRir": null
            }
          ]
        }
      ]
    }
  ],
  "warnings": [],
  "questions": []
}
<<<END_PRPLUS_COACH_PLAN>>>
```

### 5.2 응답 필드 규칙

- `requestId`: 요청에서 받은 값을 한 글자도 바꾸지 않고 반환
- `contextHash`: 요청에서 받은 값을 한 글자도 바꾸지 않고 반환
- `planId`: 해당 요청 안에서 고유한 문자열
- `status`: 추천 준비 상태. `ready` 또는 `needs_input`
- `title`: 루틴 페이지에서 보일 짧은 계획 이름
- `validFrom`, `validThrough`: 전체 계획 유효기간
- `coachMessage`: 전체 방향에 대한 짧은 한국어 설명
- `sessions`: 날짜별 추천 운동. 같은 `trainingDate`는 최대 하나
- `baseRoutineId`: 기반 루틴이 있을 때만 해당 ID를 사용하고 없으면 `null`
- `rationale`: 해당 날짜에 이 세션을 추천하는 기록 기반 이유
- `order`: 세션 안에서 운동 수행 순서. 1부터 시작
- `exerciseId`: 요청의 `exerciseCatalog`에 있는 ID
- `exerciseName`: 사람이 확인하기 위한 이름. 식별은 `exerciseId`를 기준으로 함
- `trackingMode`, `loadMode`: 요청의 운동 설정과 정확히 일치해야 함
- `direction`: 이 문서에서 정의한 값 중 하나
- `reason`: 해당 운동의 수치를 추천한 기록 기반 이유
- `sets`: 세트별 목표. 세트 번호는 1부터 연속적으로 증가
- `warnings`: 안전, 회복, 오래된 기록 또는 불확실한 추천에 대한 한국어 경고
- `questions`: 다음 추천의 정확도를 높이기 위해 사용자에게 물어볼 한국어 질문

### 5.3 세트 목표 규칙

반복 운동은 다음과 같이 작성한다.

```json
{
  "set": 1,
  "setRole": "working",
  "targetWeightKg": 60,
  "targetReps": 10,
  "targetDurationSec": null,
  "targetRir": 2
}
```

시간 운동은 다음과 같이 작성한다.

```json
{
  "set": 1,
  "setRole": "warmup",
  "targetWeightKg": null,
  "targetReps": null,
  "targetDurationSec": 30,
  "targetRir": null
}
```

- `trackingMode: reps`이면 `targetReps`가 필요하고 `targetDurationSec`는 `null`이어야 한다.
- `trackingMode: duration`이면 `targetDurationSec`가 필요하고 `targetReps`는 `null`이어야 한다.
- `loadMode: external` 또는 `assistance`이면 `targetWeightKg`를 숫자로 작성한다.
- `loadMode: bodyweight` 또는 `none`이면 `targetWeightKg`는 `null`이어야 한다.
- 목표를 알 수 없다는 이유로 숫자 대신 문자열을 사용하지 않는다.
- 세트별 목표가 동일하더라도 모든 세트를 각각 명시한다.
- `setRole`은 선택 필드이며 생략된 역할을 앱이나 GPT가 임의로 추측하지 않는다.

### 5.4 정보 부족으로 계획을 보류하는 경우

심한 통증, 필수 정보 누락 또는 안전상 이유로 수치 목표를 만들 수 없다면 억지로 세션을 생성하지 않는다.

```json
{
  "status": "needs_input",
  "sessions": [],
  "warnings": ["오른쪽 어깨 통증이 있어 증량 계획을 보류했습니다."],
  "questions": ["현재 통증이 일상 동작에서도 발생하나요?"]
}
```

- `status: ready`이면 `sessions`는 1~14개여야 한다.
- `status: needs_input`이면 `sessions`는 반드시 빈 배열이어야 한다.
- `needs_input`에는 계획을 보류한 이유를 `warnings` 또는 `questions`에 하나 이상 작성한다.

---

## 6. GPT의 분석 및 추천 규칙

GPT는 다음 순서로 판단한다.

1. 사용자 제한사항과 통증·부상 기록을 먼저 확인한다.
2. 운동일, 세트 완료 여부, 중량, 반복수 또는 유지시간, RIR을 확인한다.
3. 같은 운동의 최근 기록과 이전 기록을 비교한다.
4. PR+의 `appSuggestions`와 비교한다.
5. 유지, 반복 증가, 중량 증가, 보조 중량 감소, 시간 증가, 디로드 또는 세트 감소 중 하나를 선택한다.
6. 선택한 방향의 이유를 실제 기록 수치와 함께 작성한다.
7. 요청된 날짜와 사용 가능한 날짜 안에서 세션을 배치한다.
8. 확신할 수 없는 내용은 질문 또는 경고로 남긴다.

추천값을 결정할 때 다음 규칙을 따른다.

- 이전 목표 세트를 충분히 완료하지 못했다면 자동으로 증량하지 않는다.
- 목표 반복 상단을 달성했더라도 RIR이 너무 낮으면 중량 유지 또는 회복을 고려한다.
- `weightIncrementKg`가 있으면 가능한 한 해당 증가폭에 맞춘다.
- 어시스트 운동은 보조 중량 감소가 난이도 증가라는 점을 반영한다.
- 시간 운동은 `metricIncrement` 단위로 증가시키는 것을 우선한다.
- 기록이 하나도 없는 운동은 보수적인 기준 설정임을 `reason`에 명시한다.
- 추천이 PR+ 앱 계산과 다르면 왜 다른지 `reason`에 설명한다.
- 날짜별 운동 수와 세트 수는 사용자의 시간·회복 제한을 고려한다.

---

## 7. PR+ 가져오기 검증 규칙

PR+는 붙여넣은 계획을 저장하기 전에 다음을 검증해야 한다.

### 7.1 가져오기를 중단하는 오류

- 시작 또는 종료 표식이 없거나 두 개 이상 존재함
- JSON 문법 오류
- `protocol` 또는 `protocolVersion` 불일치
- `requestId` 또는 `contextHash` 누락
- `ready`인데 세션이 없거나 14개를 초과함
- `needs_input`인데 세션이 있거나 보류 이유·질문이 없음
- 같은 운동일에 세션이 두 개 이상 있음
- 요청에 없는 `exerciseId`
- 운동의 `trackingMode` 또는 `loadMode` 불일치
- 같은 세션 안에서 운동 ID 중복
- 세트 번호가 1부터 연속되지 않음
- 운동당 세트가 없거나 12개를 초과함
- 반복 운동과 시간 운동의 목표 필드 혼용
- 숫자 필드에 `NaN`, 무한대 또는 문자열이 들어감
- 과거 실제 운동 기록을 변경하거나 삭제하려는 필드가 들어감

### 7.2 허용 범위

- `ready` 세션 수: `1`~`14`
- `needs_input` 세션 수: `0`
- 한 세션의 운동 수: `1`~`20`
- 한 운동의 세트 수: `1`~`12`
- 목표 중량: `0`~`1000kg`
- 목표 반복수: `1`~`200회`
- 목표 유지시간: `1`~`600초`
- 목표 RIR: `0`~`10` 또는 `null`
- `reason`, `rationale`, `coachMessage`: 각 필드 최대 1000자

### 7.3 사용자 확인이 필요한 경고

- 현재 PR+ 기록의 hash가 `contextHash`와 다름
- 추천 유효기간이 지남
- 현재 진행 중인 운동 세션이 있음
- 직전 기록보다 중량이 20% 이상 증가함
- 직전 같은 기간보다 전체 working set이 50% 이상 증가함
- GPT 질문 또는 안전 경고가 남아 있음

오류가 있으면 일부만 조용히 저장하지 않는다. 전체 계획을 중단하고 어떤 필드가 잘못됐는지 사용자에게 보여준다. 경고만 있으면 미리보기에서 표시하고 사용자가 명시적으로 승인한 경우에만 저장한다.

---

## 8. PR+ 화면 표시 의미

루틴 페이지에서는 GPT 계획을 기존 사용자 루틴과 분리해 다음과 같이 표시한다.

- `GPT 추천 운동`
- 추천 날짜와 유효기간
- 계획 제목과 전체 방향
- 예정, 진행, 완료, 만료 상태
- 추천 근거와 경고
- `추천 운동 시작` 버튼

운동 중에는 각 세트마다 추천과 실제 수행을 분리한다.

```text
GPT TARGET
1세트 · 60kg × 10회 · 목표 RIR 2

ACTUAL
중량 [      ]  횟수 [      ]  RIR [      ]
```

- GPT 목표가 실제 입력칸을 완료 상태로 만들지 않는다.
- 사용자가 목표값을 입력칸에 불러오더라도 세트 완료는 별도로 눌러야 한다.
- 앱 자체 계산은 `APP TARGET`, GPT 추천은 `GPT TARGET`으로 구분한다.
- 세션 완료 후 추천 대비 실제 수행 결과를 다음 GPT 요청에 포함할 수 있다.
- 추천 세션은 원래 `trainingDate`와 다른 날에도 사용자가 확인한 뒤 시작할 수 있다.
- PR+는 원래 예정일과 실제 수행일을 모두 보존하며 다음 요청의 `scheduleChanges`로 전달한다.

---

## 9. GPT가 실제 답변에 적용할 출력 지침

PR+ 요청문을 받은 GPT는 다음 지침을 그대로 따른다.

```text
너는 PR+ 사용자의 개인 운동 코치다.

1. PRPLUS_COACH_REQUEST 블록의 기록만 근거로 분석한다.
2. 운동 ID, 운동 유형, 중량 방식과 단위를 변경하거나 새로 만들지 않는다.
3. 먼저 한국어로 핵심 분석과 추천 이유를 설명한다.
4. 정보가 부족하면 추측하지 말고 questions에 질문을 넣는다.
5. 통증이나 부상 신호가 있으면 증량보다 안전을 우선하고 warnings에 기록한다.
6. 답변 마지막에 PRPLUS_COACH_PLAN 시작·종료 표식을 정확히 한 번씩 출력한다.
7. 시작 표식부터 종료 표식까지 하나의 코드 블록에 넣어 전체를 한 번에 복사할 수 있게 한다.
8. 계획 블록 안에는 유효한 JSON만 사용하며 주석, Markdown, 말줄임표 또는 후행 쉼표를 넣지 않는다.
9. requestId와 contextHash는 요청의 값을 그대로 반환한다.
10. 추천하는 모든 운동과 루틴 ID는 요청 데이터에 존재해야 한다.
11. 세트마다 정확한 목표 중량, 반복수 또는 유지시간과 가능한 경우 목표 RIR을 작성한다.
12. 예시 수치를 복사하지 말고 사용자의 실제 기록을 분석해 추천한다.
13. working 세트를 중심으로 progression을 판단하고 warmup 세트는 working volume에서 제외한다.
14. 심한 통증이나 필수 정보 누락 시 status를 needs_input으로 설정하고 sessions를 비운다.
15. scheduleChanges가 있으면 원래 추천일과 실제 수행일의 차이를 회복 간격과 다음 일정에 반영하되, 변경 이유는 추측하지 않는다.
```

---

## 10. 호환성 정책

- PR+ v0.4.0은 `PRPLUS_COACH_PROTOCOL 1.1`을 지원한다.
- protocol 1.x에서 필드를 추가할 때는 선택 필드만 추가할 수 있다.
- 기존 필드의 의미, 단위 또는 허용값을 바꾸면 protocol version을 2.0으로 올린다.
- 앱은 알 수 없는 선택 필드를 무시할 수 있지만 알 수 없는 필수 프로토콜 버전을 가져오면 안 된다.
- PR+ 백업 데이터 schema migration과 이 텍스트 프로토콜의 호환성 관리는 서로 독립적으로 수행한다.
- 저장된 추천 계획은 가져올 때 원문과 정규화된 데이터, protocol version을 함께 보관해야 한다.

---

## 11. 사용자용 최소 사용법

```text
1. 이 PR+ Coach Text Protocol v1.1 문서를 GPT의 참고 자료로 제공한다.
2. PR+에서 "GPT 상담 요청 복사"를 누른다.
3. 복사된 PRPLUS_COACH_REQUEST 전체를 GPT에 보낸다.
4. GPT 답변 마지막의 PRPLUS_COACH_PLAN 코드 블록 전체를 복사한다.
5. PR+ 루틴 페이지에서 "GPT 추천 붙여넣기"를 누른다.
6. 날짜, 운동, 세트별 목표와 경고를 확인한다.
7. 문제가 없을 때만 "추천 저장"을 누른다.
8. 운동할 때 GPT TARGET을 참고하고 ACTUAL에는 실제 수행값을 입력한다.
9. 추천일과 다른 날 시작하면 일정 변경 확인창을 승인하고, 다음 GPT 요청에서 변경 내역이 전달되는지 확인한다.
```
