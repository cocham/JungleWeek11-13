# 06. Diff — 노드 교체 (REPLACE patch)

- 요구사항: R-P1-02 (두 Virtual DOM을 비교해 변경된 부분을 찾는 Diff 알고리즘)
- 코드: `src/diff.js`의 `walk` 맨 앞 교체 판단 부분
- 테스트: `tests/diff.test.js`의 "노드 교체(REPLACE)", "교체와 다른 형제의 변경이 함께"
- 범위: 태그가 다르거나 노드 종류(text ↔ element)가 다르면 교체 patch를 만들기. 자식 추가·삭제와 실제 DOM 반영(Patch, R-P1-03)은 하지 않는다.
- 이전 노트: [05-diff-attrs.md](05-diff-attrs.md)

## 한 줄 요약
같은 위치의 두 노드가 **고쳐 쓸 수 없을 만큼 다르면** 새 노드로 통째로 바꾸라는 patch를 낸다.

```js
{ type: 'REPLACE', path, node: 새 VDOM 노드 }
```

- `path`: 교체할 노드의 위치
- `node`: 그 자리에 들어갈 **새 VDOM 노드 전체**(자식까지 포함)

나중에 Patch 단계에서는 `node`로 실제 DOM 노드를 새로 만들고, `path` 위치의 기존 노드를 그것으로 바꾸면 된다.

## 언제 교체인가

| old | new | 결과 |
|---|---|---|
| `<p>` | `<div>` | REPLACE (태그가 다름) |
| 텍스트 `'hi'` | `<b>hi</b>` | REPLACE (text → element) |
| `<b>hi</b>` | 텍스트 `'hi'` | REPLACE (element → text) |
| `<p class="a">` | `<p class="b">` | ATTRS (태그가 같으니 고쳐 쓴다) |
| 텍스트 `'a'` | 텍스트 `'b'` | TEXT (종류가 같으니 고쳐 쓴다) |

왜 고쳐 쓰지 않는가: 실제 DOM에는 요소의 태그를 바꾸는 방법이 없다. `<p>`를 `<div>`로 만들려면 새 `<div>`를 만들어 갈아 끼워야 한다. 텍스트 노드를 요소로 바꾸는 것도 마찬가지다.

## 예시

### 루트 교체
```js
diff(<p>hi</p>, <div>hi</div>)
// → [{ type: 'REPLACE', path: [], node: { type: 'element', tag: 'div', attrs: {}, children: [{ type: 'text', text: 'hi' }] } }]
```

### 중첩 위치 교체
```js
diff(<p>hi</p>, <p><b>hi</b></p>)
// p는 그대로, p의 0번째 자식이 텍스트 → <b>로 바뀜
// → [{ type: 'REPLACE', path: [0], node: { type: 'element', tag: 'b', ... } }]
```

### 다른 형제의 변경과 함께
```html
<ul><li class="a">one</li><li>two</li><li>three</li></ul>
<ul><li class="b">ONE</li><p>two</p><li>THREE</li></ul>
```
```js
[
  { type: 'ATTRS',   path: [0],    set: { class: 'b' }, remove: [] },  // 0번째 li 속성
  { type: 'TEXT',    path: [0, 0], text: 'ONE' },                      // 0번째 li 글자
  { type: 'REPLACE', path: [1],    node: <p>two</p> },                 // 1번째 li → p
  { type: 'TEXT',    path: [2, 0], text: 'THREE' },                    // 2번째 li 글자
]
```
1번째가 교체되어도 비교를 멈추지 않고 다음 형제(2번째 li)로 넘어간다. 교체는 **그 노드 아래로만** 내려가지 않을 뿐이다.

## 이번 작업에서 정한 것
- **교체한 노드의 속성·자식은 비교하지 않는다:** 새 노드를 통째로 만들면 속성과 자식도 함께 새로 생기므로, 그 안에서 ATTRS·TEXT를 찾을 필요가 없다. 그래서 `<p class="a">x<b>y</b></p>` → `<div class="b">z</div>`는 자식 개수가 달라도(2 → 1) 에러 없이 REPLACE 하나만 나온다.
- **교체 판단을 `walk` 맨 앞에서 한다:** 노드 종류가 다르면 `text`·`tag`·`attrs` 같은 필드 자체가 없을 수 있다. 그래서 다른 비교보다 먼저 확인하고 바로 `return`한다.
- **`node`에는 새 VDOM의 노드를 그대로(같은 객체로) 담는다:** 복사하지 않는다. diff는 VDOM을 고치지 않고 읽기만 하므로 복사할 이유가 없다.
- **같은 태그면 속성이 전부 달라도 교체하지 않는다:** 태그가 같으면 ATTRS로 고쳐 쓰는 편이 새로 만드는 것보다 변경이 적다.

## 아직 빠진 것 → 다음 작업
- 자식 추가·삭제 (지금은 자식 개수가 다르면 에러)
- patch를 실제 DOM에 반영하는 Patch 함수 (R-P1-03)
  - REPLACE를 반영하려면 VDOM으로 실제 DOM 노드를 만드는 함수(VDOM → DOM)가 필요하다.

## 질문 기록
**Q. 노드를 아예 바꾸면 비교를 안 한다는 것인가?**

A. 그렇다. 다만 비교를 안 하는 범위는 **교체되는 노드와 그 아래(자식·자손)** 뿐이다. 형제나 다른 가지는 평소대로 계속 비교한다.

```
<div>                      <div>
  <p class="a">              <h2 class="b">     ← 태그가 다름 → REPLACE, 여기서 아래로 안 내려감
    hello                      bye              ← 비교 안 함 (TEXT patch 없음)
  </p>                       </h2>
  <span>x</span>             <span>y</span>     ← 형제는 계속 비교 → TEXT patch
</div>                     </div>
```

**왜 안에를 비교하지 않나:** REPLACE는 새 VDOM 노드(`node`)로 실제 DOM을 자식까지 통째로 새로 만들어 갈아 끼우라는 뜻이다. 옛 노드는 자식째 버려진다. 그러니 그 안에서 "class가 바뀌었다", "글자가 바뀌었다"를 찾아도 고칠 대상이 이미 없다. 비교해 봐야 쓸모없는 patch만 생긴다.

**대가:** 바깥 태그만 바뀌고 안쪽은 똑같아도 안쪽까지 새로 만든다.
```html
<div><ul>...li 100개...</ul></div>  →  <section><ul>...똑같은 li 100개...</ul></section>
```
`ul`은 하나도 안 바뀌었지만 `div`가 교체되므로 li 100개도 다시 만들어진다.

**그래도 이렇게 하는 이유:** 태그가 다르면 안쪽 구조도 대부분 다르다고 가정하는 것이다. 이렇게 하면 두 트리를 같은 위치끼리 한 번씩만 보면 되므로 비교가 빠르다(노드 수에 비례). 안쪽에서 같은 부분을 찾아 옮겨 쓰려면 훨씬 복잡하고 느린 비교가 필요하다. 실제 React도 같은 규칙을 쓴다. 요소 타입이 다르면 옛 트리를 통째로 버리고 새로 만든다.

**Q. `<h2>`에서 다르면 바로 자식까지 갈아끼우고 형제인 `span`으로 넘어간다는 것인가?**

A. 흐름은 맞다. 한 가지만 구분하면, diff는 직접 갈아끼우지 않고 **"여기를 통째로 바꿔라"라는 REPLACE patch를 기록만** 한다. 실제로 바꾸는 것은 나중에 Patch 단계다.

```
walk(div)           path []      태그 같음, 속성 같음 → 자식으로
├─ walk(p vs h2)    path [0]     태그 다름 → REPLACE 기록 후 return (hello/bye는 안 봄)
└─ walk(span)       path [1]     태그 같음 → 자식으로
   └─ walk('x' vs 'y') path [1, 0] 글자 다름 → TEXT 기록
```
결과(공백 텍스트 노드가 없다고 가정):
```js
[
  { type: 'REPLACE', path: [0],    node: <h2 class="b">bye</h2> },
  { type: 'TEXT',    path: [1, 0], text: 'y' },
]
```
`return`은 `walk(p vs h2)` 호출 하나만 끝낸다. 부모 div의 `for` 반복은 그대로 이어지므로 다음 형제 `span`을 비교한다.
