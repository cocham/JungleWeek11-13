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

// 지금 Hook을 부를 수 있는 상태인지 나타낸다.
//   currentComponent: 실행 중인 루트 컴포넌트. 루트 함수가 실행되는 동안만 값이 있다.
//   renderingChildren: 루트 실행이 끝나고 resolve가 자식 컴포넌트를 실행하는 중인지.
// 한 번에 컴포넌트 하나만 렌더링하므로(동기 실행) 모듈 변수 하나로 충분하다.
let currentComponent = null;
let hookIndex = 0;
let renderingChildren = false;

export class FunctionComponent {
  constructor(component, props = {}) {
    this.component = component;
    this.props = props;
    this.hooks = [];
    this.vdom = null; // 마지막으로 화면에 반영한 VDOM. 다음 diff의 "옛 VDOM"이다.
    this.root = null; // 화면에 있는 루트 DOM 노드. patch가 이 노드부터 path를 따라간다.
    this.isRendering = false;
  }

  // 첫 렌더링: 컴포넌트를 실행해 만든 VDOM을 통째로 실제 DOM으로 만들어 container에 붙인다.
  // 비교할 옛 화면이 없으므로 diff 없이 전부 만든다.
  mount(container) {
    if (this.root !== null) {
      throw new Error('FunctionComponent: 이미 mount되었습니다');
    }
    const vdom = this.render();
    this.root = vdomToDom(vdom);
    container.appendChild(this.root);
    this.vdom = vdom;
  }

  // 상태가 바뀐 뒤의 재렌더링: 새 VDOM을 계산하고 옛 VDOM과 비교해 바뀐 곳만 실제 DOM에 반영한다. (R-P2-07)
  // 적용한 patch 목록을 돌려준다(무엇이 바뀌었는지 확인용).
  update() {
    if (this.root === null) {
      throw new Error('FunctionComponent: mount 전에는 update할 수 없습니다');
    }
    const newVdom = this.render();
    const patches = diff(this.vdom, newVdom);
    // 루트가 다른 태그로 바뀌면 patch가 새 루트 노드를 돌려주므로 항상 받아 둔다.
    this.root = patch(this.root, patches);
    this.vdom = newVdom;
    return patches;
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
    try {
      const output = this.component(this.props);
      // Hook은 순서로 찾으므로 개수가 바뀌면 이후 Hook이 엉뚱한 칸을 읽는다. 조용히 틀리지 않게 멈춘다.
      // (늘어난 경우는 useState가 칸을 찾을 때 먼저 막는다. 여기서는 줄어든 경우를 잡는다.)
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

// 지금 렌더링 중인 루트 컴포넌트의 다음 Hook 칸 번호를 돌려준다. Hook을 부를 수 없는 때면 에러.
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
  return { component, index };
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
  const { component, index } = nextHookSlot('useState');

  // 첫 렌더링에만 칸을 만든다. 이후 렌더링은 같은 칸의 값을 그대로 읽으므로 initialValue는 무시된다.
  if (component.hooks.length <= index) {
    const hook = { value: initialValue };

    // setState는 첫 렌더링에 한 번 만들어 계속 같은 함수를 쓴다.
    // 이벤트 핸들러가 옛 렌더링의 setState를 들고 있어도 같은 칸·같은 컴포넌트를 바꾼다.
    hook.setState = (next) => {
      // 렌더링 중에 상태를 바꾸면 그 상태로 다시 렌더링 → 또 setState …로 끝없이 반복될 수 있다.
      if (component.isRendering) {
        throw new Error('렌더링 중에는 setState를 부를 수 없습니다. 이벤트 핸들러 안에서 부르세요');
      }
      // 함수를 넘기면 "가장 최신 값"을 받아 새 값을 계산한다. 같은 핸들러에서 여러 번 불러도 누적된다.
      const value = typeof next === 'function' ? next(hook.value) : next;

      // 값이 같으면 화면도 같으므로 다시 그리지 않는다.
      // 배열·객체는 참조로 비교하므로, 바꿀 때는 [...todos, item]처럼 새 객체를 만들어야 한다.
      if (Object.is(value, hook.value)) {
        return;
      }
      hook.value = value;

      // setState의 두 번째 역할: 바뀐 상태로 화면을 다시 그린다. (R-P2-05)
      // mount 전에 불렸다면 값만 바꾸고, mount 때 그 값으로 그린다.
      if (component.root !== null) {
        component.update();
      }
    };

    component.hooks.push(hook);
  }

  const hook = component.hooks[index];
  return [hook.value, hook.setState];
}
