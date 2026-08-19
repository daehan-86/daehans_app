# PR+ 데이터 Migration 규칙

PR+는 앱 코드가 업데이트되어도 기존 IndexedDB 기록과 JSON 백업을 잃지 않아야 한다. 데이터 schema가 변경되는 모든 릴리스는 아래 규칙을 따른다.

## 현재 버전 기준

| 항목 | PR+ v0.1 |
| --- | --- |
| 앱 버전 | `0.1.0` |
| IndexedDB 이름 | `overload-db` |
| IndexedDB 버전 | `2` |
| 데이터/백업 schema | `3` |

- IndexedDB `v1 -> v2`: 기존 store를 유지하고 `routines` store만 추가한다.
- 데이터 `v1 -> v2`: 버전이 없거나 초기 `OVERLOAD` 형식의 배열을 명시적인 schema v2로 정규화한다.
- 데이터 `v2 -> v3`: 운동 canonical name과 muscle group을 보강하고 `routines`, `schemaVersion`을 추가한다.
- 기존 exercise/session ID와 세트 기록은 유지한다.
- 새 기본 운동과 루틴은 canonical name 및 고정 ID를 기준으로 누락된 항목만 추가한다.

## 버전 모델

- 앱 표시 버전과 데이터 `schemaVersion`은 서로 독립적이다.
- 데이터 구조가 바뀌지 않은 앱 릴리스는 `schemaVersion`을 올리지 않는다.
- 현재 schema를 변경하기 전, 버전이 없는 IndexedDB 데이터와 기존 `PR+`/`OVERLOAD` 백업의 legacy 버전을 먼저 명시한다.

## 변환 체인

각 schema 변경은 오직 다음 인접 버전으로 가는 변환을 하나씩 추가한다.

```text
v1 --migrateV1ToV2--> v2 --migrateV2ToV3--> v3
```

v1 데이터를 v3에서 읽을 때 `v1 -> v3`으로 건너뛰지 않는다. migration runner가 현재 버전부터 목표 버전까지 각 변환을 순서대로 적용한다. 이 규칙으로 중간 버전에서 생성된 데이터도 같은 경로를 재사용한다.

## 변환 계약

각 `vN -> vN+1` 변환은 다음 계약을 만족해야 한다.

1. 입력 데이터를 직접 변경하지 않고 새 결과를 만든다.
2. 같은 입력에는 같은 결과를 만든다.
3. 사용자 기록의 의미와 식별자를 보존한다.
4. 변환 후 목표 schema의 필수 필드와 불변조건을 검증한다.
5. 알 수 없거나 손상된 데이터는 임의로 삭제하지 않고 migration을 중단한다.
6. 실패 시 기존 IndexedDB와 현재 로컬 데이터를 그대로 유지한다.

## IndexedDB와 JSON 백업

- IndexedDB upgrade는 `oldVersion`부터 필요한 모든 단계를 순서대로 실행한다.
- JSON restore는 파일을 메모리에서 먼저 검증하고 최신 schema까지 migration한 후 저장한다.
- restore를 위해 현재 데이터를 지우기 전에 전체 변환과 검증이 성공해야 한다.
- JSON export에는 현재 `schemaVersion`을 반드시 포함한다.
- 이전 명칭인 `OVERLOAD` 백업도 동일한 migration runner를 통과시킨다.

## 필수 검사

schema 변경을 포함한 배포에는 최소한 다음 fixture 검사가 필요하다.

```text
v1 fixture -> v2
v2 fixture -> v3
v1 fixture -> v2 -> v3
현재 IndexedDB fixture -> 최신 schema
OVERLOAD backup fixture -> 최신 schema
PR+ 구버전 backup fixture -> 최신 schema
최신 schema -> export -> restore
```

지원하는 과거 버전 중 하나라도 최신 버전까지 전이되지 않으면 배포하지 않는다.
