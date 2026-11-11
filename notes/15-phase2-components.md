# 15. Phase 2 시작 — 컴포넌트가 VDOM을 만든다

- 요구사항: R-P2-01(함수형 컴포넌트), R-P2-04(자식은 props만 받는 순수 함수), R-P2-07(Phase 1 Diff·Patch 재사용)의 기반
- 코드: `src/h.js`(`h`, `resolve`), `src/events.js`, `src/diff.js`의 `diffEvents`, `src/patch.js`의 EVENTS 처리, `src/vdomToDom.js`
- 테스트: `tests/h.test.js`, `tests/diff.test.js`·`tests/patch.test.js`·`tests/vdomToDom.test.js`의 "Phase 2" 묶음
- 이전 노트: [14-history.md](14-history.md)

## 해결할 문제
Phase 1에서는 **사람이 목표 HTML을 직접 편집**했고, 그 HTML을 `domToVdom`으로 읽어 새 VDOM을 얻었다.
Phase 2에서는 사람이 HTML을 고치지 않는다. 사용자가 버튼을 누르면 **상태(데이터)가 바뀌고, 컴포넌트 함수가 그 상태로 새 화면을 계산**한다.
그러려면 두 가지가 필요하다.
1. 코드로 VDOM을 만드는 방법 → `h()`
2. 클릭 같은 사용자 동작을 받을 방법 → VDOM의 `events`와 EVENTS patch

이번 단위는 "컴포넌트가 계산한 VDOM을 Phase 1 Diff·Patch로 화면에 반영"까지다. 상태(`useState`)와 자동 재렌더링은 다음 단위다.

## 전체 흐름
```
                Phase 1                              Phase 2 (이번 단위까지)
사용자 행동     테스트 영역 HTML 편집                  (다음 단위: 클릭 → 상태 변경)
원하는 화면     domToVdom(테스트 영역)                 resolve(h(TodoList, { todos }))
Diff            diff(옛 VDOM, 새 VDOM)      ← 같음 →   diff(옛 VDOM, 새 VDOM)
Patch           patch(실제 영역 root, patches) ← 같음 → patch(root, patches)
```
Diff와 Patch는 그대로다. 바뀐 것은 "새 VDOM을 어디서 얻느냐"뿐이다.

## 시나리오: 할 일 b를 완료하고 c를 추가
```js
const TodoItem = ({ title, done, onToggle }) =>
  h('li', { class: done ? 'done' : null, onClick: onToggle }, title, done && h('span', null, ' ✓'));

const TodoList = ({ todos, onToggle }) =>
  h('ul', null, todos.map((t, i) => h(TodoItem, { title: t.title, done: t.done, onToggle: () => onToggle(i) })));
```

1. **h가 만드는 것** — `h(TodoList, {...})`는 TodoList를 아직 호출하지 않고 `{ type: 'component', component: TodoList, props }`만 만든다.
2. **resolve가 펼침** — `resolve`가 component 노드를 만나면 함수를 props로 호출하고, 결과 안의 컴포넌트도 끝까지 호출한다.
   결과는 Phase 1과 같은 모양의 element/text 트리에 `events`만 더해진 것이다.
   ```
   ul
   ├ li  events:{click}  ─ "a"
   └ li  events:{click}  ─ "b"
   ```
3. **새 화면 계산** — todos가 `[a, b(done), c]`가 되면 다시 resolve한다.
   ```
   ul
   ├ li  events:{click}                ─ "a"
   ├ li  attrs:{class:"done"} events   ─ "b", span(" ✓")
   └ li  events:{click}                ─ "c"
   ```
4. **Diff** — Phase 1 diff가 같은 인덱스끼리 비교한다.
   - `[1]` ATTRS `{ class: 'done' }`, `[1, 1]` ADD `span`, `[2]` ADD `li(c)`
   - 모든 li의 `onClick`은 매번 새로 만든 화살표 함수라 참조가 달라서 EVENTS patch도 나온다.
5. **Patch** — 실제 DOM에서 li(b)의 class를 바꾸고 span을 붙이고, li(c)를 끝에 붙이고, 핸들러를 갈아 끼운다.
   **li(a), li(b), 텍스트 "b"는 같은 DOM 객체로 남는다** (`tests/h.test.js` "변경분만 실제 DOM에 반영").

## 데이터가 어디 있나
| 단계 | 입력 | 출력 | 보관 |
|---|---|---|---|
| `h` | 태그/컴포넌트, props, 자식 | element 또는 component 노드 | 없음 (호출할 때마다 새 객체) |
| `resolve` | component가 섞인 트리 | element/text만 있는 트리 | 없음. 원래 트리는 바꾸지 않음 |
| `diff` | 옛·새 VDOM | patch 목록 (이제 6종류) | 없음 |
| `patch` | 실제 root, patch 목록 | 적용 후 root | 실제 DOM |
| `events.js` | 요소, 이벤트 이름, 함수 | — | 요소마다 붙은 핸들러를 WeakMap에 기억 |

옛 VDOM을 기억하고 다시 렌더링하는 책임은 다음 단위의 `FunctionComponent`가 맡는다.

## h의 규칙
- 속성(attrs)은 Phase 1 계약대로 **값이 전부 문자열**이다. `true → ''`, `false/null/undefined → 없음`, 숫자 → 문자열.
- `on` + 대문자로 시작하는 props(`onClick`)는 속성이 아니라 `events: { click: fn }`으로 간다.
- 자식: 문자열·숫자 → 텍스트, 배열 → 펼침, `null/undefined/true/false` → 건너뜀(조건부 표시).

## 왜 컴포넌트를 바로 호출하지 않나
`h(TodoItem, props)` 안에서 TodoItem을 바로 호출해도 화면은 같다. 그래도 미루는 이유는 **R-P2-03(Hook은 루트에서만)**이다.
다음 단위에서 FunctionComponent는 "루트 함수 실행 → 끝 → resolve로 자식 실행" 순서로 렌더링한다.
그러면 자식 안에서 `useState`를 부르는 순간은 항상 "루트 실행이 끝난 뒤"이므로, Hook이 그 상황을 보고 에러를 던질 수 있다.

## 이벤트: 왜 EVENTS patch가 따로 필요한가
- 핸들러는 문자열 속성이 아니므로 `setAttribute`로 넣을 수 없다. `addEventListener`로 붙여야 한다.
- 함수는 내용이 아니라 **참조(===)로 비교**한다. 렌더링마다 새 화살표 함수를 만들면 매번 EVENTS patch가 나오지만,
  그래야 새 렌더링의 최신 값을 보는 핸들러가 붙는다. 옛 핸들러는 `removeEventListener`로 떼므로 한 번 클릭에 한 번만 실행된다.
- `removeEventListener`는 붙일 때와 같은 함수를 넘겨야 하므로, `events.js`가 요소마다 지금 붙은 함수를 기억한다.
- Phase 1 VDOM(`domToVdom`)에는 `events`가 없다. diff·vdomToDom은 없는 것을 `{}`로 보므로 Phase 1 동작은 그대로다.

## 한계 (지금 정한 것)
- 컴포넌트가 아무것도 돌려주지 않으면(`null`) 에러. 숨기려면 부모에서 `{show && h(Child)}`.
- 컴포넌트는 노드 **하나**만 돌려준다. 배열을 돌려주면(길이가 1이어도) 에러. 여러 노드는 `h('ul', null, ...)`처럼 요소로 감싼다.
  첫 노드만 쓰면 나머지가 조용히 사라지기 때문이다. (Fragment는 지원하지 않는다)
- key가 없으므로 리스트 중간 삽입·삭제는 Phase 1처럼 인덱스 기준으로 비교된다(뒤쪽 노드들이 TEXT/ATTRS로 고쳐짐).
- `<input>`의 `value`·`checked`는 속성으로만 넣는다. 사용자가 입력한 뒤의 화면 값(프로퍼티)을 코드로 되돌리는 문제는 테스트 앱 단계에서 필요할 때 다룬다.

## 이해 확인 질문
1. `h('ul', null, [])`와 `h('ul', null, null)`의 children은 각각 무엇일까?
2. 위 시나리오에서 todos를 `[a, b]` → `[b]`(a 삭제)로 바꾸면 diff는 어떤 patch를 낼까? li(b)의 DOM 객체는 살아남을까?
3. 모든 렌더링에서 같은 함수 객체를 `onClick`으로 넘기면 EVENTS patch는 어떻게 될까? 그때 생길 수 있는 문제는?
4. `<button onClick>` 대신 `<form onSubmit>`을 지원하려면 코드의 어느 부분을 고쳐야 할까? (힌트: 고칠 곳이 없을 수도 있다)

## 질문 기록
