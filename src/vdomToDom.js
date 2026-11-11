import { setEvent } from './events.js';

// Virtual DOM을 실제 DOM 노드로 만든다. (domToVdom의 반대 방향)
//
// Patch 단계에서 REPLACE·ADD patch의 node(VDOM)를 화면에 넣으려면 실제 DOM 노드가 필요하다.
//
//   vdomToDom(vnode)       텍스트·요소를 구분해 자식까지 통째로 만든다. 밖에서는 보통 이것만 쓴다.
//   createTextDom(vnode)   텍스트 노드 하나
//   createElementDom(vnode) 요소 자신(태그·속성)만, 자식 없이

// VDOM 노드 하나(와 그 아래 전부) → 실제 DOM 노드
export function vdomToDom(vnode) {
  if (vnode.type === 'text') {
    return createTextDom(vnode);
  }

  if (vnode.type === 'element') {
    const element = createElementDom(vnode);
    // 자식도 각자 텍스트일 수도 요소일 수도 있으므로 vdomToDom을 다시 호출한다(재귀).
    // children 배열 순서대로 appendChild하므로 형제 순서가 그대로 유지된다.
    // 빈 문자열·공백 텍스트도 건너뛰지 않는다. 건너뛰면 자식 인덱스가 VDOM과 어긋나 diff의 path가 틀어진다.
    for (const child of vnode.children) {
      element.appendChild(vdomToDom(child));
    }
    return element;
  }

  // 모르는 종류를 조용히 무시하면 화면에서 노드가 사라져도 알기 어렵다. 바로 알리도록 에러를 던진다.
  throw new Error(`vdomToDom: 알 수 없는 VDOM 종류입니다 (type: ${vnode.type})`);
}

// 텍스트 VDOM { type: 'text', text } → 실제 텍스트 노드
export function createTextDom(vnode) {
  // innerHTML이 아니라 createTextNode를 쓴다.
  // 글자를 HTML로 해석하지 않고 그대로 넣으며, 앞뒤 공백·줄바꿈·빈 문자열도 손대지 않고 보존한다.
  return document.createTextNode(vnode.text);
}

// 요소 VDOM { type: 'element', tag, attrs, children } → 실제 요소 (태그·속성만)
// children은 보지 않는다. 자식은 vdomToDom이 이 함수를 부른 뒤 붙인다.
export function createElementDom(vnode) {
  const element = document.createElement(vnode.tag);

  // 속성은 전부 문자열이므로 setAttribute로 HTML에 적힌 그대로 넣는다.
  // el.disabled = '' 같은 프로퍼티 대입을 쓰면 ''가 false로 해석되어 속성이 사라진다.
  // setAttribute('disabled', '')는 속성을 "있게" 만들므로 domToVdom이 읽은 의미(값 ''인 속성 있음)와 같다.
  // data-*도 이름 그대로 setAttribute하면 dataset에 자동으로 반영된다.
  for (const [name, value] of Object.entries(vnode.attrs)) {
    setAttr(element, name, value);
  }

  // Phase 2: h()로 만든 VDOM에는 이벤트 핸들러(events)가 있다. Phase 1 VDOM(domToVdom)에는 없으므로 {}로 본다.
  for (const [name, handler] of Object.entries(vnode.events ?? {})) {
    setEvent(element, name, handler);
  }

  return element;
}

// 속성 하나를 넣는다. patch의 ATTRS도 같은 함수를 쓴다.
//
// <input>의 value·checked는 "속성(attribute)"과 "지금 화면에 보이는 값(property)"이 따로 있다.
//   속성은 처음 값일 뿐이라, 사용자가 한 번 입력하거나 클릭한 뒤에는 setAttribute로 바꿔도 화면 값이 그대로다.
//   예) 할 일을 추가한 뒤 setText('') → value 속성은 ''가 되지만 입력창 글자는 남는다.
// 그래서 <input>에 한해 화면 값(property)도 함께 맞춘다. (React도 이 둘은 property로 다룬다)
// 다른 태그는 건드리지 않는다. 예를 들어 <li>의 value 프로퍼티는 숫자라서 대입하면 속성이 바뀌어 버린다.
export function setAttr(element, name, value) {
  element.setAttribute(name, value);
  if (isInput(element)) {
    if (name === 'value') {
      // 이미 같은 값이면 대입하지 않는다. 입력 중인 글자를 다시 넣으면 커서가 끝으로 튈 수 있기 때문이다.
      if (element.value !== value) {
        element.value = value;
      }
    } else if (name === 'checked') {
      element.checked = true;
    }
  }
}

// 속성 하나를 뺀다. <input>이면 화면 값도 비우거나 체크를 끈다.
export function removeAttr(element, name) {
  element.removeAttribute(name);
  if (isInput(element)) {
    if (name === 'value') {
      element.value = '';
    } else if (name === 'checked') {
      element.checked = false;
    }
  }
}

function isInput(element) {
  return element.tagName === 'INPUT';
}
