# 17. useEffect · useMemo — 화면 계산 밖의 일과 계산 재사용

- 요구사항: R-P2-06(최소 Hook: useState, useEffect, useMemo), R-P2-03(자식 Hook 금지 규칙을 두 Hook에도 적용)
- 코드: `src/component.js`의 `useEffect`, `useMemo`, `runEffectsAndFollowUps`, `runPendingEffects`, `depsChanged`
- 테스트: `tests/hooks.test.js`
- 이전 노트: [16-function-component-usestate.md](16-function-component-usestate.md)

## 해결할 문제
16번에서 컴포넌트는 "상태 → 화면(VDOM)"을 계산하는 함수였다. 그런데 앱에는 화면 계산이 아닌 일도 있다.
- 화면이 바뀐 **뒤에** 할 일: 문서 제목 바꾸기, localStorage에 저장, 타이머 등록, 바뀐 DOM 읽기 → **useEffect**
- 렌더링마다 반복할 필요 없는 **무거운 계산**: 필터링된 목록, 합계 → **useMemo**

두 Hook 모두 "deps(의존 값)가 바뀌었을 때만" 일한다는 점이 같다.

## 정한 정책 (사람이 결정)
| 항목 | 결정 |
|---|---|
| effect 실행 시점 | patch로 실제 DOM이 바뀐 **직후, 동기**로. `mount()`/`update()`가 돌아오기 전에 끝난다 |
| cleanup | effect가 함수를 돌려주면 보관했다가 **그 effect를 다시 실행하기 직전**에만 부른다. unmount는 없다 |
| effect 안 setState | 허용. 같은 렌더링의 effect가 **모두 끝난 뒤 한 번** 다시 렌더링. 연속 50번을 넘으면 에러 |

## 시나리오: Todo 앱 (5단계에서 만들 앱의 축소판)
```js
function App() {
  const [todos, setTodos]   = useState([...]);   // hooks[0]
  const [filter, setFilter] = useState('all');   // hooks[1]
  const [text, setText]     = useState('');      // hooks[2]

  const visible = useMemo(                        // hooks[3]
    () => todos.filter((t) => filter === 'all' || t.done),
    [todos, filter]);

  useEffect(() => {                               // hooks[4]
    document.title = `할 일 ${todos.length}개`;
  }, [todos]);

  return h('div', null, h('input', { value: text, onInput: ... }), h(TodoList, { todos: visible }));
}
```

### 입력창에 글자를 친다 (`setText('h')`)
```
setText → hooks[2].value = 'h' → update()
  render   App 실행
           useMemo: deps [todos, filter] 그대로 → 계산 건너뛰고 hooks[3].value(이전 결과) 사용
           useEffect: deps [todos] 그대로 → pendingEffects에 넣지 않음
  patch    input의 value 속성만 바뀜
  effects  실행할 것 없음
```
### 할 일을 추가한다 (`setTodos([...todos, 새 항목])`)
```
  render   useMemo: todos 참조가 바뀜 → 필터 다시 계산
           useEffect: todos 바뀜 → pendingEffects = [제목 effect]
  patch    li 하나 ADD
  effects  document.title = '할 일 3개'     ← DOM이 이미 바뀐 뒤
```

## 렌더링 한 번의 3단계
```
render ──────────▶ commit ─────────────▶ effects
컴포넌트 실행        mount: vdomToDom       cleanup(바뀐 effect들) 전부
useMemo는 여기서 계산  update: diff → patch   → effect 호출 순서대로
useEffect는 "등록"만                        (안에서 setState → 끝난 뒤 다시 render)
```
- **useMemo가 render 중에 계산하는 이유**: 결과가 이번 VDOM을 만드는 데 바로 필요하다.
- **useEffect가 render 뒤에 실행하는 이유**: 렌더링은 화면을 "계산"만 해야 한다. 그 안에서 DOM을 건드리거나 setState를 하면 계산 결과와 실제 화면이 어긋나거나 무한 반복이 된다. 그래서 실제 DOM이 바뀐 다음에 실행한다.

## 데이터가 어디 있나
| 데이터 | 위치 |
|---|---|
| effect의 마지막 실행 deps, cleanup | `hooks[i] = { kind: 'useEffect', deps, hasRun, cleanup }` |
| 이번 렌더링에서 실행할 effect | `app.pendingEffects` (렌더링 시작 때 비움, effect 실행 후 비움) |
| effect 실행 중 setState가 있었는지 | `app.updateRequested` |
| memo 결과와 deps | `hooks[i] = { kind: 'useMemo', value, deps }` |

## deps 비교 (`depsChanged`)
- 생략(`undefined`) → 매번 바뀐 것. useEffect는 매 렌더링, useMemo는 매번 계산.
- `[]` → 비교할 값이 없으니 첫 번째 이후로는 안 바뀜.
- 값마다 `Object.is`. setState와 같은 기준이라 **배열·객체는 참조가 같아야 "그대로"**다.
  `todos.push(x)`로 고친 배열은 참조가 같아 useMemo가 다시 계산하지 않는다 → 상태는 항상 새 배열로 바꾼다.
- effect의 deps는 **실제로 실행했을 때** 기록한다. 렌더링이 중간에 실패해 effect가 실행되지 않았으면, 다음 렌더링에서 실행된다.

## effect 안의 setState
```
mount: render(data='loading') → DOM → effect1: setA(1) → 예약만
                                       effect2: setB(1) → 예약만
       → effect가 다 끝남 → render(1,1) → patch → (새로 실행할 effect 없음) → 끝
```
- 바로 update하지 않는 이유: effect2가 아직 실행되지 않았는데 다음 렌더링이 끼어들면 순서가 꼬인다.
- 후속 렌더링도 diff·patch를 쓰므로 DOM 객체가 유지된다.
- deps를 빼먹고 매번 setState하면 끝나지 않으므로, 연속 50번을 넘으면 에러를 던진다. 다음 이벤트에서는 0부터 다시 센다.

> **4단계에서 바뀜**: effect 안의 setState를 따로 처리하던 `updateRequested` 반복은 없어졌다. 이제 모든 setState가 같은 예약 목록을 쓰고, microtask의 flush가 effect의 setState까지 이어서 처리한다(같은 렌더링의 effect가 모두 끝난 뒤 다시 그린다는 결과는 같다). 그래서 mount의 effect에서 setState하면 `mount()`가 돌아올 때는 첫 화면이고, microtask 뒤에 바뀐다. 50번 한도는 flush 안으로 옮겨졌다. → [18-batching.md](18-batching.md)

## Hook 순서 검사 강화
Hook 칸에 `kind`를 저장한다. 개수는 같아도 `useEffect`가 있던 자리에서 `useMemo`를 부르면 에러다.

## 한계
- unmount가 없으므로 마지막 cleanup은 불리지 않는다.
- 이 구현은 DOM 반영 직후 Effect를 동기로 실행한다. 실제 React의 useEffect는 commit 이후 실행되며, 브라우저 paint와의 순서는 상황에 따라 달라질 수 있다(예: 클릭 같은 상호작용으로 생긴 Effect는 paint 전에 실행될 수도 있다). 동기로 정한 것은 흐름과 테스트를 단순하게 하려는 결정이다.
- setState마다 바로 렌더링하는 것은 그대로다(이벤트 핸들러 안의 여러 setState 묶기 = 4단계 Batching). → 4단계에서 바뀜([18-batching.md](18-batching.md))
  단, effect 안의 여러 setState는 이미 한 번으로 묶인다.

## 이해 확인 질문
1. `useEffect(() => setCount(count + 1), [count])`는 어떻게 동작할까? 화면 숫자는 어디서 멈출까? deps를 `[]`로 바꾸면?
2. 위 Todo 앱에서 filter만 바꿨다. useMemo의 계산, 제목 effect 각각 실행될까?
3. `useMemo(() => todos.filter(...), [todos.length])`로 쓰면 어떤 버그가 생길 수 있을까? (힌트: 완료 표시만 바꾼 경우)
4. "effect 안의 setState를 이벤트 핸들러에서도 똑같이 묶으려면" `useState`의 setState 코드에서 어느 분기를 손봐야 할까? (4단계 예고)

## 질문 기록
