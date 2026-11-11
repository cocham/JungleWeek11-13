import { describe, it, expect } from 'vitest';
import { diff } from '../src/diff.js';
import { domToVdom } from '../src/domToVdom.js';

function fromHTML(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return wrapper.firstChild;
}

describe('diff — 변경 없음', () => {
  it('같은 텍스트 노드는 빈 배열을 돌려준다', () => {
    expect(diff({ type: 'text', text: 'hello' }, { type: 'text', text: 'hello' })).toEqual([]);
  });

  it('빈 문자열·공백 텍스트도 같으면 빈 배열이다', () => {
    expect(diff({ type: 'text', text: '' }, { type: 'text', text: '' })).toEqual([]);
    expect(diff({ type: 'text', text: '\n  ' }, { type: 'text', text: '\n  ' })).toEqual([]);
  });

  it('같은 요소(속성·자식 없음)는 빈 배열이다', () => {
    const vdom = () => ({ type: 'element', tag: 'div', attrs: {}, children: [] });

    expect(diff(vdom(), vdom())).toEqual([]);
  });

  it('같은 객체를 자기 자신과 비교해도 빈 배열이다', () => {
    const vdom = domToVdom(fromHTML('<p>hi <b>there</b></p>'));

    expect(diff(vdom, vdom)).toEqual([]);
  });

  it('속성의 키 순서가 달라도 내용이 같으면 변경 없음이다', () => {
    const a = { type: 'element', tag: 'input', attrs: { id: 'x', type: 'text' }, children: [] };
    const b = { type: 'element', tag: 'input', attrs: { type: 'text', id: 'x' }, children: [] };

    expect(diff(a, b)).toEqual([]);
  });

  it('같은 HTML을 두 번 변환한 VDOM(서로 다른 객체)은 변경 없음이다', () => {
    const html = `<section class="card" data-id="1">
  <h1>Title</h1>
  <ul>
    <li>one</li>
    <li><a href="/two">two</a> <b>!</b></li>
  </ul>
  <button disabled>ok</button>
</section>`;
    const oldVdom = domToVdom(fromHTML(html));
    const newVdom = domToVdom(fromHTML(html));

    expect(oldVdom).not.toBe(newVdom);
    expect(diff(oldVdom, newVdom)).toEqual([]);
  });
});

describe('diff — 텍스트 변경(TEXT)', () => {
  it('루트가 텍스트 노드면 path는 []다', () => {
    expect(diff({ type: 'text', text: 'hello' }, { type: 'text', text: 'bye' })).toEqual([
      { type: 'TEXT', path: [], text: 'bye' },
    ]);
  });

  it('루트 요소의 직계 텍스트 자식은 path [0]이다', () => {
    const oldVdom = domToVdom(fromHTML('<p>hello</p>'));
    const newVdom = domToVdom(fromHTML('<p>bye</p>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'TEXT', path: [0], text: 'bye' }]);
  });

  it('중첩된 텍스트는 내려간 인덱스를 모두 path에 담는다', () => {
    // div → children[1](p) → children[1](b) → children[0](텍스트)
    const oldVdom = domToVdom(fromHTML('<div><h1>t</h1><p>hi <b>there</b></p></div>'));
    const newVdom = domToVdom(fromHTML('<div><h1>t</h1><p>hi <b>you</b></p></div>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'TEXT', path: [1, 1, 0], text: 'you' }]);
  });

  it('빈 문자열로 바뀌어도 TEXT patch를 만든다', () => {
    // 같은 VDOM 구조를 유지하려고 직접 만든다. innerHTML '<p></p>'는 텍스트 노드 자체가 없다.
    const oldVdom = { type: 'element', tag: 'p', attrs: {}, children: [{ type: 'text', text: 'hello' }] };
    const newVdom = { type: 'element', tag: 'p', attrs: {}, children: [{ type: 'text', text: '' }] };

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'TEXT', path: [0], text: '' }]);
  });

  it('공백만 바뀌어도 변경으로 본다', () => {
    expect(diff({ type: 'text', text: 'a b' }, { type: 'text', text: 'a  b' })).toEqual([
      { type: 'TEXT', path: [], text: 'a  b' },
    ]);
  });

  it('여러 텍스트가 동시에 바뀌면 트리 순서(깊이 우선)대로 모두 담는다', () => {
    const oldVdom = domToVdom(fromHTML('<ul><li>one</li><li>two</li><li><b>three</b></li></ul>'));
    const newVdom = domToVdom(fromHTML('<ul><li>ONE</li><li>two</li><li><b>THREE</b></li></ul>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'TEXT', path: [0, 0], text: 'ONE' },
      { type: 'TEXT', path: [2, 0, 0], text: 'THREE' },
    ]);
  });

  it('patch의 path는 서로 다른 배열이다 (하나를 고쳐도 다른 patch에 영향 없음)', () => {
    const oldVdom = domToVdom(fromHTML('<p><i>a</i><i>b</i></p>'));
    const newVdom = domToVdom(fromHTML('<p><i>A</i><i>B</i></p>'));
    const [first, second] = diff(oldVdom, newVdom);

    first.path.push(99);

    expect(second.path).toEqual([1, 0]);
  });
});

// 속성만 다른 요소를 간단히 만드는 도우미
function el(attrs, children = []) {
  return { type: 'element', tag: 'div', attrs, children };
}

describe('diff — 속성 변경(ATTRS)', () => {
  it('속성 추가는 set에 담는다', () => {
    expect(diff(el({}), el({ id: 'x' }))).toEqual([
      { type: 'ATTRS', path: [], set: { id: 'x' }, remove: [] },
    ]);
  });

  it('속성 값 변경은 set에 새 값을 담는다', () => {
    expect(diff(el({ class: 'a' }), el({ class: 'b' }))).toEqual([
      { type: 'ATTRS', path: [], set: { class: 'b' }, remove: [] },
    ]);
  });

  it('속성 삭제는 remove에 이름을 담는다', () => {
    expect(diff(el({ id: 'x' }), el({}))).toEqual([
      { type: 'ATTRS', path: [], set: {}, remove: ['id'] },
    ]);
  });

  it('추가·변경·삭제가 한 요소에서 함께 일어나면 patch 하나로 모은다', () => {
    const oldVdom = el({ id: 'x', class: 'a', title: 'keep' });
    const newVdom = el({ class: 'b', title: 'keep', 'data-n': '1' });

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: { class: 'b', 'data-n': '1' }, remove: ['id'] },
    ]);
  });

  it('이름과 값이 뒤바뀌면 새 이름은 set, 옛 이름은 remove다', () => {
    expect(diff(el({ id: 'x' }), el({ x: 'id' }))).toEqual([
      { type: 'ATTRS', path: [], set: { x: 'id' }, remove: ['id'] },
    ]);
  });

  it('중첩된 요소의 속성 변경은 그 요소의 path를 갖는다', () => {
    const oldVdom = domToVdom(fromHTML('<ul><li>a</li><li><a href="/old">b</a></li></ul>'));
    const newVdom = domToVdom(fromHTML('<ul><li>a</li><li><a href="/new">b</a></li></ul>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [1, 0], set: { href: '/new' }, remove: [] },
    ]);
  });
});

describe('diff — 빈 문자열 속성값 vs 속성 삭제', () => {
  // disabled=""처럼 값이 ''인 속성은 "있는" 속성이다. 삭제와 섞이면 안 된다.
  it('값이 빈 문자열인 속성 추가는 set에 \'\'로 담는다 (remove 아님)', () => {
    const oldVdom = domToVdom(fromHTML('<button>ok</button>'));
    const newVdom = domToVdom(fromHTML('<button disabled>ok</button>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: { disabled: '' }, remove: [] },
    ]);
  });

  it('값이 빈 문자열인 속성의 삭제는 remove에 담는다', () => {
    const oldVdom = domToVdom(fromHTML('<button disabled>ok</button>'));
    const newVdom = domToVdom(fromHTML('<button>ok</button>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: {}, remove: ['disabled'] },
    ]);
  });

  it('값을 빈 문자열로 바꾸는 것은 삭제가 아니라 변경이다', () => {
    expect(diff(el({ title: 'hi' }), el({ title: '' }))).toEqual([
      { type: 'ATTRS', path: [], set: { title: '' }, remove: [] },
    ]);
  });

  it('빈 문자열 값이 그대로면 변경 없음이다', () => {
    expect(diff(el({ disabled: '' }), el({ disabled: '' }))).toEqual([]);
  });
});

describe('diff — 속성 변경과 텍스트 변경이 함께', () => {
  it('같은 요소의 속성과 그 자식 텍스트가 바뀌면 ATTRS가 TEXT보다 먼저 온다', () => {
    const oldVdom = domToVdom(fromHTML('<p class="a">hello</p>'));
    const newVdom = domToVdom(fromHTML('<p class="b">bye</p>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: { class: 'b' }, remove: [] },
      { type: 'TEXT', path: [0], text: 'bye' },
    ]);
  });

  it('여러 위치의 속성·텍스트 변경을 트리 순서(깊이 우선)대로 모두 담는다', () => {
    const oldVdom = domToVdom(
      fromHTML('<ul id="list"><li class="on">one</li><li>two</li><li><a href="/3">three</a></li></ul>'),
    );
    const newVdom = domToVdom(
      fromHTML('<ul><li>ONE</li><li data-new="">two</li><li><a href="/3" title="t">THREE</a></li></ul>'),
    );

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: {}, remove: ['id'] },
      { type: 'ATTRS', path: [0], set: {}, remove: ['class'] },
      { type: 'TEXT', path: [0, 0], text: 'ONE' },
      { type: 'ATTRS', path: [1], set: { 'data-new': '' }, remove: [] },
      { type: 'ATTRS', path: [2, 0], set: { title: 't' }, remove: [] },
      { type: 'TEXT', path: [2, 0, 0], text: 'THREE' },
    ]);
  });
});

describe('diff — 노드 교체(REPLACE)', () => {
  it('루트의 태그가 다르면 루트를 교체한다', () => {
    const oldVdom = domToVdom(fromHTML('<p>hi</p>'));
    const newVdom = domToVdom(fromHTML('<div>hi</div>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'REPLACE', path: [], node: newVdom }]);
  });

  it('루트가 text → element로 바뀌면 교체한다', () => {
    const oldVdom = { type: 'text', text: 'hi' };
    const newVdom = domToVdom(fromHTML('<b>hi</b>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'REPLACE', path: [], node: newVdom }]);
  });

  it('루트가 element → text로 바뀌면 교체한다', () => {
    const oldVdom = domToVdom(fromHTML('<b>hi</b>'));
    const newVdom = { type: 'text', text: 'hi' };

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'REPLACE', path: [], node: newVdom }]);
  });

  it('중첩된 요소의 태그가 다르면 그 위치만 교체한다', () => {
    const oldVdom = domToVdom(fromHTML('<div><section><p>a</p></section></div>'));
    const newVdom = domToVdom(fromHTML('<div><section><h2>a</h2></section></div>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'REPLACE', path: [0, 0], node: newVdom.children[0].children[0] },
    ]);
  });

  it('중첩된 자식이 text → element로 바뀌면 그 위치를 교체한다', () => {
    const oldVdom = domToVdom(fromHTML('<p>hi</p>'));
    const newVdom = domToVdom(fromHTML('<p><b>hi</b></p>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'REPLACE', path: [0], node: { type: 'element', tag: 'b', attrs: {}, children: [{ type: 'text', text: 'hi' }] } },
    ]);
  });

  it('중첩된 자식이 element → text로 바뀌면 그 위치를 교체한다', () => {
    const oldVdom = domToVdom(fromHTML('<p><b>hi</b></p>'));
    const newVdom = domToVdom(fromHTML('<p>hi</p>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'REPLACE', path: [0], node: { type: 'text', text: 'hi' } }]);
  });

  it('교체하는 노드의 속성·자식은 더 비교하지 않는다', () => {
    // 속성도 다르고 자식 개수도 다르다(2개 → 1개). 내려가 비교했다면 ATTRS·TEXT·REMOVE가 생겼을 것이다.
    const oldVdom = domToVdom(fromHTML('<p class="a">x<b>y</b></p>'));
    const newVdom = domToVdom(fromHTML('<div class="b">z</div>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'REPLACE', path: [], node: newVdom }]);
  });

  it('patch의 node는 새 VDOM의 그 노드다', () => {
    const oldVdom = domToVdom(fromHTML('<div><p>a</p></div>'));
    const newVdom = domToVdom(fromHTML('<div><span>a</span></div>'));

    expect(diff(oldVdom, newVdom)[0].node).toBe(newVdom.children[0]);
  });
});

describe('diff — 교체와 다른 형제의 변경이 함께', () => {
  it('교체된 형제와 상관없이 나머지 형제의 속성·텍스트 변경도 담는다', () => {
    const oldVdom = domToVdom(fromHTML('<ul><li class="a">one</li><li>two</li><li>three</li></ul>'));
    const newVdom = domToVdom(fromHTML('<ul><li class="b">ONE</li><p>two</p><li>THREE</li></ul>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [0], set: { class: 'b' }, remove: [] },
      { type: 'TEXT', path: [0, 0], text: 'ONE' },
      { type: 'REPLACE', path: [1], node: newVdom.children[1] },
      { type: 'TEXT', path: [2, 0], text: 'THREE' },
    ]);
  });

  it('부모의 속성 변경과 자식 교체가 함께 있으면 부모 ATTRS가 먼저 온다', () => {
    const oldVdom = domToVdom(fromHTML('<p id="x">hi <b>there</b></p>'));
    const newVdom = domToVdom(fromHTML('<p id="y">hi <i>there</i></p>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: { id: 'y' }, remove: [] },
      { type: 'REPLACE', path: [1], node: newVdom.children[1] },
    ]);
  });

  it('여러 형제가 각각 교체되면 형제 순서대로 담는다', () => {
    const oldVdom = domToVdom(fromHTML('<div><p>a</p>text<span>c</span></div>'));
    const newVdom = domToVdom(fromHTML('<div><h1>a</h1><b>text</b><span>c</span></div>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'REPLACE', path: [0], node: newVdom.children[0] },
      { type: 'REPLACE', path: [1], node: newVdom.children[1] },
    ]);
  });
});

// 자식 추가·삭제 테스트용 도우미
const li = (text) => ({ type: 'element', tag: 'li', attrs: {}, children: [{ type: 'text', text }] });
const ul = (children, attrs = {}) => ({ type: 'element', tag: 'ul', attrs, children });

describe('diff — 빈 자식 배열 ↔ 여러 자식', () => {
  it('빈 자식 → 자식 3개: ADD를 인덱스 오름차순으로 담는다', () => {
    const newVdom = ul([li('a'), li('b'), li('c')]);

    expect(diff(ul([]), newVdom)).toEqual([
      { type: 'ADD', path: [0], node: newVdom.children[0] },
      { type: 'ADD', path: [1], node: newVdom.children[1] },
      { type: 'ADD', path: [2], node: newVdom.children[2] },
    ]);
  });

  it('자식 3개 → 빈 자식: REMOVE를 인덱스 내림차순으로 담는다', () => {
    expect(diff(ul([li('a'), li('b'), li('c')]), ul([]))).toEqual([
      { type: 'REMOVE', path: [2] },
      { type: 'REMOVE', path: [1] },
      { type: 'REMOVE', path: [0] },
    ]);
  });

  it('HTML에서 만든 VDOM으로도 같다 (<ul></ul> ↔ <ul><li>a</li><li>b</li></ul>)', () => {
    const empty = domToVdom(fromHTML('<ul></ul>'));
    const full = domToVdom(fromHTML('<ul><li>a</li><li>b</li></ul>'));

    expect(diff(empty, full)).toEqual([
      { type: 'ADD', path: [0], node: full.children[0] },
      { type: 'ADD', path: [1], node: full.children[1] },
    ]);
    expect(diff(full, empty)).toEqual([
      { type: 'REMOVE', path: [1] },
      { type: 'REMOVE', path: [0] },
    ]);
  });

  it('ADD의 node는 새 VDOM의 그 노드(같은 객체)다', () => {
    const newVdom = ul([li('a')]);

    expect(diff(ul([]), newVdom)[0].node).toBe(newVdom.children[0]);
  });

  it('중첩된 요소의 자식 추가·삭제는 부모 path 뒤에 인덱스를 붙인다', () => {
    const oldVdom = domToVdom(fromHTML('<div><p>x</p><ul></ul></div>'));
    const newVdom = domToVdom(fromHTML('<div><p>x</p><ul><li>a</li></ul></div>'));

    expect(diff(oldVdom, newVdom)).toEqual([{ type: 'ADD', path: [1, 0], node: newVdom.children[1].children[0] }]);
    expect(diff(newVdom, oldVdom)).toEqual([{ type: 'REMOVE', path: [1, 0] }]);
  });
});

describe('diff — 기존 자식 변경과 추가·삭제가 함께', () => {
  it('공통 구간의 변경을 먼저 담고, 뒤에 늘어난 자식을 ADD로 담는다', () => {
    const oldVdom = ul([li('a'), li('b')]);
    const newVdom = ul([li('A'), li('b'), li('c'), li('d')]);

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'TEXT', path: [0, 0], text: 'A' },
      { type: 'ADD', path: [2], node: newVdom.children[2] },
      { type: 'ADD', path: [3], node: newVdom.children[3] },
    ]);
  });

  it('공통 구간의 변경을 먼저 담고, 뒤에 남는 옛 자식을 내림차순 REMOVE로 담는다', () => {
    const oldVdom = ul([li('a'), li('b'), li('c'), li('d')]);
    const newVdom = ul([li('a'), li('B')]);

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'TEXT', path: [1, 0], text: 'B' },
      { type: 'REMOVE', path: [3] },
      { type: 'REMOVE', path: [2] },
    ]);
  });

  it('부모 ATTRS → 공통 자식의 ATTRS·TEXT·REPLACE → ADD 순서다', () => {
    const oldVdom = domToVdom(fromHTML('<ul id="x"><li class="a">one</li><li>two</li></ul>'));
    const newVdom = domToVdom(fromHTML('<ul id="y"><li class="b">ONE</li><p>two</p><li>three</li></ul>'));

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'ATTRS', path: [], set: { id: 'y' }, remove: [] },
      { type: 'ATTRS', path: [0], set: { class: 'b' }, remove: [] },
      { type: 'TEXT', path: [0, 0], text: 'ONE' },
      { type: 'REPLACE', path: [1], node: newVdom.children[1] },
      { type: 'ADD', path: [2], node: newVdom.children[2] },
    ]);
  });

  it('key가 없으므로 맨 앞에 끼워 넣으면 같은 인덱스끼리 비교되어 TEXT들 + 끝에 ADD가 된다', () => {
    // 사람 눈에는 "앞에 x 추가"지만, 인덱스 비교에서는 0·1번 글자가 바뀌고 2번이 새로 생긴 것으로 보인다.
    const oldVdom = ul([li('a'), li('b')]);
    const newVdom = ul([li('x'), li('a'), li('b')]);

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'TEXT', path: [0, 0], text: 'x' },
      { type: 'TEXT', path: [1, 0], text: 'a' },
      { type: 'ADD', path: [2], node: newVdom.children[2] },
    ]);
  });

  it('여러 부모에서 추가·삭제가 함께 일어나면 각 부모 안에서 규칙대로, 트리 순서로 담는다', () => {
    // 0번 ul은 자식이 줄고(3 → 1), 1번 ul은 자식이 는다(1 → 3).
    const oldVdom = {
      type: 'element', tag: 'div', attrs: {},
      children: [ul([li('a'), li('b'), li('c')]), ul([li('p')])],
    };
    const newVdom = {
      type: 'element', tag: 'div', attrs: {},
      children: [ul([li('A')]), ul([li('p'), li('q'), li('r')])],
    };

    expect(diff(oldVdom, newVdom)).toEqual([
      { type: 'TEXT', path: [0, 0, 0], text: 'A' },
      { type: 'REMOVE', path: [0, 2] },
      { type: 'REMOVE', path: [0, 1] },
      { type: 'ADD', path: [1, 1], node: newVdom.children[1].children[1] },
      { type: 'ADD', path: [1, 2], node: newVdom.children[1].children[2] },
    ]);
  });

  it('삭제되는 자식의 안쪽은 비교하지 않는다', () => {
    // 1번 li 안쪽이 달라도(속성·글자) REMOVE 하나만 나온다.
    const gone = { type: 'element', tag: 'li', attrs: { class: 'z' }, children: [{ type: 'text', text: 'gone' }] };

    expect(diff(ul([li('a'), gone]), ul([li('a')]))).toEqual([{ type: 'REMOVE', path: [1] }]);
  });
});

describe('diff — patch를 순서대로 적용하면 새 트리가 된다', () => {
  // 실제 DOM 대신 VDOM 사본에 patch를 적용해 "path 기준·적용 순서" 약속이 맞는지 확인하는 테스트 전용 함수.
  // (실제 DOM Patch는 다음 작업 R-P1-03)
  function applyToVdom(root, patches) {
    root = structuredClone(root);
    for (const p of patches) {
      if (p.path.length === 0) {
        if (p.type === 'REPLACE') root = structuredClone(p.node);
        else if (p.type === 'TEXT') root.text = p.text;
        else applyAttrs(root, p);
        continue;
      }
      const parent = p.path.slice(0, -1).reduce((node, i) => node.children[i], root);
      const i = p.path[p.path.length - 1];
      if (p.type === 'ADD') {
        // 오름차순 약속이 지켜지면 i는 항상 현재 자식 수(= 끝)와 같다.
        expect(i).toBe(parent.children.length);
        parent.children.push(structuredClone(p.node));
      } else if (p.type === 'REMOVE') {
        // 내림차순 약속이 지켜지면 i는 항상 현재 마지막 자식이다.
        expect(i).toBe(parent.children.length - 1);
        parent.children.splice(i, 1);
      } else if (p.type === 'REPLACE') {
        parent.children[i] = structuredClone(p.node);
      } else if (p.type === 'TEXT') {
        parent.children[i].text = p.text;
      } else {
        applyAttrs(parent.children[i], p);
      }
    }
    return root;
  }

  function applyAttrs(node, { set, remove }) {
    Object.assign(node.attrs, set);
    for (const name of remove) delete node.attrs[name];
  }

  const cases = [
    ['빈 → 여러', '<ul></ul>', '<ul><li>a</li><li>b</li><li>c</li></ul>'],
    ['여러 → 빈', '<ul><li>a</li><li>b</li><li>c</li></ul>', '<ul></ul>'],
    ['변경 + 추가', '<ul id="x"><li>a</li></ul>', '<ul><li class="k">A</li><li>b</li><li>c</li></ul>'],
    ['변경 + 삭제', '<ul><li>a</li><li>b</li><li>c</li><li>d</li></ul>', '<ul><p>a</p><li>B</li></ul>'],
    [
      '여러 깊이에서 추가·삭제',
      '<div><ul><li>a</li><li>b</li></ul><p>x<b>y</b></p></div>',
      '<div><ul><li>a</li><li>b</li><li>c</li></ul><p>x</p><span>new</span></div>',
    ],
  ];

  for (const [name, before, after] of cases) {
    it(name, () => {
      const oldVdom = domToVdom(fromHTML(before));
      const newVdom = domToVdom(fromHTML(after));

      expect(applyToVdom(oldVdom, diff(oldVdom, newVdom))).toEqual(newVdom);
    });
  }
});

describe('diff — 이벤트 핸들러 변경(EVENTS, Phase 2)', () => {
  const el = (events, children = []) => ({ type: 'element', tag: 'button', attrs: {}, events, children });
  const onA = () => {};
  const onB = () => {};

  it('같은 함수(참조)면 patch가 없다', () => {
    expect(diff(el({ click: onA }), el({ click: onA }))).toEqual([]);
  });

  it('추가·다른 함수로 교체는 set, 사라진 이벤트는 remove에 모은다', () => {
    expect(diff(el({ click: onA, input: onA }), el({ click: onB, focus: onA }))).toEqual([
      { type: 'EVENTS', path: [], set: { click: onB, focus: onA }, remove: ['input'] },
    ]);
  });

  it('events가 없는 Phase 1 VDOM은 빈 이벤트로 본다', () => {
    const phase1 = { type: 'element', tag: 'button', attrs: {}, children: [] };

    expect(diff(phase1, phase1)).toEqual([]);
    expect(diff(phase1, el({ click: onA }))).toEqual([
      { type: 'EVENTS', path: [], set: { click: onA }, remove: [] },
    ]);
    expect(diff(el({ click: onA }), phase1)).toEqual([
      { type: 'EVENTS', path: [], set: {}, remove: ['click'] },
    ]);
  });

  it('ATTRS 다음, 자식 patch 앞에 온다', () => {
    const oldV = { type: 'element', tag: 'div', attrs: { id: 'a' }, events: {}, children: [el({})] };
    const newV = { type: 'element', tag: 'div', attrs: { id: 'b' }, events: { click: onA }, children: [el({ click: onB })] };

    expect(diff(oldV, newV).map((p) => [p.type, p.path])).toEqual([
      ['ATTRS', []],
      ['EVENTS', []],
      ['EVENTS', [0]],
    ]);
  });
});
