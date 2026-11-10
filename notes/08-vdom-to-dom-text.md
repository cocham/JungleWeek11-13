# 08. VDOM → DOM — 텍스트 노드 만들기

- 요구사항: R-P1-03 (변경된 부분만 실제 DOM에 반영, Patch)의 준비 단계
- 코드: `src/vdomToDom.js`의 `createTextDom`
- 테스트: `tests/vdomToDom.test.js`
- 범위: 텍스트 VDOM으로 실제 텍스트 노드를 만드는 것만 한다. 요소 생성과 patch 적용은 하지 않는다.
- 이전 노트: [07-diff-children.md](07-diff-children.md)

## 한 줄 요약
`{ type: 'text', text }`를 받아 `document.createTextNode(text)`로 실제 텍스트 노드를 돌려준다. `domToVdom`의 텍스트 부분을 거꾸로 하는 함수다.

```js
createTextDom({ type: 'text', text: 'hello' })  // → Text 노드, textContent === 'hello'
```

## 왜 필요한가
diff가 내는 REPLACE·ADD patch에는 새 VDOM 노드(`node`)가 들어 있다. 이걸 화면에 넣으려면 VDOM을 실제 DOM 노드로 바꾸는 함수가 필요하다. 가장 단순한 텍스트부터 만든다.

## 확인한 것

| 입력 text | 결과 textContent | 비고 |
|---|---|---|
| `'hello'` | `'hello'` | 일반 문자열 |
| `''` | `''` | 노드는 만들어진다. 부모에 넣으면 자식 수에 포함된다 |
| `'  a   b '` | `'  a   b '` | 앞·뒤·사이 공백 그대로 |
| `'\n\t  '` | `'\n\t  '` | 공백뿐인 텍스트도 그대로 |

그리고 `domToVdom(createTextDom(v))`가 `v`와 같은지(되돌리기)도 확인했다.

## 이번 작업에서 정한 것
- **`createTextNode`를 쓴다(`innerHTML` 아님):** 글자를 HTML로 해석하지 않고, 공백도 다듬지 않는다.
- **빈 문자열이어도 노드를 만든다:** diff의 TEXT patch가 `''`로 바꾸는 것을 "노드 삭제"가 아니라 "글자 비우기"로 다루기로 했으니, 생성할 때도 노드를 남겨 자식 인덱스(path)가 어긋나지 않게 한다.
- **호출할 때마다 새 노드를 만든다:** 같은 DOM 노드는 한 곳에만 있을 수 있으므로, 공유하지 않는다.

## 아직 빠진 것 → 다음 작업
- 요소 VDOM → 실제 요소 (속성 설정, 자식 재귀 생성)
- patch 목록을 실제 DOM에 적용하는 함수

## 질문 기록
