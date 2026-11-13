# 미니 DBMS — Phase 1

C로 SQL 파일을 실행하고 데이터를 파일에 저장하는 CLI를 만든다.

## 읽는 순서

1. [개발 명세](docs/spec.md): 무엇을 만들고 어떻게 확인하는가
2. [설계와 결정](docs/design.md): 처리 흐름, 저장 방식, 구현 전 결정
3. [작업 목록](docs/tasks.md): 구현 단위와 검증 기준
4. [구현설명서](docs/implementation.md): 전체 흐름에서 INSERT·SELECT 코드 따라가기

현재 상태: **Phase 1 구현·테스트 완료(DB-P1-01, DB-P1-C01 SQL 주석, DB-P1-02 조건 조회), DB-P1-02 Codex 검증 대기.**

지원 SQL: `INSERT INTO users (name, age) VALUES (...)`, `SELECT * FROM users [WHERE id = 정수 | WHERE age = 정수]`, `--`·`/* */` 주석. 조건 조회는 선형 탐색이다.

## 빌드와 실행 (Windows, TDM-GCC)

```text
mingw32-make                 # build/minidb.exe
mingw32-make test            # 단위 테스트 + CLI 통합 테스트
build\minidb.exe --data-dir data examples/basic.sql
```

```text
INSERT 1
INSERT 1
id	name	age
1	민수	25
2	O'Brien	30
```

메모리 검사(ASan/UBSan/누수)는 Docker Desktop을 켠 뒤 Linux 컨테이너에서 실행한다.

```text
docker run --rm -v "%cd%:/src" -w /src gcc:13 make sanitize
```

## 코드 구성

| 파일 | 역할 |
|---|---|
| src/main.c | CLI: 인자·SQL 파일 읽기, 문장 순차 실행, 결과·오류 출력, 종료 코드 |
| src/parser.c | Lexer + 재귀 하강 파서: SQL 텍스트 → Statement |
| src/executor.c | 값 검증 후 Storage에 저장·조회 요청. WHERE는 조회 콜백 앞의 필터로 검사, 결과는 콜백으로 전달 |
| src/storage.c | users.tsv 열기·검증·순차 읽기·추가, 다음 ID 복원 |
| tests/test_unit.c | Parser·Storage·Executor 단위 테스트 |
| tests/cli_test.py | 실제 프로세스를 실행하는 CLI 통합 테스트 |

이 폴더의 docs/를 DBMS 구현 기준으로 사용한다.

## 구현 담당에게 전달할 내용

> 위 세 문서를 읽고 미정 결정을 먼저 확인한다. 결정 후 DB-P1-01(기본 저장·조회)만 구현하고 단위·CLI 통합 테스트를 실행한다. DB-P1-02(조건 검색·전체 검증)는 1단위 PASS 후 사용자가 진행을 지시하면 시작한다. Codex 검증을 기다리며 멈춘다. 함수별 학습 노트 대신 전체 흐름과 실행 예시를 설명한다. Phase 2·3과 선택 기능은 시작하지 않는다. 커밋·푸시는 사용자 지시 후 현재 작업 브랜치에서만 한다.
