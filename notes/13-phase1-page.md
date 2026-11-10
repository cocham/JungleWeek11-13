# 13. 검증 페이지 — 로드·편집·Patch 연결

- 요구사항: R-P1-04 ~ R-P1-07 (History 저장은 다음 단위)
- 코드: `index.html`(두 영역·버튼·샘플 HTML), `src/phase1Page.js`의 `setupPhase1Page`, `findRootElement`
- 테스트: `tests/phase1Page.test.js` (실제 `index.html` 마크업으로 기능 테스트)
- 실행: `npx serve .` 후 브라우저에서 열기 (ES 모듈이라 `file://`로는 열리지 않는다)
- 이전 노트: [12-patch-replace-add-remove.md](12-patch-replace-add-remove.md)

## 해결할 문제와 전체 역할
지금까지 만든 domToVdom·diff·patch는 각각 따로 테스트한 부품이다. 이 페이지는 부품을 **사람의 행동 하나(Patch 버튼)** 로 이어서,
"바뀐 곳만 실제 화면에 반영된다"를 눈으로 확인하는 실험 장치다.

```
사용자 행동        데이터 변화                 원하는 화면 계산     비교        반영          실제 화면
테스트 영역 편집 → (테스트 영역 DOM이 바뀜) → Patch 클릭 시      → diff     → patch     → 실제 영역의
                                            domToVdom으로       (기준 VDOM   (바뀐 노드만)   일부 노드만 바뀜
                                            새 VDOM            vs 새 VDOM)
```
- **Phase 1:** 사람이 테스트 영역을 직접 고쳐 "원하는 화면"을 만든다.
- **Phase 2:** 상태(state)가 바뀌면 컴포넌트 함수가 "원하는 화면"(새 VDOM)을 계산한다. diff·patch 부분은 같다.

## 시나리오: "Diff 만들기"를 완료 처리
```
실제 영역 (지금 화면)                  테스트 영역 (원하는 화면, contenteditable)
<section class="card">                <section class="card">
  <!-- 주석 -->                          (주석 없음: VDOM에 없으니까)
  <p>남은 일 <strong>2</strong>개</p>     <p>남은 일 <strong>1</strong>개</p>   ← 글자 수정
  <li>Diff 만들기</li>                   <li class="done">Diff 만들기</li>    ← 속성 추가

                 [Patch] 클릭
diff 결과: TEXT 1개 + ATTRS 1개 (각각 path 포함)   → 상태 표시줄에 그대로 보여 준다
실제 영역: <strong> 안 텍스트 노드의 글자, <li>의 class만 바뀐다. 나머지 노드·주석은 같은 객체.
```

## 단계별 입력·출력과 데이터 보관 위치

| 단계 | 입력 | 출력 | 보관 위치 |
|---|---|---|---|
| 로드 | 실제 영역의 루트 요소 | `currentVdom` | `setupPhase1Page` 안의 변수 |
| 로드 | `currentVdom` | 테스트 영역의 **새** DOM (`vdomToDom`) | 테스트 영역 |
| 편집 | 사람의 입력 | 바뀐 테스트 영역 DOM | 테스트 영역 (실제 영역은 그대로) |
| Patch | 테스트 영역 루트 | `nextVdom` (`domToVdom`) | 지역 변수 |
| Patch | `currentVdom`, `nextVdom` | patch 목록 (`diff`) | 지역 변수 → 상태 표시줄 |
| Patch | 실제 영역 루트, patch 목록 | 바뀐 실제 영역, 새 루트 (`patch`) | `actualRoot` |
| Patch 후 | `nextVdom` | 다음 비교의 기준 | `currentVdom = nextVdom` |

- 실제 영역은 Patch 때마다 다시 읽지 않는다. **"지금 화면이 어떤 모습인지"를 `currentVdom`으로 기억**하고 그것과 비교한다.
- 다음 단위(History)는 이 `currentVdom`들을 순서대로 보관하는 일이다.

## 실제 DOM이 바뀌는 시점과 객체 유지
- **로드:** 테스트 영역만 새로 만든다. 실제 영역의 노드를 옮기거나 복제하지 않으므로 두 영역은 서로 다른 객체다.
- **편집:** 테스트 영역만 바뀐다. 실제 영역은 Patch를 누르기 전까지 그대로다.
- **Patch:** `patch`가 바뀐 노드만 고친다(11·12번 노트). 루트 태그가 바뀌면 실제 영역 안 같은 자리에서 루트가 교체되고,
  돌려받은 새 루트를 `actualRoot`에 저장해야 다음 Patch도 화면에 있는 노드에 적용된다.
- **거부:** 최상위 규칙을 어기면 실제 영역과 `currentVdom`을 둘 다 그대로 둔다. 고쳐서 다시 누르면 마지막으로 반영된 VDOM과 비교한다.

## 이번 작업에서 정한 것
- **편집 방식은 contenteditable:** 테스트 영역은 VDOM으로 렌더링한 DOM이고, 사람이 그 화면을 직접 고친다. (사람이 결정)
- **최상위는 요소 하나:** 앞뒤 공백·주석·`&nbsp;`는 무시한다. 비었거나 요소가 둘 이상이거나 요소 밖 글자가 있으면 Patch하지 않고 오류를 보인다. (사람이 결정)
- **뒤로가기·앞으로가기는 꺼 둔다:** History는 다음 단위에서 연결한다. → 연결함: [14-history.md](14-history.md)
- **patch 도중 오류가 나면** 실제 영역이 일부만 바뀌었을 수 있으므로 `currentVdom`을 실제 영역에서 다시 읽는다.

## 한계
- 주석이 VDOM에서 빠지면 그 양옆 텍스트가 VDOM에서 **이웃한 텍스트 두 개**로 남는다. 편집 중 브라우저가 둘을 하나로 합치면
  뒤 자식들의 인덱스가 밀려 최소 변경보다 많은 patch가 나온다. 결과 구조는 맞다. 샘플에서는 주석을 이런 자리에 두지 않았다.
- contenteditable은 브라우저가 Enter·붙여넣기 때 `<div>`, `<br>`, `style` 속성 등을 끼워 넣을 수 있다. 그것도 그대로 "원하는 화면"으로 보고 반영한다.
- 기능 테스트는 jsdom에서 DOM을 직접 바꿔 편집을 흉내 낸다. 실제 브라우저의 키 입력 동작은 직접 열어서 확인해야 한다.

## 이해 확인 질문
1. Patch를 한 번 누른 뒤, 아무것도 고치지 않고 다시 누르면 상태 표시줄에 무엇이 나올까? 그 이유는 어떤 변수 때문인가?
2. 테스트 영역에서 `<section>`을 `<article>`로 바꿔 Patch한 뒤 제목 글자를 고쳐 다시 Patch했다. `setupPhase1Page`에서 어떤 한 줄이 없으면 두 번째 Patch가 화면에 보이지 않을까?
3. 실제 영역 샘플 맨 앞에 주석을 하나 더 넣으면, 테스트 영역의 초기 모습과 첫 Patch 결과는 어떻게 될까?
4. 로드 시 테스트 영역을 `actualRoot.cloneNode(true)`로 만들면 화면은 같아 보인다. 요구사항 R-P1-05와 무엇이 달라지는가?

## 질문 기록
