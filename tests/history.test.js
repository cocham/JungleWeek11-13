import { describe, it, expect } from 'vitest';
import { createHistory, cloneVdom } from '../src/history.js';

const t = (text) => ({ type: 'text', text });
const e = (tag, attrs = {}, children = []) => ({ type: 'element', tag, attrs, children });
const v = (title) => e('div', { id: 'r' }, [e('h1', {}, [t(title)])]);

describe('cloneVdom — VDOM 깊은 복사', () => {
  it('내용은 같고 attrs·children·자식 노드는 모두 새 객체다', () => {
    const original = e('ul', { class: 'a', disabled: '' }, [e('li', { 'data-id': '1' }, [t('x')]), t(' ')]);

    const copy = cloneVdom(original);

    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(copy.attrs).not.toBe(original.attrs);
    expect(copy.children).not.toBe(original.children);
    expect(copy.children[0]).not.toBe(original.children[0]);
    expect(copy.children[0].attrs).not.toBe(original.children[0].attrs);
    expect(copy.children[0].children[0]).not.toBe(original.children[0].children[0]);
  });
});

describe('createHistory — 저장과 이동', () => {
  it('초기 화면 하나로 시작한다: 어느 쪽으로도 갈 수 없다', () => {
    const history = createHistory(v('0'));

    expect(history.index).toBe(0);
    expect(history.length).toBe(1);
    expect(history.current()).toEqual(v('0'));
    expect(history.canBack()).toBe(false);
    expect(history.canForward()).toBe(false);
  });

  it('push하면 끝에 저장하고 그 위치로 간다', () => {
    const history = createHistory(v('0'));

    history.push(v('1'));
    history.push(v('2'));

    expect(history.length).toBe(3);
    expect(history.index).toBe(2);
    expect(history.current()).toEqual(v('2'));
    expect(history.canBack()).toBe(true);
    expect(history.canForward()).toBe(false);
  });

  it('back·forward는 한 칸씩 움직이며 그 화면을 돌려준다', () => {
    const history = createHistory(v('0'));
    history.push(v('1'));
    history.push(v('2'));

    expect(history.back()).toEqual(v('1'));
    expect(history.back()).toEqual(v('0'));
    expect(history.canBack()).toBe(false);
    expect(history.forward()).toEqual(v('1'));
    expect(history.forward()).toEqual(v('2'));
    expect(history.canForward()).toBe(false);
  });

  it('경계를 넘어 이동하면 에러를 던지고 위치는 그대로다', () => {
    const history = createHistory(v('0'));
    history.push(v('1'));

    expect(() => history.forward()).toThrow(/더 앞으로/);
    expect(history.index).toBe(1);
    history.back();
    expect(() => history.back()).toThrow(/더 뒤로/);
    expect(history.index).toBe(0);
  });

  it('과거 위치에서 push하면 그 뒤 기록을 버린다', () => {
    const history = createHistory(v('0'));
    history.push(v('1'));
    history.push(v('2'));
    history.push(v('3'));
    history.back();
    history.back(); // v1

    history.push(v('4'));

    expect(history.length).toBe(3);
    expect(history.index).toBe(2);
    expect(history.canForward()).toBe(false);
    expect(history.back()).toEqual(v('1'));
    expect(history.back()).toEqual(v('0'));
  });

  it('맨 처음 위치에서 push하면 초기 화면만 남기고 나머지를 버린다', () => {
    const history = createHistory(v('0'));
    history.push(v('1'));
    history.back();

    history.push(v('new'));

    expect(history.length).toBe(2);
    expect(history.back()).toEqual(v('0'));
    expect(history.forward()).toEqual(v('new'));
  });
});

describe('createHistory — 스냅샷 독립성', () => {
  it('저장한 뒤 원본 VDOM을 고쳐도 기록은 바뀌지 않는다', () => {
    const initial = v('0');
    const next = v('1');
    const history = createHistory(initial);
    history.push(next);

    initial.children[0].children[0].text = '고침';
    initial.attrs.id = '고침';
    next.children.push(t('추가'));

    expect(history.current()).toEqual(v('1'));
    expect(history.back()).toEqual(v('0'));
  });

  it('돌려받은 VDOM을 고쳐도 기록은 바뀌지 않는다', () => {
    const history = createHistory(v('0'));
    history.push(v('1'));

    const got = history.back();
    got.children[0].children[0].text = '고침';
    got.attrs.class = 'x';
    history.current().children.length = 0;

    expect(history.current()).toEqual(v('0'));
    expect(history.forward()).toEqual(v('1'));
    expect(history.back()).toEqual(v('0'));
  });
});
