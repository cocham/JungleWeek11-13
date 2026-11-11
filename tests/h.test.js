import { describe, it, expect, vi } from 'vitest';
import { h, resolve } from '../src/h.js';
import { diff } from '../src/diff.js';
import { patch } from '../src/patch.js';
import { vdomToDom } from '../src/vdomToDom.js';

const text = (t) => ({ type: 'text', text: t });

describe('h — 요소 VDOM 만들기', () => {
  it('태그·속성·자식을 Phase 1과 같은 모양의 element VDOM으로 만든다', () => {
    expect(h('p', { id: 'a', class: 'b' }, 'hi')).toEqual({
      type: 'element',
      tag: 'p',
      attrs: { id: 'a', class: 'b' },
      events: {},
      children: [text('hi')],
    });
  });

  it('props가 null이면 속성·이벤트가 빈 객체다', () => {
    expect(h('div', null)).toEqual({ type: 'element', tag: 'div', attrs: {}, events: {}, children: [] });
  });

  it('속성 값을 문자열로 맞춘다: 숫자 → 문자열, true → "", false·null·undefined → 없음', () => {
    const vnode = h('input', { maxlength: 10, disabled: true, hidden: false, title: null, alt: undefined });

    expect(vnode.attrs).toEqual({ maxlength: '10', disabled: '' });
  });

  it('on + 대문자 props는 속성이 아니라 이벤트(소문자 이름)로 분리한다', () => {
    const onClick = () => {};
    const onInput = () => {};
    const vnode = h('button', { onClick, onInput, class: 'btn' });

    expect(vnode.events).toEqual({ click: onClick, input: onInput });
    expect(vnode.attrs).toEqual({ class: 'btn' });
  });

  it('핸들러 자리에 함수가 아닌 값이 오면 이벤트도 속성도 만들지 않는다', () => {
    const vnode = h('button', { onClick: null, onInput: undefined });

    expect(vnode.events).toEqual({});
    expect(vnode.attrs).toEqual({});
  });

  it('on 다음이 소문자인 이름(예: one)은 일반 속성이다', () => {
    expect(h('div', { one: '1' }).attrs).toEqual({ one: '1' });
  });

  it('자식 문자열·숫자는 텍스트 노드가 된다 (0, 빈 문자열 포함)', () => {
    expect(h('p', null, 'Count: ', 0, '').children).toEqual([text('Count: '), text('0'), text('')]);
  });

  it('null·undefined·true·false 자식은 건너뛴다 (조건부 표시)', () => {
    const done = false;
    const vnode = h('li', null, 'a', done && h('span', null, '완료'), null, undefined, true, 'b');

    expect(vnode.children).toEqual([text('a'), text('b')]);
  });

  it('배열 자식(map 결과)은 펼쳐서 같은 단계의 자식으로 넣는다 (중첩 배열 포함)', () => {
    const items = ['x', 'y'];
    const vnode = h('ul', null, h('li', null, 'first'), items.map((t) => h('li', null, t)), [['z']]);

    expect(vnode.children.map((c) => c.tag ?? c.text)).toEqual(['li', 'li', 'li', 'z']);
    expect(vnode.children[2].children).toEqual([text('y')]);
  });

  it('태그가 문자열·함수가 아니면 에러', () => {
    expect(() => h(undefined, null)).toThrow(/태그 이름/);
  });
});

describe('h + resolve — 함수형 컴포넌트 펼치기', () => {
  it('h(컴포넌트)는 함수를 바로 호출하지 않고 component 노드만 만든다', () => {
    const Item = vi.fn(() => h('li', null, 'x'));
    const vnode = h(Item, { title: 'a' }, 'child');

    expect(Item).not.toHaveBeenCalled();
    expect(vnode).toEqual({
      type: 'component',
      component: Item,
      props: { title: 'a', children: [text('child')] },
    });
  });

  it('resolve는 컴포넌트를 props로 호출해 element/text만 남은 트리로 만든다', () => {
    const Item = ({ title, done }) => h('li', { class: done ? 'done' : null }, title);
    const tree = h('ul', null, h(Item, { title: '공부', done: true }), h(Item, { title: '운동', done: false }));

    expect(resolve(tree)).toEqual(
      h('ul', null, h('li', { class: 'done' }, '공부'), h('li', null, '운동')),
    );
  });

  it('컴포넌트 안의 컴포넌트, 그리고 props.children으로 받은 자식도 끝까지 펼친다', () => {
    const Label = ({ text: t }) => h('b', null, t);
    const Card = ({ children }) => h('section', { class: 'card' }, ...children);
    const tree = h(Card, null, h(Label, { text: '제목' }), '본문');

    expect(resolve(tree)).toEqual(h('section', { class: 'card' }, h('b', null, '제목'), '본문'));
  });

  it('루트가 컴포넌트여도 펼친다. 컴포넌트가 문자열·숫자를 돌려주면 텍스트 노드가 된다', () => {
    const Count = ({ n }) => n;
    expect(resolve(h(Count, { n: 3 }))).toEqual(text('3'));
  });

  it('컴포넌트가 아무 노드도 돌려주지 않으면(null 등) 이름을 담아 에러를 던진다', () => {
    function Empty() {
      return null;
    }
    expect(() => resolve(h('div', null, h(Empty)))).toThrow(/Empty/);
  });

  it('컴포넌트가 배열을 돌려주면 일부만 남기지 않고 에러를 던진다 (길이 1·0 배열 포함)', () => {
    function Items() {
      return [h('li', null, 'a'), h('li', null, 'b')];
    }
    function One() {
      return [h('li', null, 'a')];
    }
    function None() {
      return [];
    }

    expect(() => resolve(h('ul', null, h(Items)))).toThrow(/Items가 배열/);
    expect(() => resolve(h(One))).toThrow(/One가 배열/);
    expect(() => resolve(h(None))).toThrow(/None가 배열/);
  });

  it('여러 노드는 요소 하나로 감싸서 돌려주면 된다', () => {
    const Items = () => h('ul', null, [h('li', null, 'a'), h('li', null, 'b')]);

    expect(resolve(h(Items))).toEqual(h('ul', null, h('li', null, 'a'), h('li', null, 'b')));
  });

  it('resolve는 원래 트리를 바꾸지 않는다', () => {
    const Item = () => h('li', null, 'x');
    const componentNode = h(Item);
    const tree = h('ul', null, componentNode);
    const children = tree.children;

    const resolved = resolve(tree);

    expect(resolved).not.toBe(tree);
    expect(tree.children).toBe(children);
    expect(tree.children[0]).toBe(componentNode);
    expect(componentNode.type).toBe('component');
  });
});

describe('컴포넌트 VDOM → Phase 1 diff·patch', () => {
  // 실제 화면 컨테이너 안에 처음 그린 뒤, 새 VDOM과의 diff만 적용한다.
  function mount(vdom) {
    const container = document.createElement('div');
    container.appendChild(vdomToDom(vdom));
    return container;
  }

  const TodoItem = ({ title, done, onToggle }) =>
    h('li', { class: done ? 'done' : null, onClick: onToggle }, title, done && h('span', null, ' ✓'));
  const TodoList = ({ todos, onToggle }) =>
    h('ul', null, todos.map((t, i) => h(TodoItem, { title: t.title, done: t.done, onToggle: () => onToggle(i) })));

  it('컴포넌트가 계산한 새 화면과 diff한 변경분만 실제 DOM에 반영하고 나머지 노드는 유지한다', () => {
    const onToggle = () => {};
    const oldVdom = resolve(h(TodoList, { todos: [{ title: 'a', done: false }, { title: 'b', done: false }], onToggle }));
    const container = mount(oldVdom);
    let root = container.firstChild;
    const [liA, liB] = root.childNodes;
    const textB = liB.firstChild;

    const newVdom = resolve(
      h(TodoList, { todos: [{ title: 'a', done: false }, { title: 'b', done: true }, { title: 'c', done: false }], onToggle }),
    );
    root = patch(root, diff(oldVdom, newVdom));

    expect(container.innerHTML).toBe('<ul><li>a</li><li class="done">b<span> ✓</span></li><li>c</li></ul>');
    // 바뀐 li(b)도 새로 만들지 않고 속성·자식만 고쳤다. 다른 li도 같은 객체다.
    expect(root.childNodes[0]).toBe(liA);
    expect(root.childNodes[1]).toBe(liB);
    expect(liB.firstChild).toBe(textB);
  });

  it('patch 후 클릭하면 최신 렌더링의 핸들러가 한 번만 실행된다', () => {
    const calls = [];
    const render = (label) =>
      resolve(h(TodoList, { todos: [{ title: 'a', done: false }], onToggle: (i) => calls.push(`${label}:${i}`) }));

    const v1 = render('v1');
    const container = mount(v1);
    let root = container.firstChild;
    root.firstChild.click();

    const v2 = render('v2');
    root = patch(root, diff(v1, v2));
    root.firstChild.click();

    // 옛 핸들러(v1)는 떼어졌으므로 두 번째 클릭에서 v1이 다시 불리지 않는다.
    expect(calls).toEqual(['v1:0', 'v2:0']);
  });
});
