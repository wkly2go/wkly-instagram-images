# 설계 프로젝트 작업 환경 개선 (2026-11-17 대표 지시)

대표 지시 원문: "설계 프로젝트의 작업 환경을 개선해" · "houzz 와 같은 인터페이스에 피그마처럼 협업할 수 있는 구조로 만들고 캐드와 스케츠업을 활용가능하게" · "설계 프로젝트의 평면과 3d 작업공간을 더욱 현실에 맞게" · "환경개선에 특화 작업해" · "마감재와 각종 기구들을 저장해서 바로 사용할 수 있게" · "모든 개발과 인트라넷은 자동화를 목표로" · "비용이 들지않게" · "무조건 10시까지 완성해".

대표가 읽는 기획서는 Claude 문서 '설계 프로젝트 작업 환경 개선 기획서'(대표 계정 문서함)에 있다. 이 파일은 이어서 개발하는 사람이 보는 요약이다.

## 구역

설계(`design` 구역 · `/design`)는 원래 설계 담당 작업자의 구역이다. 2026-11-17 은 대표가 이 세션에 직접 시켜(모든 권한) 인트라넷 화면 쪽만 고쳤다. 맥의 작업 처리기 · 스케치업 확장(저장소 `arterior-design-auto`)은 손대지 않았다. 평면 자료(`design.spaces.geometry`)에는 **선택 칸만 더했다** — 기존 칸의 뜻은 바꾸지 않았으므로 처리기는 그대로 읽는다.

## 평면 자료에 더한 선택 칸 (`lib/designPlan.ts`)

| 칸 | 뜻 |
| --- | --- |
| `openings[].hinge` (`start`/`end`) · `side` (1/-1) | 문 경첩 쪽 · 열리는 쪽 (없으면 start · 1) |
| `items[].shape` | 부품 모양(평면 기호 · 3D). 비우면 이름으로 알아봄 (`lib/designPlanLook.ts` itemShape) |
| `items[].z` · `items[].finish` | 바닥에서 띄운 높이(mm) · 부품 마감(색) |
| `notes[]` (`PlanNote`) | 도면 위 댓글 핀 (x · y · 글 · 쓴 사람 · 시각 · 해결 여부). 저장할 때 서버 것과 `mergeNotes` 로 합침 |

## 공용 계산 (순수 함수 · 시험 `tests/design-plan-real.test.ts`)

- `lib/designPlanLook.ts` — 마감 글 → 재료 종류 · 색(`finishLook` · 재료 번호 앞 글자 PT/WP/TL/ST/WF/VS/MT/GL … + 색 낱말), 스펙북 번호 풀기(`resolveFinish`), 부품 이름 → 모양(`itemShape` · `ITEM_SHAPES`).
- `lib/designPlanDraw.ts` — 문 열림 호(`doorSymbol`), 바깥 치수선(`outwardSides` · `dimLine`), 축척 막대, 모서리 끌기(`moveCorner`), 길이 맞추기(`setWallLength`), 벽을 문 · 창에서 끊은 조각(`wallPieces` — 3D 와 스케치업 내보내기가 같이 씀).
- `lib/designDxf.ts` — DXF 읽기(`parseDxf` · LINE · LWPOLYLINE · POLYLINE 만) → 벽(`dxfToWalls` · 캐드의 겹선 벽을 가운데 선 + 두께로 묶음 · 짝 없는 500mm 미만 선은 버림), 평면 → DXF R12(`planToDxf` · 레이어 A-WALL · A-WALL-NEW · A-DOOR · A-GLAZ · A-FURN · A-ANNO-DIMS · 한글은 `\U+XXXX`).
- `lib/designSketchup.ts` — 평면 → 스케치업 루비 스크립트(`planToSketchupRuby` · 벽 조각 · 바닥 · 집기를 태그별 그룹으로, 마감 색을 재질로). **실제 스케치업에서 실행 시험은 아직 못 함**(개발 환경에 스케치업 없음).

## 화면 확인 방법 (체험 모드에는 설계 자료가 없다)

```
cd erp && VITE_DESIGN_HARNESS=1 npx vite --port 5181
→ '관리자 (대표)로 입장' → /design?id=harness-1&view=model
```

`src/dev/designHarness.ts` 가 개발 서버에서만 시험용 프로젝트 · 평면 · 스펙북을 메모리에 넣는다(운영 · 체험 모드 배포에는 들어가지 않음 — `main.tsx` 가 `import.meta.env.DEV` 와 환경 변수를 함께 확인). `window.__designHarness.api` 로 자동 시험에서 api 를 바꿔 끼울 수 있다.

## 다음에 할 것 (대표 결정 뒤 순서를 정함)

1. 스케치업에서 스크립트 실제 실행 확인 → 고칠 것 반영. 확장 프로그램에 '인트라넷 평면 불러오기' 단추(설계 담당).
2. 수량표 · 견적 표: 엑셀 붙여넣기 · 여러 줄 고치기 · 지난 프로젝트 복사 · 공정 틀.
3. 무드보드 · 고객 선택판 · 고객 공유 링크(금액 표시 여부는 대표 결정) · 변경 주문 · 변경 이력 견주기.
4. DWG 자동 변환(맥 작업 처리기에 무료 변환기 — 약관 확인 뒤) · 스케치업 3D 파일을 프로젝트에 보관해 웹에서 보기.
5. 같은 벽을 두 사람이 동시에 고칠 때 합치기(지금은 나중 저장이 남고 알림만 뜸).
