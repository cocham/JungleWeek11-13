// 실제 DOM 요소에 이벤트 핸들러를 붙이고 떼는 도우미. (Phase 2)
//
// removeEventListener는 붙일 때와 "같은 함수"를 넘겨야 뗄 수 있다.
// 그래서 요소마다 지금 붙어 있는 핸들러를 { click: fn } 형태로 기억해 둔다.
// WeakMap을 쓰면 요소가 화면에서 사라져 버려질 때 이 기록도 함께 버려진다.
const listenersByElement = new WeakMap();

// name 이벤트의 핸들러를 handler로 바꾼다. 이전 핸들러가 있으면 먼저 뗀다.
export function setEvent(element, name, handler) {
  let listeners = listenersByElement.get(element);
  if (listeners === undefined) {
    listeners = {};
    listenersByElement.set(element, listeners);
  }
  if (listeners[name] !== undefined) {
    element.removeEventListener(name, listeners[name]);
  }
  element.addEventListener(name, handler);
  listeners[name] = handler;
}

export function removeEvent(element, name) {
  const listeners = listenersByElement.get(element);
  if (listeners === undefined || listeners[name] === undefined) {
    return;
  }
  element.removeEventListener(name, listeners[name]);
  delete listeners[name];
}
