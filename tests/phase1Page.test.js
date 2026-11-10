import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupPhase1Page, findRootElement } from '../src/phase1Page.js';
import { domToVdom } from '../src/domToVdom.js';

// 실제 index.html의 <body>를 그대로 쓴다. id·샘플 HTML이 페이지와 어긋나면 테스트가 잡도록 하기 위해서다.
// (innerHTML로 넣은 <script>는 실행되지 않으므로 setupPhase1Page는 테스트가 직접 부른다.)
// (jsdom 환경의 전역 URL은 file: 경로를 다루지 못하므로 import.meta.dirname으로 경로를 만든다.)
const pageHTML = readFileSync(join(import.meta.dirname, '..', 'index.html'), 'utf8');
const pageBody = new DOMParser().parseFromString(pageHTML, 'text/html').body.innerHTML;

const $ = (id) => document.getElementById(id);
const actualRoot = () => findRootElement($('actual-area'));
const testRoot = () => findRootElement($('test-area'));
const clickPatch = () => $('patch-button').click();

// root 아래 모든 노드(주석 포함). 패치 전후로 같은 객체인지 비교할 때 쓴다.
function allNodes(root) {
  const nodes = [root];
  for (const child of root.childNodes) {
    nodes.push(...allNodes(child));
  }
  return nodes;
}

// 테스트 영역 루트 안에서 css 선택자로 찾는다. 사람이 contenteditable로 고치는 것을 DOM 조작으로 흉내 낸다.
const inTest = (selector) => testRoot().querySelector(selector);
const inActual = (selector) => actualRoot().querySelector(selector);

describe('findRootElement — 영역의 루트 요소 하나 찾기', () => {
  function area(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div;
  }

  it('앞뒤 공백·주석은 무시하고 요소 하나를 돌려준다', () => {
    const div = area('\n  <!--c--> <ul><li>a</li></ul>\n <!--d-->');

    expect(findRootElement(div)).toBe(div.querySelector('ul'));
  });

  it('&nbsp;만 있는 텍스트도 공백으로 본다', () => {
    const div = area('&nbsp;<p>x</p>&nbsp;');

    expect(findRootElement(div).tagName).toBe('P');
  });

  it('비었거나 공백·주석뿐이면 에러', () => {
    expect(() => findRootElement(area(''))).toThrow(/최상위 요소가 없습니다/);
    expect(() => findRootElement(area('  <!--c-->  '))).toThrow(/최상위 요소가 없습니다/);
  });

  it('최상위 요소가 둘 이상이거나 요소 밖 글자가 있으면 에러', () => {
    expect(() => findRootElement(area('<h1>a</h1><p>b</p>'))).toThrow(/요소 하나만.*2개/);
    expect(() => findRootElement(area('글자<p>b</p>'))).toThrow(/요소 하나만.*2개/);
  });

  it('글자만 있으면 에러', () => {
    expect(() => findRootElement(area('그냥 글자'))).toThrow(/글자만 있습니다/);
  });
});

describe('검증 페이지 — 로드 (R-P1-04·05)', () => {
  beforeEach(() => {
    document.body.innerHTML = pageBody;
  });

  it('실제·테스트 영역과 Patch·뒤로가기·앞으로가기 버튼이 있다', () => {
    setupPhase1Page();

    for (const id of ['actual-area', 'test-area', 'patch-button', 'back-button', 'forward-button', 'status']) {
      expect($(id)).not.toBe(null);
    }
    expect($('test-area').getAttribute('contenteditable')).toBe('true');
  });

  it('실제 영역의 VDOM으로 테스트 영역을 만든다: 구조는 같고 노드 객체는 다르다', () => {
    const before = allNodes(actualRoot());

    setupPhase1Page();

    expect(domToVdom(testRoot())).toEqual(domToVdom(actualRoot()));
    // 실제 영역 노드를 옮기거나 그대로 끼운 것이 아니라 새로 만든 것이다.
    const testNodes = allNodes(testRoot());
    for (const node of before) {
      expect(testNodes).not.toContain(node);
    }
  });

  it('로드는 실제 영역을 건드리지 않는다 (주석 포함 모든 노드가 같은 객체)', () => {
    const before = allNodes(actualRoot());

    setupPhase1Page();

    const after = allNodes(actualRoot());
    expect(after.length).toBe(before.length);
    after.forEach((node, i) => expect(node).toBe(before[i]));
  });

  it('주석은 VDOM에 없으므로 테스트 영역에는 없다', () => {
    setupPhase1Page();

    expect($('actual-area').innerHTML).toContain('<!-- 할 일 카드');
    expect($('test-area').innerHTML).not.toContain('<!--');
  });

  it('처음에는 기록이 초기 화면 하나뿐이므로 뒤로가기·앞으로가기는 꺼져 있다', () => {
    setupPhase1Page();

    expect($('back-button').disabled).toBe(true);
    expect($('forward-button').disabled).toBe(true);
    expect($('patch-button').disabled).toBe(false);
  });

  it('실제 영역에 최상위 요소가 둘이면 오류를 보이고 Patch를 막는다', () => {
    $('actual-area').innerHTML = '<h1>a</h1><p>b</p>';

    setupPhase1Page();

    expect($('status').dataset.kind).toBe('error');
    expect($('status').textContent).toMatch(/실제 영역을 읽을 수 없습니다/);
    expect($('patch-button').disabled).toBe(true);
    expect($('test-area').childNodes.length).toBe(0);
  });
});

describe('검증 페이지 — 편집과 Patch (R-P1-06·07, History 저장 제외)', () => {
  beforeEach(() => {
    document.body.innerHTML = pageBody;
    setupPhase1Page();
  });

  it('테스트 영역을 고치기만 해서는 실제 영역이 바뀌지 않는다', () => {
    const html = $('actual-area').innerHTML;

    inTest('strong').firstChild.nodeValue = '1';
    inTest('li').removeAttribute('class');

    expect($('actual-area').innerHTML).toBe(html);
  });

  it('글자 하나를 고치고 Patch하면 그 텍스트만 바뀌고, 실제 영역의 모든 노드가 같은 객체로 남는다', () => {
    const before = allNodes(actualRoot());
    const strongText = inActual('strong').firstChild;

    inTest('strong').firstChild.nodeValue = '1';
    clickPatch();

    expect(strongText.nodeValue).toBe('1');
    const after = allNodes(actualRoot());
    expect(after.length).toBe(before.length);
    after.forEach((node, i) => expect(node).toBe(before[i]));
    expect($('status').dataset.kind).toBe('ok');
    expect($('status').textContent).toMatch(/^1개 변경 반영 — TEXT \[/);
  });

  it('속성·추가·삭제·태그 교체를 한 번에 Patch하면 실제 영역이 테스트 영역과 같은 구조가 되고, 주석과 바뀌지 않은 노드는 유지된다', () => {
    const keptH2 = inActual('h2');
    const keptButton = inActual('button');
    const removedLink = inActual('a');

    // ATTRS: 첫 할 일 완료 해제, 둘째 완료
    const items = testRoot().querySelectorAll('li');
    items[0].removeAttribute('class');
    items[1].setAttribute('class', 'done');
    // ADD: 할 일 추가
    const li = document.createElement('li');
    li.textContent = 'History 만들기';
    inTest('ul').appendChild(li);
    // REPLACE: <p> → <div>
    const p = inTest('p');
    const div = document.createElement('div');
    div.className = 'summary';
    div.textContent = '남은 일 3개';
    p.replaceWith(div);
    // REMOVE: 마지막 링크(와 그 앞 공백) 삭제
    const link = inTest('a');
    link.previousSibling.remove();
    link.remove();

    clickPatch();

    expect(domToVdom(actualRoot())).toEqual(domToVdom(testRoot()));
    expect($('actual-area').innerHTML).toContain('<!-- 할 일 카드');
    expect(inActual('h2')).toBe(keptH2);
    expect(inActual('button')).toBe(keptButton);
    expect(removedLink.isConnected).toBe(false);
    expect($('status').textContent).toMatch(/ATTRS.*ADD|ADD.*ATTRS/);
    expect($('status').textContent).toMatch(/REPLACE/);
    expect($('status').textContent).toMatch(/REMOVE/);
  });

  it('고치지 않고 Patch하면 "변경 없음"이고 실제 영역은 그대로다', () => {
    const html = $('actual-area').innerHTML;

    clickPatch();

    expect($('actual-area').innerHTML).toBe(html);
    expect($('status').textContent).toMatch(/변경 없음/);
  });

  it('두 번째 Patch는 첫 번째 Patch 결과(새 VDOM)와 비교해 새로 고친 것만 반영한다', () => {
    inTest('h2').firstChild.nodeValue = '내일 할 일';
    clickPatch();

    inTest('strong').firstChild.nodeValue = '5';
    clickPatch();

    expect($('status').textContent).toMatch(/^1개 변경 반영 — TEXT \[/);
    expect(inActual('h2').textContent).toBe('내일 할 일');
    expect(inActual('strong').textContent).toBe('5');

    clickPatch();
    expect($('status').textContent).toMatch(/변경 없음/);
  });

  it('루트 태그를 바꾸면 실제 영역의 같은 자리에서 루트가 교체되고, 다음 Patch도 새 루트에 적용된다', () => {
    const oldRoot = actualRoot();

    $('test-area').innerHTML = '<article class="card"><h2>새 카드</h2></article>';
    clickPatch();

    const newRoot = actualRoot();
    expect(newRoot).not.toBe(oldRoot);
    expect(newRoot.tagName).toBe('ARTICLE');
    expect(oldRoot.isConnected).toBe(false);
    expect($('status').textContent).toBe('1개 변경 반영 — REPLACE [] (기록 2 / 2)');

    inTest('h2').firstChild.nodeValue = '다시 고친 카드';
    clickPatch();

    expect(actualRoot()).toBe(newRoot);
    expect(newRoot.querySelector('h2').textContent).toBe('다시 고친 카드');
  });

  it('브라우저 편집처럼 테스트 영역을 통째로 다시 써도 구조로 비교한다 (같은 내용이면 변경 없음)', () => {
    const before = allNodes(actualRoot());

    // contenteditable 편집 중 브라우저가 노드를 새로 만들어도, 내용이 같으면 바뀐 것이 없다.
    $('test-area').innerHTML = $('test-area').innerHTML;
    clickPatch();

    expect($('status').textContent).toMatch(/변경 없음/);
    allNodes(actualRoot()).forEach((node, i) => expect(node).toBe(before[i]));
  });

  it('한계: 주석 사이 텍스트 두 개가 편집 중 하나로 합쳐지면 최소 변경은 아니지만 결과 구조는 맞다', () => {
    // 실제 영역: <p>a<!--c-->b</p> → VDOM children ['a', 'b'] (주석이 빠져 텍스트 둘이 이웃)
    $('actual-area').innerHTML = '<p>a<!--c-->b</p>';
    setupPhase1Page();
    expect(testRoot().childNodes.length).toBe(2); // 테스트 영역에도 텍스트 노드 둘

    // 브라우저가 이웃 텍스트를 합치면(normalize) VDOM children은 ['ab'] 하나가 된다.
    testRoot().normalize();
    clickPatch();

    expect($('status').textContent).toBe('2개 변경 반영 — TEXT [0] · REMOVE [1] (기록 2 / 2)');
    expect(domToVdom(actualRoot())).toEqual(domToVdom(testRoot()));
    expect($('actual-area').innerHTML).toBe('<p>ab<!--c--></p>');
  });

  it('테스트 영역 루트 앞뒤의 공백·주석은 무시한다', () => {
    $('test-area').innerHTML = `\n <!--메모-->  ${testRoot().outerHTML}  \n`;
    clickPatch();

    expect($('status').textContent).toMatch(/변경 없음/);
  });

  describe('최상위 규칙을 어기면 Patch하지 않는다', () => {
    const invalid = [
      ['전부 지움', ''],
      ['최상위 요소 둘', '<h1>a</h1><p>b</p>'],
      ['요소 밖 글자', '<section>a</section>뒤에 글자'],
      ['글자만', '그냥 글자'],
    ];

    for (const [name, html] of invalid) {
      it(`${name} → 오류를 보이고 실제 영역은 그대로다`, () => {
        const before = allNodes(actualRoot());
        const html0 = $('actual-area').innerHTML;

        $('test-area').innerHTML = html;
        clickPatch();

        expect($('status').dataset.kind).toBe('error');
        expect($('status').textContent).toMatch(/^Patch하지 않았습니다/);
        expect($('actual-area').innerHTML).toBe(html0);
        allNodes(actualRoot()).forEach((node, i) => expect(node).toBe(before[i]));
      });
    }

    it('오류 뒤 고쳐서 다시 Patch하면 마지막으로 반영된 VDOM과 비교한다', () => {
      inTest('h2').firstChild.nodeValue = 'A';
      clickPatch(); // 반영됨: 기준 VDOM = 제목 A

      const saved = testRoot().outerHTML;
      $('test-area').innerHTML = saved + '<p>둘째 루트</p>';
      clickPatch(); // 거부됨: 기준 VDOM은 그대로

      $('test-area').innerHTML = saved.replace('남은 일', '할 일');
      clickPatch();

      // 제목 A는 이미 반영됐으므로 이번에는 문단 글자 하나만 바뀐다.
      expect($('status').textContent).toMatch(/^1개 변경 반영 — TEXT \[/);
      expect(inActual('h2').textContent).toBe('A');
      expect(inActual('p').textContent).toMatch(/^할 일/);
    });
  });
});

describe('검증 페이지 — History 저장·이동 (R-P1-07·08)', () => {
  beforeEach(() => {
    document.body.innerHTML = pageBody;
    setupPhase1Page();
  });

  const vdomOfActual = () => domToVdom(actualRoot());
  const vdomOfTest = () => domToVdom(testRoot());
  const setText = (selector, text) => {
    inTest(selector).firstChild.nodeValue = text;
  };
  const status = () => $('status').textContent;
  const buttons = () => ({ back: !$('back-button').disabled, forward: !$('forward-button').disabled });

  // 두 영역이 모두 expected 화면인지 확인한다. (R-P1-08: 둘 다 함께 바뀜)
  function expectBothAreas(expected) {
    expect(vdomOfActual()).toEqual(expected);
    expect(vdomOfTest()).toEqual(expected);
  }

  it('변경이 있는 Patch만 기록한다: 기록이 둘이 되면 뒤로가기가 켜진다', () => {
    setText('h2', '내일 할 일');
    clickPatch();

    expect(status()).toMatch(/\(기록 2 \/ 2\)$/);
    expect(buttons()).toEqual({ back: true, forward: false });
  });

  it('변경 없는 Patch와 거부된 Patch는 기록하지 않는다', () => {
    clickPatch(); // 변경 없음
    expect(status()).toMatch(/기록도 남기지 않았습니다. \(기록 1 \/ 1\)$/);

    $('test-area').innerHTML = '<h1>a</h1><p>b</p>';
    clickPatch(); // 거부

    expect(buttons()).toEqual({ back: false, forward: false });
  });

  it('뒤로가기: 두 영역이 이전 화면이 되고, 실제 영역은 바뀐 노드만 되돌린다', () => {
    const v0 = vdomOfActual();
    const strongText = inActual('strong').firstChild;
    const h2 = inActual('h2');
    setText('strong', '1');
    clickPatch();

    $('back-button').click();

    expectBothAreas(v0);
    // 같은 텍스트 노드의 글자만 되돌렸다. 바뀌지 않은 요소와 주석도 같은 객체로 남는다.
    expect(inActual('strong').firstChild).toBe(strongText);
    expect(strongText.nodeValue).toBe('2');
    expect(inActual('h2')).toBe(h2);
    expect($('actual-area').innerHTML).toContain('<!-- 할 일 카드');
    expect(status()).toMatch(/^뒤로 이동: 1개 변경 반영 — TEXT \[.*\] \(기록 1 \/ 2\)$/);
    expect(buttons()).toEqual({ back: false, forward: true });
  });

  it('이동한 뒤에도 테스트 영역은 실제 영역과 다른 객체다 (VDOM으로 새로 만든다)', () => {
    setText('h2', 'X');
    clickPatch();
    $('back-button').click();

    const actualNodes = allNodes(actualRoot());
    for (const node of allNodes(testRoot())) {
      expect(actualNodes).not.toContain(node);
    }
  });

  it('앞으로가기: 되돌렸던 화면으로 두 영역이 다시 바뀐다', () => {
    setText('strong', '1');
    clickPatch();
    const v1 = vdomOfActual();

    $('back-button').click();
    $('forward-button').click();

    expectBothAreas(v1);
    expect(status()).toMatch(/^앞으로 이동: 1개 변경 반영 — TEXT \[.*\] \(기록 2 \/ 2\)$/);
    expect(buttons()).toEqual({ back: true, forward: false });
  });

  it('여러 번 Patch한 뒤 처음까지 뒤로, 끝까지 앞으로 가면 매 단계 두 영역이 그 기록과 같다', () => {
    const versions = [vdomOfActual()];
    setText('h2', 'A');
    clickPatch();
    versions.push(vdomOfActual());
    inTest('li').removeAttribute('class');
    inTest('ul').appendChild(document.createElement('li')).textContent = '새 일';
    clickPatch();
    versions.push(vdomOfActual());
    $('test-area').innerHTML = '<article><p>완전히 다른 화면</p></article>'; // 루트 교체
    clickPatch();
    versions.push(vdomOfActual());

    for (let i = versions.length - 2; i >= 0; i--) {
      $('back-button').click();
      expectBothAreas(versions[i]);
      expect(status()).toMatch(new RegExp(`\\(기록 ${i + 1} / 4\\)$`));
    }
    expect(buttons()).toEqual({ back: false, forward: true });

    for (let i = 1; i < versions.length; i++) {
      $('forward-button').click();
      expectBothAreas(versions[i]);
    }
    expect(buttons()).toEqual({ back: true, forward: false });
  });

  it('루트를 교체한 기록을 오가도 실제 영역 안 같은 자리에서 루트가 바뀌고, 이어서 Patch할 수 있다', () => {
    $('test-area').innerHTML = '<article><h2>새 카드</h2></article>';
    clickPatch();

    $('back-button').click();
    expect(actualRoot().tagName).toBe('SECTION');
    expect($('actual-area').querySelectorAll('section, article').length).toBe(1);

    $('forward-button').click();
    expect(actualRoot().tagName).toBe('ARTICLE');

    setText('h2', '이어서 고침');
    clickPatch();
    expect(inActual('h2').textContent).toBe('이어서 고침');
  });

  it('과거 위치에서 새로 Patch하면 그 뒤 기록은 버려지고 앞으로가기가 꺼진다', () => {
    const v0 = vdomOfActual();
    setText('h2', 'v1');
    clickPatch();
    const v1 = vdomOfActual();
    setText('h2', 'v2');
    clickPatch();

    $('back-button').click(); // v1에 있음 (기록 2 / 3)
    setText('h2', 'v3');
    clickPatch();

    expect(status()).toMatch(/\(기록 3 \/ 3\)$/);
    expect(buttons()).toEqual({ back: true, forward: false });
    expect(inActual('h2').textContent).toBe('v3');

    $('back-button').click();
    expectBothAreas(v1);
    $('back-button').click();
    expectBothAreas(v0);
    // v2로 갈 길은 없다: 끝까지 앞으로 가면 v3이다.
    $('forward-button').click();
    $('forward-button').click();
    expect(inActual('h2').textContent).toBe('v3');
    expect(buttons().forward).toBe(false);
  });

  it('Patch하지 않은 편집은 이동하면 덮어쓰인다', () => {
    const v0 = vdomOfActual();
    setText('h2', 'v1');
    clickPatch();
    const v1 = vdomOfActual();

    setText('h2', '반영 안 한 편집');
    $('back-button').click();
    expectBothAreas(v0);

    $('forward-button').click();
    expectBothAreas(v1);
    expect(inTest('h2').textContent).toBe('v1');
  });

  it('이동 후 테스트 영역을 고쳐 Patch해도 저장된 과거 화면은 바뀌지 않는다 (스냅샷 독립)', () => {
    const v0 = vdomOfActual();
    setText('h2', 'v1');
    clickPatch();

    $('back-button').click();
    setText('strong', '9');
    inTest('li').setAttribute('class', 'changed');
    clickPatch(); // 기록: [v0, 새 화면]

    $('back-button').click();
    expectBothAreas(v0);
  });
});
