# 09. VDOM → DOM — 요소 만들기 (태그·속성)

- 요구사항: R-P1-03 (변경된 부분만 실제 DOM에 반영, Patch)의 준비 단계
- 코드: `src/vdomToDom.js`의 `createElementDom`
- 테스트: `tests/vdomToDom.test.js`의 "createElementDom" 묶음
- 범위: 요소 VDOM의 태그와 속성으로 실제 요소를 만든다. 자식 재귀 생성과 patch 적용은 하지 않는다.
- 이전 노트: [08-vdom-to-dom-text.md](08-vdom-to-dom-text.md)

## 한 줄 요약
`document.createElement(tag)`로 요소를 만들고, `attrs`의 각 항목을 `setAttribute(이름, 값)`으로 넣는다. `children`은 아직 보지 않는다.

```js
createElementDom({ type: 'element', tag: 'button', attrs: { class: 'ok', disabled: '' }, children: [] })
// → <button class="ok" disabled=""></button>
```

## 확인한 것

| 입력 attrs | 결과 |
|---|---|
| `{}` | 속성 0개인 빈 요소 |
| `{ href, class, title }` | 세 속성 모두 같은 값으로 설정 |
| `{ disabled: '' }` | `hasAttribute('disabled') === true`, 값 `''`, `button.disabled === true` |
| `{ 'data-id': '42', 'data-user-name': 'kim' }` | `getAttribute`로 그대로 읽히고, `dataset.id`, `dataset.userName`으로도 읽힘 |

그리고 `children`이 있어도 자식 노드를 만들지 않는지, `domToVdom`으로 되돌리면 원래 VDOM과 같은지도 확인했다.

## 이번 작업에서 정한 것
- **프로퍼티 대입이 아니라 `setAttribute`를 쓴다:** VDOM의 `attrs`는 HTML에 적힌 속성(이름 → 문자열 값)이다. `button.disabled = ''`처럼 프로퍼티에 넣으면 `''`가 false로 바뀌어 속성이 오히려 사라진다. `setAttribute('disabled', '')`는 "값이 빈 문자열인 속성이 있다"는 뜻이라, `domToVdom`이 읽어 들인 의미와 같다.
- **`data-*`도 따로 처리하지 않는다:** 이름 그대로 `setAttribute`하면 브라우저가 `dataset`에 자동으로 반영한다.
- **태그 이름은 VDOM의 소문자 그대로 넘긴다:** HTML 문서에서 `createElement`는 대소문자를 가리지 않고, `tagName`은 `'DIV'`처럼 대문자로 돌려준다(`domToVdom`이 소문자로 맞춤).

## 아직 빠진 것 → 다음 작업
- 자식 재귀 생성 (텍스트·요소 자식을 `createTextDom`/`createElementDom`으로 만들어 붙이기)
- patch 목록을 실제 DOM에 적용하는 함수

## 질문 기록
