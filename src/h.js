// 컴포넌트 코드에서 Virtual DOM을 만드는 함수들. (Phase 2)
//
// Phase 1에서는 사람이 편집한 HTML을 domToVdom으로 읽어 VDOM을 얻었다.
// Phase 2에서는 컴포넌트 함수가 h(...)를 호출해 "지금 상태에서 보여야 할 화면"을 VDOM으로 직접 만든다.
//
//   h('button', { class: 'btn', onClick: add }, '추가')
//     → { type: 'element', tag: 'button', attrs: { class: 'btn' }, events: { click: add },
//         children: [{ type: 'text', text: '추가' }] }
//
//   h(TodoItem, { title: '공부' })
//     → { type: 'component', component: TodoItem, props: { title: '공부', children: [] } }
//        아직 TodoItem을 호출하지 않는다. resolve가 나중에 호출해 element/text로 펼친다.
//
// 왜 컴포넌트를 바로 호출하지 않나:
//   루트 컴포넌트를 실행하는 시점과 자식 컴포넌트를 실행하는 시점을 나누기 위해서다.
//   그래야 "Hook은 루트에서만"(R-P2-03) 규칙을 지킬 수 있다. 루트 실행이 끝난 뒤 resolve가 자식을 실행하므로,
//   자식 안에서 Hook을 부르면 "지금 렌더링 중인 루트 없음" 상태라 바로 알아챌 수 있다.

// props 중 이 형태(on + 대문자)는 속성이 아니라 이벤트 핸들러로 본다. onClick → click
const EVENT_PROP = /^on[A-Z]/;

export function h(type, props, ...children) {
  const flatChildren = normalizeChildren(children);

  if (typeof type === 'function') {
    // 자식(children)도 props로 넘긴다. 컴포넌트가 받은 자식을 원하는 위치에 넣을 수 있게 하려는 것이다.
    return { type: 'component', component: type, props: { ...props, children: flatChildren } };
  }

  if (typeof type !== 'string') {
    throw new Error(`h: 태그 이름(문자열)이나 컴포넌트 함수가 필요합니다 (받은 값: ${type})`);
  }

  const attrs = {};
  const events = {};
  for (const [name, value] of Object.entries(props ?? {})) {
    if (EVENT_PROP.test(name)) {
      if (typeof value === 'function') {
        events[name.slice(2).toLowerCase()] = value;
      }
      // 핸들러 자리에 함수가 아닌 값(null 등)이 오면 "핸들러 없음"으로 본다.
      continue;
    }
    // attrs는 Phase 1과 같은 계약(값은 전부 문자열)을 지킨다. diff·patch를 그대로 쓰기 위해서다.
    //   true  → ''      (disabled처럼 값 없이 "있는" 속성. domToVdom이 읽는 모양과 같다)
    //   false / null / undefined → 속성 없음
    if (value === true) {
      attrs[name] = '';
    } else if (value !== false && value !== null && value !== undefined) {
      attrs[name] = String(value);
    }
  }

  return { type: 'element', tag: type, attrs, events, children: flatChildren };
}

// h에 넘어온 자식들을 VDOM 노드 배열로 고른다.
//   배열(예: items.map(...)의 결과) → 펼쳐서 같은 단계의 자식으로 넣는다.
//   문자열·숫자                     → 텍스트 노드. 숫자 0도 '0'으로 보인다.
//   null / undefined / true / false → 건너뛴다. {done && h('span', ...)} 같은 조건부 표시를 위해서다.
function normalizeChildren(children) {
  const result = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      result.push(...normalizeChildren(child));
    } else if (child === null || child === undefined || typeof child === 'boolean') {
      continue;
    } else if (typeof child === 'string' || typeof child === 'number') {
      result.push({ type: 'text', text: String(child) });
    } else {
      result.push(child);
    }
  }
  return result;
}

// component 노드를 모두 실행해 element/text만 남은 VDOM으로 만든다.
// diff·patch·vdomToDom은 Phase 1 그대로 element/text만 다루므로, 그 앞에 이 단계를 거친다.
// 원래 트리는 바꾸지 않고 새 객체를 만든다.
export function resolve(vnode) {
  if (vnode.type === 'component') {
    // 자식 컴포넌트는 props만 받아 VDOM을 돌려주는 순수 함수다(R-P2-04).
    // 돌려준 결과 안에 또 컴포넌트가 있을 수 있으므로 다시 resolve한다.
    const output = vnode.component(vnode.props);
    const name = vnode.component.name || '익명 컴포넌트';

    // 컴포넌트는 노드 "하나"를 돌려준다. 한 자리(path 하나)에 노드 하나가 대응해야 diff·patch가 맞기 때문이다.
    // 배열을 받아 첫 노드만 쓰면 나머지가 조용히 사라지므로, 길이와 상관없이 배열은 거부한다.
    // 여러 노드를 보여 주려면 h('ul', null, ...)처럼 부모 요소 하나로 감싼다.
    if (Array.isArray(output)) {
      throw new Error(`resolve: ${name}가 배열을 돌려주었습니다. 노드 하나(요소로 감싼 것)를 돌려주어야 합니다`);
    }

    const [rendered] = normalizeChildren([output]);
    if (rendered === undefined) {
      // 빈 결과를 허용하면 그 자리 노드가 사라져 형제 인덱스(path)가 렌더링마다 달라진다.
      // 조건부로 숨기려면 부모에서 {show && h(Child)}처럼 쓴다.
      throw new Error(`resolve: ${name}가 VDOM 노드를 돌려주지 않았습니다 (받은 값: ${output})`);
    }
    return resolve(rendered);
  }

  if (vnode.type === 'text') {
    return vnode;
  }

  if (vnode.type === 'element') {
    return { ...vnode, children: vnode.children.map(resolve) };
  }

  throw new Error(`resolve: 알 수 없는 VDOM 종류입니다 (type: ${vnode.type})`);
}
