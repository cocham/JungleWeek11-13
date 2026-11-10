import { describe, it, expect } from 'vitest';
import { domToVdom } from '../src/domToVdom.js';

describe('domToVdom — 텍스트 노드', () => {
  it('텍스트 노드를 text VDOM으로 바꾼다', () => {
    const node = document.createTextNode('hello');

    expect(domToVdom(node)).toEqual({ type: 'text', text: 'hello' });
  });

  it('앞뒤 공백을 그대로 보존한다', () => {
    const node = document.createTextNode('  hello ');

    expect(domToVdom(node)).toEqual({ type: 'text', text: '  hello ' });
  });

  it('공백뿐인 텍스트(줄바꿈 포함)도 버리지 않는다', () => {
    const node = document.createTextNode('\n  ');

    expect(domToVdom(node)).toEqual({ type: 'text', text: '\n  ' });
  });

  it('빈 문자열 텍스트도 그대로 바꾼다', () => {
    const node = document.createTextNode('');

    expect(domToVdom(node)).toEqual({ type: 'text', text: '' });
  });
});

describe('domToVdom — 자식 없는 요소', () => {
  it('속성 없는 요소는 빈 attrs와 빈 children을 갖는다', () => {
    const node = document.createElement('div');

    expect(domToVdom(node)).toEqual({
      type: 'element',
      tag: 'div',
      attrs: {},
      children: [],
    });
  });

  it('태그 이름을 소문자로 바꾼다', () => {
    // HTML 파서로 만든 요소의 tagName은 대문자('SPAN')다.
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<SPAN></SPAN>';
    const node = wrapper.firstChild;

    expect(node.tagName).toBe('SPAN');
    expect(domToVdom(node).tag).toBe('span');
  });

  it('속성을 이름-값 객체로 바꾼다', () => {
    const node = document.createElement('input');
    node.setAttribute('id', 'name');
    node.setAttribute('class', 'field');
    node.setAttribute('type', 'text');

    expect(domToVdom(node)).toEqual({
      type: 'element',
      tag: 'input',
      attrs: { id: 'name', class: 'field', type: 'text' },
      children: [],
    });
  });

  it('값 없는 속성은 빈 문자열이 된다', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<button disabled></button>';

    expect(domToVdom(wrapper.firstChild).attrs).toEqual({ disabled: '' });
  });

  it('data-* 속성과 공백이 든 속성값을 그대로 보존한다', () => {
    const node = document.createElement('p');
    node.setAttribute('data-user-id', '42');
    node.setAttribute('title', '  hi there ');

    expect(domToVdom(node).attrs).toEqual({
      'data-user-id': '42',
      title: '  hi there ',
    });
  });
});

// HTML 문자열로 요소를 만든다. innerHTML 파서를 쓰면 공백 텍스트 노드까지 실제처럼 생긴다.
function fromHTML(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  return wrapper.firstChild;
}

describe('domToVdom — 직계 자식', () => {
  it('텍스트 자식 하나를 children에 담는다', () => {
    expect(domToVdom(fromHTML('<p>hello</p>'))).toEqual({
      type: 'element',
      tag: 'p',
      attrs: {},
      children: [{ type: 'text', text: 'hello' }],
    });
  });

  it('요소 자식 하나를 children에 담는다', () => {
    expect(domToVdom(fromHTML('<div><span id="a"></span></div>')).children).toEqual([
      { type: 'element', tag: 'span', attrs: { id: 'a' }, children: [] },
    ]);
  });

  it('텍스트와 요소가 섞인 자식을 순서대로 담는다', () => {
    expect(domToVdom(fromHTML('<p>hi <b>there</b>!</p>')).children).toEqual([
      { type: 'text', text: 'hi ' },
      { type: 'element', tag: 'b', attrs: {}, children: [{ type: 'text', text: 'there' }] },
      { type: 'text', text: '!' },
    ]);
  });

  it('요소 사이의 공백 텍스트 노드를 보존한다', () => {
    expect(domToVdom(fromHTML('<p><b>a</b> <i>b</i></p>')).children).toEqual([
      { type: 'element', tag: 'b', attrs: {}, children: [{ type: 'text', text: 'a' }] },
      { type: 'text', text: ' ' },
      { type: 'element', tag: 'i', attrs: {}, children: [{ type: 'text', text: 'b' }] },
    ]);
  });

  it('들여쓰기 줄바꿈 공백도 텍스트 자식으로 보존한다', () => {
    const vdom = domToVdom(fromHTML('<ul>\n  <li>one</li>\n</ul>'));

    expect(vdom.children).toEqual([
      { type: 'text', text: '\n  ' },
      { type: 'element', tag: 'li', attrs: {}, children: [{ type: 'text', text: 'one' }] },
      { type: 'text', text: '\n' },
    ]);
  });

  it('주석 노드는 children에서 빠진다', () => {
    expect(domToVdom(fromHTML('<p>a<!-- memo -->b</p>')).children).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });
});

describe('domToVdom — 중첩 자식', () => {
  it('여러 단계로 중첩된 자식을 끝까지 변환한다', () => {
    const html = '<section class="card"><div><p>hi <b>there</b></p></div></section>';

    expect(domToVdom(fromHTML(html))).toEqual({
      type: 'element',
      tag: 'section',
      attrs: { class: 'card' },
      children: [
        {
          type: 'element',
          tag: 'div',
          attrs: {},
          children: [
            {
              type: 'element',
              tag: 'p',
              attrs: {},
              children: [
                { type: 'text', text: 'hi ' },
                { type: 'element', tag: 'b', attrs: {}, children: [{ type: 'text', text: 'there' }] },
              ],
            },
          ],
        },
      ],
    });
  });

  it('중첩된 자식의 속성과 형제 순서를 보존한다', () => {
    const html = '<ul id="list"><li data-id="1">one</li><li data-id="2"><a href="/two">two</a></li></ul>';

    expect(domToVdom(fromHTML(html))).toEqual({
      type: 'element',
      tag: 'ul',
      attrs: { id: 'list' },
      children: [
        { type: 'element', tag: 'li', attrs: { 'data-id': '1' }, children: [{ type: 'text', text: 'one' }] },
        {
          type: 'element',
          tag: 'li',
          attrs: { 'data-id': '2' },
          children: [
            { type: 'element', tag: 'a', attrs: { href: '/two' }, children: [{ type: 'text', text: 'two' }] },
          ],
        },
      ],
    });
  });

  it('깊은 곳의 공백 텍스트도 보존한다', () => {
    const vdom = domToVdom(fromHTML('<div><p>  <span> x </span>  </p></div>'));

    expect(vdom.children[0].children).toEqual([
      { type: 'text', text: '  ' },
      { type: 'element', tag: 'span', attrs: {}, children: [{ type: 'text', text: ' x ' }] },
      { type: 'text', text: '  ' },
    ]);
  });
});
