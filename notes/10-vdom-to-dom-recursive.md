# 10. VDOM → DOM — vdomToDom (텍스트·요소 구분, 자식 재귀 생성)

- 요구사항: R-P1-03 (변경된 부분만 실제 DOM에 반영, Patch)의 준비 단계
- 코드: `src/vdomToDom.js`의 `vdomToDom`
- 테스트: `tests/vdomToDom.test.js`의 "vdomToDom — 텍스트·요소 구분과 자식 재귀 생성"
- 범위: VDOM 노드 하나를 받아 자식까지 통째로 실제 DOM으로 만든다. patch 적용은 하지 않는다.
- 이전 노트: [09-vdom-to-dom-element.md](09-vdom-to-dom-element.md)

## 한 줄 요약
`type`을 보고 텍스트면 `createTextDom`, 요소면 `createElementDom`으로 만든 뒤 `children`마다 `vdomToDom`을 다시 불러 순서대로 `appendChild`한다. `domToVdom`과 정확히 거꾸로 된 모양이다.

```js
export function vdomToDom(vnode) {
  if (vnode.type === 'text') return createTextDom(vnode);
  if (vnode.type === 'element') {
    const element = createElementDom(vnode);       // 태그·속성
    for (const child of vnode.children) {
      element.appendChild(vdomToDom(child));       // 자식(재귀)
    }
    return element;
  }
  throw new Error(...);                            // 모르는 type
}
```

| domToVdom (DOM → VDOM) | vdomToDom (VDOM → DOM) |
|---|---|
| `nodeType`으로 텍스트/요소 구분 | `type`으로 텍스트/요소 구분 |
| `childNodes`마다 재귀 → `children` 배열 | `children`마다 재귀 → `appendChild` |
| 공백 텍스트도 버리지 않음 | 공백·빈 텍스트도 건너뛰지 않음 |

## 재귀가 도는 모양
```
vdomToDom(<p>)                     createElementDom → <p></p>
├─ vdomToDom('hi ')                → 텍스트 노드, p에 append
├─ vdomToDom(<b>)                  createElementDom → <b></b>
│  └─ vdomToDom('there')           → 텍스트 노드, b에 append
│                                  b 완성 → p에 append
└─ vdomToDom('!')                  → 텍스트 노드, p에 append
                                   p 완성: <p>hi <b>there</b>!</p>
```
자식을 먼저 끝까지 만든 다음 부모에 붙인다. children 배열 순서대로 붙이므로 형제 순서가 그대로다.

## 확인한 것
- 텍스트/요소 구분, 모르는 `type`이면 에러(자식 안에 있어도)
- 중첩 요소: `div > section > p > b > 텍스트`
- 텍스트·요소 혼합: `<p>hi <b>there</b>!</p>`
- 형제 순서: `li` 1, 2, 3
- 공백: 요소 사이의 `'\n  '` 텍스트도 자식 노드로 만든다
- 빈 텍스트: `''`도 자식 노드로 만든다. 그래서 `childNodes[1]`이 VDOM의 `children[1]`과 같은 노드다
- VDOM을 바꾸지 않는지, 호출할 때마다 새 트리를 만드는지
- 왕복
  - DOM → VDOM → DOM: `outerHTML`과 `isEqualNode`가 원본과 같다
  - VDOM → DOM → VDOM: `toEqual`로 원본과 같다
  - 빈 텍스트가 있는 VDOM도 왕복하면 그대로다

## 이번 작업에서 정한 것
- **`createElementDom`은 태그·속성만 만드는 채로 두고, 자식은 `vdomToDom`이 붙인다:** 요소 하나 만들기와 트리 만들기를 나눠 두면 각자 읽기 쉽다. 09의 "자식을 만들지 않는다" 테스트도 그대로 유효하다.
- **빈·공백 텍스트를 건너뛰지 않는다:** 건너뛰면 실제 DOM의 자식 인덱스가 VDOM과 어긋난다. diff의 path는 VDOM 인덱스 기준이므로, Patch 단계에서 엉뚱한 노드를 고치게 된다.
- **모르는 `type`은 에러:** `domToVdom`은 주석 같은 노드를 `null`로 걸러 내므로 정상 VDOM에는 없다. 그런데도 나왔다면 버그이니, 조용히 빼지 않고 바로 알린다.

## 아직 빠진 것 → 다음 작업
- patch 목록을 실제 DOM에 적용하는 함수 (R-P1-03)
  - path를 따라 실제 DOM 노드를 찾기 (`childNodes[i]`를 차례로)
  - TEXT, ATTRS, REPLACE(`vdomToDom` 사용), ADD(`appendChild(vdomToDom(node))`), REMOVE

## 질문 기록
