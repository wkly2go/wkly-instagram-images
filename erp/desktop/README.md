# WKLY 인트라넷 PC 프로그램

인트라넷 웹(https://wkly-erp.pages.dev)을 띄우는 Electron 프로그램입니다. 화면 기능은 웹 배포 때 함께 바뀌고, 이 폴더는 PC 전용 동작만 담당합니다.

- 컴퓨터를 켜면 자동 실행, 로그인 전에는 창을 닫을 수 없고 맨 위에 고정
- 로그인 후 X → 트레이로 숨김 (알림 · 소리 계속)
- 컴퓨터를 1시간 안 쓰거나 화면 잠금 · 절전 → 인트라넷 잠금
- 출근 기록: 이 프로그램으로 접속하면 접속 경로가 `desktop` 으로 기록됨 (관리 › 출근 기록 방식)
- 윈도우는 새 버전을 자동 설치, 맥은 서명이 없어 내려받기 안내

## 배포
1. `package.json` 의 `version` 을 올려 main 에 반영
2. GitHub Actions `desktop-app` 이 윈도우 · 맥 설치 파일을 만들어 릴리스(`v버전`)에 올림
3. 인트라넷 `/download` 페이지가 최신 릴리스 파일로 연결

## 개발 시험
```
npm ci
WKLY_APP_URL=http://localhost:4321 WKLY_IDLE_SEC=10 npm start
```
(설치본이 아닐 때만 주소 · 잠금 시간을 바꿀 수 있음)
