# 02. DOM → Virtual DOM 변환 (자식 노드)

- 요구사항: R-P1-01 (브라우저 DOM을 읽어 Virtual DOM으로 변환)
- 코드: `src/domToVdom.js`의 `getChildren(element)`
- 테스트: `tests/domToVdom.test.js`의 "직계 자식", "중첩 자식"
- 범위: 요소의 자식 노드를 순서·공백 그대로 VDOM `children`에 담기. DOM 렌더링과 Diff는 다음 작업.
- 이전 노트: [01-dom-to-vdom.md](01-dom-to-vdom.md)

## 한 줄 요약
요소를 변환할 때 `childNodes`를 앞에서부터 돌며 각 자식에 `domToVdom`을 **다시 호출(재귀)** 한다. 그러면 DOM 트리와 같은 모양의 VDOM 트리가 만들어진다.

## `children` vs `childNodes`

```html
<p>hi <b>there</b>!</p>
```

| DOM 속성 | 담기는 것 | 위 예시의 결과 |
|---|---|---|
| `element.children` | **요소만** | `[<b>]` — 텍스트 `"hi "`, `"!"`가 사라진다 |
| `element.childNodes` | 텍스트·주석을 포함한 **모든 노드** | `["hi ", <b>, "!"]` |

화면에 보이는 글자는 텍스트 노드에 들어 있다. 그래서 `children`을 쓰면 내용이 빠진다. 순서와 공백까지 그대로 옮기려면 `childNodes`를 써야 한다.

> 헷갈리기 쉬운 점: DOM의 `element.children`(요소만)과 VDOM 객체의 `children` 필드(텍스트 포함 모든 자식)는 이름만 같고 다르다.

## 재귀로 중첩을 처리하는 방식

```js
function getChildren(element) {
  const children = [];
  for (const child of element.childNodes) {
    const vnode = domToVdom(child);   // 자식이 요소면 그 안에서 다시 getChildren이 불린다
    if (vnode !== null) children.push(vnode);
  }
  return children;
}
```

`<div><p>hi <b>there</b></p></div>`를 변환할 때 호출 순서:

```
domToVdom(div)
└─ getChildren(div)
   └─ domToVdom(p)
      └─ getChildren(p)
         ├─ domToVdom("hi ")   → { type: 'text', text: 'hi ' }        ← 텍스트에서 멈춤
         └─ domToVdom(b)
            └─ getChildren(b)
               └─ domToVdom("there") → { type: 'text', text: 'there' }
```

- **멈추는 조건:** 텍스트 노드는 자식이 없으니 바로 객체를 돌려준다. 자식이 없는 요소는 `childNodes`가 비어 있어 `children: []`가 된다.
- 결과적으로 깊이 우선(위에서 아래로, 왼쪽에서 오른쪽으로) 순서로 트리를 훑는다.

## 공백이 텍스트 노드가 되는 경우

```html
<ul>
  <li>one</li>
</ul>
```

HTML을 보기 좋게 들여쓰면 줄바꿈과 들여쓰기도 텍스트 노드가 된다.

```js
children: [
  { type: 'text', text: '\n  ' },   // <ul> 다음 줄바꿈 + 들여쓰기
  { type: 'element', tag: 'li', ... },
  { type: 'text', text: '\n' },     // </li> 다음 줄바꿈
]
```

이번 작업에서는 이것도 그대로 보존한다(01에서 정한 "공백 보존" 규칙). `<b>a</b> <b>b</b>` 사이의 공백처럼 화면에 띄어쓰기로 보이는 경우가 있기 때문이다.

## 이번 작업에서 정한 것
- **주석은 빠진다:** `domToVdom`이 주석에 `null`을 돌려주므로, `getChildren`이 `null`을 `children`에 넣지 않는다. 그래서 `a<!-- memo -->b`는 텍스트 두 개 `['a', 'b']`가 된다(하나로 합치지 않는다).
- **테스트 입력은 `innerHTML`로 만든다:** 테스트의 `fromHTML(html)` 도우미가 브라우저 파서로 요소를 만든다. 실제 페이지처럼 공백 텍스트 노드까지 생긴다.

## 아직 빠진 것 → 다음 작업
- VDOM을 다시 실제 DOM으로 만드는 렌더링
- 두 VDOM을 비교하는 Diff

## 질문 기록
**Q. 실제 React에서도 주석은 자식으로 취급하지 않나?**

A. 취급하지 않는다. React의 Virtual DOM(React element 트리)에는 주석 노드 종류가 아예 없다.

- **JSX 주석은 빌드 때 사라진다.** `{/* 메모 */}`는 컴파일 과정에서 지워져 element 트리에 남지 않는다. 그래서 화면에도 `<!-- -->`가 생기지 않는다.
  ```jsx
  <p>a{/* memo */}b</p>
  // 컴파일 결과: React.createElement('p', null, 'a', 'b')  ← 주석 자리에 아무것도 없음
  ```
- **React 자식이 될 수 있는 것:** element, 문자열, 숫자, 그리고 이것들의 배열. `null`·`undefined`·`true`·`false`는 "아무것도 그리지 않음"으로 처리된다.
- **React가 실제 DOM에 주석을 쓰는 경우는 있다.** 다만 사용자의 자식이 아니라 React 내부 표시용이다. 예를 들어 서버 렌더링 HTML에서 Suspense 경계를 `<!--$-->`, `<!--/$-->`로 표시한다(예전 React 15는 `<!-- react-text -->`를 썼다).
- **hydration 때 실제 DOM을 읽을 때도** React는 자기 표시용이 아닌 일반 주석을 건너뛴다.

**우리 구현과의 차이**
- React는 보통 JSX에서 VDOM을 만들고, 실제 DOM을 읽어서 VDOM을 만들지 않는다(hydration 제외).
- 우리 과제는 실제 DOM을 읽어 VDOM을 만들므로(R-P1-01) 주석을 만날 수 있다. 그래서 `null`을 돌려주고 `children`에서 빼는 방식을 택했다. React가 주석을 자식으로 보지 않는 것과 같은 결과다.
- **나중에 Patch에서 조심할 점:** VDOM `children`에는 주석이 없지만 실제 DOM의 `childNodes`에는 주석이 남아 있을 수 있다. 그러면 "VDOM의 i번째 자식 = DOM의 i번째 childNode"가 어긋난다. 다만 "실제 영역"을 VDOM으로 렌더링해서 만들면 그 안에는 주석이 없으므로 이 문제가 생기지 않는다.
