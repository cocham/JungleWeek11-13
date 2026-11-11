# 19. Todo 앱 — Phase 1·2 엔진으로 만든 실제 페이지

- 요구사항: R-APP-01(Phase 1·2를 활용한 웹 페이지), R-APP-02(입력·클릭으로 화면 변화), R-P2-01·03·04(컴포넌트 분리와 상태 위치), R-Q-02(기능 테스트)
- 코드: `app.html`, `src/todoApp.js`, `src/vdomToDom.js`의 `setAttr`·`removeAttr`, `src/patch.js`의 `syncInputs`(이번에 추가, `component.js`의 `update`가 호출), `index.html`(앱 링크)
- 테스트: `tests/todoApp.test.js`(실제 `app.html` 마크업으로 기능 테스트), `tests/patch.test.js`·`tests/vdomToDom.test.js`의 `<input>` 묶음
- 실행: `npx serve .` 후 브라우저에서 `app.html` (ES 모듈이라 `file://`로는 열리지 않는다)
- 이전 노트: [18-batching.md](18-batching.md)

## 전체 흐름 — Phase 1과 무엇이 다른가
```
                Phase 1 (index.html)                 Phase 2 (app.html)
사용자 행동     테스트 영역 HTML 직접 편집             체크박스 클릭, 입력, 버튼
데이터 변화     (없음 — HTML 자체가 목표)              setTodos / setText / setFilter
원하는 화면     domToVdom(테스트 영역)                 TodoApp(상태) → h() → resolve
Diff → Patch    Patch 버튼이 호출                      setState가 예약한 flush가 호출
실제 화면       실제 영역의 바뀐 곳만                   #app의 바뀐 곳만
```
같은 `diff`·`patch`가 두 페이지에서 그대로 쓰인다(R-P2-07).

## 컴포넌트 나누기와 상태 위치
```
TodoApp            상태: todos, text, filter  (Hook은 여기서만)
├ TodoForm         props: text, onTextChange, onSubmit
├ FilterBar        props: filter, onChange
├ TodoList         props: todos(필터된 목록), onToggle, onDelete
│ └ TodoItem       props: todo, onToggle, onDelete
│   (목록이 비면 EmptyMessage)
└ Summary          props: remaining, total
```
- **상태는 루트에**: FilterBar가 바꾸는 `filter`를 TodoList가, TodoForm이 추가한 `todos`를 Summary가 쓴다. 여러 자식이 함께 쓰는 상태라 공통 부모(루트)에 둔다(Lifting State Up).
- **자식은 화면 조각**: 받은 props로 VDOM만 만든다. 바꾸고 싶으면 props로 받은 함수(`onToggle` 등)를 부른다.
- **Hook 사용처**
  - `useState` ×3 — todos, 입력 글자, 필터
  - `useMemo` ×2 — 필터된 목록(`[todos, filter]`), 남은 개수(`[todos]`). 입력창에 칠 때는 다시 계산하지 않는다.
  - `useEffect` ×1 — 문서 제목 `할 일 N개 남음`. 렌더링이 아니라 DOM 반영 뒤 화면 밖을 바꾸는 일이라 effect에서 한다.

## 시나리오: "Batching 만들기"를 추가한다
```
1. 입력  키를 칠 때마다 onInput → setText(입력값) → (microtask) 렌더링
         patch: ATTRS [1,0] value="…", 처음 한 글자에서 ATTRS [1,1] -disabled (추가 버튼 켜짐)
2. Enter form submit → addTodo
         preventDefault() (새로고침 방지)
         setTodos([...prev, 새 항목]); setText('')   ← 두 번 불러도 렌더링 1번(Batching)
3. 렌더링  useMemo: todos가 새 배열 → 필터 다시 계산 / useEffect: remaining 바뀜 → 예약
4. Diff    ATTRS [1,0] value="" · ATTRS [1,1] disabled="" · ADD [3,3] <li> · TEXT [4,0] "남은 일 2개 / 전체 4개" · EVENTS ×11
5. Patch   기존 li 3개는 같은 DOM 객체 그대로, 끝에 li 하나만 붙음
6. Effect  document.title = '할 일 2개 남음 · Mini React'
```
화면 옆 "엔진 동작" 패널이 4번의 목록을 그대로 보여 준다.

## 엔진 동작 패널
- `FunctionComponent`를 상속한 `InspectedComponent`가 `mount`·`update` 뒤에 결과를 알려 준다. 엔진 코드는 바꾸지 않았다.
- 패널 자체는 VDOM 밖에서 `textContent`로 직접 고친다. 패널을 앱 상태로 만들면 "patch를 표시 → 렌더링 → 또 patch"가 되어 렌더링 횟수가 섞인다.
- EVENTS는 렌더링마다 새 화살표 함수 때문에 거의 모든 핸들러에서 나온다. 다른 변경이 묻히지 않게 한 줄로 묶었다.
  상태가 같은 재렌더링은 EVENTS만 나오므로 "보이는 변화 없음"으로 표시한다.

## 이번에 고친 엔진 문제: `<input>`의 value·checked
`<input>`에는 **속성**(HTML에 적힌 처음 값)과 **프로퍼티**(지금 화면 값)가 따로 있다.
사용자가 한 번 입력하거나 클릭하면 그 뒤로는 속성을 바꿔도 화면 값이 따라오지 않는다.
- 증상 1: 추가 후 `setText('')` → value 속성은 ''인데 입력창 글자가 남는다.
- 증상 2: 사용자가 클릭했던 체크박스가, 삭제·필터로 같은 자리에 온 다른 항목에 재사용되면 이전 체크 상태가 남는다.

그래서 `setAttr`·`removeAttr`가 `<input>`에 한해 `value`·`checked` 프로퍼티도 함께 맞춘다(React도 이 둘은 프로퍼티로 다룬다).
- 같은 값이면 대입하지 않는다. 입력 중 커서가 끝으로 튀지 않게 하려는 것이다.
- 다른 태그는 건드리지 않는다. `<li>`의 `value` 프로퍼티는 숫자라 대입하면 속성이 바뀐다.
- `createElementDom`(처음 만들 때)과 patch의 ATTRS(고칠 때)가 같은 함수를 쓴다.

### 속성 차이가 없을 때: `syncInputs` (검증에서 발견)
`setAttr`는 ATTRS patch가 **있을 때만** 실행된다. 그런데 patch가 아예 안 나오는 경우가 있다.
```
진행 중 필터: [0]Hook(미완료) [1]Batching(미완료)
1. 사용자가 [0] 체크박스 클릭 → 브라우저가 checked 프로퍼티를 먼저 true로 바꿈 → onChange → setTodos
2. 새 화면: [0]Batching(미완료)               ← Hook은 완료라 목록에서 빠짐
3. diff: 옛 [0]도 새 [0]도 checked 속성 없음 → ATTRS patch 없음
4. 같은 체크박스를 재사용하므로 클릭으로 켜진 체크가 Batching 자리에 남는다 (버그)
```
그래서 `FunctionComponent.update`가 patch 뒤에 `syncInputs(root, 새 VDOM)`(`src/patch.js`)를 부른다.
새 VDOM과 실제 DOM을 같이 내려가며 `<input>`의 화면 값을 VDOM 속성에 맞춘다. "화면 값은 상태를 따른다"는 React 제어 컴포넌트 규칙을 commit마다 보장하는 것이다.
- 같은 값이면 대입하지 않는다(커서 유지). VDOM에 `value` 속성이 없는 입력창의 글자는 건드리지 않는다.
- 한계: 재렌더링이 일어날 때만 맞춘다. 핸들러가 상태를 바꾸지 않아 렌더링이 없으면, 클릭한 체크는 그대로 남는다(React는 이벤트 직후 되돌린다). 이 앱의 핸들러는 항상 상태를 바꾸므로 해당 없음.

## key가 없어서 생기는 일 (발표 포인트)
가운데 "Diff·Patch 만들기"를 지우면 diff는 "[1]이 사라졌다"가 아니라 인덱스끼리 비교한다.
```
옛: [0]Virtual DOM  [1]Diff·Patch  [2]Hook
새: [0]Virtual DOM  [1]Hook
→ [1]의 글자·class·checked·aria-label을 Hook 것으로 고치고, [2]를 REMOVE
```
결과 화면은 맞지만, 실제 React라면 `key`로 "Diff·Patch의 li만 제거"할 수 있다. 패널에서 TEXT·ATTRS가 여러 줄 나오는 이유다.

## 확인한 것
- 기능 테스트(`tests/todoApp.test.js`, 실제 app.html 사용): 첫 화면, 추가(공백 무시·새로고침 방지·입력창 비움·한 번 렌더링·기존 li 유지), 체크·해제, 가운데 삭제, 클릭했던 체크박스 재사용, 모두 삭제 → 안내 문구(REPLACE), 필터 세 가지와 선택 표시, 필터 중 체크로 목록에서 빠짐, 같은 필터 재클릭은 렌더링 없음, 입력 중 patch가 입력창·버튼 쪽만 나옴, 패널 문구
- 실제 브라우저(Chrome headless): 한글 키보드 입력, Enter 추가, 체크·삭제·필터, 패널 표시, 390px 폭에서 가로 스크롤 없음, Phase 1 페이지와 서로 이동. 콘솔 오류는 favicon 404뿐
- 테스트가 틀린 구현을 잡는지: `<input>` 프로퍼티 맞추기를 끄면 patch 단위 테스트 3개와 앱 테스트 2개(입력창 비움, 체크박스 재사용)가 실패했다. `update`의 `syncInputs` 호출을 빼면 "진행 중 필터에서 첫 항목 완료" 앱 테스트가 실패했다(확인 후 되돌림)

## 이해 확인 질문
1. 진행 중 필터에서 "Hook 만들기"를 체크했다. 어떤 setState가 불리고, useMemo 두 개와 제목 effect는 각각 다시 실행될까?
2. 입력창에 "abc"를 칠 때 렌더링은 몇 번 일어날까? 그때 TodoList 쪽 patch가 EVENTS만 나오는 이유는?
3. 항목 수정(더블클릭으로 제목 고치기)을 넣는다면 어떤 상태를 어디에 추가해야 할까? 자식 컴포넌트에 Hook을 쓰면 어떻게 될까?
4. `setAttr`에서 `isInput` 검사를 빼고 모든 요소의 `value`를 프로퍼티로 넣으면 어떤 태그에서 문제가 생길까?

## 질문 기록
