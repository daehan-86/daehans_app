# PR+ — Local-first Progressive Training Log

`PR+`는 서버 DB나 로그인을 사용하지 않고 **브라우저 IndexedDB에 운동 기록을 저장하는 PWA**입니다.
`daehans_app` 저장소에서는 이 폴더 하나를 그대로 하나의 앱으로 관리하면 됩니다.

```text
daehans_app/
├── index.html          # 선택: 전체 앱 런처
├── pr-plus/            # ← 이 폴더가 PR+ 앱 전체
│   ├── index.html
│   ├── app.js
│   ├── data.mjs
│   ├── progression.mjs
│   ├── version.json
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── start.sh
│   └── icons/
├── another-app/
└── ...
```

## 기능
- 29개 기본 Exercise Library와 영문 canonical name / 한글 표시명
- Chest / Back / Shoulders / Legs 기본 4분할 루틴
- 루틴 운동 추가·제거·순서·세트 수·횟수/시간 범위 편집
- 루틴으로 오늘 세션 생성 및 이전 수행 기반 NEXT 목표 계산
- 오늘 세션에서 운동 순서 이동·삭제와 개별 세트 추가·삭제
- 운동 종목 검색·부위 필터·직접 생성
- 세트별 중량(kg), 반복수 또는 유지시간(초), RIR, 완료 체크
- Dead Hang 초 단위 기록 및 인앱 수행 타이머
- 이전 운동 기록 표시·복사, 운동별 전체 기록과 중량/반복/e1RM 그래프
- Double Progression 다음 반복·시간·중량 목표, RIR 보류 판정, PR 표시
- Assisted Pull-Up 보조 중량 감소 방향 계산 및 사용자 지정 증가폭/기구 단위 반올림
- 세트 완료 시 휴식 타이머, 운동·세션 메모, 즐겨찾기
- 운동 부위에 맞춘 Library 기본 루틴 선택
- 오전 7시 운동일 갱신(00:00–06:59 수행은 전날 기록)
- 첫 기록 이후 미등록일 휴식 표시, 과거 날짜 기록 추가·수정·삭제
- 총 볼륨, 주간 hard set, 훈련 빈도, e1RM(Epley), 체중과 8주 성장 추세 그래프
- 기록의 전체·일·주·월 조회, 이전/다음 기간 이동과 기간 연동 지표
- 운동 종목별 중량·횟수·e1RM·유지시간 변화 그래프
- 선택 기간의 운동을 GPT 상담용 텍스트로 정리하고 클립보드에 복사
- Exercise / Routine / Session / 설정 JSON 전체 백업·복원
- 기존 `OVERLOAD` 및 PR+ v2/v3 백업의 순차 migration
- Service Worker 오프라인 캐시
- 앱 안의 현재 버전 표시, 새 릴리스 확인, 사용자 선택 업데이트
- iPhone Home Screen Web App용 manifest / icon / 설치 안내

## 운동일과 아이폰 타이머

- PR+의 하루는 현지 시각 오전 7시에 시작합니다. 자정부터 오전 6시 59분까지 시작한 기록은 전날 운동일에 저장됩니다.
- 앱이 열린 상태에서는 오전 7시에 자동 갱신하고, 다른 앱을 사용하다 돌아온 경우에도 즉시 날짜와 타이머를 현재 시각에 맞춥니다.
- GitHub Pages PWA는 iOS의 `ActivityKit`을 사용할 수 없어 Dynamic Island/Live Activity에 타이머를 표시할 수 없습니다. 이 기능은 향후 SwiftUI·WidgetKit 확장을 포함한 네이티브 iOS 앱이 필요합니다.

## PC에서 테스트

```bash
cd pr-plus
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속.
`file://`로 `index.html`을 직접 여는 방식은 Service Worker가 제대로 동작하지 않으므로 권장하지 않습니다.

## daehans_app 저장소에 추가

이미 로컬에 저장소가 있다면 `pr-plus` 폴더를 저장소 루트에 복사한 뒤:

```bash
cd daehans_app
git pull

git add pr-plus
git commit -m "Add PR+ workout tracker"
git push origin main
```

저장소를 아직 PC에 받은 적이 없다면:

```bash
git clone https://github.com/<GITHUB_USERNAME>/daehans_app.git
cd daehans_app
# 이 PR+ 폴더를 여기의 pr-plus/로 복사

git add pr-plus
git commit -m "Add PR+ workout tracker"
git push origin main
```

## GitHub Pages

저장소에서:

1. **Settings → Pages**
2. **Build and deployment → Source → GitHub Actions**
3. 기능 브랜치의 검사를 통과시킨 뒤 `main`으로 병합
4. `Validate and deploy GitHub Pages` workflow 완료 확인

그 뒤 저장소의 Pages 주소가 다음과 같다면:

```text
https://<GITHUB_USERNAME>.github.io/daehans_app/
```

PR+는 다음 주소에서 실행됩니다.

```text
https://<GITHUB_USERNAME>.github.io/daehans_app/pr-plus/
```

PR+의 manifest와 Service Worker는 상대경로와 `./` scope를 사용하므로 다른 앱 폴더를 침범하지 않습니다.

## iPhone에 앱으로 추가

1. iPhone **Safari**에서 PR+ URL 열기
2. **공유** 메뉴 열기
3. **홈 화면에 추가** 선택
4. **웹 앱으로 열기**가 보이면 활성화
5. **추가**

이후 홈 화면의 `PR+` 아이콘으로 실행할 수 있습니다.

## 앱 업데이트

- 상단의 버전 버튼 또는 `설정 → 업데이트 확인`을 누르면 배포 사이트의 최신 릴리스를 확인합니다.
- 새 버전 파일을 모두 받은 뒤에만 앱 상단에 `업데이트` 안내가 표시됩니다.
- `업데이트`를 누르면 새 파일로 전환하면서 앱이 한 번 다시 열립니다. IndexedDB의 운동 기록은 삭제하지 않습니다.
- 앱을 다시 설치할 필요는 없습니다. 인터넷에 연결된 상태에서 설치된 앱을 열거나 업데이트 확인을 누르면 됩니다.
- 공개 앱 버전은 `appVersion`, 각 배포 식별자는 `releaseId`, 저장 데이터 구조는 `dataSchemaVersion`으로 서로 분리합니다.

캐시되는 앱 파일을 변경해 배포할 때는 `data.mjs`, `version.json`, `sw.js`의 `releaseId`를 모두 같은 새 값으로 바꿔야 합니다. GitHub Actions가 이 규칙을 검사하며, 누락된 배포는 차단합니다.

## 백업

- `설정 → JSON 백업 만들기`
- 파일명: `pr-plus-backup-YYYY-MM-DD.json`
- `설정 → 백업 복원`에서 JSON을 선택하면 현재 로컬 기록을 백업 내용으로 복원합니다.
- 이전 버전의 `OVERLOAD` JSON 백업도 받아들입니다.

> 브라우저 사이트 데이터를 삭제하거나 기기를 초기화하면 IndexedDB 기록을 잃을 수 있으므로 중요한 기록은 주기적으로 JSON 백업하세요.

## 내부 데이터 호환성

브랜드명은 `PR+`로 변경했지만 IndexedDB 이름은 기존 `overload-db`를 유지합니다. 같은 배포 URL에서 기존 앱을 PR+로 업데이트할 때 이미 저장된 운동 기록을 그대로 유지하기 위한 선택입니다.

PR+ v0.3.0의 IndexedDB 버전은 `2`, 백업/저장 데이터 schema는 `4`입니다. v0.3.0은 기존 session 구조를 그대로 사용하므로 v0.2.x 운동·루틴·기록을 변환 없이 읽습니다. 더 오래된 데이터는 `v1 → v2 → v3 → v4` 인접 migration을 순서대로 거치며, 변환이 완료되기 전에는 기존 데이터를 삭제하지 않습니다. 상세 규칙은 [`MIGRATIONS.md`](./MIGRATIONS.md)를 참고하세요.

## v0.3 기록 분석과 GPT 피드백

- 기록 화면의 `전체 / 일 / 주 / 월` 탭은 목록, 휴식일, 훈련일, hard set, 볼륨, 부위별 합계, e1RM 및 체중 그래프에 같은 조회 기간을 적용합니다.
- 일·주·월 화면에서는 좌우 버튼으로 이전/다음 기간을 이동합니다. 현재 운동일 이후의 미래 기간은 열지 않습니다.
- 운동별 변화 영역은 종목의 전체 기록을 기준으로 최고 반복, 사용 중량, e1RM 또는 유지시간을 날짜순으로 표시합니다.
- `GPT 상담용 요약`은 선택 기간의 완료 세트, RIR, 세션 메모, 앱의 다음 목표를 텍스트 프롬프트로 만듭니다. 앱은 이 내용을 자동 전송하지 않으며 사용자가 복사한 뒤 원하는 ChatGPT 대화에 직접 붙여넣습니다.

## v0.2+ 기록 방식과 추천 정책

- 기본 운동 29개 중 Dead Hang은 `duration`, 나머지 28개는 `reps` 방식입니다. 사용자 운동은 생성·설정 화면에서 방식을 선택합니다.
- Dead Hang 기본 목표는 10–60초이며 초 단위 직접 입력과 수행 타이머를 지원합니다. [NASM의 10–20초 시작 및 최대 1분 가이드](https://blog.nasm.org/how-to-get-better-at-pull-ups)와, [Dead Hang을 초 단위로 측정한 연구](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0306300)를 기준으로 했습니다.
- 반복 범위 안에서는 지난 세션보다 최소 1회를 더 수행하도록 제안합니다.
- 모든 목표 세트를 상단 반복수와 목표 RIR로 완료한 경우에만 사용자가 입력한 중량 증가폭을 적용합니다. 증가폭을 설정하지 않은 운동에는 앱이 임의 중량을 만들지 않습니다.
- Assisted Pull-Up은 보조 중량이 낮아지는 방향, 일반 중량 운동은 높아지는 방향으로 계산합니다.
- 추천은 기록 보조이며 자세, 통증, 당일 컨디션보다 우선하지 않습니다.
