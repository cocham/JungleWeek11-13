// 두 Virtual DOM을 비교해 "무엇이 바뀌었는지"를 patch 목록(배열)으로 돌려준다.
//
// 반환 형식:
//   변경 없음   → []
//   변경 있음   → [{ type, path, ... }, ...]
//     path: 루트에서 그 노드까지 내려가는 children 인덱스 목록. 루트 자신은 [].
//     예) 텍스트 변경 → { type: 'TEXT', path: [0], text: '새 글자' }
//         속성 변경   → { type: 'ATTRS', path: [], set: { class: 'b' }, remove: ['id'] }
//         노드 교체   → { type: 'REPLACE', path: [1], node: 새 VDOM 노드 }
//         자식 추가   → { type: 'ADD', path: [2], node: 새 VDOM 노드 }   (path = 새 트리에서의 위치)
//         자식 삭제   → { type: 'REMOVE', path: [2] }                   (path = 옛 트리에서의 위치)
//         이벤트 변경 → { type: 'EVENTS', path: [], set: { click: fn }, remove: ['input'] }  (Phase 2)
//
// 적용 순서 약속: patch 배열을 앞에서부터 차례로 적용하면,
// 각 patch의 path는 "그 시점의 트리"에서 정확한 위치를 가리킨다.
//   - ADD는 인덱스 오름차순 → 부모의 끝에 하나씩 붙이면 된다.
//   - REMOVE는 인덱스 내림차순 → 뒤에서부터 지우므로 아직 안 지운 앞쪽 인덱스가 밀리지 않는다.
export function diff(oldVdom, newVdom) {
  const patches = [];
  walk(oldVdom, newVdom, [], patches);
  return patches;
}

// 두 노드를 같은 위치(path)에서 비교하고, 같으면 자식으로 내려간다.
function walk(oldNode, newNode, path, patches) {
  // 노드 종류(text ↔ element)나 태그가 다르면 고쳐 쓸 수 없는 다른 노드다.
  // 실제 DOM에서도 <p>를 <div>로 바꾸는 방법은 없으므로 새 노드로 통째로 바꾼다.
  // 새 노드 안의 속성·자식은 어차피 전부 새로 만들어지므로 더 내려가 비교하지 않는다.
  if (oldNode.type !== newNode.type || (oldNode.type === 'element' && oldNode.tag !== newNode.tag)) {
    patches.push({ type: 'REPLACE', path, node: newNode });
    return;
  }

  if (oldNode.type === 'text') {
    // 텍스트 노드는 글자만 바꾸면 되므로 새 글자만 담는다.
    // 빈 문자열('')로 바뀌는 것도 변경이다. 노드를 지우지 않고 글자만 비운다.
    if (oldNode.text !== newNode.text) {
      patches.push({ type: 'TEXT', path, text: newNode.text });
    }
    return;
  }

  // 요소 자신의 속성 patch를 자식 patch보다 먼저 넣는다(위에서 아래 순서 유지).
  const attrsPatch = diffAttrs(oldNode.attrs, newNode.attrs, path);
  if (attrsPatch !== null) {
    patches.push(attrsPatch);
  }

  // Phase 2: 이벤트 핸들러도 속성처럼 비교한다. Phase 1 VDOM에는 events가 없으므로 {}로 본다.
  const eventsPatch = diffEvents(oldNode.events ?? {}, newNode.events ?? {}, path);
  if (eventsPatch !== null) {
    patches.push(eventsPatch);
  }

  diffChildren(oldNode.children, newNode.children, path, patches);
}

// 자식 목록을 같은 인덱스끼리 비교한다(key 없음).
//
//   old: [a, b, c, d]        old: [a, b]
//   new: [a', b']            new: [a', b', c, d]
//         └ 0~1 공통 비교          └ 0~1 공통 비교
//   2~3 → REMOVE (3, 2 순서)   2~3 → ADD (2, 3 순서)
//
// 한 부모에서 자식은 늘거나 줄거나 둘 중 하나이므로 ADD와 REMOVE가 같은 부모에 함께 나오지 않는다.
// 공통 구간(0 ~ 짧은 쪽 길이-1)은 old·new에서 인덱스가 같으므로 그 안의 path는 어느 트리 기준으로 봐도 같다.
function diffChildren(oldChildren, newChildren, parentPath, patches) {
  const common = Math.min(oldChildren.length, newChildren.length);

  // 객체가 서로 다른 인스턴스여도 내용이 같으면 "변경 없음"이어야 하므로,
  // 참조(===)가 아니라 자식을 하나씩 같은 인덱스끼리 비교한다.
  for (let i = 0; i < common; i++) {
    walk(oldChildren[i], newChildren[i], [...parentPath, i], patches);
  }

  // 새 자식이 더 많으면 남는 것을 추가한다.
  // 오름차순으로 넣으면 각 ADD 시점에 path의 인덱스 = 부모의 현재 자식 수이므로 "끝에 붙이기"가 된다.
  for (let i = common; i < newChildren.length; i++) {
    patches.push({ type: 'ADD', path: [...parentPath, i], node: newChildren[i] });
  }

  // 옛 자식이 더 많으면 남는 것을 삭제한다.
  // 오름차순으로 지우면 [2]를 지운 순간 옛 [3]이 [2]로 당겨져 다음 patch의 path [3]이 틀어진다.
  // 그래서 뒤(큰 인덱스)부터 지운다. 삭제되는 노드의 안쪽은 비교하지 않는다(어차피 사라진다).
  for (let i = oldChildren.length - 1; i >= common; i--) {
    patches.push({ type: 'REMOVE', path: [...parentPath, i] });
  }
}

// 한 요소의 속성 변화를 ATTRS patch 하나로 모은다. 바뀐 게 없으면 null.
//   set:    새로 생겼거나 값이 바뀐 속성 { 이름: 새 값 }  → 나중에 setAttribute
//   remove: 없어진 속성 이름 목록                        → 나중에 removeAttribute
// 이름을 기준으로 비교하므로 속성을 적은 순서는 결과에 영향이 없다.
function diffAttrs(oldAttrs, newAttrs, path) {
  const set = {};
  const remove = [];

  for (const name of Object.keys(newAttrs)) {
    // 값이 ''인 속성(예: disabled)도 "있는" 속성이다.
    // 그래서 값의 참/거짓이 아니라 이름이 있는지(hasOwn)로 판단해야 '' 와 삭제가 섞이지 않는다.
    if (!Object.hasOwn(oldAttrs, name) || oldAttrs[name] !== newAttrs[name]) {
      set[name] = newAttrs[name];
    }
  }

  for (const name of Object.keys(oldAttrs)) {
    if (!Object.hasOwn(newAttrs, name)) {
      remove.push(name);
    }
  }

  if (Object.keys(set).length === 0 && remove.length === 0) {
    return null;
  }
  // set·remove는 비어 있어도 항상 넣는다. 받는 쪽이 존재 여부를 따로 확인하지 않아도 되게 하려는 것이다.
  return { type: 'ATTRS', path, set, remove };
}

// 한 요소의 이벤트 핸들러 변화를 EVENTS patch 하나로 모은다. 바뀐 게 없으면 null.
//   set:    새로 생겼거나 다른 함수로 바뀐 핸들러 { 이벤트 이름: 새 함수 }
//   remove: 없어진 이벤트 이름 목록
// 함수는 내용이 아니라 참조(===)로 비교한다. 렌더링마다 새로 만든 화살표 함수는 "바뀐" 것이 되어
// 매번 핸들러를 갈아 끼우지만, 그래야 새 렌더링의 최신 값(클로저)을 보는 핸들러가 붙는다.
function diffEvents(oldEvents, newEvents, path) {
  const set = {};
  const remove = [];

  for (const name of Object.keys(newEvents)) {
    if (oldEvents[name] !== newEvents[name]) {
      set[name] = newEvents[name];
    }
  }

  for (const name of Object.keys(oldEvents)) {
    if (!Object.hasOwn(newEvents, name)) {
      remove.push(name);
    }
  }

  if (Object.keys(set).length === 0 && remove.length === 0) {
    return null;
  }
  return { type: 'EVENTS', path, set, remove };
}
