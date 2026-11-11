# 18. Batching — 여러 setState를 렌더링 한 번으로

- 요구사항: R-OPT-01(여러 상태 변경을 한 번에 처리하는 Batching), 발표 포인트 "setState는 상태 변경 말고 무엇을 해야 하는지", "여러 상태 변경을 한 번에 처리하는 방법"
- 코드: `src/component.js`의 `scheduleUpdate`, `flushUpdates`, `flushSync`, `useState`의 setState
- 테스트: `tests/batching.test.js` (기존 테스트는 화면을 바로 확인하는 곳에 `flushSync`를 씀)
- 이전 노트: [17-useeffect-usememo.md](17-useeffect-usememo.md)

## 해결할 문제
16번까지는 setState를 부를 때마다 바로 `update()`했다.
```js
const onAdd = () => {
  setTodos([...todos, text]);  // 렌더링 1 — 목록에 추가됐지만 입력창은 아직 그대로인 중간 화면
  setText('');                 // 렌더링 2
};
```
- **낭비**: 컴포넌트 실행 → diff → patch를 두 번 한다. 첫 번째 결과는 곧바로 덮인다.
- **중간 상태**: 첫 번째 렌더링은 "todos는 새 값, text는 옛 값"이라는, 사용자가 의도하지 않은 조합으로 계산된다.

## 결정: React 18 방식의 자동 batching
"현재 React에 가깝게"라는 요청에 따라 React 18의 **자동 batching**을 따랐다.
- setState는 **값만 바꾸고 재렌더링을 예약**한다.
- 지금 실행 중인 코드가 끝나면 **microtask**에서 예약된 컴포넌트를 **한 번씩만** 다시 그린다.
- 이벤트 핸들러, 타이머, effect 등 **어디서 부르든** 같은 규칙이다.

(React 17은 이벤트 핸들러 안에서만 묶었고, `setTimeout` 안의 setState는 바로 그렸다. React 18부터 어디서나 묶는다.)

## 시나리오: 할 일 추가 버튼
```
클릭 → onAdd 실행
  setTodos([...])  hooks[0].value = 새 배열   dirtyComponents = {app}   microtask 예약
  setText('')      hooks[1].value = ''        dirtyComponents = {app}   (이미 예약됨)
onAdd 끝 → 호출 스택이 빔
microtask: flushUpdates()
  app.update()   App 실행(todos 새 값, text '') → diff → patch → effects
  dirtyComponents = {} → 끝
브라우저가 화면을 그림 (사용자는 최종 화면만 봄)
```

## 왜 microtask인가
```
[ 이벤트 핸들러 ] → [ microtask들 ] → [ 렌더링(paint) ] → [ 다음 이벤트/타이머 ]
                     ↑ flush가 여기서 실행
```
- 핸들러가 끝나면 브라우저는 화면을 그리기 **전에** microtask를 모두 실행한다.
  그래서 중간 화면이 사용자에게 보이지 않는다.
- `setTimeout(flush, 0)`은 paint 뒤로 밀릴 수 있어서, 한 프레임 동안 옛 화면이 보일 수 있다.
- 대신 setState를 부른 **직후의 코드**에서는 DOM이 아직 옛 화면이다(`textContent`가 그대로).

## 데이터가 어디 있나
| 데이터 | 위치 | 설명 |
|---|---|---|
| 상태 값 | `hooks[i].value` | setState를 부르는 즉시 바뀐다. 함수형 업데이트가 최신 값을 받는 이유 |
| 다시 그릴 컴포넌트 | 모듈 변수 `dirtyComponents` (Set) | 같은 컴포넌트는 한 번만 들어간다 |
| 예약 여부 | 모듈 변수 `flushScheduled` | microtask를 한 번만 예약하기 위해 |

## setState는 무엇을 하나 (16번 노트의 갱신판)
1. 렌더링 중이면 에러
2. 새 값 계산(값 또는 `prev => next`)
3. `Object.is`로 같으면 끝
4. 값 저장
5. **재렌더링 예약** — `scheduleUpdate(component)` (이전: 바로 `update()`)

## effect 안의 setState
17번에서는 effect 실행 중의 setState를 `updateRequested`로 따로 처리했다. 이제는 모든 setState가 같은 예약 목록을 쓴다.
```
flushUpdates
  바퀴 1: app.update() → patch → effect: setCount(3) → dirtyComponents = {app}
  바퀴 2: app.update() → patch → (실행할 effect 없음)
  목록이 비어 끝
```
- 같은 렌더링의 effect가 모두 끝난 뒤 다시 그린다는 결과는 같다.
- 바퀴가 50번을 넘으면 에러를 던진다(deps를 빼먹은 effect의 무한 반복 방지). flush마다 0부터 센다.
- mount의 effect에서 setState하면 `mount()`가 돌아올 때는 첫 화면이고, microtask 뒤에 바뀐다.

## flushSync — 기다리지 않고 바로 반영
`flushSync(fn)`은 fn을 실행한 뒤 예약된 재렌더링을 **바로** 처리한다. fn 안의 여러 setState도 여전히 한 번으로 묶인다.
React에도 같은 이름의 API가 있다(드물게 "지금 당장 DOM이 바뀌어야 하는" 경우에 쓴다).
테스트에서는 클릭 직후 화면을 확인하려고 쓴다.
```js
flushSync(() => button.click());
expect(container.textContent).toBe('count: 1');
```

## 경계 동작
- **바뀐 뒤 원래대로**: `setN(1); setN(0);` → 렌더링은 한 번 하지만 VDOM이 같아 patch가 없다.
- **여러 컴포넌트**: 한 번에 A, B, A 순서로 setState하면 A·B를 한 번씩만 그린다.
- **직접 `update()`**: 예약 목록에서 빠지므로 microtask가 다시 그리지 않는다.
- **flush 중 한 컴포넌트가 실패**: 에러를 던진다. 실패한 컴포넌트의 예약은 버리고, 같은 바퀴의 나머지 컴포넌트는 다음 microtask에서 그린다.
  microtask 안에서 난 에러는 setState를 부른 쪽에서 `try/catch`로 잡을 수 없다(브라우저 콘솔에 표시됨). 바로 잡아야 하면 `flushSync`를 쓴다.

## 이번 구현과 실제 React의 차이
| | 이번 구현 | React 18 |
|---|---|---|
| 상태 값 반영 | setState 즉시 `hooks[i].value`를 바꿈 | 업데이트를 Hook의 큐에 쌓고, 다음 렌더링에서 차례로 적용 |
| 예약 | 모든 업데이트를 microtask 하나로 | 업데이트마다 우선순위(lane)가 있다. 클릭 같은 이산 이벤트의 업데이트는 microtask에서, 그 밖의 업데이트는 Scheduler 작업으로 처리되는 등 상황마다 다르다 |
| 렌더링 중단 | 불가(한 번 시작하면 끝까지) | Concurrent 기능(transition 등)을 쓰면 렌더링 도중 양보·중단할 수 있다 |

## 이해 확인 질문
1. `onClick() { setN(n + 1); setN(n + 1); }`는 한 번 클릭하면 화면이 얼마가 될까? 렌더링은 몇 번일까? 16번 노트의 답과 무엇이 달라졌나?
2. 핸들러 안에서 `setText('a')` 직후 `container.textContent`를 읽으면 어떤 값이 나올까? 바뀐 화면을 읽으려면 어떻게 해야 할까?
3. `flushUpdates`에서 `components`를 복사하고 `dirtyComponents.clear()`를 먼저 하지 않고, Set을 그대로 돌면서 지우면 어떤 문제가 생길 수 있을까?
4. `setTimeout(() => { setA(1); setB(1); })`은 React 17과 React 18에서 각각 몇 번 렌더링될까? 이번 구현에서는?

## 질문 기록
