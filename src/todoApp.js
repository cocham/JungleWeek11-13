import { h } from './h.js';
import { FunctionComponent, useState, useEffect, useMemo } from './component.js';

// Phase 1·2 엔진으로 만든 Todo 앱. (R-APP-01, R-APP-02)
//
// 컴포넌트 구조 — 상태는 루트(TodoApp)에만 있고, 자식은 props만 받아 그린다(Lifting State Up, R-P2-04).
//
//   TodoApp            상태: todos, text, filter   Hook: useState·useMemo·useEffect
//   ├ TodoForm         text, onTextChange, onSubmit
//   ├ FilterBar        filter, onChange
//   ├ TodoList         todos, onToggle, onDelete    (보여 줄 항목이 없으면 EmptyMessage)
//   │ └ TodoItem       todo, onToggle, onDelete
//   └ Summary          remaining, total
//
// 사용자 행동 → setState → (microtask) 재렌더링 → diff → patch 흐름은 엔진이 처리한다.
// 화면 옆 "엔진 동작" 패널은 그 결과(렌더링 횟수, 마지막 patch 목록)를 보여 준다.

export const FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '진행 중' },
  { value: 'done', label: '완료' },
];

export const SAMPLE_TODOS = [
  { id: 1, title: 'Virtual DOM 만들기', done: true },
  { id: 2, title: 'Diff·Patch 만들기', done: true },
  { id: 3, title: 'Hook 만들기', done: false },
];

// ── 루트 컴포넌트: 상태와 상태를 바꾸는 함수를 모두 가진다 ──
export function TodoApp({ initialTodos = [] }) {
  const [todos, setTodos] = useState(initialTodos);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('all');

  // 필터 결과는 todos·filter가 바뀔 때만 다시 계산한다. 입력창에 글자를 칠 때(text만 바뀜)는 이전 결과를 쓴다.
  const visibleTodos = useMemo(() => todos.filter((todo) => matchesFilter(todo, filter)), [todos, filter]);
  const remaining = useMemo(() => todos.filter((todo) => !todo.done).length, [todos]);

  // 화면 밖(문서 제목)을 바꾸는 일은 렌더링이 아니라 effect에서 한다. 남은 개수가 바뀔 때만 실행된다.
  useEffect(() => {
    document.title = `할 일 ${remaining}개 남음 · Mini React`;
  }, [remaining]);

  const addTodo = (event) => {
    // form 제출의 기본 동작(페이지 새로고침)을 막는다.
    event.preventDefault();
    const title = text.trim();
    if (title === '') {
      return;
    }
    // 두 setState는 하나의 렌더링으로 묶인다(Batching). "목록엔 추가됐는데 입력창은 그대로"인 중간 화면이 없다.
    // 상태는 고치지 않고 새 배열을 만든다. 그래야 Object.is 비교와 useMemo deps가 변경을 알아챈다.
    setTodos((prev) => [...prev, { id: nextId(prev), title, done: false }]);
    setText('');
  };

  const toggleTodo = (id) => {
    setTodos((prev) => prev.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)));
  };

  const deleteTodo = (id) => {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  };

  return h(
    'section',
    { class: 'todo-app' },
    h('h1', null, '오늘 할 일'),
    h(TodoForm, { text, onTextChange: setText, onSubmit: addTodo }),
    h(FilterBar, { filter, onChange: setFilter }),
    visibleTodos.length === 0
      ? h(EmptyMessage, { filter })
      : h(TodoList, { todos: visibleTodos, onToggle: toggleTodo, onDelete: deleteTodo }),
    h(Summary, { remaining, total: todos.length }),
  );
}

// ── 자식 컴포넌트: props만 받아 VDOM을 돌려주는 순수 함수 ──

function TodoForm({ text, onTextChange, onSubmit }) {
  return h(
    'form',
    { class: 'todo-form', onSubmit },
    h('input', {
      type: 'text',
      value: text,
      placeholder: '할 일을 입력하세요',
      'aria-label': '새 할 일',
      // 입력할 때마다 루트의 text 상태를 바꾼다. 화면의 입력창은 그 상태를 그대로 보여 준다(제어 컴포넌트).
      onInput: (event) => onTextChange(event.target.value),
    }),
    h('button', { type: 'submit', disabled: text.trim() === '' }, '추가'),
  );
}

function FilterBar({ filter, onChange }) {
  return h(
    'div',
    { class: 'filters', role: 'group', 'aria-label': '필터' },
    FILTERS.map(({ value, label }) =>
      h(
        'button',
        {
          type: 'button',
          class: value === filter ? 'filter selected' : 'filter',
          'aria-pressed': String(value === filter),
          onClick: () => onChange(value),
        },
        label,
      ),
    ),
  );
}

function TodoList({ todos, onToggle, onDelete }) {
  return h(
    'ul',
    { class: 'todo-list' },
    todos.map((todo) =>
      h(TodoItem, { todo, onToggle: () => onToggle(todo.id), onDelete: () => onDelete(todo.id) }),
    ),
  );
}

function TodoItem({ todo, onToggle, onDelete }) {
  return h(
    'li',
    { class: todo.done ? 'todo done' : 'todo' },
    h(
      'label',
      null,
      h('input', { type: 'checkbox', checked: todo.done, onChange: onToggle }),
      h('span', { class: 'title' }, todo.title),
    ),
    h('button', { type: 'button', class: 'delete', 'aria-label': `${todo.title} 삭제`, onClick: onDelete }, '삭제'),
  );
}

function EmptyMessage({ filter }) {
  const messages = {
    all: '할 일이 없습니다. 위에서 추가해 보세요.',
    active: '진행 중인 일이 없습니다.',
    done: '완료한 일이 없습니다.',
  };
  return h('p', { class: 'empty' }, messages[filter]);
}

function Summary({ remaining, total }) {
  return h('p', { class: 'summary' }, `남은 일 ${remaining}개 / 전체 ${total}개`);
}

function matchesFilter(todo, filter) {
  if (filter === 'active') return !todo.done;
  if (filter === 'done') return todo.done;
  return true;
}

function nextId(todos) {
  return todos.reduce((max, todo) => Math.max(max, todo.id), 0) + 1;
}

// ── 엔진 동작 패널 ──

// FunctionComponent를 그대로 쓰되, 화면에 반영할 때마다 결과를 알려 주도록 감싼다.
// 엔진 코드는 바꾸지 않는다. 패널도 VDOM 밖에서 직접 DOM을 고친다(패널 갱신이 앱의 렌더링 횟수에 섞이지 않게).
class InspectedComponent extends FunctionComponent {
  constructor(component, props, onCommit) {
    super(component, props);
    this.onCommit = onCommit;
    this.commitCount = 0;
  }

  mount(container) {
    super.mount(container);
    this.commitCount += 1;
    this.onCommit({ kind: 'mount', count: this.commitCount, patches: null });
  }

  update() {
    const patches = super.update();
    this.commitCount += 1;
    this.onCommit({ kind: 'update', count: this.commitCount, patches });
    return patches;
  }
}

// app.html의 요소를 찾아 앱을 mount하고 패널을 연결한다.
export function setupTodoApp(doc = document, initialTodos = SAMPLE_TODOS) {
  const container = doc.getElementById('app');
  const renderCount = doc.getElementById('render-count');
  const patchSummary = doc.getElementById('patch-summary');
  const patchLog = doc.getElementById('patch-log');

  const showCommit = ({ kind, count, patches }) => {
    renderCount.textContent = String(count);
    patchLog.replaceChildren();
    if (kind === 'mount') {
      patchSummary.textContent = '첫 렌더링(mount): VDOM 전체를 실제 DOM으로 만들었습니다.';
      return;
    }
    if (patches.length === 0) {
      patchSummary.textContent = '다시 렌더링했지만 바뀐 곳이 없어 실제 DOM을 건드리지 않았습니다.';
      return;
    }
    if (patches.every((p) => p.type === 'EVENTS')) {
      // 렌더링마다 새 화살표 함수가 생기므로 상태가 같아도 EVENTS는 나온다. 눈에 보이는 DOM 변화는 없다.
      patchSummary.textContent = `보이는 변화 없음 — 핸들러 함수 ${patches.length}개만 새것으로 교체했습니다.`;
      return;
    }
    patchSummary.textContent = `patch ${patches.length}개 — ${countByType(patches)}`;
    for (const line of describePatches(patches)) {
      const item = doc.createElement('li');
      item.textContent = line;
      patchLog.appendChild(item);
    }
  };

  const app = new InspectedComponent(TodoApp, { initialTodos }, showCommit);
  app.mount(container);
  return app;
}

// "TEXT 1 · ATTRS 2 · EVENTS 8"
export function countByType(patches) {
  const counts = new Map();
  for (const p of patches) {
    counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  }
  return [...counts].map(([type, n]) => `${type} ${n}`).join(' · ');
}

// patch를 사람이 읽을 수 있는 줄로 바꾼다.
// EVENTS는 렌더링마다 새 화살표 함수가 생겨 거의 모든 핸들러에서 나오므로, 한 줄로 묶어 다른 변경이 묻히지 않게 한다.
export function describePatches(patches) {
  const lines = [];
  let events = 0;
  for (const p of patches) {
    const at = `[${p.path.join(', ')}]`;
    if (p.type === 'TEXT') {
      lines.push(`TEXT ${at} → "${p.text}"`);
    } else if (p.type === 'ATTRS') {
      const set = Object.entries(p.set).map(([name, value]) => `${name}="${value}"`);
      const remove = p.remove.map((name) => `-${name}`);
      lines.push(`ATTRS ${at} ${[...set, ...remove].join(' ')}`);
    } else if (p.type === 'REPLACE') {
      lines.push(`REPLACE ${at} → <${p.node.tag ?? '#text'}>`);
    } else if (p.type === 'ADD') {
      lines.push(`ADD ${at} <${p.node.tag ?? '#text'}>`);
    } else if (p.type === 'REMOVE') {
      lines.push(`REMOVE ${at}`);
    } else if (p.type === 'EVENTS') {
      events += 1;
    }
  }
  if (events > 0) {
    lines.push(`EVENTS ×${events} (새로 만든 핸들러 함수로 교체)`);
  }
  return lines;
}
