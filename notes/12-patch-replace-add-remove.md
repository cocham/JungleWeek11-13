# 12. Patch — REPLACE·ADD·REMOVE 적용

- 요구사항: R-P1-03 (변경된 부분만 실제 DOM에 반영, Patch)
- 코드: `src/patch.js`의 `applyReplace`, `applyAdd`, `applyRemove`
- 테스트: `tests/patch.test.js`의 "REPLACE 적용", "ADD 적용", "REMOVE 적용", "다섯 종류 patch 통합"
- 범위: 구조를 바꾸는 세 patch를 적용한다. 이제 diff가 내는 다섯 종류 patch를 모두 실제 DOM에 반영할 수 있다.
- 이전 노트: [11-patch-text-attrs.md](11-patch-text-attrs.md)

## 한 줄 요약

| patch | 찾는 것 | 하는 일 |
|---|---|---|
| REPLACE | path의 노드 | `vdomToDom(node)`로 만든 새 노드로 `replaceChild`. 루트면 새 노드를 root로 반환 |
| ADD | path에서 마지막을 뺀 **부모** | index번째 VDOM 자식 앞에 `insertBefore`, 없으면 맨 끝에 붙임 |
| REMOVE | path의 노드 | 부모에서 `removeChild` |

세 경우 모두 위치는 `getNodeByPath`로 찾으므로 **주석을 세지 않는다**(11번 노트).

## 루트 교체
```js
const container = document.querySelector('#actual');   // <!--앞--><p>hi</p><!--뒤-->
let root = container.childNodes[1];

root = patch(root, [{ type: 'REPLACE', path: [], node: <section>new</section> }]);
// container: <!--앞--><section>new</section><!--뒤-->
// root: 새 <section>  (옛 <p>는 parentNode === null)
```
- 루트에 부모가 있으면 부모 안의 **같은 자리**에서 `replaceChild`로 갈아 끼운다. 앞뒤 형제(주석 포함)는 그대로다.
- 부모가 없는 루트는 화면에 끼울 곳이 없으니, 새 노드만 돌려준다.
- 어느 쪽이든 `patch`는 새 root를 돌려준다. 그래서 부르는 쪽은 `root = patch(root, ...)`로 받으면 다음 Patch도 화면의 노드에 적용된다.

## 주석이 섞였을 때 위치
```
<ul><!--c1--><li>a</li><!--끝--></ul>      VDOM children: [li(a)]

ADD [1] li(b) → VDOM 자식 [1]이 없으므로 맨 끝에 붙임
<ul><!--c1--><li>a</li><!--끝--><li>b</li></ul>
```
- ADD는 "index번째 VDOM 자식의 바로 앞"에 끼운다. 그 자식이 없으면(끝에 추가) DOM의 맨 끝, 즉 끝의 주석 **뒤**에 붙는다.
- 주석은 VDOM에 없으므로, 주석의 앞에 붙이든 뒤에 붙이든 VDOM 순서는 같다. 규칙을 단순하게 하려고 맨 끝으로 정했다.
- index가 VDOM 자식 수보다 크면 사이가 비게 되므로 에러를 던진다.

## 적용 순서
patch 배열을 앞에서부터 적용한다. diff가 정한 순서(07번 노트) 덕분에 각 path는 적용 순간의 DOM에서 맞다.
- REMOVE는 내림차순이다. `[3]`, `[2]`, `[1]` 순서로 지우므로 아직 안 지운 앞쪽 노드는 밀리지 않는다.
- ADD는 오름차순이다. 매번 "지금의 끝"에 붙는다.
- 주석을 지우거나 더하지 않으므로, 주석은 이 순서 계산에 끼어들지 않는다.

## 확인한 것
- REPLACE: 중첩 위치, text ↔ element 교체에서 대상만 바뀌고 주석·형제는 같은 객체로 남는다.
  - 루트 교체 시 부모 컨테이너의 같은 자리가 바뀌고, 반환값이 새 루트다. 옛 루트는 떨어져 나간다.
  - 부모 없는 루트를 교체하면 새 노드를 돌려준다.
  - 돌려받은 루트로 다음 patch를 이어서 적용할 수 있다.
- ADD: 빈 부모, 끝에 주석이 있는 부모, 중첩된 부모에 붙인다. 위치가 범위를 넘으면 에러.
- REMOVE: 주석 사이의 여러 노드를 내림차순으로 지운다. 전부 지우면 주석만 남는다. 루트 REMOVE는 에러.
- 통합
  - 주석이 섞인 원본에 다섯 종류가 모두 나오는 diff 결과를 적용하면, `domToVdom(root)`가 새 VDOM과 같다.
  - **교체·삭제 대상과 그 자손을 뺀 모든 기존 노드**가 같은 객체로, 같은 상대 순서로 남는다. 대상 노드는 root 안에 없다.
  - "실제 영역" 시나리오: 루트 교체를 포함해 다섯 번 이어서 patch해도 매번 새 VDOM과 같고, 부모 안의 자리도 함께 갱신된다.
- 테스트가 틀린 구현을 잡는지 확인: 주석까지 세도록 바꾸면 patch 테스트 19개, 끝에 추가할 때 마지막 노드 앞에 끼우도록 바꾸면 6개가 실패했다(확인 후 원래대로 되돌림).

## 이번 작업에서 정한 것
- **교체·삭제는 대상 노드 하나만 바꾼다:** `replaceChild`·`removeChild`는 그 노드의 자리만 건드린다. 형제나 주석을 다시 만들지 않는다.
- **끝에 추가할 때는 DOM의 맨 끝에 붙인다:** 끝에 주석이 있어도 그 뒤에 붙는다. VDOM 순서에는 영향이 없다.
- **ADD를 "index번째 VDOM 자식 앞에 끼우기"로 일반화했다:** 지금 diff는 항상 끝에 추가하지만, 중간 index가 와도 맞는 자리에 들어간다.
- **루트에는 ADD·REMOVE를 할 수 없다:** 루트를 없애거나 루트의 형제를 만드는 것은 diff가 내지 않는 patch이므로 에러로 막는다.

## 아직 빠진 것 → 다음 작업
- 검증용 웹 페이지(R-P1-04 이후): "실제 영역"·"테스트 영역", Patch / 뒤로가기 / 앞으로가기 버튼
- key 기반 자식 비교 (이동 감지)

## 질문 기록
