import { describe, it, expect, vi } from 'vitest';
import { FunctionComponent, useState, useEffect, flushSync } from '../src/component.js';
import { h } from '../src/h.js';

// setState가 예약한 flush(microtask)가 끝날 때까지 기다린다.
// flush가 먼저 queueMicrotask로 예약되어 있으므로, 그 뒤에 예약한 이 microtask는 flush 다음에 실행된다.
const nextMicrotask = () => new Promise((resolve) => queueMicrotask(resolve));

function mountApp(App) {
  const container = document.createElement('div');
  const app = new FunctionComponent(App);
  app.mount(container);
  return { app, container };
}

describe('Batching — 여러 setState를 한 번의 렌더링으로 (R-OPT-01)', () => {
  it('핸들러 안의 setState 세 번(서로 다른 상태)은 렌더링 한 번으로 묶인다', async () => {
    const renders = vi.fn();
    const App = () => {
      const [a, setA] = useState(0);
      const [b, setB] = useState(0);
      const [c, setC] = useState(0);
      renders();
      const onClick = () => {
        setA(1);
        setB(2);
        setC(3);
      };
      return h('button', { onClick }, `${a}${b}${c}`);
    };
    const { container } = mountApp(App);

    container.firstChild.click();
    // 핸들러가 끝난 직후, flush 전: 상태는 바뀌었지만 화면은 아직 그대로다.
    expect(container.textContent).toBe('000');

    await nextMicrotask();

    expect(container.textContent).toBe('123');
    expect(renders).toHaveBeenCalledTimes(2); // mount 1번 + 클릭 1번
  });

  it('같은 상태를 함수형으로 세 번 바꾸면 값은 누적되고 렌더링은 한 번이다', async () => {
    const renders = vi.fn();
    const App = () => {
      const [n, setN] = useState(0);
      renders();
      const onClick = () => {
        setN((prev) => prev + 1);
        setN((prev) => prev + 1);
        setN((prev) => prev + 1);
      };
      return h('button', { onClick }, n);
    };
    const { container } = mountApp(App);

    container.firstChild.click();
    await nextMicrotask();

    expect(container.textContent).toBe('3');
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('이벤트 밖(타이머·직접 호출)의 setState도 묶인다 (자동 batching)', async () => {
    const renders = vi.fn();
    let setA;
    let setB;
    const App = () => {
      const [a, _setA] = useState(0);
      const [b, _setB] = useState(0);
      setA = _setA;
      setB = _setB;
      renders();
      return h('p', null, `${a}${b}`);
    };
    const { container } = mountApp(App);

    await new Promise((resolve) =>
      setTimeout(() => {
        setA(1);
        setB(1);
        resolve();
      }, 0),
    );
    await nextMicrotask();

    expect(container.textContent).toBe('11');
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('따로 일어난 두 클릭은 각각 렌더링된다 (한 flush가 끝나면 다시 예약 가능)', async () => {
    const renders = vi.fn();
    const App = () => {
      const [n, setN] = useState(0);
      renders();
      return h('button', { onClick: () => setN((v) => v + 1) }, n);
    };
    const { container } = mountApp(App);

    container.firstChild.click();
    await nextMicrotask();
    container.firstChild.click();
    await nextMicrotask();

    expect(container.textContent).toBe('2');
    expect(renders).toHaveBeenCalledTimes(3);
  });

  it('한 번에 여러 컴포넌트의 setState가 일어나면 각 컴포넌트를 한 번씩만 다시 그린다', async () => {
    const setters = {};
    const renders = { A: 0, B: 0 };
    const make = (name) => () => {
      const [v, setV] = useState(0);
      setters[name] = setV;
      renders[name] += 1;
      return h('p', null, v);
    };
    const a = mountApp(make('A'));
    const b = mountApp(make('B'));

    setters.A(1);
    setters.B(1);
    setters.A(2);
    await nextMicrotask();

    expect(a.container.textContent).toBe('2');
    expect(b.container.textContent).toBe('1');
    expect(renders).toEqual({ A: 2, B: 2 });
  });

  it('묶인 변경이 결국 원래 값으로 돌아오면 렌더링은 하지만 DOM patch는 없다', async () => {
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      return h('p', null, n);
    };
    const { app, container } = mountApp(App);
    const text = container.firstChild.firstChild;
    const update = vi.spyOn(app, 'update');

    setN(1);
    setN(0);
    await nextMicrotask();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.results[0].value).toEqual([]);
    expect(container.firstChild.firstChild).toBe(text);
  });

  it('flush 안에서 핸들러의 재렌더링 → effect의 setState → 재렌더링이 이어서 처리된다', async () => {
    const renders = [];
    const App = () => {
      const [query, setQuery] = useState('');
      const [count, setCount] = useState(0);
      renders.push(`${query}:${count}`);
      useEffect(() => {
        setCount(query.length);
      }, [query]);
      return h('button', { onClick: () => setQuery('abc') }, `${query}:${count}`);
    };
    const { container } = mountApp(App);
    await nextMicrotask(); // mount effect의 setCount(0)은 같은 값이라 렌더링 없음

    container.firstChild.click();
    await nextMicrotask();

    expect(container.textContent).toBe('abc:3');
    expect(renders).toEqual([':0', 'abc:0', 'abc:3']);
  });
});

describe('Batching — mount와 effect', () => {
  it('mount의 effect에서 setState하면 mount가 돌아올 때는 첫 화면이고, microtask 뒤에 바뀐다', async () => {
    const App = () => {
      const [data, setData] = useState('loading');
      useEffect(() => {
        setData('loaded');
      }, []);
      return h('p', null, data);
    };
    const { container } = mountApp(App);

    expect(container.textContent).toBe('loading');
    await nextMicrotask();
    expect(container.textContent).toBe('loaded');
  });
});

describe('flushSync — 기다리지 않고 바로 반영', () => {
  it('fn 안의 setState를 한 번으로 묶어 바로 그리고, fn의 반환값을 돌려준다', async () => {
    const renders = vi.fn();
    let setA;
    let setB;
    const App = () => {
      const [a, _setA] = useState(0);
      const [b, _setB] = useState(0);
      setA = _setA;
      setB = _setB;
      renders();
      return h('p', null, `${a}${b}`);
    };
    const { container } = mountApp(App);

    const result = flushSync(() => {
      setA(1);
      setB(1);
      return 'done';
    });

    expect(result).toBe('done');
    expect(container.textContent).toBe('11');
    expect(renders).toHaveBeenCalledTimes(2);

    // 이미 처리했으므로 예약돼 있던 microtask는 할 일이 없다.
    await nextMicrotask();
    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('인자 없이 부르면 이미 예약된 재렌더링을 바로 처리한다', () => {
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      return h('p', null, n);
    };
    const { container } = mountApp(App);

    setN(5);
    expect(container.textContent).toBe('0');
    flushSync();
    expect(container.textContent).toBe('5');
  });

  it('직접 update()하면 예약은 지워져 microtask에서 다시 그리지 않는다', async () => {
    const renders = vi.fn();
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      renders();
      return h('p', null, n);
    };
    const { app, container } = mountApp(App);

    setN(1);
    app.update();
    expect(container.textContent).toBe('1');
    await nextMicrotask();

    expect(renders).toHaveBeenCalledTimes(2);
  });

  it('한 컴포넌트의 재렌더링이 실패해도, 같은 flush에 예약된 다른 컴포넌트는 다음 microtask에 그려진다', async () => {
    let breakA = false;
    const setters = {};
    const A = () => {
      const [v, setV] = useState(0);
      setters.A = setV;
      if (breakA) useState('늘어난 Hook'); // Hook 개수가 바뀌어 에러
      return h('p', null, v);
    };
    const B = () => {
      const [v, setV] = useState(0);
      setters.B = setV;
      return h('p', null, v);
    };
    mountApp(A);
    const b = mountApp(B);

    breakA = true;
    expect(() =>
      flushSync(() => {
        setters.A(1);
        setters.B(1);
      }),
    ).toThrow(/Hook 개수/);
    expect(b.container.textContent).toBe('0');

    await nextMicrotask();
    expect(b.container.textContent).toBe('1');
  });
});
