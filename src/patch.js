import { vdomToDom } from './vdomToDom.js';
import { setEvent, removeEvent } from './events.js';

// diff가 만든 patch 목록을 실제 DOM에 반영한다. (R-P1-03)
//
// 바뀐 곳만 고친다.
//   TEXT·ATTRS → 그 노드를 그 자리에서 고친다. 노드 객체는 그대로 남는다.
//   EVENTS     → 그 요소의 이벤트 핸들러만 갈아 끼운다. (Phase 2)
//   REPLACE    → 그 노드(와 자손)만 새 노드로 갈아 끼운다.
//   ADD        → 새 노드를 만들어 끼운다.
//   REMOVE     → 그 노드(와 자손)만 떼어 낸다.
// 이 밖의 노드(형제, 주석 등)는 같은 DOM 객체 그대로 남는다.
//
// 적용 순서: patches를 배열 순서대로 적용한다. diff가 ADD는 오름차순, REMOVE는 내림차순으로 내므로
// 각 patch의 path는 적용하는 그 순간의 DOM에서 맞는 위치를 가리킨다.

// patches를 root 아래에 적용하고, 적용 후의 root를 돌려준다.
// 루트가 REPLACE되면 root가 새 노드로 바뀌므로, 부르는 쪽은 항상 root = patch(root, patches)로 받아야 한다.
export function patch(root, patches) {
  for (const p of patches) {
    if (p.type === 'TEXT') {
      // 텍스트 노드를 새로 만들지 않고 글자만 바꾼다. 빈 문자열이어도 노드는 남는다.
      getNodeByPath(root, p.path).nodeValue = p.text;
    } else if (p.type === 'ATTRS') {
      const element = getNodeByPath(root, p.path);
      // 값이 ''인 속성(disabled 등)도 setAttribute로 "있는" 속성이 된다.
      for (const [name, value] of Object.entries(p.set)) {
        element.setAttribute(name, value);
      }
      for (const name of p.remove) {
        element.removeAttribute(name);
      }
    } else if (p.type === 'EVENTS') {
      const element = getNodeByPath(root, p.path);
      for (const [name, handler] of Object.entries(p.set)) {
        setEvent(element, name, handler);
      }
      for (const name of p.remove) {
        removeEvent(element, name);
      }
    } else if (p.type === 'REPLACE') {
      root = applyReplace(root, p);
    } else if (p.type === 'ADD') {
      applyAdd(root, p);
    } else if (p.type === 'REMOVE') {
      applyRemove(root, p);
    } else {
      throw new Error(`patch: 알 수 없는 patch 종류입니다 (type: ${p.type})`);
    }
  }
  return root;
}

// path의 노드를 vdomToDom(node)로 만든 새 노드로 갈아 끼운다. 바뀐 root를 돌려준다.
function applyReplace(root, p) {
  const oldNode = getNodeByPath(root, p.path);
  const newNode = vdomToDom(p.node);

  // replaceChild는 정확히 그 노드 하나의 자리만 바꾼다. 앞뒤의 주석·형제는 건드리지 않는다.
  // 루트도 부모(예: "실제 영역" 컨테이너)가 있으면 같은 방법으로 화면에서 갈아 끼운다.
  if (oldNode.parentNode !== null) {
    oldNode.parentNode.replaceChild(newNode, oldNode);
  }

  // 루트를 교체했다면 이제 새 노드가 root다. 부모가 없어 화면에 끼울 곳이 없는 루트도 새 노드를 돌려준다.
  return p.path.length === 0 ? newNode : root;
}

// 부모를 찾아 path의 마지막 인덱스 위치에 새 노드를 끼운다.
function applyAdd(root, p) {
  if (p.path.length === 0) {
    throw new Error('patch: 루트 위치에는 ADD할 수 없습니다');
  }
  const parent = getNodeByPath(root, p.path.slice(0, -1));
  const index = p.path[p.path.length - 1];
  const siblings = vdomChildNodes(parent);

  // diff는 ADD를 오름차순으로 내므로 index는 항상 "지금의 VDOM 자식 수"(= 끝)와 같다.
  // 그보다 크면 중간이 비게 되므로 잘못된 patch다.
  if (index > siblings.length) {
    throw new Error(`patch: ADD 위치 [${p.path.join(', ')}]가 자식 수(${siblings.length})보다 큽니다`);
  }

  // index번째 VDOM 자식 바로 앞에 끼운다. 그런 자식이 없으면(끝에 추가) DOM의 맨 끝에 붙인다.
  // 주석은 VDOM에 없으므로 어디에 두든 VDOM 순서는 같다. 끝에 추가할 때는 끝의 주석 뒤에 붙는다.
  parent.insertBefore(vdomToDom(p.node), siblings[index] ?? null);
}

// path의 노드를 부모에서 떼어 낸다. 앞뒤의 주석·형제는 그대로 둔다.
function applyRemove(root, p) {
  if (p.path.length === 0) {
    throw new Error('patch: 루트는 REMOVE할 수 없습니다');
  }
  const node = getNodeByPath(root, p.path);
  node.parentNode.removeChild(node);
}

// VDOM의 path(children 인덱스 목록)를 따라 실제 DOM 노드를 찾는다. path []는 root 자신.
//
// 실제 DOM의 childNodes와 VDOM의 children은 인덱스가 다를 수 있다.
// domToVdom이 주석 같은 노드를 VDOM에서 빼기 때문이다.
//   DOM  childNodes: [<!--c-->, <li>a</li>, <!--c-->, <li>b</li>]
//   VDOM children:  [          li(a),                li(b)     ]
// 그래서 childNodes[i]가 아니라 "VDOM에 들어가는 노드만 센 i번째"를 찾아야 path가 맞는다.
export function getNodeByPath(root, path) {
  let node = root;
  for (let depth = 0; depth < path.length; depth++) {
    const child = vdomChildNodes(node)[path[depth]];
    if (child === undefined) {
      // path가 실제 DOM과 맞지 않으면 엉뚱한 노드를 고치기 전에 멈춘다.
      throw new Error(`patch: path [${path.join(', ')}]에 해당하는 노드가 없습니다 (깊이 ${depth}에서 찾지 못함)`);
    }
    node = child;
  }
  return node;
}

// domToVdom이 VDOM으로 만드는 노드(텍스트·요소)만 골라 순서대로 돌려준다.
// 이 기준은 domToVdom의 기준과 반드시 같아야 한다. 다르면 path가 다른 노드를 가리킨다.
function vdomChildNodes(parent) {
  return [...parent.childNodes].filter(
    (child) => child.nodeType === Node.TEXT_NODE || child.nodeType === Node.ELEMENT_NODE,
  );
}
