import { describe, it, expect, vi } from 'vitest';
import { FunctionComponent, useState } from '../src/component.js';
import { h } from '../src/h.js';

function mountApp(App, props) {
  const container = document.createElement('div');
  const app = new FunctionComponent(App, props);
  app.mount(container);
  return { app, container };
}

describe('FunctionComponent — mount (첫 렌더링)', () => {
  it('컴포넌트를 실행해 만든 화면을 container에 붙인다. 자식 컴포넌트도 펼친다', () => {
    const Title = ({ text }) => h('h1', null, text);
    const App = ({ name }) => h('div', { id: 'app' }, h(Title, { text: `안녕 ${name}` }), h('p', null, 'p'));
    const { app, container } = mountApp(App, { name: 'kim' });

    expect(container.innerHTML).toBe('<div id="app"><h1>안녕 kim</h1><p>p</p></div>');
    expect(app.root).toBe(container.firstChild);
  });

  it('container에 원래 있던 노드는 그대로 두고 뒤에 붙인다', () => {
    const container = document.createElement('div');
    container.innerHTML = '<!--앞-->';
    new FunctionComponent(() => h('p', null, 'x')).mount(container);

    expect(container.innerHTML).toBe('<!--앞--><p>x</p>');
  });

  it('두 번 mount하면 에러', () => {
    const { app } = mountApp(() => h('p', null, 'x'));
    expect(() => app.mount(document.createElement('div'))).toThrow(/이미 mount/);
  });

  it('mount 전 update는 에러', () => {
    expect(() => new FunctionComponent(() => h('p', null)).update()).toThrow(/mount 전/);
  });

  it('루트가 배열·null을 돌려주면 자식 컴포넌트와 같은 규칙으로 에러', () => {
    function ArrayApp() {
      return [h('p', null)];
    }
    function NullApp() {
      return null;
    }
    expect(() => mountApp(ArrayApp)).toThrow(/ArrayApp가 배열/);
    expect(() => mountApp(NullApp)).toThrow(/NullApp가 VDOM 노드를 돌려주지/);
  });
});

describe('useState — 상태 저장과 자동 재렌더링', () => {
  function Counter() {
    const [count, setCount] = useState(0);
    return h('div', null, h('span', null, `count: ${count}`), h('button', { onClick: () => setCount(count + 1) }, '+'));
  }

  it('초기값으로 그리고, 클릭으로 setState하면 화면이 자동으로 바뀐다', () => {
    const { container } = mountApp(Counter);
    const button = container.querySelector('button');

    expect(container.querySelector('span').textContent).toBe('count: 0');
    button.click();
    button.click();
    expect(container.querySelector('span').textContent).toBe('count: 2');
  });

  it('상태는 hooks 배열에 순서대로 저장되고, 렌더링 사이에 유지된다', () => {
    let setB;
    const App = () => {
      const [a] = useState('A');
      const [b, _setB] = useState(1);
      setB = _setB;
      return h('p', null, `${a}${b}`);
    };
    const { app, container } = mountApp(App);

    setB(5);

    expect(app.hooks.map((hook) => hook.value)).toEqual(['A', 5]);
    expect(container.textContent).toBe('A5');
  });

  it('재렌더링은 전체를 다시 만들지 않고 diff 결과만 patch한다 (DOM 객체 유지)', () => {
    const { app, container } = mountApp(Counter);
    const div = container.firstChild;
    const span = div.firstChild;
    const spanText = span.firstChild;
    const button = div.lastChild;

    const update = vi.spyOn(app, 'update');
    button.click();

    // 바뀐 텍스트(TEXT)와 새 클로저 핸들러(EVENTS)만 반영된다.
    expect(update.mock.results[0].value).toEqual([
      { type: 'TEXT', path: [0, 0], text: 'count: 1' },
      { type: 'EVENTS', path: [1], set: { click: expect.any(Function) }, remove: [] },
    ]);
    expect(container.firstChild).toBe(div);
    expect(div.firstChild).toBe(span);
    expect(span.firstChild).toBe(spanText);
    expect(div.lastChild).toBe(button);
  });

  it('setState는 렌더링이 바뀌어도 같은 함수다', () => {
    const setters = [];
    const App = () => {
      const [n, setN] = useState(0);
      setters.push(setN);
      return h('p', null, n);
    };
    mountApp(App);

    setters[0](1);
    setters[0](2);

    expect(setters).toHaveLength(3);
    expect(new Set(setters).size).toBe(1);
  });

  it('함수를 넘기면 최신 값으로 계산하므로 한 핸들러에서 여러 번 불러도 누적된다', () => {
    const App = () => {
      const [n, setN] = useState(0);
      const addThree = () => {
        setN((prev) => prev + 1);
        setN((prev) => prev + 1);
        setN((prev) => prev + 1);
      };
      return h('button', { onClick: addThree }, n);
    };
    const { container } = mountApp(App);

    container.firstChild.click();

    expect(container.textContent).toBe('3');
  });

  it('같은 값(Object.is)으로 setState하면 다시 렌더링하지 않는다', () => {
    let setN;
    const App = vi.fn(() => {
      const [n, _setN] = useState(0);
      setN = _setN;
      return h('p', null, n);
    });
    mountApp(App);

    setN(0);
    setN((prev) => prev);

    expect(App).toHaveBeenCalledTimes(1);
  });

  it('배열 상태: 새 배열로 바꾸면 다시 그리고, 같은 배열을 고쳐 넣으면 다시 그리지 않는다', () => {
    let items;
    let setItems;
    const App = () => {
      [items, setItems] = useState(['a']);
      return h('ul', null, items.map((t) => h('li', null, t)));
    };
    const { container } = mountApp(App);

    setItems([...items, 'b']);
    expect(container.innerHTML).toBe('<ul><li>a</li><li>b</li></ul>');

    items.push('c');
    setItems(items);
    expect(container.innerHTML).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('mount 전에 setState하면 값만 바뀌고, mount 때 그 값으로 그린다', () => {
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      return h('p', null, n);
    };
    const app = new FunctionComponent(App);
    app.render(); // hooks만 만들고 화면에는 붙이지 않는다

    setN(7);
    const container = document.createElement('div');
    app.mount(container);

    expect(container.textContent).toBe('7');
  });

  it('루트 태그가 바뀌어도 새 루트 노드를 받아 다음 업데이트를 이어간다', () => {
    let setOn;
    const App = () => {
      const [on, _setOn] = useState(false);
      setOn = _setOn;
      return on ? h('section', null, 'on') : h('p', null, 'off');
    };
    const { app, container } = mountApp(App);

    setOn(true);
    expect(container.innerHTML).toBe('<section>on</section>');
    expect(app.root).toBe(container.firstChild);

    setOn(false);
    expect(container.innerHTML).toBe('<p>off</p>');
  });

  it('컴포넌트 인스턴스마다 상태가 따로 있다', () => {
    const a = mountApp(Counter);
    const b = mountApp(Counter);

    a.container.querySelector('button').click();

    expect(a.container.querySelector('span').textContent).toBe('count: 1');
    expect(b.container.querySelector('span').textContent).toBe('count: 0');
  });
});

describe('Lifting State Up — 상태는 루트, 자식은 props만 (R-P2-04)', () => {
  it('자식이 받은 콜백으로 루트 상태를 바꾸면 형제 자식의 화면도 바뀐다', () => {
    const Input = ({ value, onChange }) => h('input', { value, onInput: (e) => onChange(e.target.value) });
    const Preview = ({ value }) => h('p', null, `미리보기: ${value}`);
    const App = () => {
      const [text, setText] = useState('');
      return h('div', null, h(Input, { value: text, onChange: setText }), h(Preview, { value: text }));
    };
    const { container } = mountApp(App);
    const input = container.querySelector('input');

    input.value = 'hi';
    input.dispatchEvent(new Event('input'));

    expect(container.querySelector('p').textContent).toBe('미리보기: hi');
    // input 요소는 새로 만들어지지 않는다.
    expect(container.querySelector('input')).toBe(input);
  });
});

describe('Hook 규칙 — 잘못 부르면 에러', () => {
  it('자식 컴포넌트에서 Hook을 부르면 R-P2-03 에러', () => {
    const Child = () => {
      const [v] = useState(0);
      return h('span', null, v);
    };
    const App = () => h('div', null, h(Child));

    expect(() => mountApp(App)).toThrow(/루트 컴포넌트에서만.*R-P2-03/);
  });

  it('루트가 Hook을 쓴 뒤에도 자식의 Hook은 막는다', () => {
    const Child = () => {
      useState(0);
      return h('span', null);
    };
    const App = () => {
      const [n] = useState(1);
      return h('div', null, n, h(Child));
    };

    expect(() => mountApp(App)).toThrow(/R-P2-03/);
  });

  it('렌더링 밖에서 Hook을 부르면 에러', () => {
    expect(() => useState(0)).toThrow(/렌더링 중에만/);
  });

  it('렌더링 중(루트·자식 모두)에 setState하면 에러', () => {
    let setN;
    let mode = 'none';
    const Child = ({ onRender }) => {
      onRender();
      return h('span', null);
    };
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      if (mode === 'root') setN(n + 1);
      return h('div', null, h(Child, { onRender: () => mode === 'child' && setN(n + 1) }));
    };
    const { app } = mountApp(App);

    mode = 'root';
    expect(() => app.update()).toThrow(/렌더링 중에는 setState/);
    mode = 'child';
    expect(() => app.update()).toThrow(/렌더링 중에는 setState/);

    // 에러 후에도 렌더링 표시가 풀려 이벤트에서의 setState는 정상 동작한다.
    mode = 'none';
    expect(() => setN(10)).not.toThrow();
  });

  it('조건문 때문에 Hook 개수가 줄거나 늘면 에러', () => {
    let extra = false;
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      if (extra) useState('x');
      return h('p', null, n);
    };
    mountApp(App);
    extra = true;
    expect(() => setN(1)).toThrow(/Hook 개수가 렌더링마다 달라졌습니다 \(이전 1개, 이번 2개 이상\)/);

    let skip = false;
    let setA;
    const App2 = () => {
      const [a, _setA] = useState(0);
      setA = _setA;
      if (!skip) useState('b');
      return h('p', null, a);
    };
    mountApp(App2);
    skip = true;
    expect(() => setA(1)).toThrow(/이전 2개, 이번 1개\)/);
  });

  it('에러가 난 렌더링 뒤에도 다음 렌더링에서 Hook을 정상적으로 쓸 수 있다', () => {
    const Bad = () => {
      useState(0);
      return h('span', null);
    };
    expect(() => mountApp(() => h('div', null, h(Bad)))).toThrow(/R-P2-03/);

    const { container } = mountApp(() => {
      const [v] = useState('ok');
      return h('p', null, v);
    });
    expect(container.textContent).toBe('ok');
  });
});
