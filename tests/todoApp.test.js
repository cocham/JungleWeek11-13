import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupTodoApp, describePatches, countByType, SAMPLE_TODOS } from '../src/todoApp.js';
import { flushSync } from '../src/component.js';

// 실제 app.html의 <body>를 그대로 쓴다. id가 페이지와 어긋나면 테스트가 잡도록 하기 위해서다.
// (innerHTML로 넣은 <script>는 실행되지 않으므로 setupTodoApp은 테스트가 직접 부른다.)
const pageHTML = readFileSync(join(import.meta.dirname, '..', 'app.html'), 'utf8');
const pageBody = new DOMParser().parseFromString(pageHTML, 'text/html').body.innerHTML;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const titles = () => $$('.todo .title').map((el) => el.textContent);
const checks = () => $$('.todo input[type=checkbox]').map((el) => el.checked);
const summary = () => $('.summary').textContent;
const renderCount = () => Number($('#render-count').textContent);
const patchLog = () => $$('#patch-log li').map((li) => li.textContent);
const filterButton = (label) => $$('.filter').find((b) => b.textContent === label);
const itemByTitle = (title) => $$('.todo').find((li) => li.querySelector('.title').textContent === title);

// 사용자 동작을 흉내 낸다. 동작 뒤 예약된 재렌더링까지 바로 처리해 화면을 확인한다.
function type(text) {
  const input = $('.todo-form input');
  flushSync(() => {
    input.value = text;
    input.dispatchEvent(new Event('input'));
  });
}
function submit() {
  flushSync(() => $('.todo-form').dispatchEvent(new Event('submit', { cancelable: true })));
}
function click(element) {
  flushSync(() => element.click());
}

let app;
beforeEach(() => {
  document.body.innerHTML = pageBody;
  document.title = '';
  app = setupTodoApp(document, SAMPLE_TODOS.map((todo) => ({ ...todo })));
});

describe('Todo 앱 — 첫 화면', () => {
  it('샘플 할 일·필터·남은 개수를 그리고, 패널에 첫 렌더링을 표시한다', () => {
    expect(titles()).toEqual(['Virtual DOM 만들기', 'Diff·Patch 만들기', 'Hook 만들기']);
    expect(checks()).toEqual([true, true, false]);
    expect(summary()).toBe('남은 일 1개 / 전체 3개');
    expect(filterButton('전체').getAttribute('aria-pressed')).toBe('true');
    expect($('.todo-form button').disabled).toBe(true);
    expect(renderCount()).toBe(1);
    expect($('#patch-summary').textContent).toMatch(/첫 렌더링/);
  });

  it('useEffect가 남은 개수로 문서 제목을 바꾼다', () => {
    expect(document.title).toBe('할 일 1개 남음 · Mini React');
  });
});

describe('Todo 앱 — 추가', () => {
  it('입력하면 추가 버튼이 켜지고, 제출하면 목록 끝에 추가되고 입력창이 비워진다', () => {
    type('  Batching 만들기  ');
    expect($('.todo-form button').disabled).toBe(false);

    submit();

    expect(titles()).toEqual(['Virtual DOM 만들기', 'Diff·Patch 만들기', 'Hook 만들기', 'Batching 만들기']);
    expect(checks()).toEqual([true, true, false, false]);
    // 사용자가 친 글자(property)까지 비워진다.
    expect($('.todo-form input').value).toBe('');
    expect($('.todo-form button').disabled).toBe(true);
    expect(summary()).toBe('남은 일 2개 / 전체 4개');
    expect(document.title).toBe('할 일 2개 남음 · Mini React');
  });

  it('setTodos와 setText 두 번의 setState가 한 번의 렌더링으로 묶이고, 패널에 ADD가 보인다', () => {
    type('새 일');
    const before = renderCount();

    submit();

    expect(renderCount()).toBe(before + 1);
    expect(patchLog()).toContain('ADD [3, 3] <li>');
  });

  it('기존 항목의 DOM 노드는 새로 만들지 않는다', () => {
    const [first, second] = $$('.todo');

    type('새 일');
    submit();

    expect($$('.todo')[0]).toBe(first);
    expect($$('.todo')[1]).toBe(second);
  });

  it('빈 문자열·공백만 입력하면 추가하지 않는다', () => {
    type('   ');
    expect($('.todo-form button').disabled).toBe(true);

    submit(); // 버튼이 꺼져 있어도 Enter 제출 등을 막는지 확인

    expect(titles()).toHaveLength(3);
  });

  it('제출의 기본 동작(새로고침)을 막는다', () => {
    type('x');
    const event = new Event('submit', { cancelable: true });
    flushSync(() => $('.todo-form').dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
  });
});

describe('Todo 앱 — 완료 체크·삭제', () => {
  it('체크하면 완료 표시·남은 개수·문서 제목이 바뀌고, 그 li는 같은 DOM 객체다', () => {
    const li = itemByTitle('Hook 만들기');

    click(li.querySelector('input'));

    expect(li.className).toBe('todo done');
    expect(itemByTitle('Hook 만들기')).toBe(li);
    expect(summary()).toBe('남은 일 0개 / 전체 3개');
    expect(document.title).toBe('할 일 0개 남음 · Mini React');
    // li의 class와 그 안 checkbox의 checked는 서로 다른 노드라 ATTRS도 따로 나온다.
    expect(patchLog()).toEqual(expect.arrayContaining(['ATTRS [3, 2] class="todo done"', 'ATTRS [3, 2, 0, 0] checked=""']));
  });

  it('체크를 다시 풀면 원래대로 돌아온다', () => {
    const box = itemByTitle('Virtual DOM 만들기').querySelector('input');

    click(box);

    expect(box.checked).toBe(false);
    expect(itemByTitle('Virtual DOM 만들기').className).toBe('todo');
    expect(summary()).toBe('남은 일 2개 / 전체 3개');
  });

  it('가운데 항목을 지우면 뒤 항목이 당겨진다. 같은 자리의 체크 상태도 새 항목을 따른다', () => {
    click(itemByTitle('Diff·Patch 만들기').querySelector('.delete'));

    expect(titles()).toEqual(['Virtual DOM 만들기', 'Hook 만들기']);
    // key가 없어 인덱스로 비교하므로 [1] 자리의 li가 "Hook 만들기"로 고쳐진다(완료 → 미완료).
    expect(checks()).toEqual([true, false]);
    expect(patchLog()).toEqual(
      expect.arrayContaining(['TEXT [3, 1, 0, 1, 0] → "Hook 만들기"', 'REMOVE [3, 2]']),
    );
  });

  it('사용자가 클릭했던 체크박스가 다른 항목 자리로 재사용돼도 그 항목의 체크 상태를 보여 준다', () => {
    // [1] Diff·Patch의 체크박스를 두 번 클릭(해제 → 다시 체크). 이제 이 체크박스는 "사용자가 만진" 상태다.
    const box1 = $$('.todo input')[1];
    click(box1);
    click(box1);

    // [0]을 지우면 [1] 자리에 미완료인 Hook 만들기가 온다. 같은 체크박스를 고쳐 쓰므로 체크가 풀려야 한다.
    click(itemByTitle('Virtual DOM 만들기').querySelector('.delete'));

    expect(titles()).toEqual(['Diff·Patch 만들기', 'Hook 만들기']);
    expect($$('.todo input')[1]).toBe(box1);
    expect(checks()).toEqual([true, false]);
  });

  it('모두 지우면 빈 목록 안내로 바뀐다 (ul → p REPLACE)', () => {
    for (let i = 0; i < 3; i++) {
      click($('.todo .delete'));
    }

    expect($('.todo-list')).toBeNull();
    expect($('.empty').textContent).toBe('할 일이 없습니다. 위에서 추가해 보세요.');
    expect(summary()).toBe('남은 일 0개 / 전체 0개');
    expect(patchLog()).toContain('REPLACE [3] → <p>');
  });
});

describe('Todo 앱 — 필터', () => {
  it('진행 중·완료·전체 필터가 목록과 선택 표시를 바꾼다', () => {
    click(filterButton('진행 중'));
    expect(titles()).toEqual(['Hook 만들기']);
    expect(filterButton('진행 중').getAttribute('aria-pressed')).toBe('true');
    expect(filterButton('전체').getAttribute('aria-pressed')).toBe('false');

    click(filterButton('완료'));
    expect(titles()).toEqual(['Virtual DOM 만들기', 'Diff·Patch 만들기']);
    expect(checks()).toEqual([true, true]);

    click(filterButton('전체'));
    expect(titles()).toHaveLength(3);
  });

  it('필터를 바꿔 같은 자리에 다른 항목이 와도 체크 상태가 맞다', () => {
    // 전체: [0]=Virtual DOM(완료) → 진행 중: [0]=Hook(미완료). 같은 li·checkbox를 고쳐 쓴다.
    const firstBox = $('.todo input');

    click(filterButton('진행 중'));

    expect($('.todo input')).toBe(firstBox);
    expect(firstBox.checked).toBe(false);
  });

  it('진행 중 필터에서 완료로 체크하면 목록에서 빠지고, 남은 게 없으면 안내 문구가 나온다', () => {
    click(filterButton('진행 중'));

    click(itemByTitle('Hook 만들기').querySelector('input'));

    expect($('.empty').textContent).toBe('진행 중인 일이 없습니다.');
    expect(summary()).toBe('남은 일 0개 / 전체 3개');
  });

  it('미완료가 2개 이상인 진행 중 필터에서 첫 항목을 완료하면, 그 자리에 온 다음 항목은 체크되지 않은 채로 보인다', () => {
    // 클릭이 checked 프로퍼티를 먼저 켠다. 옛 [0]·새 [0] 모두 미완료라 ATTRS patch가 없어도 화면 값이 상태를 따라야 한다.
    type('Batching 만들기');
    submit();
    click(filterButton('진행 중'));
    const firstBox = $('.todo input');

    click(firstBox);

    expect(titles()).toEqual(['Batching 만들기']);
    expect($('.todo input')).toBe(firstBox);
    expect(checks()).toEqual([false]);
    expect(summary()).toBe('남은 일 1개 / 전체 4개');
  });

  it('이미 선택된 필터를 다시 누르면 상태가 같아 렌더링하지 않는다', () => {
    const before = renderCount();

    click(filterButton('전체'));

    expect(renderCount()).toBe(before);
  });

  it('입력창에 글자를 쳐도 목록·필터 결과는 바뀌지 않고, patch는 입력창·버튼 쪽만 나온다', () => {
    type('a');

    const lines = patchLog();
    expect(lines).toContain('ATTRS [1, 0] value="a"');
    expect(lines).toContain('ATTRS [1, 1] -disabled');
    // 목록 쪽 구조 변경(ADD/REMOVE/REPLACE/TEXT)은 없다.
    expect(lines.filter((line) => /^(ADD|REMOVE|REPLACE|TEXT)/.test(line))).toEqual([]);
  });
});

describe('엔진 동작 패널 — patch 설명', () => {
  it('종류별 개수를 센다', () => {
    expect(countByType([{ type: 'TEXT' }, { type: 'EVENTS' }, { type: 'EVENTS' }])).toBe('TEXT 1 · EVENTS 2');
  });

  it('EVENTS는 한 줄로 묶고, 나머지는 위치와 내용을 보여 준다', () => {
    const lines = describePatches([
      { type: 'TEXT', path: [0], text: 'a' },
      { type: 'ATTRS', path: [], set: { class: 'x' }, remove: ['id'] },
      { type: 'EVENTS', path: [1], set: {}, remove: [] },
      { type: 'REPLACE', path: [2], node: { type: 'text', text: 't' } },
      { type: 'ADD', path: [3], node: { type: 'element', tag: 'li' } },
      { type: 'REMOVE', path: [4] },
      { type: 'EVENTS', path: [2], set: {}, remove: [] },
    ]);

    expect(lines).toEqual([
      'TEXT [0] → "a"',
      'ATTRS [] class="x" -id',
      'REPLACE [2] → <#text>',
      'ADD [3] <li>',
      'REMOVE [4]',
      'EVENTS ×2 (새로 만든 핸들러 함수로 교체)',
    ]);
  });

  it('상태가 같은 재렌더링은 핸들러만 교체되므로 "보이는 변화 없음"으로 표시한다', () => {
    flushSync(() => app.update());

    expect($('#patch-summary').textContent).toMatch(/^보이는 변화 없음 — 핸들러 함수 \d+개만/);
    expect(patchLog()).toEqual([]);
  });
});
