# 11. Patch — 위치 찾기와 TEXT·ATTRS 적용

- 요구사항: R-P1-03 (변경된 부분만 실제 DOM에 반영, Patch)
- 코드: `src/patch.js`의 `patch`, `getNodeByPath`
- 테스트: `tests/patch.test.js`
- 범위: path로 실제 DOM 노드를 찾고, TEXT·ATTRS patch를 그 자리에서 적용한다. REPLACE·ADD·REMOVE는 하지 않는다(에러).
- 이전 노트: [10-vdom-to-dom-recursive.md](10-vdom-to-dom-recursive.md)

## 한 줄 요약
`patch(root, patches)`는 patch마다 `getNodeByPath`로 노드를 찾아 **글자(`nodeValue`)나 속성(`setAttribute`/`removeAttribute`)만** 고친다. 노드를 새로 만들지 않으므로 모든 DOM 객체가 그대로 남는다.

```js
patch(root, [
  { type: 'ATTRS', path: [],     set: { class: 'b' }, remove: ['id'] },
  { type: 'TEXT',  path: [1, 0], text: 'B' },
]);
// → root 그대로 반환
```

## 위치 찾기: 주석은 세지 않는다
path는 **VDOM의 children 인덱스**다. 그런데 `domToVdom`은 주석을 VDOM에서 뺀다. 그래서 실제 DOM의 `childNodes` 인덱스와 다를 수 있다.

```
<ul><!--c1--><li>a</li><!--c2--><li>b</li></ul>

DOM  childNodes: [ <!--c1-->, <li>a</li>, <!--c2-->, <li>b</li> ]   → li(b)는 [3]
VDOM children:   [            li(a),                 li(b)      ]   → li(b)는 [1]
```

`childNodes[1]`을 그대로 쓰면 `li(a)`를 고치게 된다. 그래서 `getNodeByPath`는 각 단계에서 **텍스트·요소 노드만 골라** 센 다음 i번째를 고른다(`vdomChildNodes`).

- 이 기준은 `domToVdom`이 VDOM에 넣는 노드의 기준(텍스트·요소)과 반드시 같아야 한다.
- 공백 텍스트 노드는 VDOM에 있으므로 센다.
- path에 해당하는 노드가 없으면 엉뚱한 노드를 고치기 전에 에러를 던진다.

## 적용
| patch | 하는 일 | 바뀌지 않는 것 |
|---|---|---|
| TEXT | `node.nodeValue = text` | 텍스트 노드 객체. `''`여도 노드가 남는다 |
| ATTRS | `set`은 `setAttribute`, `remove`는 `removeAttribute` | 요소 객체, 그 자식, 형제 |

- `disabled: ''`도 `setAttribute`라서 "있는" 속성이 된다(`button.disabled === true`).
- `data-*`는 `dataset`에 자동으로 반영된다.

## 확인한 것
- `getNodeByPath`
  - path `[]`는 root
  - 주석이 앞이나 사이에 있을 때, 여러 깊이에 있을 때도 VDOM path와 같은 노드를 찾는다
  - 주석이 섞인 트리에서 **VDOM의 모든 path**를 돌며, 찾은 DOM 노드를 다시 VDOM으로 바꾸면 그 위치의 VDOM과 같다
  - 공백 텍스트는 센다, 없는 path면 에러
- TEXT·ATTRS: 글자·속성만 바뀌고, 패치 전에 모아 둔 모든 노드(주석 포함)가 **같은 객체(`===`)로 같은 순서와 개수**로 남는다
- diff와 연결: 주석이 섞인 원본 DOM에 `diff(domToVdom(root), newVdom)` 결과를 적용하면 `domToVdom(root)`가 `newVdom`과 같아지고, 모든 노드 객체와 주석이 유지된다
- REPLACE·ADD·REMOVE는 에러

## 이번 작업에서 정한 것
- **고칠 때 노드를 새로 만들지 않는다:** 글자는 `nodeValue`, 속성은 `setAttribute`/`removeAttribute`로 그 자리에서 바꾼다. 이벤트 리스너나 입력 중인 값 같은, 노드에 붙은 상태도 잃지 않는다.
- **주석은 건드리지도 세지도 않는다:** VDOM에 없는 노드라 diff가 알지 못한다. 그대로 두고, 위치를 셀 때만 건너뛴다.
- **`patch`는 root를 돌려준다:** 다음 작업에서 루트를 REPLACE하면 root 자체가 바뀌므로, 쓰는 쪽이 처음부터 반환값을 받도록 맞췄다.
- **지원하지 않는 patch는 에러:** 건너뛰면 화면이 새 VDOM과 다른데도 성공한 것처럼 보이기 때문이다.

## 아직 빠진 것 → 다음 작업
- REPLACE: `vdomToDom(node)`로 만들어 그 자리의 노드와 바꾸기(`replaceChild`). 루트이면 root를 바꿔 반환한다.
- ADD: 부모를 찾아 `appendChild(vdomToDom(node))`. 단, 부모 끝에 주석이 있으면 "VDOM 기준 끝"과 "DOM의 끝"이 다를 수 있다.
- REMOVE: 부모에서 `removeChild`

## 질문 기록

**Q. "patch는 root를 돌려준다: 루트를 REPLACE하면 root 자체가 바뀌므로, 쓰는 쪽이 처음부터 반환값을 받도록 맞췄다"는 무슨 뜻인가?**

A. 보통 `patch`는 root **안쪽**만 고치므로 root 객체는 그대로다. 그런데 루트 REPLACE(`path: []`)는 다르다. 실제 DOM에는 `<p>` 객체를 `<div>`로 바꾸는 방법이 없어서, 새 `<div>`를 만들어 `<p>` 자리에 끼우고 `<p>`는 떼어 낸다.

```
patch 전                          patch 후
#actual                           #actual
 └─ <p>hi</p>  ← root 변수          └─ <div>hi</div>  ← 새 노드 (화면에 있음)
                                  <p>hi</p>  ← root 변수는 아직 이걸 가리킴 (화면에서 떨어짐)
```

부르는 쪽의 `root` 변수는 여전히 떼어 낸 옛 `<p>`를 가리킨다. 다음 Patch 때 이걸 고치면 화면은 바뀌지 않는다. 그래서 `patch`가 patch 후의 진짜 root를 돌려주고, 부르는 쪽은 항상 그 값으로 바꿔 쥔다.

```js
root = patch(root, patches);   // 루트가 교체됐으면 새 노드, 아니면 원래 root 그대로
```

지금은 TEXT·ATTRS뿐이라 반환값이 언제나 넘겨준 root와 같다. 그래도 지금 "반환값을 받는다"로 정해 두면, REPLACE를 넣을 때 `patch`를 부르는 코드를 고칠 필요가 없다. 루트를 갈아 끼우려면 root에 부모(예: "실제 영역" 컨테이너)가 있어야 `replaceChild`를 쓸 수 있는데, 이건 REPLACE 작업에서 다룬다.
