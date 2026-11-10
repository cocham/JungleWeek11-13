# 요구사항

> 원본: 과제 안내문 "미니 리액트 구현 요구사항"을 ID 붙여 재정리한 것.
> 이 문서는 **과제가 요구한 것만** 적는다. AI는 이 문서를 임의로 수정하지 않는다.

## 기술 제한

| ID | 내용 |
|---|---|
| R-TECH-01 | HTML, CSS, JavaScript(또는 TypeScript) — Vanilla |
| R-TECH-02 | 외부 프레임워크(React, Vue 등) 사용 금지 |

## Phase 1 — Virtual DOM + Diff + Patch

| ID | 내용 |
|---|---|
| R-P1-01 | 브라우저 DOM을 읽어 Virtual DOM으로 변환하는 함수 |
| R-P1-02 | 두 Virtual DOM을 비교해 변경된 부분을 찾는 Diff 알고리즘 |
| R-P1-03 | 변경된 부분만 실제 DOM에 반영(Patch) |
| R-P1-04 | 검증용 웹 페이지: "실제 영역", "테스트 영역", Patch / 뒤로가기 / 앞으로가기 버튼 |
| R-P1-05 | 페이지 로드 시: "실제 영역"의 샘플 HTML → Virtual DOM 변환 → 그 VDOM으로 "테스트 영역" 렌더링 |
| R-P1-06 | 사용자가 "테스트 영역"의 샘플 HTML을 자유롭게 수정 |
| R-P1-07 | Patch 버튼: 테스트 영역 → 새 VDOM → 이전 VDOM과 Diff → 변경분만 "실제 영역"에 렌더링 → 새 VDOM을 State History에 저장 |
| R-P1-08 | 뒤로가기 / 앞으로가기: History의 특정 VDOM으로 이동, "실제 영역"과 "테스트 영역" 둘 다 함께 바뀜 |

## Phase 2 — Component · State · Hooks

| ID | 내용 |
|---|---|
| R-P2-01 | 반드시 함수형 컴포넌트로 구현 |
| R-P2-02 | 함수형 컴포넌트를 감싸는 `FunctionComponent` 클래스 직접 구현: hooks 배열(상태 저장), `mount()`(첫 렌더링), `update()`(상태 변경 후 재렌더링) |
| R-P2-03 | Hook은 최상위(루트) 컴포넌트에서만 사용 (`해석 필요`: 자식에서 호출됐을 때 처리) |
| R-P2-04 | State는 루트 컴포넌트에서만 관리, 자식은 props만 받는 stateless 순수 함수 (Lifting State Up) |
| R-P2-05 | State가 바뀌면 화면이 자동으로 다시 그려짐 |
| R-P2-06 | 최소 Hook: `useState`, `useEffect`, `useMemo` |
| R-P2-07 | 재렌더링 시 Phase 1의 VDOM 생성 → Diff → Patch를 그대로 사용 (전체를 다시 그리지 않음) |

## 테스트 페이지

| ID | 내용 |
|---|---|
| R-APP-01 | Phase 1·2 결과를 활용한, 브라우저에서 동작하는 웹 페이지. 주제 자유 |
| R-APP-02 | 사용자 입력/클릭 등에 따라 화면이 바뀌어야 함 |

## 품질

| ID | 내용 |
|---|---|
| R-Q-01 | 단위 테스트로 각 모듈 검증: VDOM 변환, Diff, Patch, useState, useEffect, useMemo 등 |
| R-Q-02 | 기능 테스트로 화면 동작 확인 |
| R-Q-03 | 테스트 영역에 다양한 태그/요소를 넣어 여러 변화 확인 |
| R-Q-04 | 엣지 케이스 최대한 고려 |
| R-Q-05 | 이력서·포트폴리오에 넣을 수 있는 완성도 |

## 학습 원칙

| ID | 내용 |
|---|---|
| R-L-01 | 구현이 우선, AI 적극 활용 가능. 전체 코드를 AI로 생성해도 됨 |
| R-L-02 | 단, 핵심 로직은 이해하고 설명할 수 있어야 함 |

## 선택 과제

| ID | 내용 |
|---|---|
| R-OPT-01 | 여러 상태 변경을 한 번에 처리하는 Batching |
| R-OPT-02 | 다른 팀과 차별점이 되는 추가 구현 요소 |

## 중점 학습 포인트 (발표·질문 대비)

Phase 1
- DOM 다루는 법 (Document, Window)
- 실제 DOM 변화를 감지하는 브라우저 API
- 실제 DOM이 느린 이유 (Reflow / Repaint)
- Virtual DOM 구조와 필요한 이유
- Diff 동작 방식, 최소 변경을 찾는 5가지 핵심 케이스, 실제 DOM 반영 방법
- React가 실제 DOM을 바꿀 때 VDOM과 Diff가 동작하는 방식

Phase 2
- UI를 어떻게 컴포넌트로 나눌지
- State를 어디에 둘지
- setState는 상태 변경 말고 무엇을 해야 하는지
- 여러 상태 변경을 한 번에 처리하는 방법 (Batching)
- 이번 구현과 실제 React의 차이
