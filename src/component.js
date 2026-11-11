import { resolve, toSingleNode } from './h.js';
import { vdomToDom } from './vdomToDom.js';
import { diff } from './diff.js';
import { patch } from './patch.js';

// 루트 함수형 컴포넌트를 감싸 상태(hooks)를 보관하고 화면을 그리는 클래스. (R-P2-02)
//
//   const app = new FunctionComponent(App);
//   app.mount(container);   첫 렌더링: App 실행 → VDOM → 실제 DOM 생성
//   (버튼 클릭 → setCount(1))
//     → app.update()       재렌더링: App 다시 실행 → 새 VDOM → diff(옛, 새) → patch
//
// 함수형 컴포넌트는 호출이 끝나면 지역 변수가 사라진다. 그래서 상태는 함수 밖, 이 객체의 hooks 배열에 둔다.
// 렌더링마다 Hook을 "부른 순서"대로 hooks[0], hooks[1], ...을 꺼내 쓴다.
//   App() { const [todos] = useState([]);   → hooks[0]
//           const [text]  = useState('');   → hooks[1] }
// 이름이 아니라 순서로 찾으므로, 렌더링마다 Hook을 같은 순서·같은 개수로 불러야 한다.
//
// 한 번의 렌더링 흐름 (mount·update 공통)
//   render   컴포넌트 실행 → VDOM. useEffect는 "실행할 effect"를 pendingEffects에 모아 두기만 한다.
//   commit   실제 DOM 생성(mount) 또는 diff → patch(update)
//   effects  DOM이 바뀐 뒤 모아 둔 effect를 실행한다. effect 안에서 바뀐 DOM을 읽을 수 있다.
//
// Batching (R-OPT-01, React 18의 자동 batching과 같은 방식)
//   setState는 값만 바꾸고 컴포넌트를 "다시 그릴 목록"(dirtyComponents)에 넣는다. 바로 그리지 않는다.
//   지금 실행 중인 코드(이벤트 핸들러, effect 등)가 끝나면 microtask에서 목록의 컴포넌트를 한 번씩만 다시 그린다.
//     onClick() { setA(1); setB(2); setC(3); }   → 렌더링 1번 (setState 3번)
//   microtask는 이벤트 핸들러가 끝난 직후, 브라우저가 화면을 그리기 전에 실행되므로 중간 화면은 보이지 않는다.

// 지금 Hook을 부를 수 있는 상태인지 나타낸다.
//   currentComponent: 실행 중인 루트 컴포넌트. 루트 함수가 실행되는 동안만 값이 있다.
//   renderingChildren: 루트 실행이 끝나고 resolve가 자식 컴포넌트를 실행하는 중인지.
// 한 번에 컴포넌트 하나만 렌더링하므로(동기 실행) 모듈 변수 하나로 충분하다.
let currentComponent = null;
let hookIndex = 0;
let renderingChildren = false;

// 다시 그릴 컴포넌트 목록. Set이라 같은 컴포넌트를 여러 번 넣어도 한 번만 들어간다.
const dirtyComponents = new Set();
let flushScheduled = false;

// 한 번의 flush 안에서 "다시 그리기 → effect의 setState → 또 다시 그리기"가 이어질 수 있는 최대 횟수.
// deps를 빼먹은 effect가 매번 setState하면 끝나지 않으므로, 브라우저가 멈추기 전에 에러로 알린다.
const MAX_NESTED_UPDATES = 50;

// 컴포넌트를 다시 그릴 목록에 넣고, 아직 예약이 없으면 microtask에 flush를 예약한다.
function scheduleUpdate(component) {
  dirtyComponents.add(component);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      flushUpdates();
    });
  }
}

// 목록의 컴포넌트를 지금 바로 다시 그린다. 목록이 빌 때까지 반복한다.
// 다시 그리는 중 effect가 setState하면 그 컴포넌트가 목록에 다시 들어오고, 다음 바퀴에서 그려진다.
function flushUpdates() {
  let rounds = 0;
  while (dirtyComponents.size > 0) {
    rounds += 1;
    if (rounds > MAX_NESTED_UPDATES) {
      dirtyComponents.clear();
      throw new Error(
        `effect 안의 setState로 재렌더링이 ${MAX_NESTED_UPDATES}번을 넘었습니다. useEffect의 deps를 확인하세요`,
      );
    }
    // 이번 바퀴에 그릴 컴포넌트를 꺼내고 목록은 비운다. 그리는 동안 새로 들어온 것은 다음 바퀴 몫이다.
    const components = [...dirtyComponents];
    dirtyComponents.clear();
    for (const component of components) {
      try {
        component.update();
      } catch (error) {
        // 실패한 컴포넌트가 실패 도중 예약한 재렌더링은 버린다(실패를 반복하지 않게).
        // 이번 바퀴의 나머지 컴포넌트는 다시 목록에 넣어 다음 microtask에서 그린다.
        dirtyComponents.delete(component);
        for (const rest of components.slice(components.indexOf(component) + 1)) {
          scheduleUpdate(rest);
        }
        throw error;
      }
    }
  }
}

// fn을 실행하고, 그 안에서 예약된 재렌더링을 microtask를 기다리지 않고 바로 처리한다. (React의 flushSync와 같은 이름)
// 기다리지 않고 바로 화면을 확인해야 할 때(테스트 등) 쓴다. fn 안의 여러 setState는 여전히 한 번으로 묶인다.
export function flushSync(fn) {
  const result = fn === undefined ? undefined : fn();
  flushUpdates();
  return result;
}

export class FunctionComponent {
  constructor(component, props = {}) {
    this.component = component;
    this.props = props;
    this.hooks = [];
    this.vdom = null; // 마지막으로 화면에 반영한 VDOM. 다음 diff의 "옛 VDOM"이다.
    this.root = null; // 화면에 있는 루트 DOM 노드. patch가 이 노드부터 path를 따라간다.
    this.isRendering = false;
    this.pendingEffects = []; // 이번 렌더링에서 실행하기로 한 effect들 (useEffect가 채운다)
  }

  // 첫 렌더링: 컴포넌트를 실행해 만든 VDOM을 통째로 실제 DOM으로 만들어 container에 붙인다.
  // 비교할 옛 화면이 없으므로 diff 없이 전부 만든다. 화면에 붙인 뒤 effect를 실행한다.
  mount(container) {
    if (this.root !== null) {
      throw new Error('FunctionComponent: 이미 mount되었습니다');
    }
    const vdom = this.render();
    this.root = vdomToDom(vdom);
    container.appendChild(this.root);
    this.vdom = vdom;
    this.runPendingEffects();
  }

  // 상태가 바뀐 뒤의 재렌더링: 새 VDOM을 계산하고 옛 VDOM과 비교해 바뀐 곳만 실제 DOM에 반영한다. (R-P2-07)
  // 보통은 직접 부르지 않고, setState가 예약한 flush가 부른다.
  // 이 update가 적용한 patch 목록을 돌려준다(무엇이 바뀌었는지 확인용).
  update() {
    if (this.root === null) {
      throw new Error('FunctionComponent: mount 전에는 update할 수 없습니다');
    }
    // 직접 update하면 이미 최신 상태로 그리므로, 예약해 둔 재렌더링은 필요 없다.
    dirtyComponents.delete(this);
    const newVdom = this.render();
    const patches = diff(this.vdom, newVdom);
    // 루트가 다른 태그로 바뀌면 patch가 새 루트 노드를 돌려주므로 항상 받아 둔다.
    this.root = patch(this.root, patches);
    this.vdom = newVdom;
    this.runPendingEffects();
    return patches;
  }

  // 이번 렌더링에서 실행하기로 한 effect를 실행한다.
  // React처럼 이전 cleanup을 모두 먼저 부르고, 그다음 effect를 호출 순서대로 부른다.
  // effect 안의 setState도 다른 setState처럼 예약만 한다. 그래서 같은 렌더링의 effect가 모두 끝난 뒤 다시 그려진다.
  runPendingEffects() {
    const effects = this.pendingEffects;
    this.pendingEffects = [];
    for (const { hook } of effects) {
      if (hook.cleanup !== null) {
        const cleanup = hook.cleanup;
        hook.cleanup = null;
        cleanup();
      }
    }
    for (const { hook, effect, deps } of effects) {
      hook.deps = deps;
      hook.hasRun = true;
      const result = effect();
      hook.cleanup = typeof result === 'function' ? result : null;
    }
  }

  // 컴포넌트를 실행해 element/text만 남은 VDOM을 만든다. 실제 DOM은 건드리지 않는다.
  render() {
    // isRendering은 루트·자식 실행 전체 동안 켜 둔다. 이 동안의 setState를 막기 위해서다.
    // 에러가 나도 finally에서 풀어야 다음 렌더링·setState가 막히지 않는다.
    this.isRendering = true;
    try {
      const output = this.renderRoot();

      // 2) 자식 실행: 자식은 props만 받는 순수 함수다(R-P2-04). 이 동안 Hook을 부르면 에러다(R-P2-03).
      renderingChildren = true;
      try {
        return resolve(toSingleNode(output, this.component));
      } finally {
        renderingChildren = false;
      }
    } finally {
      this.isRendering = false;
    }
  }

  // 1) 루트 실행: 이 동안만 Hook을 부를 수 있다. 컴포넌트가 돌려준 값을 그대로 돌려준다.
  renderRoot() {
    currentComponent = this;
    hookIndex = 0;
    // 실패한 이전 렌더링에서 모은 effect가 남아 있지 않게 매번 비우고 시작한다.
    this.pendingEffects = [];
    try {
      const output = this.component(this.props);
      // Hook은 순서로 찾으므로 개수가 바뀌면 이후 Hook이 엉뚱한 칸을 읽는다. 조용히 틀리지 않게 멈춘다.
      // (늘어난 경우는 Hook이 칸을 찾을 때 먼저 막는다. 여기서는 줄어든 경우를 잡는다.)
      if (!this.isFirstRender() && hookIndex !== this.hooks.length) {
        throw hookCountError(this.hooks.length, `${hookIndex}개`);
      }
      return output;
    } finally {
      currentComponent = null;
    }
  }

  // 아직 화면에 반영한 적이 없으면 첫 렌더링이다. 첫 렌더링에서만 Hook 칸을 새로 만든다.
  isFirstRender() {
    return this.vdom === null;
  }
}

// 지금 렌더링 중인 루트 컴포넌트의 다음 Hook 칸을 찾는다. Hook을 부를 수 없는 때면 에러.
//   hook: 그 칸에 이미 있는 Hook 객체. 첫 렌더링이면 undefined이고, 부른 쪽이 만들어 push한다.
function nextHookSlot(hookName) {
  if (renderingChildren) {
    throw new Error(`${hookName}는 루트 컴포넌트에서만 쓸 수 있습니다. 자식 컴포넌트는 props만 받아야 합니다 (R-P2-03)`);
  }
  if (currentComponent === null) {
    throw new Error(`${hookName}는 컴포넌트 렌더링 중에만 부를 수 있습니다`);
  }
  const component = currentComponent;
  const index = hookIndex++;
  // 재렌더링인데 처음 보는 칸이면 Hook이 늘어난 것이다. 새 칸을 만들면 개수 비교로는 못 잡으므로 여기서 멈춘다.
  if (!component.isFirstRender() && index >= component.hooks.length) {
    throw hookCountError(component.hooks.length, `${index + 1}개 이상`);
  }
  const hook = component.hooks[index];
  // 개수는 같아도 순서가 바뀌면(useState 자리에 useMemo) 다른 종류의 칸을 읽게 된다.
  if (hook !== undefined && hook.kind !== hookName) {
    throw new Error(
      `Hook 순서가 렌더링마다 달라졌습니다 (${index}번째: 이전 ${hook.kind}, 이번 ${hookName}). ` +
        'Hook을 조건문·반복문 안에서 부르지 마세요',
    );
  }
  return { component, hook };
}

function hookCountError(before, now) {
  return new Error(
    `Hook 개수가 렌더링마다 달라졌습니다 (이전 ${before}개, 이번 ${now}). ` +
      'Hook을 조건문·반복문 안에서 부르지 마세요',
  );
}

// 상태 하나를 만든다. [지금 값, 값을 바꾸는 함수]를 돌려준다. (R-P2-06)
//   setState(새 값) 또는 setState(이전 값 => 새 값)
export function useState(initialValue) {
  const { component, hook: existing } = nextHookSlot('useState');
  let hook = existing;

  // 첫 렌더링에만 칸을 만든다. 이후 렌더링은 같은 칸의 값을 그대로 읽으므로 initialValue는 무시된다.
  if (hook === undefined) {
    hook = { kind: 'useState', value: initialValue };
    const stateHook = hook;

    // setState는 첫 렌더링에 한 번 만들어 계속 같은 함수를 쓴다.
    // 이벤트 핸들러가 옛 렌더링의 setState를 들고 있어도 같은 칸·같은 컴포넌트를 바꾼다.
    stateHook.setState = (next) => {
      // 렌더링 중에 상태를 바꾸면 그 상태로 다시 렌더링 → 또 setState …로 끝없이 반복될 수 있다.
      if (component.isRendering) {
        throw new Error('렌더링 중에는 setState를 부를 수 없습니다. 이벤트 핸들러 안에서 부르세요');
      }
      // 함수를 넘기면 "가장 최신 값"을 받아 새 값을 계산한다. 같은 핸들러에서 여러 번 불러도 누적된다.
      const value = typeof next === 'function' ? next(stateHook.value) : next;

      // 값이 같으면 화면도 같으므로 다시 그리지 않는다.
      // 배열·객체는 참조로 비교하므로, 바꿀 때는 [...todos, item]처럼 새 객체를 만들어야 한다.
      if (Object.is(value, stateHook.value)) {
        return;
      }
      stateHook.value = value;

      // setState의 두 번째 역할: 바뀐 상태로 화면을 다시 그린다. (R-P2-05)
      // mount 전에 불렸다면 값만 바꾸고, mount 때 그 값으로 그린다.
      if (component.root === null) {
        return;
      }
      // 바로 그리지 않고 예약한다(Batching). 지금 코드가 끝나면 microtask에서 한 번만 다시 그린다.
      scheduleUpdate(component);
    };

    component.hooks.push(hook);
  }

  return [hook.value, hook.setState];
}

// 화면이 실제 DOM에 반영된 뒤 실행할 일(effect)을 등록한다. (R-P2-06)
//   deps 생략      → 매 렌더링 뒤 실행
//   deps []        → mount 뒤 한 번만
//   deps [a, b]    → a나 b가 이전 렌더링 때와 달라진 렌더링 뒤에만
// effect가 함수를 돌려주면 cleanup으로 보관했다가, 이 effect를 다시 실행하기 직전에 부른다. (unmount는 없음)
// 렌더링 중에는 실행하지 않고 모아 두기만 한다. 렌더링은 화면을 "계산"만 하고, DOM이 바뀐 뒤에 effect가 돈다.
export function useEffect(effect, deps) {
  const { component, hook: existing } = nextHookSlot('useEffect');
  checkDeps('useEffect', deps);

  let hook = existing;
  if (hook === undefined) {
    // deps는 effect를 "실제로 실행했을 때" 기록한다(runPendingEffects).
    // 렌더링 중에 기록하면, 그 렌더링이 실패해 effect가 실행되지 않았는데도 다음에 "안 바뀜"으로 보게 된다.
    hook = { kind: 'useEffect', deps: undefined, hasRun: false, cleanup: null };
    component.hooks.push(hook);
  }

  if (!hook.hasRun || depsChanged(hook.deps, deps)) {
    component.pendingEffects.push({ hook, effect, deps });
  }
}

// 계산 결과를 기억해 두고, deps가 바뀐 렌더링에서만 다시 계산한다. (R-P2-06)
//   const visible = useMemo(() => todos.filter(...), [todos, filter]);
// 계산은 렌더링 중에 바로 한다. 결과가 이번 화면(VDOM)을 만드는 데 필요하기 때문이다.
export function useMemo(compute, deps) {
  const { component, hook: existing } = nextHookSlot('useMemo');
  checkDeps('useMemo', deps);

  if (existing === undefined) {
    const hook = { kind: 'useMemo', value: compute(), deps };
    component.hooks.push(hook);
    return hook.value;
  }

  if (depsChanged(existing.deps, deps)) {
    existing.value = compute();
    existing.deps = deps;
  }
  return existing.value;
}

function checkDeps(hookName, deps) {
  if (deps !== undefined && !Array.isArray(deps)) {
    throw new Error(`${hookName}의 deps는 배열이거나 생략해야 합니다 (받은 값: ${deps})`);
  }
}

// deps가 바뀌었는지. 생략(undefined)이면 매번 바뀐 것으로 본다.
// 각 값은 Object.is로 비교한다. 배열·객체는 참조가 같아야 "안 바뀜"이다(setState와 같은 기준).
function depsChanged(prevDeps, nextDeps) {
  if (prevDeps === undefined || nextDeps === undefined) {
    return true;
  }
  if (prevDeps.length !== nextDeps.length) {
    return true;
  }
  return nextDeps.some((value, i) => !Object.is(value, prevDeps[i]));
}
