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
    element.setAttribute(name, value);
  }

  return element;
}
