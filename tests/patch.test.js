import { describe, it, expect } from 'vitest';
import { patch, getNodeByPath } from '../src/patch.js';
import { diff } from '../src/diff.js';
import { domToVdom } from '../src/domToVdom.js';
import { vdomToDom } from '../src/vdomToDom.js';

function fromHTML(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return wrapper.firstChild;
}

// root 아래의 모든 노드(주석 포함)를 순서대로 모은다. 패치 전후로 같은 객체인지 비교할 때 쓴다.
function allNodes(root) {
  const nodes = [root];
  for (const child of root.childNodes) {
    nodes.push(...allNodes(child));
  }
  return nodes;
}

// 패치 후에도 노드 개수·순서가 같고, 각 자리의 노드가 패치 전과 같은 객체(===)인지 확인한다.
// (before는 패치 전에 모은 배열. 객체 자체는 패치로 내용이 바뀌므로 toEqual이 아니라 toBe로 비교해야 의미가 있다.)
function expectSameNodes(root, before) {
  const after = allNodes(root);
  expect(after.length).toBe(before.length);
  after.forEach((node, i) => expect(node).toBe(before[i]));
}

describe('getNodeByPath — VDOM path로 실제 DOM 노드 찾기', () => {
  it('path []는 root 자신이다', () => {
    const root = fromHTML('<p>hi</p>');

    expect(getNodeByPath(root, [])).toBe(root);
  });

  it('주석이 없으면 childNodes 인덱스를 차례로 따라간다', () => {
    const root = fromHTML('<div><h1>t</h1><p>hi <b>there</b></p></div>');

    expect(getNodeByPath(root, [1, 1, 0])).toBe(root.childNodes[1].childNodes[1].firstChild);
  });

  it('주석은 세지 않는다 (VDOM에 없는 노드이므로)', () => {
    const root = fromHTML('<ul><!--first--><li>a</li><!--between--><li>b</li></ul>');

    // DOM childNodes로는 [3]이지만 VDOM path로는 [1]이다.
    expect(getNodeByPath(root, [1])).toBe(root.childNodes[3]);
    expect(getNodeByPath(root, [1, 0]).nodeValue).toBe('b');
  });

  it('깊은 곳 여러 단계에 주석이 있어도 VDOM path와 같은 노드를 찾는다', () => {
    const root = fromHTML(
      '<div><!--a--><section><!--b--><p>x</p><!--c--><p><!--d-->y<i>z</i></p></section></div>',
    );
    const vdom = domToVdom(root);

    // VDOM: div > [section > [p(x), p([y, i(z)])]]
    expect(vdom.children[0].children[1].children[1].children[0].text).toBe('z');
    expect(getNodeByPath(root, [0, 1, 1, 0]).nodeValue).toBe('z');
    expect(getNodeByPath(root, [0, 1, 0]).nodeValue).toBe('y');
  });

  it('공백 텍스트 노드는 VDOM에 있으므로 센다', () => {
    const root = fromHTML('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>');

    // VDOM children: ['\n  ', li(a), '\n  ', li(b), '\n']
    expect(getNodeByPath(root, [3, 0]).nodeValue).toBe('b');
  });

  it('VDOM의 모든 path가 DOM에서 같은 내용의 노드를 가리킨다 (주석 섞인 트리)', () => {
    const root = fromHTML(
      '<div id="r"><!--x--> <p class="a">one<!--y--><b>two</b></p><!--z--><ul><li>3</li><!--w--><li>4</li></ul></div>',
    );
    const vdom = domToVdom(root);

    // VDOM을 돌며 path마다 DOM 노드를 찾아 다시 VDOM으로 바꿔 비교한다.
    function check(vnode, path) {
      expect(domToVdom(getNodeByPath(root, path))).toEqual(vnode);
      if (vnode.type === 'element') {
        vnode.children.forEach((child, i) => check(child, [...path, i]));
      }
    }
    check(vdom, []);
  });

  it('없는 path면 에러를 던진다', () => {
    const root = fromHTML('<ul><!--c--><li>a</li></ul>');

    expect(() => getNodeByPath(root, [1])).toThrow(/path \[1\]/);
    expect(() => getNodeByPath(root, [0, 0, 0])).toThrow(/깊이 2/);
  });
});

describe('patch — TEXT 적용', () => {
  it('텍스트 노드의 글자만 바꾸고 노드 객체는 그대로 둔다', () => {
    const root = fromHTML('<p>hello</p>');
    const textNode = root.firstChild;

    patch(root, [{ type: 'TEXT', path: [0], text: 'bye' }]);

    expect(root.firstChild).toBe(textNode);
    expect(textNode.nodeValue).toBe('bye');
  });

  it('빈 문자열로 바꿔도 텍스트 노드는 남는다', () => {
    const root = fromHTML('<p>hello<b>x</b></p>');
    const textNode = root.firstChild;

    patch(root, [{ type: 'TEXT', path: [0], text: '' }]);

    expect(root.childNodes.length).toBe(2);
    expect(root.firstChild).toBe(textNode);
    expect(root.innerHTML).toBe('<b>x</b>');
  });

  it('공백을 그대로 넣는다', () => {
    const root = fromHTML('<p>a</p>');

    patch(root, [{ type: 'TEXT', path: [0], text: '  a\n b ' }]);

    expect(root.firstChild.nodeValue).toBe('  a\n b ');
  });

  it('루트가 텍스트 노드면 path []로 그 노드를 고친다', () => {
    const root = document.createTextNode('hi');

    expect(patch(root, [{ type: 'TEXT', path: [], text: 'bye' }])).toBe(root);
    expect(root.nodeValue).toBe('bye');
  });

  it('주석이 끼어 있어도 VDOM path의 텍스트를 고치고, 주석·형제는 그대로 둔다', () => {
    const root = fromHTML('<ul><!--c1--><li>a</li><!--c2--><li>b</li><li>c</li></ul>');
    const before = allNodes(root);

    patch(root, [{ type: 'TEXT', path: [1, 0], text: 'B' }]);

    expect(root.outerHTML).toBe('<ul><!--c1--><li>a</li><!--c2--><li>B</li><li>c</li></ul>');
    expectSameNodes(root, before);
  });
});

describe('patch — ATTRS 적용', () => {
  it('set의 속성을 추가·변경하고 remove의 속성을 지운다', () => {
    const root = fromHTML('<div id="x" class="a" title="keep"></div>');

    patch(root, [{ type: 'ATTRS', path: [], set: { class: 'b', 'data-n': '1' }, remove: ['id'] }]);

    expect(domToVdom(root).attrs).toEqual({ class: 'b', title: 'keep', 'data-n': '1' });
  });

  it("disabled: ''를 set하면 '있는' 속성이 되고, remove하면 사라진다", () => {
    const root = fromHTML('<button>ok</button>');

    patch(root, [{ type: 'ATTRS', path: [], set: { disabled: '' }, remove: [] }]);
    expect(root.hasAttribute('disabled')).toBe(true);
    expect(root.disabled).toBe(true);

    patch(root, [{ type: 'ATTRS', path: [], set: {}, remove: ['disabled'] }]);
    expect(root.hasAttribute('disabled')).toBe(false);
  });

  it('data-* 속성은 dataset에도 반영된다', () => {
    const root = fromHTML('<li data-id="1">a</li>');

    patch(root, [{ type: 'ATTRS', path: [], set: { 'data-id': '2', 'data-user-name': 'kim' }, remove: [] }]);

    expect(root.dataset.id).toBe('2');
    expect(root.dataset.userName).toBe('kim');
  });

  it('요소 객체와 그 자식·형제는 그대로 둔다', () => {
    const root = fromHTML('<ul><li class="a">one</li><!--c--><li><a href="/old">two</a></li><li>three</li></ul>');
    const before = allNodes(root);

    patch(root, [{ type: 'ATTRS', path: [1, 0], set: { href: '/new' }, remove: [] }]);

    expect(root.outerHTML).toBe('<ul><li class="a">one</li><!--c--><li><a href="/new">two</a></li><li>three</li></ul>');
    expectSameNodes(root, before);
  });
});

describe('patch — diff 결과를 그대로 적용', () => {
  it('빈 patch 목록이면 아무것도 바꾸지 않고 root를 돌려준다', () => {
    const root = fromHTML('<p class="a">hi<!--c--></p>');
    const html = root.outerHTML;

    expect(patch(root, [])).toBe(root);
    expect(root.outerHTML).toBe(html);
  });

  it('주석 섞인 원본 DOM에 TEXT·ATTRS를 적용하면 새 VDOM과 같아지고, 모든 노드 객체와 주석이 유지된다', () => {
    const root = fromHTML(`<section id="old" class="card">
  <!-- 제목 -->
  <h1>Title</h1>
  <ul><!--목록--><li class="on">one</li><li>two</li><!--끝--><li><a href="/3">three</a></li></ul>
  <button disabled>ok</button>
</section>`);
    const newVdom = domToVdom(
      fromHTML(`<section class="card" data-v="2">
  <!-- 주석은 VDOM에 없으므로 내용이 달라도 상관없다 -->
  <h1>New Title</h1>
  <ul><li>ONE</li><li data-new="">two</li><li><a href="/3" title="t">THREE</a></li></ul>
  <button>ok</button>
</section>`),
    );
    const before = allNodes(root);
    const patches = diff(domToVdom(root), newVdom);

    // TEXT·ATTRS만 나오는 변경이므로 모든 노드가 같은 객체로 남아야 한다.
    expect(new Set(patches.map((p) => p.type))).toEqual(new Set(['TEXT', 'ATTRS']));

    const result = patch(root, patches);

    expect(result).toBe(root);
    expect(domToVdom(root)).toEqual(newVdom);
    expectSameNodes(root, before);
    expect(root.innerHTML).toContain('<!-- 제목 -->');
    expect(root.innerHTML).toContain('<!--목록-->');
    expect(root.innerHTML).toContain('<!--끝-->');
  });
});

// 패치 전 노드 중 "사라져야 할 것(교체·삭제 대상과 그 자손)"을 빼면,
// 나머지는 패치 후에도 같은 객체로, 같은 상대 순서로 root 안에 남아 있어야 한다.
// gone: 사라져야 할 노드 배열 (패치 전에 getNodeByPath로 찾아 둔다)
function expectKeptExcept(root, before, gone) {
  const goneSet = new Set(gone.flatMap((node) => allNodes(node)));
  const kept = before.filter((node) => !goneSet.has(node));
  const after = allNodes(root);

  // 남아야 할 노드가 after 안에 같은 순서로 들어 있는지(부분 수열인지) 확인한다.
  const positions = kept.map((node) => after.indexOf(node));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));

  // 사라져야 할 노드는 root 안에 없다.
  for (const node of goneSet) {
    expect(after).not.toContain(node);
  }
}

const t = (text) => ({ type: 'text', text });
const e = (tag, attrs = {}, children = []) => ({ type: 'element', tag, attrs, children });

describe('patch — REPLACE 적용', () => {
  it('중첩 위치의 노드만 새 노드로 갈아 끼우고, 주석·형제는 그대로 둔다', () => {
    const root = fromHTML('<div><!--a--><p>x</p><!--b--><span>y</span></div>');
    const before = allNodes(root);
    const target = getNodeByPath(root, [0]); // <p>
    const newNode = e('h2', { class: 'k' }, [t('X')]);

    const result = patch(root, [{ type: 'REPLACE', path: [0], node: newNode }]);

    expect(result).toBe(root);
    expect(root.outerHTML).toBe('<div><!--a--><h2 class="k">X</h2><!--b--><span>y</span></div>');
    expect(target.parentNode).toBe(null); // 옛 노드는 떼어졌다
    expectKeptExcept(root, before, [target]);
  });

  it('text ↔ element 교체도 같은 자리에서 한다', () => {
    const root = fromHTML('<p>hi<!--c--><b>x</b></p>');

    patch(root, [
      { type: 'REPLACE', path: [0], node: e('i', {}, [t('hi')]) },
      { type: 'REPLACE', path: [1], node: t('x') },
    ]);

    expect(root.outerHTML).toBe('<p><i>hi</i><!--c-->x</p>');
  });

  it('루트를 교체하면 실제 부모 DOM의 자리도 바뀌고, 새 루트를 돌려준다', () => {
    const container = document.createElement('div');
    container.innerHTML = '<!--앞--><p class="a">hi</p><!--뒤-->';
    const [before, oldRoot, after] = container.childNodes;

    const result = patch(oldRoot, [{ type: 'REPLACE', path: [], node: e('section', {}, [t('new')]) }]);

    expect(result).not.toBe(oldRoot);
    expect(result.outerHTML).toBe('<section>new</section>');
    expect(container.childNodes[1]).toBe(result); // 부모 안에서 같은 자리
    expect(container.innerHTML).toBe('<!--앞--><section>new</section><!--뒤-->');
    expect(container.childNodes[0]).toBe(before); // 루트 앞뒤 형제(주석)는 그대로
    expect(container.childNodes[2]).toBe(after);
    expect(oldRoot.parentNode).toBe(null);
  });

  it('부모가 없는 루트를 교체하면 새 노드를 돌려준다', () => {
    const root = fromHTML('<p>hi</p>');
    root.remove();

    const result = patch(root, [{ type: 'REPLACE', path: [], node: t('text') }]);

    expect(result.nodeType).toBe(Node.TEXT_NODE);
    expect(result.nodeValue).toBe('text');
  });

  it('돌려받은 새 루트로 다음 patch를 이어서 적용할 수 있다', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>hi</p>';
    let root = container.firstChild;

    const v1 = domToVdom(root);
    const v2 = e('div', { id: 'r' }, [t('one')]);
    const v3 = e('div', { id: 'r2' }, [t('two'), e('b', {}, [t('!')])]);

    root = patch(root, diff(v1, v2)); // 루트 교체
    root = patch(root, diff(v2, v3)); // 새 루트 위에서 ATTRS·TEXT·ADD

    expect(container.innerHTML).toBe('<div id="r2">two<b>!</b></div>');
    expect(container.firstChild).toBe(root);
  });
});

describe('patch — ADD 적용', () => {
  it('빈 부모에 여러 자식을 오름차순으로 붙인다', () => {
    const root = fromHTML('<ul></ul>');

    patch(root, [
      { type: 'ADD', path: [0], node: e('li', {}, [t('a')]) },
      { type: 'ADD', path: [1], node: e('li', {}, [t('b')]) },
    ]);

    expect(root.outerHTML).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('주석이 섞여 있어도 VDOM 기준 끝에 붙이고, 기존 노드·주석은 그대로 둔다', () => {
    // VDOM children: [li(a)] → ADD [1], [2]. DOM의 끝(마지막 주석 뒤)에 붙는다.
    const root = fromHTML('<ul><!--c1--><li>a</li><!--끝--></ul>');
    const before = allNodes(root);

    patch(root, [
      { type: 'ADD', path: [1], node: e('li', {}, [t('b')]) },
      { type: 'ADD', path: [2], node: e('li', {}, [t('c')]) },
    ]);

    expect(root.outerHTML).toBe('<ul><!--c1--><li>a</li><!--끝--><li>b</li><li>c</li></ul>');
    expect(domToVdom(root)).toEqual(e('ul', {}, ['a', 'b', 'c'].map((x) => e('li', {}, [t(x)]))));
    expectKeptExcept(root, before, []);
  });

  it('중첩된 부모에도 주석을 건너뛰어 찾아 붙인다', () => {
    const root = fromHTML('<div><!--x--><p>1</p><!--y--><ul></ul></div>');

    patch(root, [{ type: 'ADD', path: [1, 0], node: e('li', {}, [t('a')]) }]);

    expect(root.outerHTML).toBe('<div><!--x--><p>1</p><!--y--><ul><li>a</li></ul></div>');
  });

  it('VDOM 자식 수보다 큰 위치에 ADD하면 에러를 던진다', () => {
    const root = fromHTML('<ul><li>a</li><!--c--></ul>');

    expect(() => patch(root, [{ type: 'ADD', path: [2], node: t('x') }])).toThrow(/자식 수\(1\)/);
  });
});

describe('patch — REMOVE 적용', () => {
  it('여러 노드를 내림차순으로 지우고, 주석과 남는 형제는 그대로 둔다', () => {
    const root = fromHTML('<ul><li>a</li><!--c1--><li>b</li><!--c2--><li>c</li><li>d</li></ul>');
    const before = allNodes(root);
    const gone = [getNodeByPath(root, [3]), getNodeByPath(root, [2]), getNodeByPath(root, [1])];

    patch(root, [
      { type: 'REMOVE', path: [3] },
      { type: 'REMOVE', path: [2] },
      { type: 'REMOVE', path: [1] },
    ]);

    expect(root.outerHTML).toBe('<ul><li>a</li><!--c1--><!--c2--></ul>');
    expectKeptExcept(root, before, gone);
  });

  it('모든 자식을 지우면 주석만 남는다', () => {
    const root = fromHTML('<p><!--keep-->x<b>y</b></p>');

    patch(root, diff(domToVdom(root), e('p')));

    expect(root.outerHTML).toBe('<p><!--keep--></p>');
  });

  it('루트는 REMOVE할 수 없다', () => {
    expect(() => patch(fromHTML('<p></p>'), [{ type: 'REMOVE', path: [] }])).toThrow(/루트는 REMOVE/);
  });
});

describe('patch — 다섯 종류 patch 통합', () => {
  // 패치 전 DOM에서 교체·삭제 대상 노드를 찾아 둔다(적용 순서대로 찾으면 path가 이미 바뀌므로, 미리 찾는다).
  // REMOVE는 내림차순이라 앞의 REMOVE가 뒤 path에 영향을 주지 않고, REPLACE·ADD는 다른 형제의 위치를 바꾸지 않는다.
  function targetsOf(root, patches) {
    return patches
      .filter((p) => p.type === 'REPLACE' || p.type === 'REMOVE')
      .map((p) => getNodeByPath(root, p.path));
  }

  it('주석 섞인 원본 DOM에 diff 결과를 적용하면 새 VDOM과 같아지고, 교체·삭제 대상 외 노드는 유지된다', () => {
    const root = fromHTML(`<section id="old" class="card">
  <!-- 머리 -->
  <h1>Title</h1>
  <ul><!--목록--><li class="on">one</li><li>two</li><!--중간--><li>three</li><li>four</li></ul>
  <ol><li>x</li><!--끝--></ol>
  <p>keep <b>this</b></p>
</section>`);
    const newVdom = domToVdom(
      fromHTML(`<section class="card" data-v="2">
  <!-- 주석은 VDOM에 없다 -->
  <h2>Title</h2>
  <ul><li>ONE</li><li data-new="">two</li></ul>
  <ol><li>x</li><li>y</li><li>z</li></ol>
  <p>keep <b>this</b></p>
</section>`),
    );

    const patches = diff(domToVdom(root), newVdom);
    expect(new Set(patches.map((p) => p.type))).toEqual(new Set(['TEXT', 'ATTRS', 'REPLACE', 'ADD', 'REMOVE']));

    const before = allNodes(root);
    const gone = targetsOf(root, patches);
    const result = patch(root, patches);

    expect(result).toBe(root);
    expect(domToVdom(root)).toEqual(newVdom);
    expectKeptExcept(root, before, gone);
    for (const comment of ['<!-- 머리 -->', '<!--목록-->', '<!--중간-->', '<!--끝-->']) {
      expect(root.innerHTML).toContain(comment);
    }
  });

  it('루트 교체를 포함한 여러 번의 patch를 이어서 해도 매번 새 VDOM과 같다 (실제 영역 시나리오)', () => {
    const container = document.createElement('div');
    container.innerHTML = '<!--실제 영역--><ul><li>a</li></ul>';
    let root = container.childNodes[1];
    let current = domToVdom(root);

    const versions = [
      '<ul class="x"><li>A</li><li>b</li><li>c</li></ul>', // ATTRS·TEXT·ADD
      '<ul><li>A</li></ul>', // ATTRS·REMOVE
      '<ol><li>A</li></ol>', // 루트 REPLACE
      '<ol><p>A</p><li>new</li></ol>', // REPLACE·ADD
      '<ol></ol>', // REMOVE 전부
    ];

    for (const html of versions) {
      const next = domToVdom(fromHTML(html));
      root = patch(root, diff(current, next));
      current = next;

      expect(domToVdom(root)).toEqual(next);
      expect(container.childNodes[1]).toBe(root); // 부모 DOM 안의 자리도 함께 갱신
      expect(container.firstChild.nodeType).toBe(Node.COMMENT_NODE);
    }
  });

  const cases = [
    ['빈 → 여러', '<ul><!--c--></ul>', '<ul><li>a</li><li>b</li></ul>'],
    ['여러 → 빈', '<ul><li>a</li><!--c--><li>b</li></ul>', '<ul></ul>'],
    ['변경 + 추가', '<ul id="x"><!--c--><li>a</li></ul>', '<ul><li class="k">A</li><li>b</li><li>c</li></ul>'],
    ['변경 + 삭제', '<ul><li>a</li><!--c--><li>b</li><li>c</li><li>d</li></ul>', '<ul><p>a</p><li>B</li></ul>'],
    [
      '여러 깊이에서 추가·삭제·교체',
      '<div><!--1--><ul><li>a</li><!--2--><li>b</li></ul><p>x<!--3--><b>y</b></p></div>',
      '<div><ul><li>a</li><li>b</li><li>c</li></ul><p>x</p><span>new</span></div>',
    ],
  ];

  for (const [name, beforeHTML, afterHTML] of cases) {
    it(`주석 포함: ${name}`, () => {
      const root = fromHTML(beforeHTML);
      const newVdom = domToVdom(fromHTML(afterHTML));
      const patches = diff(domToVdom(root), newVdom);
      const before = allNodes(root);
      const gone = targetsOf(root, patches);

      patch(root, patches);

      expect(domToVdom(root)).toEqual(newVdom);
      expectKeptExcept(root, before, gone);
    });
  }
});

describe('patch — 알 수 없는 patch', () => {
  it('모르는 type이면 에러를 던진다', () => {
    expect(() => patch(fromHTML('<p></p>'), [{ type: 'MOVE', path: [0] }])).toThrow(/알 수 없는 patch 종류/);
  });
});

describe('patch — EVENTS 적용 (Phase 2)', () => {
  function button(events) {
    return vdomToDom({ type: 'element', tag: 'button', attrs: {}, events, children: [] });
  }

  it('set은 옛 핸들러를 떼고 새 핸들러를 붙인다. 요소 객체는 그대로다', () => {
    const calls = [];
    const root = button({ click: () => calls.push('old') });

    const result = patch(root, [{ type: 'EVENTS', path: [], set: { click: () => calls.push('new') }, remove: [] }]);
    root.click();

    expect(result).toBe(root);
    expect(calls).toEqual(['new']);
  });

  it('remove는 핸들러를 뗀다. 없는 이벤트를 remove해도 에러가 없다', () => {
    const calls = [];
    const root = button({ click: () => calls.push('click') });

    patch(root, [{ type: 'EVENTS', path: [], set: {}, remove: ['click', 'input'] }]);
    root.click();

    expect(calls).toEqual([]);
  });

  it('주석이 섞인 자식에서도 path로 찾은 요소에만 적용한다', () => {
    const calls = [];
    const root = fromHTML('<div><!--c--><button>a</button><!--c--><button>b</button></div>');

    patch(root, [{ type: 'EVENTS', path: [1], set: { click: () => calls.push('b') }, remove: [] }]);
    root.childNodes[1].click();
    root.childNodes[3].click();

    expect(calls).toEqual(['b']);
  });
});
