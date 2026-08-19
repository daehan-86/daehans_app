# PR+ — Local-first Progressive Training Log

`PR+`는 서버 DB나 로그인을 사용하지 않고 **브라우저 IndexedDB에 운동 기록을 저장하는 PWA**입니다.
`daehans_app` 저장소에서는 이 폴더 하나를 그대로 하나의 앱으로 관리하면 됩니다.

```text
daehans_app/
├── index.html          # 선택: 전체 앱 런처
├── pr-plus/            # ← 이 폴더가 PR+ 앱 전체
│   ├── index.html
│   ├── app.js
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
- 루틴 운동 추가·제거·순서·세트 수·반복 범위 편집
- 루틴으로 오늘 세션 생성 (추천 중량 없이 baseline 기록)
- 운동 종목 검색·부위 필터·직접 생성
- 세트별 중량(kg), 반복수, RIR, 완료 체크
- 이전 운동 기록 표시 및 복사
- 총 볼륨, 주간 hard set, e1RM(Epley) 통계
- Exercise / Routine / Session / 설정 JSON 전체 백업·복원
- 기존 `OVERLOAD` 및 PR+ v2 백업의 순차 migration
- Service Worker 오프라인 캐시
- 앱 안의 현재 버전 표시, 새 릴리스 확인, 사용자 선택 업데이트
- iPhone Home Screen Web App용 manifest / icon / 설치 안내

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

PR+ v0.1의 IndexedDB 버전은 `2`, 백업/저장 데이터 schema는 `3`입니다. 기존 데이터는 `v1 → v2 → v3` 인접 migration을 순서대로 거치며, 변환이 완료되기 전에는 기존 데이터를 삭제하지 않습니다. 상세 규칙은 [`MIGRATIONS.md`](./MIGRATIONS.md)를 참고하세요.

## v0.1 Baseline 정책

루틴에는 목표 세트 수와 반복 범위만 저장합니다. 시작 중량이나 weight increment는 임의로 넣지 않습니다. 실제 세션에서 입력한 중량·반복수·RIR·완료 여부가 이후 Progressive Overload 기능의 baseline이 됩니다.
