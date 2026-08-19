# daehans_app 작업 규칙

이 저장소를 수정하는 모든 작업은 기존 사용자에게 새 버전이 안전하고 일관되게 전달되는 것을 최우선으로 한다.

## 기본 원칙

- 변경 전에 대상 앱의 기존 HTML, CSS, JavaScript, manifest, Service Worker, 저장소 구조를 먼저 확인한다.
- 요청 범위 밖의 앱이나 저장소 루트 동작은 불필요하게 변경하지 않는다.
- 기능은 작고 검토 가능한 단위로 수정하고, 기존 동작을 불필요하게 다시 작성하지 않는다.
- 배포를 위해 데이터를 삭제하거나 IndexedDB를 초기화하지 않는다.

## PR+ 데이터 호환성

- PR+의 IndexedDB 이름 `overload-db`는 기존 데이터 보존을 위해 유지한다.
- 앱 릴리스 버전과 저장 데이터 schema version을 분리한다. 데이터 구조가 바뀔 때만 단조 증가하는 `schemaVersion`을 올린다.
- 버전이 없는 기존 데이터는 문서에 정의된 legacy schema version으로 간주한다.
- 데이터 구조 변경마다 반드시 인접 버전 변환 함수 `vN -> vN+1`을 추가한다. 과거 버전에서 최신 버전으로 바로 건너뛰는 일회성 변환만 만들지 않는다.
- 모든 upgrade는 등록된 변환을 버전 순서대로 적용한다. 예를 들어 v1 데이터는 `v1 -> v2 -> v3`을 거쳐 v3가 되어야 한다.
- 각 변환은 입력을 직접 훼손하지 않는 결정적 변환이어야 하며, 변환 단계마다 필수 필드와 데이터 불변조건을 검증한다.
- 변환 도중 오류가 나면 기존 데이터를 지우거나 일부만 저장하지 않는다. 가능한 경우 하나의 IndexedDB transaction에서 처리하고, 원본을 유지한 채 실패한다.
- IndexedDB 구조 변경은 `onupgradeneeded`의 `oldVersion`을 기준으로 모든 중간 upgrade 단계를 순서대로 실행한다.
- 기존 `PR+` 및 `OVERLOAD` JSON 백업을 계속 복원할 수 있어야 하며, restore는 원본을 검증한 뒤 동일한 순차 migration을 적용한다.
- export는 항상 현재 `schemaVersion`을 명시하고 현재 schema로 내보낸다.
- schema를 바꿀 때마다 각 인접 버전 migration fixture와, 지원하는 모든 과거 버전에서 최신 버전까지의 전체 migration 검사를 추가한다.
- migration 검사가 하나라도 실패하면 배포하지 않는다.
- 배포 전 기존 IndexedDB 데이터, 모든 지원 버전의 백업 복원, 최신 백업 재생성이 깨지지 않는지 확인한다.

## PWA 업데이트 전달

- `app.js`, `styles.css`, `index.html`, manifest, 아이콘 등 캐시되는 정적 파일을 배포할 때는 매 배포마다 고유한 `releaseId`를 사용한다.
- `pr-plus/data.mjs`, `pr-plus/version.json`, `pr-plus/sw.js`의 `releaseId`는 항상 같아야 하며, 공개 앱 버전과 데이터 schema version은 별도로 관리한다.
- Service Worker는 새 캐시를 설치하고 이전 PR+ 캐시를 정리해야 한다.
- 설치된 앱에서는 새 Service Worker를 대기 상태로 두고 사용자에게 알린 뒤, 사용자가 업데이트를 선택했을 때만 전환하고 다시 연다. 운동 기록 중 임의로 새로고침하지 않는다.
- Service Worker와 manifest의 경로는 `/pr-plus/` 배포를 고려한 상대경로를 유지한다.
- 변경 후 설치된 iPhone PWA가 새 버전을 받을 수 있는지 확인한다.

## 검사와 배포

- 기능 브랜치에서 작업하고 검사를 통과한 변경만 `main`에 병합한다.
- GitHub Pages 배포는 `main`에서만 수행한다.
- JavaScript 문법, manifest JSON, 필수 PWA 파일, 상대경로, 정적 파일 응답을 검사한다.
- IndexedDB 또는 백업 로직을 수정했다면 호환성 검증 없이 배포하지 않는다.
- 검사가 실패하면 기존 배포를 유지하고 새 버전을 배포하지 않는다.
- 배포 후 GitHub Pages 결과와 iPhone PWA 업데이트를 확인한다.

## 완료 보고

- 변경 파일, 수행한 검사, 데이터 migration 여부, Service Worker 캐시 버전 변경 여부를 함께 기록한다.
- 확인하지 못한 항목이 있다면 완료된 것처럼 표현하지 않고 명확히 알린다.
