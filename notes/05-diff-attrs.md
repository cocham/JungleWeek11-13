# 05. Diff — 속성 추가·변경·삭제 (ATTRS patch)

- 요구사항: R-P1-02 (두 Virtual DOM을 비교해 변경된 부분을 찾는 Diff 알고리즘)
- 코드: `src/diff.js`의 `diffAttrs(oldAttrs, newAttrs, path)`, `walk`에서 호출하는 부분
- 테스트: `tests/diff.test.js`의 "속성 변경(ATTRS)", "빈 문자열 속성값 vs 속성 삭제", "속성 변경과 텍스트 변경이 함께"
- 범위: 같은 위치·같은 태그의 요소끼리 속성 차이를 patch로 만들기. 태그 교체, 자식 추가·삭제, 실제 DOM 반영(Patch, R-P1-03)은 하지 않는다.
- 이전 노트: [04-diff-text.md](04-diff-text.md)

## 한 줄 요약
한 요소의 속성 변화는 **patch 하나**로 모은다. 생기거나 바뀐 속성은 `set`에, 없어진 속성은 `remove`에 담는다.

```js
{ type: 'ATTRS', path, set: { 이름: 새 값, ... }, remove: ['이름', ...] }
```

나중에 Patch 단계에서는 `set`의 각 항목에 `setAttribute(이름, 값)`, `remove`의 각 이름에 `removeAttribute(이름)`를 부르면 된다.

## 예시

| 상황 | old attrs → new attrs | patch |
|---|---|---|
| 추가 | `{}` → `{ id: 'x' }` | `set: { id: 'x' }, remove: []` |
| 변경 | `{ class: 'a' }` → `{ class: 'b' }` | `set: { class: 'b' }, remove: []` |
| 삭제 | `{ id: 'x' }` → `{}` | `set: {}, remove: ['id']` |
| 한꺼번에 | `{ id: 'x', class: 'a', title: 'keep' }` → `{ class: 'b', title: 'keep', 'data-n': '1' }` | `set: { class: 'b', 'data-n': '1' }, remove: ['id']` |
| 순서만 다름 | `{ id, type }` → `{ type, id }` (값 같음) | patch 없음 |

바뀌지 않은 속성(`title: 'keep'`)은 patch에 넣지 않는다. 바뀐 것만 담아야 "변경분만 반영"(R-P1-03)이 된다.

## 빈 문자열 값 vs 삭제

`<button disabled>`의 `disabled`는 DOM에서 값이 `''`로 읽힌다(01 노트). 값이 비어 있어도 **속성은 있는 것**이다.

| 상황 | old → new | patch |
|---|---|---|
| `''` 값 속성 추가 | `<button>` → `<button disabled>` | `set: { disabled: '' }` |
| `''` 값 속성 삭제 | `<button disabled>` → `<button>` | `remove: ['disabled']` |
| 값을 `''`로 변경 | `{ title: 'hi' }` → `{ title: '' }` | `set: { title: '' }` (삭제 아님) |

그래서 "있는지"는 값으로 판단하지 않고 이름으로 판단한다.

```js
// 틀린 방식: '' 는 falsy라서 "없다"로 잘못 판단한다
if (!newAttrs[name]) remove.push(name);

// 이번 구현: 이름이 객체에 있는지를 본다
if (!Object.hasOwn(newAttrs, name)) remove.push(name);
```

## 속성과 텍스트가 함께 바뀔 때

```html
<p class="a">hello</p>  →  <p class="b">bye</p>
```

```js
[
  { type: 'ATTRS', path: [],  set: { class: 'b' }, remove: [] },  // p 자신
  { type: 'TEXT',  path: [0], text: 'bye' },                      // p의 0번째 자식
]
```

`walk`는 요소 자신의 속성을 먼저 비교하고 그다음 자식으로 내려간다. 그래서 같은 요소에서는 ATTRS가 그 자식들의 patch보다 항상 먼저 온다. 트리 전체로 보면 위에서 아래로, 왼쪽에서 오른쪽(깊이 우선) 순서다.

## 이번 작업에서 정한 것
- **요소 하나당 ATTRS patch 하나:** 속성마다 patch를 따로 만들지 않는다. 같은 노드를 한 번만 찾아가면 되고, patch 목록도 짧아진다.
- **`set`과 `remove`는 비어 있어도 항상 넣는다:** 받는 쪽이 `patch.set`이 있는지 따로 확인하지 않아도 된다.
- **추가와 변경을 구분하지 않는다:** 둘 다 결국 `setAttribute`이므로 `set` 하나로 합쳤다.
- **이름과 값이 뒤바뀐 경우**(`{ id: 'x' }` → `{ x: 'id' }`)는 `set: { x: 'id' }, remove: ['id']`가 된다. 03에서 "에러가 나는지"로 확인하던 테스트를 이 patch로 바꿨다.
- **속성 이름은 그대로 비교한다:** `domToVdom`이 DOM에서 읽은 이름(HTML에서는 소문자)을 그대로 쓴다. 대소문자를 따로 맞추지 않는다.

## 아직 빠진 것 → 다음 작업
- 노드 종류(text ↔ element) 변경, 태그 교체 (지금은 에러)
- 자식 추가·삭제 (지금은 자식 개수가 다르면 에러)
- patch를 실제 DOM에 반영하는 Patch 함수 (R-P1-03)
  - `value`·`checked`처럼 속성과 DOM 프로퍼티가 따로 노는 경우를 Patch 때 확인해야 한다.

## 질문 기록
**Q. `<p class="a">hello</p>` → `<p class="b">bye</p>`의 결과(ATTRS 하나, TEXT 하나)가 이해되지 않는다.**

A. 바뀐 곳이 **두 군데**라서 patch도 두 개다.

1. 두 VDOM을 나란히 놓는다.
   ```js
   // old                                        // new
   { tag: 'p', attrs: { class: 'a' },           { tag: 'p', attrs: { class: 'b' },
     children: [                                  children: [
       { type: 'text', text: 'hello' }              { type: 'text', text: 'bye' }
     ] }                                          ] }
   ```
2. `walk`가 루트 p(path `[]`)부터 비교한다.
   - 태그: `p` = `p` → 같다
   - 속성: `class`가 `'a'` → `'b'` → **다르다** → `{ type: 'ATTRS', path: [], set: { class: 'b' }, remove: [] }`
     - `path: []`: 바뀐 곳이 루트인 p 자신
     - `set: { class: 'b' }`: class를 'b'로 설정
     - `remove: []`: 지울 속성 없음
   - 자식 개수: 1 = 1 → 같다 → 자식으로 내려간다
3. p의 0번째 자식(path `[0]`)을 비교한다.
   - 둘 다 텍스트, 글자가 `'hello'` → `'bye'` → **다르다** → `{ type: 'TEXT', path: [0], text: 'bye' }`

순서가 ATTRS → TEXT인 것은 `walk`가 **자기 자신을 먼저 비교하고 그다음 자식으로 내려가기** 때문이다.

나중에 Patch가 이 배열을 받으면 이렇게 읽는다.
- 첫 번째: 루트 p를 찾아 `setAttribute('class', 'b')`
- 두 번째: p의 `childNodes[0]`(텍스트)를 찾아 글자를 `'bye'`로

p를 통째로 다시 만들지 않고 이 두 군데만 고친다. 이것이 Diff가 "변경된 부분만" 찾는다는 뜻이다.

**Q. class는 타입이 attrs인가?**

A. 아니다. class는 **속성 이름**이고, `attrs` 객체 안에 들어 있는 키 하나다. `'ATTRS'`는 class의 타입이 아니라 **patch의 종류**(속성이 바뀌었다는 변경)다.

`type`이라는 이름이 두 군데에서 다른 뜻으로 쓰여서 헷갈리기 쉽다.

| 어디의 type | 값 | 뜻 |
|---|---|---|
| VDOM 노드의 `type` | `'element'`, `'text'` | 이 노드가 요소인지 텍스트인지 |
| patch의 `type` | `'TEXT'`, `'ATTRS'` | 어떤 종류의 변경인지 |

```js
// VDOM 노드
{ type: 'element', tag: 'p', attrs: { class: 'a' }, children: [...] }
//       노드 종류              속성 모음 ↑ 이름 'class', 값 'a'

// patch
{ type: 'ATTRS', path: [], set: { class: 'b' }, remove: [] }
//      변경 종류: "속성이 바뀜"   class를 'b'로
```

class·id·href·disabled는 모두 똑같이 `attrs` 안의 속성이고, 이 중 무엇이 바뀌어도 patch 종류는 `'ATTRS'` 하나다. 노드 종류(`'text'`)와 patch 종류(`'TEXT'`)는 대소문자로 구분해 두었다.
