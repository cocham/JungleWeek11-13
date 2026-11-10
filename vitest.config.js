import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 테스트에서 document 같은 브라우저 DOM API를 쓰기 위해 jsdom 환경을 사용한다.
    environment: 'jsdom',
  },
});
