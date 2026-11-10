import { domToVdom } from './domToVdom.js';
import { vdomToDom } from './vdomToDom.js';
import { diff } from './diff.js';
import { patch } from './patch.js';
import { createHistory } from './history.js';

// Phase 1 검증 페이지를 연결한다. (R-P1-04 ~ R-P1-08)
//
// 흐름:
//   로드     실제 영역 DOM → VDOM(currentVdom) → vdomToDom → 테스트 영역에 별도 DOM 생성
//            → 초기 화면을 History에 저장
//   편집     사람이 테스트 영역(contenteditable)을 직접 고친다. 실제 영역은 아직 그대로다.
//   Patch    테스트 영역 DOM → 새 VDOM → diff(currentVdom, 새 VDOM) → patch(실제 영역 루트)
//            → 새 VDOM이 다음 비교의 기준(currentVdom)이 되고, History에 저장된다.
//   뒤로/앞으로  History의 VDOM을 꺼내 "목표 화면"으로 삼는다.
//            → 실제 영역은 diff·patch로 바뀐 곳만, 테스트 영역은 그 VDOM으로 새로 만든다.
//
// 실제 영역은 다시 읽지 않고 currentVdom과 비교한다. "지금 화면이 어떤 모습인지"를 VDOM으로 기억해 두는 것이
// Virtual DOM 방식의 핵심이기 때문이다. 과거 화면으로 돌아갈 때도 되돌리는 명령을 따로 만들지 않고,
// 과거 VDOM을 새 목표로 diff·patch하면 된다.

// 페이지의 요소를 id로 찾아 연결한다. 브라우저에서는 index.html이 이 함수를 부른다.
export function setupPhase1Page(doc = document) {
  const actualArea = doc.getElementById('actual-area');
  const testArea = doc.getElementById('test-area');
  const patchButton = doc.getElementById('patch-button');
  const backButton = doc.getElementById('back-button');
  const forwardButton = doc.getElementById('forward-button');
  const status = doc.getElementById('status');

  // 기록이 생기기 전에는 이동할 곳이 없으므로 꺼 둔다.
  backButton.disabled = true;
  forwardButton.disabled = true;

  let actualRoot;
  try {
    actualRoot = findRootElement(actualArea);
  } catch (error) {
    // 시작 화면부터 잘못되면 비교 기준이 없으므로 Patch를 막는다.
    patchButton.disabled = true;
    showStatus(status, 'error', `실제 영역을 읽을 수 없습니다: ${error.message}`);
    return;
  }

  // 지금 실제 영역이 어떤 모습인지 기억하는 VDOM. Patch·이동할 때마다 이것과 목표 VDOM을 비교한다.
  let currentVdom = domToVdom(actualRoot);
  // 초기 화면도 저장한다(사람이 정한 정책). 그래서 처음 화면까지 뒤로 갈 수 있다.
  const history = createHistory(currentVdom);

  // 실제 영역의 노드를 옮기거나 복제하지 않고, VDOM으로 새 DOM을 만든다. (R-P1-05)
  // 그래서 두 영역은 구조는 같지만 서로 다른 객체이고, 테스트 영역을 고쳐도 실제 영역은 바뀌지 않는다.
  // 주석은 VDOM에 없으므로 테스트 영역에는 나타나지 않는다.
  testArea.replaceChildren(vdomToDom(currentVdom));
  showStatus(status, 'info', `테스트 영역을 직접 고친 뒤 Patch를 누르세요. ${position()}`);

  // 실제 영역을 목표 VDOM에 맞춘다: diff로 바뀐 곳을 찾고 patch로 그곳만 고친다. 적용한 patch 목록을 돌려준다.
  function syncActual(targetVdom) {
    const patches = diff(currentVdom, targetVdom);
    try {
      // 루트가 교체될 수 있으므로 반환값을 받아 둬야 다음 Patch도 화면의 노드에 적용된다.
      actualRoot = patch(actualRoot, patches);
      currentVdom = targetVdom;
      return patches;
    } catch (error) {
      // diff 결과라면 일어나지 않아야 하지만, 중간에 실패하면 실제 영역이 일부만 바뀌었을 수 있다.
      // 다음 비교가 어긋나지 않도록 기준 VDOM을 지금 실제 영역의 모습으로 다시 읽는다.
      currentVdom = domToVdom(actualRoot);
      throw error;
    }
  }

  // 경계에서는 버튼을 끈다(사람이 정한 정책).
  function updateHistoryButtons() {
    backButton.disabled = !history.canBack();
    forwardButton.disabled = !history.canForward();
  }

  function position() {
    return `(기록 ${history.index + 1} / ${history.length})`;
  }

  patchButton.addEventListener('click', () => {
    let testRoot;
    try {
      testRoot = findRootElement(testArea);
    } catch (error) {
      // 목표 화면이 규칙에 맞지 않으면 실제 영역·기준 VDOM·History를 그대로 둔다. 고친 뒤 다시 누르면 된다.
      showStatus(status, 'error', `Patch하지 않았습니다: ${error.message}`);
      return;
    }

    let patches;
    try {
      patches = syncActual(domToVdom(testRoot));
    } catch (error) {
      showStatus(status, 'error', `Patch 중 오류가 났습니다: ${error.message}`);
      return;
    }

    if (patches.length === 0) {
      // 같은 화면을 또 저장하면 뒤로가기를 눌러도 화면이 그대로여서 고장 난 것처럼 보인다. 그래서 저장하지 않는다.
      showStatus(status, 'info', `변경 없음: 실제 영역을 건드리지 않았고 기록도 남기지 않았습니다. ${position()}`);
      return;
    }

    // 과거 위치에서 Patch했다면 그 뒤의 기록은 버려진다(사람이 정한 정책).
    // history가 깊은 복사로 저장하므로, 이후 currentVdom을 어떻게 쓰든 저장된 스냅샷은 바뀌지 않는다.
    history.push(currentVdom);
    updateHistoryButtons();
    showStatus(status, 'ok', `${patches.length}개 변경 반영 — ${describePatches(patches)} ${position()}`);
  });

  // History의 한 화면으로 이동한다. 실제 영역과 테스트 영역이 함께 그 화면이 된다. (R-P1-08)
  function move(direction) {
    const target = direction === 'back' ? history.back() : history.forward();

    let patches;
    try {
      patches = syncActual(target);
    } catch (error) {
      showStatus(status, 'error', `이동 중 오류가 났습니다: ${error.message}`);
      updateHistoryButtons();
      return;
    }

    // 테스트 영역은 다음 편집의 출발점이므로 같은 화면으로 새로 만든다.
    // Patch하지 않은 편집 내용은 덮어쓴다(사람이 정한 정책).
    testArea.replaceChildren(vdomToDom(target));
    updateHistoryButtons();

    const label = direction === 'back' ? '뒤로' : '앞으로';
    const detail = patches.length === 0 ? '실제 영역 변경 없음' : `${patches.length}개 변경 반영 — ${describePatches(patches)}`;
    showStatus(status, 'ok', `${label} 이동: ${detail} ${position()}`);
  }

  backButton.addEventListener('click', () => move('back'));
  forwardButton.addEventListener('click', () => move('forward'));
}

// 영역 컨테이너 안의 루트 요소 하나를 찾는다.
// patch는 루트 하나를 기준으로 동작하므로, 최상위에는 요소가 정확히 하나만 있어야 한다.
// 루트 앞뒤의 공백 텍스트와 주석은 화면 구조와 상관없으므로 무시한다.
// (contenteditable은 &nbsp;를 자주 넣는데, trim()은 이것도 공백으로 본다.)
export function findRootElement(container) {
  const topLevel = [...container.childNodes].filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== ''),
  );

  if (topLevel.length === 0) {
    throw new Error('최상위 요소가 없습니다. 요소 하나를 넣어 주세요.');
  }
  if (topLevel.length > 1) {
    throw new Error(`최상위에는 요소 하나만 둘 수 있습니다 (지금 ${topLevel.length}개: 요소 밖 글자 포함).`);
  }
  if (topLevel[0].nodeType !== Node.ELEMENT_NODE) {
    throw new Error('최상위에 요소 없이 글자만 있습니다. 글자를 요소로 감싸 주세요.');
  }
  return topLevel[0];
}

// 상태 표시줄에 쓸 patch 설명. 예) TEXT [3, 1, 0] · ATTRS [5]
function describePatches(patches) {
  return patches.map((p) => `${p.type} [${p.path.join(', ')}]`).join(' · ');
}

function showStatus(status, kind, message) {
  status.dataset.kind = kind;
  status.textContent = message;
}
