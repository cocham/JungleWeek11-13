# 07. Diff — 자식 추가·삭제 (ADD / REMOVE patch)

- 요구사항: R-P1-02 (두 Virtual DOM을 비교해 변경된 부분을 찾는 Diff 알고리즘)
- 코드: `src/diff.js`의 `diffChildren`
- 테스트: `tests/diff.test.js`의 "빈 자식 배열 ↔ 여러 자식", "기존 자식 변경과 추가·삭제가 함께", "patch를 순서대로 적용하면 새 트리가 된다"
- 범위: 같은 인덱스끼리 비교하는 방식은 그대로 두고, 자식 개수가 다를 때 남는 자식을 ADD/REMOVE로 낸다. key 기반 비교와 실제 DOM 반영(R-P1-03)은 하지 않는다.
- 이전 노트: [06-diff-replace.md](06-diff-replace.md)

## 한 줄 요약
짧은 쪽 길이만큼은 같은 인덱스끼리 비교하고, **남는 새 자식은 ADD, 남는 옛 자식은 REMOVE**로 낸다.

```js
{ type: 'ADD',    path, node }  // path = 새 트리에서의 위치, node = 새 VDOM 노드(자식 포함)
{ type: 'REMOVE', path }        // path = 옛 트리에서의 위치
```

## path 기준

```
old: [a, b, c, d]          old: [a, b]
new: [a', b']              new: [a', b', c, d]
      0  1  ← 공통 구간          0  1  ← 공통 구간
REMOVE [3], [2]            ADD [2], [3]
```

- **공통 구간(0 ~ 짧은 쪽 길이-1)**: old와 new에서 인덱스가 같다. 그래서 TEXT·ATTRS·REPLACE의 path는 어느 트리 기준으로 봐도 같다.
- **ADD**: 새 트리에서 그 노드가 놓일 인덱스.
- **REMOVE**: 옛 트리에서 지울 노드의 인덱스.
- 한 부모에서 자식은 늘거나 줄거나 둘 중 하나라서, 같은 부모에 ADD와 REMOVE가 함께 나오지 않는다.

## 적용 순서 (여러 노드를 지울 때)

약속: **patch 배열을 앞에서부터 차례로 적용하면, 각 path는 그 시점의 트리에서 정확한 위치를 가리킨다.**

- REMOVE는 **내림차순**(큰 인덱스부터)으로 낸다.
  - 오름차순이면: `[a,b,c,d]`에서 [2](c)를 지운 순간 d가 [2]로 당겨진다. 다음 patch인 [3]은 존재하지 않는 위치가 된다.
  - 내림차순이면: [3](d)부터 지우므로, 아직 안 지운 앞쪽 노드의 인덱스는 그대로다.
- ADD는 **오름차순**으로 낸다. 각 ADD 시점에 path의 인덱스는 부모의 현재 자식 수와 같으므로 그냥 "끝에 붙이기"가 된다.
- 부모 하나 안에서는 `부모 ATTRS → 공통 자식들(깊이 우선) → ADD 또는 REMOVE` 순서로 담긴다. 공통 자식들은 ADD·REMOVE보다 앞 인덱스라서, 이 순서에서 서로 위치를 밀지 않는다.
- 다른 부모의 추가·삭제는 서로 영향이 없다. 지우거나 붙이는 위치가 각자 부모의 공통 구간 뒤쪽이라서 다른 가지의 path에 끼어들지 않는다.

테스트 "patch를 순서대로 적용하면 새 트리가 된다"는 VDOM 사본에 patch를 차례로 적용해서 결과가 새 VDOM과 같은지 확인한다. 적용할 때 ADD는 `index === 현재 자식 수`, REMOVE는 `index === 마지막 인덱스`인지도 함께 검사한다.

## 예시

### 빈 자식 ↔ 여러 자식
```js
diff(<ul></ul>, <ul><li>a</li><li>b</li><li>c</li></ul>)
// → ADD [0], ADD [1], ADD [2]

diff(<ul><li>a</li><li>b</li><li>c</li></ul>, <ul></ul>)
// → REMOVE [2], REMOVE [1], REMOVE [0]
```

### 기존 자식 변경 + 추가
```html
<ul id="x"><li class="a">one</li><li>two</li></ul>
<ul id="y"><li class="b">ONE</li><p>two</p><li>three</li></ul>
```
```js
[
  { type: 'ATTRS',   path: [],     set: { id: 'y' } ... },     // 부모 속성
  { type: 'ATTRS',   path: [0],    set: { class: 'b' } ... },  // 공통 구간
  { type: 'TEXT',    path: [0, 0], text: 'ONE' },
  { type: 'REPLACE', path: [1],    node: <p>two</p> },
  { type: 'ADD',     path: [2],    node: <li>three</li> },     // 남는 새 자식
]
```

### 기존 자식 변경 + 삭제
```js
diff([a, b, c, d], [a, B])
// → TEXT [1, 0] 'B', REMOVE [3], REMOVE [2]
```

## 이번 작업에서 정한 것
- **REMOVE에는 node를 담지 않는다:** 지울 위치만 알면 된다.
- **삭제되는 자식의 안쪽은 비교하지 않는다:** 어차피 사라지므로 REPLACE와 같은 이유다.
- **ADD의 node는 새 VDOM의 그 노드를 그대로(같은 객체로) 담는다:** REPLACE와 같다.
- **자식 개수 변경 에러(`notSupportedYet`)를 없앴다:** 이제 모든 경우에 patch를 만든다.

## 한계 (key가 없어서)
맨 앞에 끼워 넣으면 사람 눈에는 "앞에 하나 추가"지만, 인덱스 비교에서는 뒤로 한 칸씩 밀린 것으로 보인다.
```js
diff([a, b], [x, a, b])
// → TEXT [0,0] 'x', TEXT [1,0] 'a', ADD [2] <li>b</li>
```
결과 트리는 맞지만 변경이 최소는 아니다. 이걸 줄이는 것이 key 기반 비교이고, 이번 범위에서는 하지 않는다.

## 아직 빠진 것 → 다음 작업
- key 기반 자식 비교 (이동 감지)
- patch를 실제 DOM에 반영하는 Patch 함수 (R-P1-03)
  - ADD/REPLACE에는 VDOM → DOM 생성 함수가 필요하다.
  - REMOVE는 path의 부모를 찾아 `removeChild`, ADD는 `appendChild`로 반영할 수 있다(위 순서 약속 덕분).

## 질문 기록
