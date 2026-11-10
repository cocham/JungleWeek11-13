# 03. Diff — 반환 형식과 "변경 없음"

- 요구사항: R-P1-02 (두 Virtual DOM을 비교해 변경된 부분을 찾는 Diff 알고리즘)
- 코드: `src/diff.js`의 `diff(oldVdom, newVdom)`, `walk`, `sameAttrs`
- 테스트: `tests/diff.test.js`
- 범위: 반환 형식을 정하고, 같은 VDOM이면 `[]`를 돌려주는 것까지. 변경을 patch로 만드는 것과 실제 DOM 반영(Patch, R-P1-03)은 다음 작업.
- 이전 노트: [02-dom-to-vdom-children.md](02-dom-to-vdom-children.md)

## 한 줄 요약
`diff`는 **patch 객체의 배열**을 돌려준다. 바뀐 게 없으면 빈 배열 `[]`이다.

## 반환 형식

```js
diff(oldVdom, newVdom) // → Patch[]
// Patch = { type: '종류', path: [자식 인덱스, ...], ...종류별 데이터 }
```

- **배열인 이유:** 한 번 비교에서 여러 곳이 바뀔 수 있다. 개수가 0이면 "변경 없음"이 자연스럽게 표현된다.
- **`path`:** 루트에서 그 노드까지 `children` 인덱스를 차례로 적은 것. 루트 자신은 `[]`. 나중에 Patch가 실제 DOM에서 `childNodes[i]`를 따라 내려가 같은 노드를 찾는 데 쓴다.

### 예시 1 — 변경 없음

```js
const oldVdom = { type: 'element', tag: 'p', attrs: {}, children: [{ type: 'text', text: 'hello' }] };
const newVdom = { type: 'element', tag: 'p', attrs: {}, children: [{ type: 'text', text: 'hello' }] };

diff(oldVdom, newVdom); // → []
```

### 예시 2 — 텍스트 변경 (형식만 정함, 아직 구현 안 함)

```html
<p>hello</p>  →  <p>bye</p>
```

```js
diff(oldVdom, newVdom);
// → [{ type: 'TEXT', path: [0], text: 'bye' }]
//    p(루트, path [])의 0번째 자식인 텍스트 노드의 글자를 'bye'로 바꾸라는 뜻
```

중첩된 경우 `<div><p>hello</p></div>`에서 `hello`가 바뀌면 `path: [0, 0]`(div → 0번째 p → 0번째 텍스트)이 된다.

## 비교 방식 (이번 구현)
두 트리를 **같은 위치끼리** 위에서 아래로 내려가며 비교한다.

1. `type`(text/element)이 같은가
2. 텍스트면 `text`가 같은가
3. 요소면 `tag`, `attrs`, 자식 개수가 같은가
4. 같으면 `children[i]`끼리 재귀로 비교 (path에 `i`를 덧붙임)

## 이번 작업에서 정한 것
- **참조가 아니라 내용으로 비교한다:** `domToVdom`을 두 번 부르면 서로 다른 객체가 나온다. `oldVdom === newVdom`으로는 "변경 없음"을 알 수 없으므로 필드를 하나씩 비교한다.
- **속성은 나열 순서를 무시한다:** `{ id: 'x', type: 'text' }`와 `{ type: 'text', id: 'x' }`는 같은 속성이다. 각 이름이 가진 값은 그대로 비교하므로 `{ id: 'x' }`와 `{ x: 'id' }`는 다르다.
- **아직 못 다루는 변경은 에러를 던진다:** 텍스트·태그·속성·자식 개수가 다르면 `"diff: 텍스트 변경은(는) 아직 지원하지 않습니다 (path: [0])"` 같은 에러를 낸다. `[]`를 돌려주면 "변경 없음"으로 잘못 읽히기 때문이다. 다음 작업에서 에러 대신 patch를 넣는다.

## 아직 빠진 것 → 다음 작업
- 텍스트 변경 → `TEXT` patch 생성
- 속성 변경, 태그/종류 변경(교체), 자식 추가·삭제 patch
- patch를 실제 DOM에 반영하는 Patch 함수 (R-P1-03)

## 질문 기록
**Q. `<p>hello</p>` → `<p>bye</p>`에서 `path: [0]`이면 p가 0번째라는 뜻인가?**

A. 아니다. p는 diff에 넘긴 **루트**라서 `path: []`(빈 배열)이다. `[0]`은 "루트 p의 `children[0]`", 즉 텍스트 노드 `'hello'`를 가리킨다.

```js
oldVdom                         // path []   ← p
oldVdom.children[0]             // path [0]  ← 텍스트 'hello'
```

`path`의 숫자는 루트부터 **몇 번째 자식으로 내려갔는지**를 적은 것이다. 숫자 하나가 한 단계 아래로 내려간다는 뜻이고, 루트에서는 아직 내려가지 않았으므로 숫자가 없다.

```html
<div>          path []
  <p>          path [0]       div.children[0]
    hello      path [0, 0]    div.children[0].children[0]
  </p>
  <span>       path [1]       div.children[1]
    hi         path [1, 0]    div.children[1].children[0]
  </span>
</div>
```

(공백 텍스트 노드가 없다고 가정한 그림이다. 들여쓰기 공백까지 보존하면 공백도 자식이라 인덱스가 밀린다.)

Patch에서는 `path`를 따라 실제 DOM의 `childNodes[i]`로 내려가 같은 노드를 찾는다. `[0]`이면 `root.childNodes[0]`이다.

**Q. "속성은 키 순서를 무시한다"면 키와 값이 뒤바뀌어도 같다고 보나?**

A. 아니다. 무시하는 것은 **여러 속성을 적은 순서**뿐이다. 이름과 값의 짝은 그대로 비교한다.

```js
{ id: 'x', type: 'text' }  vs  { type: 'text', id: 'x' }  // 같음: 적은 순서만 다름
{ id: 'x' }                vs  { x: 'id' }                // 다름: 이름과 값이 뒤바뀜
{ id: 'x' }                vs  { id: 'y' }                // 다름: 값이 다름
```

`sameAttrs`는 old의 이름마다 "new에도 그 이름이 있는지(`Object.hasOwn`)", "값이 같은지(`===`)"를 확인한다. `{ x: 'id' }`에는 `id`라는 이름이 없으므로 여기서 다르다고 나온다.

순서를 무시하는 이유: HTML 속성은 `<input id="x" type="text">`든 `<input type="text" id="x">`든 화면 결과가 같다. 순서만 다르다고 변경으로 보면 고칠 필요가 없는 DOM을 고치게 된다.
