// 실제 DOM 노드를 Virtual DOM(평범한 JS 객체)으로 바꾼다.
//
// 텍스트: { type: 'text', text }
// 요소:   { type: 'element', tag, attrs, children }
//
// 요소의 children은 childNodes를 재귀로 변환해 만든다.
export function domToVdom(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    // 공백뿐인 텍스트도 버리지 않는다. 공백도 화면 결과에 영향을 줄 수 있기 때문이다.
    return { type: 'text', text: node.textContent };
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return {
      type: 'element',
      // HTML 문서에서 tagName은 'DIV'처럼 대문자이므로 소문자로 맞춘다.
      tag: node.tagName.toLowerCase(),
      attrs: getAttrs(node),
      children: getChildren(node),
    };
  }

  // 주석 같은 다른 종류의 노드는 아직 다루지 않는다.
  return null;
}

// 자식 노드를 순서대로 VDOM으로 바꾼다.
// children(요소만)이 아니라 childNodes(텍스트 포함)를 써야 텍스트와 공백이 빠지지 않는다.
// 각 자식에 domToVdom을 다시 호출하므로 중첩된 자식도 끝까지 내려가며 변환된다.
function getChildren(element) {
  const children = [];
  for (const child of element.childNodes) {
    const vnode = domToVdom(child);
    // 다루지 않는 노드(주석 등)는 null이므로 children에 넣지 않는다.
    if (vnode !== null) {
      children.push(vnode);
    }
  }
  return children;
}

// element.attributes(NamedNodeMap)를 { 이름: 값 } 객체로 바꾼다.
// 값이 없는 속성(예: disabled)은 DOM에서 빈 문자열 ''로 읽힌다.
function getAttrs(element) {
  const attrs = {};
  for (const attr of element.attributes) {
    attrs[attr.name] = attr.value;
  }
  return attrs;
}
