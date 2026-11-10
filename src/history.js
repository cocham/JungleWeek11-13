// Patch로 반영한 화면(VDOM)을 순서대로 보관하는 State History. (R-P1-07·08)
//
//   snapshots: [초기, v1, v2, v3]
//   index:              ↑ 지금 화면의 위치
//
// 정한 정책 (사람이 결정):
//   - 초기 화면도 저장한다 → 처음 화면까지 뒤로 갈 수 있다.
//   - 과거 위치에서 새로 push하면 그 뒤(미래) 기록은 버린다 → 브라우저 뒤로가기·Undo와 같다.
//   - 더 갈 곳이 없으면 canBack/canForward가 false다 → 페이지가 버튼을 끈다.
//
// 스냅샷은 넣을 때와 꺼낼 때 모두 깊은 복사한다.
// 바깥에서 받은 VDOM이나 돌려준 VDOM을 누가 고쳐도 History 안의 과거 화면은 바뀌지 않게 하기 위해서다.
export function createHistory(initialVdom) {
  const snapshots = [cloneVdom(initialVdom)];
  let index = 0;

  return {
    // 새 화면을 지금 위치 다음에 저장하고 그 위치로 간다. 지금 위치 뒤의 기록은 버린다.
    push(vdom) {
      snapshots.splice(index + 1);
      snapshots.push(cloneVdom(vdom));
      index = snapshots.length - 1;
    },

    canBack() {
      return index > 0;
    },

    canForward() {
      return index < snapshots.length - 1;
    },

    // 한 칸 뒤로 가서 그 화면의 복사본을 돌려준다. 갈 곳이 없으면 위치를 바꾸지 않고 에러를 던진다.
    back() {
      if (!this.canBack()) {
        throw new Error('history: 더 뒤로 갈 기록이 없습니다');
      }
      index -= 1;
      return cloneVdom(snapshots[index]);
    },

    forward() {
      if (!this.canForward()) {
        throw new Error('history: 더 앞으로 갈 기록이 없습니다');
      }
      index += 1;
      return cloneVdom(snapshots[index]);
    },

    // 지금 화면의 복사본
    current() {
      return cloneVdom(snapshots[index]);
    },

    // 화면 표시용: 지금 위치(0부터)와 전체 기록 수
    get index() {
      return index;
    },
    get length() {
      return snapshots.length;
    },
  };
}

// VDOM을 깊은 복사한다. attrs 객체와 children 배열까지 새로 만들어야 원본과 아무것도 공유하지 않는다.
export function cloneVdom(vnode) {
  if (vnode.type === 'text') {
    return { type: 'text', text: vnode.text };
  }
  return {
    type: 'element',
    tag: vnode.tag,
    attrs: { ...vnode.attrs }, // 속성 값은 문자열뿐이므로 한 단계 복사로 충분하다.
    children: vnode.children.map(cloneVdom),
  };
}
