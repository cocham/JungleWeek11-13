import { describe, it, expect } from 'vitest';
import { vdomToDom, createTextDom, createElementDom } from '../src/vdomToDom.js';
import { domToVdom } from '../src/domToVdom.js';

describe('createTextDom — 텍스트 VDOM → 실제 텍스트 노드', () => {
  it('일반 문자열로 텍스트 노드를 만든다', () => {
    const node = createTextDom({ type: 'text', text: 'hello' });

    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('hello');
  });

  it('빈 문자열도 노드를 만든다 (null이 아니라 글자가 없는 텍스트 노드)', () => {
    const node = createTextDom({ type: 'text', text: '' });

    expect(node.nodeType).toBe(Node.TEXT_NODE);
    expect(node.textContent).toBe('');
  });

  it('앞뒤·사이 공백을 그대로 보존한다', () => {
    const node = createTextDom({ type: 'text', text: '  a   b ' });

    expect(node.textContent).toBe('  a   b ');
  });

  it('공백뿐인 텍스트(줄바꿈·탭 포함)도 그대로 보존한다', () => {
    const node = createTextDom({ type: 'text', text: '\n\t  ' });

    expect(node.textContent).toBe('\n\t  ');
  });

  it('부모에 넣어도 글자와 공백이 그대로이고, 빈 문자열도 자식 노드로 남는다', () => {
    const p = document.createElement('p');
    p.appendChild(createTextDom({ type: 'text', text: ' hi ' }));
    p.appendChild(createTextDom({ type: 'text', text: '' }));

    expect(p.childNodes.length).toBe(2);
    expect(p.textContent).toBe(' hi ');
  });

  it('호출할 때마다 새 노드를 만든다', () => {
    const vnode = { type: 'text', text: 'x' };

    expect(createTextDom(vnode)).not.toBe(createTextDom(vnode));
  });

  it('domToVdom으로 되돌리면 원래 VDOM과 같다', () => {
    for (const text of ['hello', '', '  a   b ', '\n\t  ']) {
      const vnode = { type: 'text', text };

      expect(domToVdom(createTextDom(vnode))).toEqual(vnode);
    }
  });
});

describe('createElementDom — 요소 VDOM → 실제 요소 (태그·속성)', () => {
  const vel = (tag, attrs = {}, children = []) => ({ type: 'element', tag, attrs, children });

  it('속성이 없으면 태그만 있는 빈 요소를 만든다', () => {
    const element = createElementDom(vel('div'));

    expect(element.nodeType).toBe(Node.ELEMENT_NODE);
    expect(element.tagName).toBe('DIV'); // HTML 문서의 tagName은 대문자
    expect(element.attributes.length).toBe(0);
  });

  it('여러 속성을 모두 이름 그대로 설정한다', () => {
    const element = createElementDom(vel('a', { href: '/home', class: 'link active', title: '홈' }));

    expect(element.attributes.length).toBe(3);
    expect(element.getAttribute('href')).toBe('/home');
    expect(element.getAttribute('class')).toBe('link active');
    expect(element.getAttribute('title')).toBe('홈');
  });

  it("disabled: ''는 값이 빈 문자열인 '있는' 속성으로 설정한다", () => {
    const element = createElementDom(vel('button', { disabled: '' }));

    expect(element.hasAttribute('disabled')).toBe(true);
    expect(element.getAttribute('disabled')).toBe('');
    expect(element.disabled).toBe(true); // 브라우저 입장에서도 실제로 비활성화
  });

  it('data-* 속성은 그대로 설정되고 dataset에서도 읽힌다', () => {
    const element = createElementDom(vel('li', { 'data-id': '42', 'data-user-name': 'kim', 'data-empty': '' }));

    expect(element.getAttribute('data-id')).toBe('42');
    expect(element.dataset.id).toBe('42');
    expect(element.dataset.userName).toBe('kim'); // data-user-name → userName
    expect(element.dataset.empty).toBe('');
  });

  it('자식은 아직 만들지 않는다 (children이 있어도 빈 요소)', () => {
    const element = createElementDom(vel('p', {}, [{ type: 'text', text: 'hi' }]));

    expect(element.childNodes.length).toBe(0);
  });

  it('domToVdom으로 되돌리면 태그·속성이 원래 VDOM과 같다', () => {
    const cases = [
      vel('div'),
      vel('a', { href: '/home', class: 'link active', title: '홈' }),
      vel('button', { disabled: '' }),
      vel('li', { 'data-id': '42', 'data-user-name': 'kim' }),
    ];

    for (const vnode of cases) {
      expect(domToVdom(createElementDom(vnode))).toEqual(vnode);
    }
  });
});

describe('vdomToDom — 텍스트·요소 구분과 자식 재귀 생성', () => {
  const t = (text) => ({ type: 'text', text });
  const e = (tag, attrs = {}, children = []) => ({ type: 'element', tag, attrs, children });

  // 테스트에서 HTML 문자열로 실제 DOM을 만드는 도우미
  function fromHTML(html) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    return wrapper.firstChild;
  }

  it('텍스트 VDOM은 텍스트 노드, 요소 VDOM은 요소로 만든다', () => {
    expect(vdomToDom(t('hi')).nodeType).toBe(Node.TEXT_NODE);
    expect(vdomToDom(e('div')).nodeType).toBe(Node.ELEMENT_NODE);
  });

  it('중첩된 요소를 끝까지 내려가며 만든다', () => {
    const vnode = e('div', { class: 'card' }, [
      e('section', {}, [e('p', {}, [e('b', {}, [t('deep')])])]),
    ]);
    const dom = vdomToDom(vnode);

    expect(dom.outerHTML).toBe('<div class="card"><section><p><b>deep</b></p></section></div>');
  });

  it('텍스트와 요소가 섞인 자식을 모두 만든다', () => {
    const vnode = e('p', {}, [t('hi '), e('b', {}, [t('there')]), t('!')]);
    const dom = vdomToDom(vnode);

    expect(dom.innerHTML).toBe('hi <b>there</b>!');
    expect(dom.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(dom.childNodes[1].nodeType).toBe(Node.ELEMENT_NODE);
    expect(dom.childNodes[2].nodeType).toBe(Node.TEXT_NODE);
  });

  it('형제 순서를 children 배열 순서 그대로 유지한다', () => {
    const vnode = e('ul', {}, [e('li', {}, [t('1')]), e('li', {}, [t('2')]), e('li', {}, [t('3')])]);
    const dom = vdomToDom(vnode);

    expect([...dom.children].map((li) => li.textContent)).toEqual(['1', '2', '3']);
  });

  it('요소 사이의 공백 텍스트 노드도 자식으로 만든다', () => {
    const vnode = e('ul', {}, [t('\n  '), e('li', {}, [t('a')]), t('\n  '), e('li', {}, [t('b')]), t('\n')]);
    const dom = vdomToDom(vnode);

    expect(dom.childNodes.length).toBe(5); // 공백 3개 + li 2개
    expect(dom.childNodes[0].textContent).toBe('\n  ');
    expect(dom.innerHTML).toBe('\n  <li>a</li>\n  <li>b</li>\n');
  });

  it('빈 텍스트도 건너뛰지 않고 자식 노드로 만든다 (자식 인덱스가 VDOM과 같다)', () => {
    const vnode = e('p', {}, [t(''), e('b', {}, [t('x')]), t('')]);
    const dom = vdomToDom(vnode);

    expect(dom.childNodes.length).toBe(3);
    expect(dom.childNodes[1].tagName).toBe('B'); // 빈 텍스트를 건너뛰었다면 0번이 b가 된다
    expect(dom.innerHTML).toBe('<b>x</b>');
  });

  it('속성도 각 요소에 설정한다', () => {
    const vnode = e('form', { id: 'f' }, [e('input', { type: 'text', 'data-k': '1' }), e('button', { disabled: '' }, [t('ok')])]);
    const dom = vdomToDom(vnode);

    expect(dom.outerHTML).toBe('<form id="f"><input type="text" data-k="1"><button disabled="">ok</button></form>');
  });

  it('VDOM을 바꾸지 않는다', () => {
    const vnode = e('p', { class: 'a' }, [t('hi'), e('b', {}, [t('x')])]);
    const copy = structuredClone(vnode);

    vdomToDom(vnode);

    expect(vnode).toEqual(copy);
  });

  it('호출할 때마다 새 트리를 만든다 (노드를 공유하지 않는다)', () => {
    const vnode = e('p', {}, [t('hi')]);
    const a = vdomToDom(vnode);
    const b = vdomToDom(vnode);

    expect(a).not.toBe(b);
    expect(a.firstChild).not.toBe(b.firstChild);
  });

  it('알 수 없는 type이면 에러를 던진다', () => {
    expect(() => vdomToDom({ type: 'comment', text: 'x' })).toThrow(/알 수 없는 VDOM 종류/);
    expect(() => vdomToDom(e('div', {}, [{ type: 'oops' }]))).toThrow(/oops/);
  });

  describe('DOM ↔ VDOM 왕복', () => {
    const htmls = [
      '<p>hello</p>',
      '<p>hi <b>there</b>!</p>',
      '<div class="card" data-id="1"><h1>Title</h1><p>a <i>b</i> c</p></div>',
      `<section class="card">
  <ul>
    <li>one</li>
    <li><a href="/two">two</a> <b>!</b></li>
  </ul>
  <button disabled>ok</button>
</section>`,
      '<pre>  line1\n\tline2  </pre>',
    ];

    for (const html of htmls) {
      it(`DOM → VDOM → DOM: ${JSON.stringify(html.slice(0, 30))}`, () => {
        const original = fromHTML(html);
        const rebuilt = vdomToDom(domToVdom(original));

        expect(rebuilt.outerHTML).toBe(original.outerHTML);
        expect(rebuilt.isEqualNode(original)).toBe(true); // 노드 종류·속성·자식(텍스트 포함)이 모두 같은지
      });

      it(`VDOM → DOM → VDOM: ${JSON.stringify(html.slice(0, 30))}`, () => {
        const vnode = domToVdom(fromHTML(html));

        expect(domToVdom(vdomToDom(vnode))).toEqual(vnode);
      });
    }

    it('빈 텍스트가 있는 VDOM도 왕복하면 그대로다', () => {
      // HTML 문자열로는 빈 텍스트 노드를 만들 수 없어서 VDOM을 직접 만든다.
      const vnode = e('p', {}, [t(''), t('  '), e('b', {}, [t('')])]);

      expect(domToVdom(vdomToDom(vnode))).toEqual(vnode);
    });
  });
});
