# 설계와 결정

## 결정 목록

| ID | 항목 | 상태 |
|---|---|---|
| DB-D01 | C, Phase 1 최소 기능 | 확정(2026-11-12, 사용자) |
| DB-D02 | spec.md의 SQL·CLI·출력·스키마 계약 | 확정(2026-11-12, 사용자: 제안 그대로 승인) |
| DB-D03 | 아래 저장 형식·폴더·모듈 경계 | 확정(2026-11-12, 사용자: 제안 그대로 승인) |
| DB-D05 | 두 기능 단위: 기본 저장·조회 → 조건 검색·전체 검증. 단위별 Codex 검증 후 정지 | 확정(2026-11-12, 사용자) |
| DB-D04 | 실행·빌드·검사 도구 | 확정(2026-11-12, 사용자): Windows 네이티브(TDM-GCC 10.3, C17, mingw32-make)로 빌드·테스트, ASan/UBSan·누수 검사는 Docker `gcc:13`에서 `make sanitize` |
| DB-D06 | 공개 헤더 계약(src/*.h) | 확정(2026-11-12, 사용자: 초안 승인). 2단위에서 `Statement`에 `where`(WhereKind)·`where_value`(int64_t) 필드 추가(2026-11-13, spec의 WHERE 계약 구현용) |

DB-D04 확인 결과(2026-11-12): Windows에 TDM-GCC 10.3·mingw32-make 있음(ASan 링크 불가), Ubuntu WSL 없음, Docker Desktop 있음.
공개 C 함수·구조체는 src/common.h, parser.h, storage.h, executor.h가 기준이다. 반환 규칙은 0 성공, -1 실패(DbError에 원인)이고 `parser_next`만 1/0/-1이다.

## 전체 흐름

```text
SQL 파일 → CLI → Lexer/Parser → Statement → Executor → Storage → users.tsv
                                               └→ 조회 결과 → CLI 출력
```

| 모듈 | 책임 |
|---|---|
| CLI | 인자·SQL 파일 읽기, 실행 순서, 결과·오류 출력, 종료 코드 |
| Parser | 토큰·문법 분석, INSERT/SELECT 구조 생성. 파일 저장은 하지 않음. Statement에 테이블·컬럼 필드가 없으므로 테이블 이름과 컬럼 이름(누락·중복·미지원) 확인은 Parser가 한다. WHERE 조건 컬럼·비교값도 Parser가 해석해 Statement에 담는다 |
| Executor | 값 검증(name 길이·금지 문자, age 범위), 저장·조회 요청. SELECT는 Storage의 레코드 콜백 앞에 조건 필터를 끼워 일치하는 행만 전달. stdout에 직접 쓰지 않음 |
| Storage | 파일 열기·순차 읽기·추가, 다음 ID 관리. SQL 문법을 알지 않음 |

작은 모듈 4개로 시작한다. 범용 플러그인 구조·쿼리 최적화 계층은 만들지 않는다.

## 파일 저장

- `users.tsv`: 헤더 없이 `id<TAB>name<TAB>age<LF>`. 바이너리 모드로 열어 줄바꿈을 고정한다.
- name의 탭·개행 금지 덕분에 별도 이스케이프 형식이 필요 없다. 작은따옴표는 파싱 후 일반 문자로 저장한다.
- 시작 시 파일을 한 번 순회해 레코드 형식·ID 증가 순서를 확인하고 최대 ID를 구한다.
- 이후 INSERT마다 전체 파일을 재탐색하지 않는다. 최대 ID 초과는 오류다.
- 레코드를 하나씩 읽는다. 전체 테이블을 메모리에 상주시키지 않는다.
- 구조체 메모리를 그대로 파일에 쓰지 않는다. 숫자와 문자열을 명시적으로 직렬화한다.
- 정상적인 단일 프로세스 사용만 지원한다. 쓰기·flush·close 실패를 검사한다. fsync 내구성은 보장하지 않는다.

Phase 2에서는 같은 SQL 처리기를 유지하고 ID 조건의 조회 경로에 B+ 트리를 연결한다.
인덱스가 레코드의 바이트 위치를 가리키게 할 수 있지만, 지금 인덱스 코드를 구현하지 않는다.

## 메모리 책임

- CLI가 SQL 입력 버퍼의 수명을 관리한다.
- Statement는 자신이 보유하는 동적 메모리를 정리한다. 입력 문자열을 참조한다면 입력보다 오래 살지 않는다.
- 조회 레코드 버퍼는 처리 후 재사용·해제한다. 호출자는 임시 버퍼 주소를 보관하지 않는다.
- 성공·실패 경로 모두 열린 파일과 할당 메모리를 정리한다. 할당 실패·길이·정수 변환 범위를 검사한다.

## 폴더 구조

```text
miniDBMS/
  README.md
  docs/        spec.md, design.md, tasks.md
  src/         CLI, parser, executor, storage의 .c/.h
  tests/       단위·CLI 통합 테스트
  examples/    실행 가능한 SQL
  Makefile
  build/       생성물, Git 제외
  data/        실행 데이터, Git 제외
```
