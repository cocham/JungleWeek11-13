# 16. FunctionComponent와 useState — 상태가 바뀌면 화면이 스스로 바뀐다

- 요구사항: R-P2-02(FunctionComponent: hooks·mount·update), R-P2-03(Hook은 루트에서만), R-P2-04(Lifting State Up), R-P2-05(자동 재렌더링), R-P2-06 중 useState, R-P2-07(Phase 1 Diff·Patch 재사용)
- 코드: `src/component.js`, `src/h.js`의 `toSingleNode`
- 테스트: `tests/component.test.js`
- 이전 노트: [15-phase2-components.md](15-phase2-components.md)

## 해결할 문제
15번까지는 새 화면을 얻으려면 **사람(테스트 코드)이** 새 props로 `resolve`를 다시 부르고 diff·patch를 직접 불러야 했다.
이번 단위부터는 이렇게 된다.
- 데이터(상태)는 `FunctionComponent`가 보관한다.
- 사용자가 클릭하면 핸들러가 `setState`를 부른다.
- `setState`가 **상태를 바꾸고 화면을 다시 그리는 일까지** 한다.

Phase 1과 비교하면 이렇다.

| | Phase 1 | Phase 2 |
|---|---|---|
| 사용자 행동 | 테스트 영역 HTML 편집 → Patch 버튼 | 버튼 클릭 → 핸들러가 `setState` |
| 새 화면 계산 | `domToVdom(테스트 영역)` | 컴포넌트 함수를 새 상태로 다시 실행 |
| 옛 VDOM 보관 | 페이지 변수 / History | `FunctionComponent.vdom` |
| Diff → Patch | Patch 버튼 핸들러가 호출 | `update()`가 호출 (Diff·Patch 코드는 같음) |

## 시나리오: 카운터의 + 버튼을 누른다
```js
function Counter() {
  const [count, setCount] = useState(0);
  return h('div', null,
    h('span', null, `count: ${count}`),
    h('button', { onClick: () => setCount(count + 1) }, '+'));
}
const app = new FunctionComponent(Counter);
app.mount(container);
```

```
mount
  render() ─ Counter() 실행: useState(0) → hooks[0] = { value: 0, setState }
           └ resolve → VDOM v0 (span "count: 0")
  vdomToDom(v0) → container에 붙임.   app.vdom = v0, app.root = <div>

클릭 → setCount(1)
  hooks[0].value = 1                     ← 데이터 변화
  app.update()
    render() ─ Counter() 다시 실행: useState(0)은 hooks[0]의 1을 돌려줌 (초기값 0은 무시)
             └ VDOM v1 (span "count: 1")  ← 원하는 화면 계산
    diff(v0, v1) → [TEXT [0,0] "count: 1", EVENTS [1] click]
    patch(app.root, …)                   ← 실제 DOM 변경은 여기서만
    app.vdom = v1                        ← 다음 diff의 "옛 화면"
```
<div>, <span>, 텍스트 노드, <button>은 **같은 DOM 객체로 남는다**. 바뀐 것은 텍스트 글자와 click 핸들러뿐이다.

## 데이터가 어디 있나
| 데이터 | 위치 | 언제 바뀌나 |
|---|---|---|
| 상태 값 | `app.hooks[i].value` | `setState` |
| setState 함수 | `app.hooks[i].setState` | 첫 렌더링에 한 번 만들고 계속 같은 함수 |
| 마지막 화면 VDOM | `app.vdom` | `mount`, `update` 끝 |
| 실제 루트 노드 | `app.root` | `mount`, 루트 REPLACE가 일어난 `update` |
| 지금 렌더링 중인 컴포넌트 | 모듈 변수 `currentComponent`, `hookIndex` | `renderRoot` 동안만 값이 있다 |

## 왜 hooks "배열"이고 순서가 중요한가
함수형 컴포넌트는 호출이 끝나면 지역 변수가 사라진다. 그래서 상태는 함수 **밖** `hooks` 배열에 둔다.
`useState`는 이름을 받지 않으므로 "몇 번째로 불렸는지"(`hookIndex`)로 자기 칸을 찾는다.
```
App() { const [todos] = useState([]);  → hooks[0]
        const [text]  = useState('');  → hooks[1] }
```
`if (x) useState(...)`처럼 조건부로 부르면 다음 렌더링에서 칸이 밀린다. 그래서 개수가 달라지면 에러를 던진다.
- 늘어난 경우: `useState`가 재렌더링인데 처음 보는 칸을 찾을 때 멈춘다.
- 줄어든 경우: 루트 실행이 끝났을 때 `hookIndex !== hooks.length`로 잡는다.

## setState는 무엇을 하나 (발표 포인트)
1. **새 값 계산** — 값 또는 `prev => next` 함수. 함수형은 "가장 최신 값"을 받으므로 한 핸들러에서 세 번 불러도 3이 더해진다.
2. **변경 확인** — `Object.is`로 같으면 아무것도 안 한다. 배열·객체는 참조 비교라서 `todos.push(x)` 후 `setTodos(todos)`는 무시된다. `[...todos, x]`처럼 새 배열을 만들어야 한다.
3. **화면 다시 그리기** — `update()`: 재실행 → diff → patch.
4. **잘못된 시점 차단** — 렌더링 중(루트든 자식이든)에 부르면 무한 반복이 될 수 있으므로 에러.

지금은 setState마다 바로 `update()`한다. 그래서 위 2번 예처럼 세 번 부르면 **세 번 렌더링**된다. 한 번으로 묶는 것은 4단계(Batching)에서 한다.

> **4단계에서 바뀜**: setState는 이제 바로 `update()`하지 않고 재렌더링을 예약하며, microtask에서 한 번만 그린다. → [18-batching.md](18-batching.md)

## Hook은 루트에서만 (R-P2-03) — 어떻게 막나
`render()`는 두 단계로 나뉜다.
```
renderRoot()   currentComponent = this   ← 이때만 Hook 허용
               App(props) 실행 → 결과에 h(Child) 노드가 있지만 Child는 아직 실행 안 됨 (15번 노트)
               currentComponent = null
resolve(...)   renderingChildren = true  ← 이때 Child() 실행. Child 안의 useState → R-P2-03 에러
               renderingChildren = false
```
에러가 나도 `finally`로 표시를 되돌리므로, 다음 렌더링이나 이벤트의 `setState`가 막히지 않는다.

## Lifting State Up (R-P2-04)
입력창(Input)과 미리보기(Preview)가 같은 글자를 보여야 하면, 상태를 **둘의 공통 부모인 루트**에 둔다.
- 루트: `const [text, setText] = useState('')`
- Input: `value`와 `onChange`(=setText)를 props로 받는다. 입력 이벤트에서 `onChange` 호출.
- Preview: `value`만 받아 그린다.
자식은 상태가 없으므로 같은 props면 항상 같은 VDOM을 돌려준다(순수 함수).

## 한계 (지금 정한 것)
- setState마다 동기로 바로 재렌더링한다(Batching은 4단계). → 4단계에서 microtask 자동 batching으로 바뀜([18-batching.md](18-batching.md))
- 루트 props는 생성할 때 한 번 받는다. 밖에서 props를 바꿔 다시 그리는 API는 없다.
- unmount(화면에서 떼기)는 없다.
- `<input>`의 `value`는 속성으로만 반영된다. 상태가 바뀌어 `value` 속성이 바뀌어도, 사용자가 이미 입력한 화면 값(프로퍼티)은 따라오지 않을 수 있다(Todo 앱 단계에서 다룸).

## 이해 확인 질문
1. 카운터에서 `onClick: () => { setCount(count + 1); setCount(count + 1); }`이면 한 번 클릭 후 화면 숫자는? 렌더링은 몇 번 일어날까? `prev => prev + 1`로 바꾸면?
2. `useState(0)`을 두 번 부르는 컴포넌트에서, 첫 번째 `useState`를 `if (show)` 안으로 옮기면 show가 false가 되는 순간 무슨 일이 생길까?
3. Todo 앱에서 "완료 개수" 표시를 별도 자식 컴포넌트로 만들 때, 그 자식에 어떤 props를 넘겨야 할까? 상태는 어디에 둘까?
4. 루트가 `on ? h('section') : h('p')`를 돌려줄 때 on이 바뀌면 `app.root`는 어떻게 될까? 코드의 어느 줄이 그걸 처리할까?

## 질문 기록
