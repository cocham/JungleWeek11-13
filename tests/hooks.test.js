import { describe, it, expect, vi } from 'vitest';
import { FunctionComponent, useState, useEffect, useMemo } from '../src/component.js';
import { h } from '../src/h.js';

function mountApp(App) {
  const container = document.createElement('div');
  const app = new FunctionComponent(App);
  app.mount(container);
  return { app, container };
}

describe('useEffect — 실행 시점', () => {
  it('렌더링 중이 아니라 실제 DOM이 붙은 뒤 실행되므로, effect 안에서 화면을 읽을 수 있다', () => {
    const log = [];
    let container;
    const App = () => {
      log.push('render');
      useEffect(() => {
        log.push(`effect: ${container.textContent}`);
      });
      return h('p', null, 'hello');
    };
    container = document.createElement('div');
    new FunctionComponent(App).mount(container);

    expect(log).toEqual(['render', 'effect: hello']);
  });

  it('update에서도 patch가 끝난 뒤 실행되어 바뀐 화면을 본다', () => {
    const seen = [];
    let setN;
    let container;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      useEffect(() => {
        seen.push(container.textContent);
      });
      return h('p', null, `n=${n}`);
    };
    container = document.createElement('div');
    new FunctionComponent(App).mount(container);

    setN(1);

    expect(seen).toEqual(['n=0', 'n=1']);
  });

  it('mount()/update()가 돌아오기 전에 effect가 끝난다 (동기 실행)', () => {
    const effect = vi.fn();
    const app = new FunctionComponent(() => {
      useEffect(effect);
      return h('p', null);
    });

    app.mount(document.createElement('div'));
    expect(effect).toHaveBeenCalledTimes(1);
    app.update();
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('여러 effect는 호출 순서대로 실행된다', () => {
    const log = [];
    mountApp(() => {
      useEffect(() => log.push('a'));
      useEffect(() => log.push('b'));
      return h('p', null);
    });

    expect(log).toEqual(['a', 'b']);
  });
});

describe('useEffect — deps', () => {
  function setup(depsOf) {
    const effect = vi.fn();
    let setA;
    let setB;
    const App = () => {
      const [a, _setA] = useState(0);
      const [b, _setB] = useState(0);
      setA = _setA;
      setB = _setB;
      useEffect(() => effect(a, b), depsOf(a, b));
      return h('p', null, `${a},${b}`);
    };
    mountApp(App);
    return { effect, setA: (v) => setA(v), setB: (v) => setB(v) };
  }

  it('deps를 생략하면 매 렌더링 뒤 실행된다', () => {
    const { effect, setA, setB } = setup(() => undefined);
    setA(1);
    setB(1);
    expect(effect).toHaveBeenCalledTimes(3);
  });

  it('deps가 []이면 mount 뒤 한 번만 실행된다', () => {
    const { effect, setA, setB } = setup(() => []);
    setA(1);
    setB(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('deps [a]이면 a가 바뀐 렌더링에서만 실행되고, 그때의 최신 값을 본다', () => {
    const { effect, setA, setB } = setup((a) => [a]);
    setB(1); // a 그대로 → 실행 안 함
    setA(5); // a 바뀜 → 실행
    expect(effect.mock.calls).toEqual([
      [0, 0],
      [5, 1],
    ]);
  });

  it('deps 값은 Object.is로 비교한다 (NaN은 같음, 새 배열 객체는 다름)', () => {
    const effect = vi.fn();
    let setTick;
    let value = NaN;
    const App = () => {
      const [tick, _setTick] = useState(0);
      setTick = _setTick;
      useEffect(effect, [value]);
      return h('p', null, tick);
    };
    mountApp(App);

    setTick(1); // NaN → NaN: 같음
    expect(effect).toHaveBeenCalledTimes(1);

    value = [];
    setTick(2); // NaN → []: 다름
    value = [];
    setTick(3); // [] → 새 []: 참조가 달라 다름
    expect(effect).toHaveBeenCalledTimes(3);
  });

  it('deps 길이가 바뀌면 바뀐 것으로 본다', () => {
    const effect = vi.fn();
    let deps = [1];
    let setTick;
    const App = () => {
      const [tick, _setTick] = useState(0);
      setTick = _setTick;
      useEffect(effect, deps);
      return h('p', null, tick);
    };
    mountApp(App);

    deps = [1, 2];
    setTick(1);

    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('deps가 배열이 아니면 에러', () => {
    expect(() =>
      mountApp(() => {
        useEffect(() => {}, 'a');
        return h('p', null);
      }),
    ).toThrow(/deps는 배열/);
  });
});

describe('useEffect — cleanup', () => {
  it('effect가 돌려준 함수는 다음에 그 effect를 다시 실행하기 직전에 불린다', () => {
    const log = [];
    let setId;
    const App = () => {
      const [id, _setId] = useState(1);
      setId = _setId;
      useEffect(() => {
        log.push(`subscribe ${id}`);
        return () => log.push(`unsubscribe ${id}`);
      }, [id]);
      return h('p', null, id);
    };
    mountApp(App);

    setId(2);
    setId(3);

    expect(log).toEqual(['subscribe 1', 'unsubscribe 1', 'subscribe 2', 'unsubscribe 2', 'subscribe 3']);
  });

  it('deps가 그대로면 cleanup도 부르지 않는다', () => {
    const cleanup = vi.fn();
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      useEffect(() => cleanup, []);
      return h('p', null, n);
    };
    mountApp(App);

    setN(1);

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('다시 실행할 effect들의 cleanup을 모두 먼저 부르고, 그다음 effect를 부른다', () => {
    const log = [];
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      useEffect(() => {
        log.push(`a${n}`);
        return () => log.push(`cleanup a${n}`);
      });
      useEffect(() => {
        log.push(`b${n}`);
        return () => log.push(`cleanup b${n}`);
      });
      return h('p', null, n);
    };
    mountApp(App);
    log.length = 0;

    setN(1);

    expect(log).toEqual(['cleanup a0', 'cleanup b0', 'a1', 'b1']);
  });

  it('함수가 아닌 반환값은 cleanup으로 보지 않는다', () => {
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      useEffect(() => 42);
      return h('p', null, n);
    };
    mountApp(App);

    expect(() => setN(1)).not.toThrow();
  });
});

describe('useEffect — effect 안의 setState', () => {
  it('mount의 effect에서 setState하면 effect가 끝난 뒤 다시 렌더링되고, mount가 돌아올 때 화면은 최신이다', () => {
    const renders = vi.fn();
    const App = () => {
      const [data, setData] = useState('loading');
      renders(data);
      useEffect(() => {
        setData('loaded');
      }, []);
      return h('p', null, data);
    };
    const { container } = mountApp(App);

    expect(container.textContent).toBe('loaded');
    expect(renders.mock.calls).toEqual([['loading'], ['loaded']]);
  });

  it('같은 렌더링의 effect가 모두 끝난 뒤에 한 번 다시 렌더링한다', () => {
    const log = [];
    const App = () => {
      const [a, setA] = useState(0);
      const [b, setB] = useState(0);
      log.push(`render ${a}${b}`);
      useEffect(() => {
        log.push('effect1');
        setA(1);
      }, []);
      useEffect(() => {
        log.push('effect2');
        setB(1);
      }, []);
      return h('p', null, `${a}${b}`);
    };
    const { container } = mountApp(App);

    expect(log).toEqual(['render 00', 'effect1', 'effect2', 'render 11']);
    expect(container.textContent).toBe('11');
  });

  it('후속 재렌더링도 diff·patch로 반영되어 DOM 객체가 유지된다', () => {
    let p;
    const App = () => {
      const [n, setN] = useState(0);
      useEffect(() => {
        p = p ?? document.querySelector('p');
        if (n < 3) setN(n + 1);
      }, [n]);
      return h('p', null, n);
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = new FunctionComponent(App);
    app.mount(container);

    expect(container.innerHTML).toBe('<p>3</p>');
    expect(container.firstChild).toBe(p);
    container.remove();
  });

  it('deps를 빼먹어 매번 setState하면 무한 반복 대신 에러를 던진다', () => {
    const App = () => {
      const [n, setN] = useState(0);
      useEffect(() => {
        setN(n + 1);
      });
      return h('p', null, n);
    };

    expect(() => mountApp(App)).toThrow(/재렌더링이 50번을 넘었습니다/);
  });

  it('한도는 연속 후속 재렌더링마다 새로 센다 (이벤트마다 다시 0부터)', () => {
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      const [m, setM] = useState(0);
      setN = _setN;
      // n이 바뀔 때마다 effect가 m을 40번 연속으로 올린다.
      useEffect(() => {
        if (m < n * 40) setM(m + 1);
      });
      return h('p', null, `${n},${m}`);
    };
    const { container } = mountApp(App);

    setN(1);
    setN(2);

    expect(container.textContent).toBe('2,80');
  });

  it('effect가 에러를 던지면 그 effect의 setState로 인한 재렌더링은 하지 않고, 이후 이벤트는 정상 동작한다', () => {
    let fail = false;
    let setN;
    const renders = vi.fn();
    const App = () => {
      const [n, _setN] = useState(0);
      const [x, setX] = useState(0);
      setN = _setN;
      renders();
      useEffect(() => {
        if (fail) {
          setX((v) => v + 1);
          throw new Error('effect 실패');
        }
      });
      return h('p', null, `${n},${x}`);
    };
    const { container } = mountApp(App);

    fail = true;
    expect(() => setN(1)).toThrow('effect 실패');
    expect(renders).toHaveBeenCalledTimes(2);

    fail = false;
    setN(2);
    expect(container.textContent).toBe('2,1');
  });
});

describe('useMemo', () => {
  function setup() {
    const filterTodos = vi.fn((todos, filter) => todos.filter((t) => filter === 'all' || t.done));
    let setTodos;
    let setFilter;
    let setText;
    const App = () => {
      const [todos, _setTodos] = useState([
        { title: 'a', done: true },
        { title: 'b', done: false },
      ]);
      const [filter, _setFilter] = useState('all');
      const [text, _setText] = useState('');
      setTodos = _setTodos;
      setFilter = _setFilter;
      setText = _setText;
      const visible = useMemo(() => filterTodos(todos, filter), [todos, filter]);
      return h('div', null, h('input', { value: text }), h('ul', null, visible.map((t) => h('li', null, t.title))));
    };
    const { container } = mountApp(App);
    return {
      filterTodos,
      container,
      setTodos: (v) => setTodos(v),
      setFilter: (v) => setFilter(v),
      setText: (v) => setText(v),
    };
  }

  it('첫 렌더링에 계산하고, 결과를 화면에 쓴다', () => {
    const { filterTodos, container } = setup();
    expect(filterTodos).toHaveBeenCalledTimes(1);
    expect(container.querySelector('ul').innerHTML).toBe('<li>a</li><li>b</li>');
  });

  it('deps와 관계없는 상태가 바뀌면 다시 계산하지 않고 이전 결과를 쓴다', () => {
    const { filterTodos, container, setText } = setup();
    setText('hi');
    setText('hello');
    expect(filterTodos).toHaveBeenCalledTimes(1);
    expect(container.querySelector('ul').innerHTML).toBe('<li>a</li><li>b</li>');
  });

  it('deps 중 하나라도 바뀌면 다시 계산한다', () => {
    const { filterTodos, container, setFilter, setTodos } = setup();

    setFilter('done');
    expect(filterTodos).toHaveBeenCalledTimes(2);
    expect(container.querySelector('ul').innerHTML).toBe('<li>a</li>');

    setTodos((todos) => [...todos, { title: 'c', done: true }]);
    expect(filterTodos).toHaveBeenCalledTimes(3);
    expect(container.querySelector('ul').innerHTML).toBe('<li>a</li><li>c</li>');
  });

  it('deps가 같으면 같은 결과 객체를 돌려준다 (참조 유지)', () => {
    const results = [];
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      const obj = useMemo(() => ({ v: 1 }), []);
      results.push(obj);
      return h('p', null, n);
    };
    mountApp(App);

    setN(1);

    expect(results[1]).toBe(results[0]);
  });

  it('deps를 생략하면 매 렌더링 다시 계산한다', () => {
    const compute = vi.fn(() => 1);
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      useMemo(compute);
      return h('p', null, n);
    };
    mountApp(App);

    setN(1);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('계산 함수 안에서 setState하면 렌더링 중 setState 에러', () => {
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      useMemo(() => setN(1), []);
      return h('p', null, n);
    };
    expect(() => mountApp(App)).toThrow(/렌더링 중에는 setState/);
  });
});

describe('Hook 규칙 — useEffect·useMemo', () => {
  it('자식 컴포넌트에서 useEffect·useMemo를 부르면 R-P2-03 에러', () => {
    const EffectChild = () => {
      useEffect(() => {});
      return h('span', null);
    };
    const MemoChild = () => {
      useMemo(() => 1, []);
      return h('span', null);
    };

    expect(() => mountApp(() => h('div', null, h(EffectChild)))).toThrow(/useEffect는 루트 컴포넌트에서만/);
    expect(() => mountApp(() => h('div', null, h(MemoChild)))).toThrow(/useMemo는 루트 컴포넌트에서만/);
  });

  it('개수는 같아도 Hook 종류의 순서가 바뀌면 에러', () => {
    let swap = false;
    let setN;
    const App = () => {
      const [n, _setN] = useState(0);
      setN = _setN;
      if (swap) {
        useMemo(() => 1, []);
        useEffect(() => {});
      } else {
        useEffect(() => {});
        useMemo(() => 1, []);
      }
      return h('p', null, n);
    };
    mountApp(App);
    swap = true;

    expect(() => setN(1)).toThrow(/Hook 순서가 렌더링마다 달라졌습니다 \(1번째: 이전 useEffect, 이번 useMemo\)/);
  });

  it('렌더링이 실패해 effect가 실행되지 않았으면, 다음 렌더링에서 실행된다', () => {
    let failChild = true;
    const effect = vi.fn();
    const Child = () => {
      if (failChild) throw new Error('자식 실패');
      return h('span', null);
    };
    const App = () => {
      useEffect(effect, []);
      return h('div', null, h(Child));
    };
    const container = document.createElement('div');
    const app = new FunctionComponent(App);

    expect(() => app.mount(container)).toThrow('자식 실패');
    expect(effect).not.toHaveBeenCalled();

    failChild = false;
    app.mount(container);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
