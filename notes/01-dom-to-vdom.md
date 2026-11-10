# 01. DOM → Virtual DOM 변환 (텍스트 · 자식 없는 요소)

- 요구사항: R-P1-01 (브라우저 DOM을 읽어 Virtual DOM으로 변환)
- 코드: `src/domToVdom.js`
- 테스트: `tests/domToVdom.test.js`
- 범위: 텍스트 노드, 자식 없는 요소의 태그·속성. 자식 순회는 다음 작업.

## 한 줄 요약
실제 DOM 노드는 브라우저가 관리하는 무거운 객체다. 그중 화면 비교에 필요한 정보만 꺼내 **평범한 JS 객체**로 옮긴 것이 Virtual DOM이다.

## 실제 DOM 노드에는 무엇이 있나
`<input id="name" class="field" disabled>`의 DOM 노드(`HTMLInputElement`)에는 이런 것들이 함께 붙어 있다.

```
tagName: "INPUT"
id, className, value, checked, style ...       ← 속성 관련
parentNode, childNodes, nextSibling ...        ← 문서 트리 연결
offsetWidth, getBoundingClientRect() ...       ← 레이아웃(화면 계산) 정보
addEventListener(), focus(), click() ...       ← 메서드
... 이런 속성·메서드가 수백 개
```

- 이 객체는 `document`에 연결된 채로 화면과 이어져 있다.
- 그래서 값을 바꾸면 브라우저가 레이아웃 계산(Reflow)과 다시 그리기(Repaint)를 할 수 있다.

## Virtual DOM으로 바꾸면

```js
// 요소
{ type: 'element', tag: 'input', attrs: { id: 'name', class: 'field', disabled: '' }, children: [] }

// 텍스트
{ type: 'text', text: '  hello ' }
```

- 남는 것은 노드 종류(`type`), 태그(`tag`), 속성(`attrs`), 자식(`children`), 텍스트 내용(`text`)뿐이다.
- 브라우저와 연결이 끊긴 그냥 데이터다. 만들고 버리고 비교해도 화면에 아무 영향이 없다.

## 각 필드를 어디서 꺼내나

| VDOM 필드 | DOM에서 꺼내는 곳 | 메모 |
|---|---|---|
| `type` | `node.nodeType` | `Node.TEXT_NODE`(3)이면 `'text'`, `Node.ELEMENT_NODE`(1)이면 `'element'` |
| `tag` | `node.tagName.toLowerCase()` | HTML 문서에서 `tagName`은 `'INPUT'`처럼 대문자로 나온다 |
| `attrs` | `node.attributes`를 돌면서 `{ 이름: 값 }`으로 | 값 없는 속성(`disabled`)은 `''`로 읽힌다 |
| `text` | `node.textContent` | 공백뿐이어도 버리지 않는다 |

## 이번 작업에서 정한 것
- **공백 보존:** 공백뿐인 텍스트도 버리지 않는다. 공백도 화면 결과에 영향을 줄 수 있기 때문이다(예: `<b>a</b> <b>b</b>` 사이의 띄어쓰기).
- **속성값은 문자열 그대로:** `disabled`를 `true`로 바꾸지 않고 DOM에서 읽힌 `''`를 그대로 쓴다.
- **다루지 않는 노드:** 주석 등 텍스트·요소가 아닌 노드는 `null`을 돌려준다.

## 왜 이렇게 바꾸나
나중에 Diff는 이전 VDOM과 새 VDOM을 비교한다.

- 실제 DOM끼리 비교하면 무거운 객체를 계속 건드려야 한다.
- 평범한 객체끼리는 `old.tag !== new.tag`, `old.attrs.class !== new.attrs.class`처럼 가볍게 비교할 수 있다.
- 비교해서 달라진 부분만 실제 DOM에 반영하는 것이 Patch다.

## 아직 빠진 것 → 다음 작업
지금은 `children`이 항상 `[]`다. 자식 순회를 넣으면 이런 트리가 된다.

```html
<p class="a">hi <b>there</b></p>
```

```js
{ type: 'element', tag: 'p', attrs: { class: 'a' }, children: [
  { type: 'text', text: 'hi ' },
  { type: 'element', tag: 'b', attrs: {}, children: [
    { type: 'text', text: 'there' }
  ]}
]}
```

## 질문 기록
**Q. 일반 DOM에서 Virtual DOM으로 바뀌면 형태가 어떻게 바뀌나?**
A. 수백 개의 속성·메서드를 가진 채 화면과 연결된 브라우저 객체가, `type`·`tag`·`attrs`·`children`(텍스트는 `text`)만 가진 평범한 객체가 된다. 위 "실제 DOM 노드에는 무엇이 있나"와 "Virtual DOM으로 바꾸면" 절이 이 질문의 답이다.
