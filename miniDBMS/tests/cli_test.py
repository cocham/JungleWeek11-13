#!/usr/bin/env python3
"""CLI 통합 테스트.

실제 minidb 프로세스를 실행해 stdout, stderr, 종료 코드, 저장 파일을 바이트 단위로 확인한다.
각 테스트는 새 임시 디렉터리에서 실행한다.

사용법: python tests/cli_test.py <minidb 실행 파일>
"""
import os
import subprocess
import sys
import tempfile
import traceback

BIN = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else None
HEADER = b"id\tname\tage\n"
SANITIZER_MARKERS = (
    b"AddressSanitizer",
    b"LeakSanitizer",
    b"UndefinedBehaviorSanitizer",
    b"runtime error:",
)

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


def u(s):
    return s.encode("utf-8")


class Env:
    """테스트 하나가 쓰는 임시 작업 공간."""

    def __init__(self, root):
        self.root = root
        self.data_dir = os.path.join(root, "data")
        self.data_file = os.path.join(self.data_dir, "users.tsv")
        self.counter = 0

    def sql_file(self, content):
        self.counter += 1
        path = os.path.join(self.root, "q%d.sql" % self.counter)
        with open(path, "wb") as f:
            f.write(content if isinstance(content, bytes) else u(content))
        return path

    def run_args(self, args):
        proc = subprocess.run([BIN] + args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              cwd=self.root, timeout=30)
        for marker in SANITIZER_MARKERS:
            assert marker not in proc.stderr, "검사 도구 보고:\n" + proc.stderr.decode("utf-8", "replace")
        return proc.returncode, proc.stdout, proc.stderr

    def run(self, sql):
        return self.run_args(["--data-dir", self.data_dir, self.sql_file(sql)])

    def data(self):
        if not os.path.exists(self.data_file):
            return b""
        with open(self.data_file, "rb") as f:
            return f.read()


def eq(actual, expected, what):
    assert actual == expected, "%s\n  기대: %r\n  실제: %r" % (what, expected, actual)


def expect_ok(result, stdout):
    code, out, err = result
    eq(err, b"", "stderr")
    eq(code, 0, "종료 코드")
    eq(out, stdout, "stdout")


def expect_fail(result, *needles, stdout=b""):
    code, out, err = result
    assert code != 0, "실패 종료 코드를 기대했지만 0"
    eq(out, stdout, "stdout")
    for needle in needles:
        assert u(needle) in err, "stderr에 %r 없음: %r" % (needle, err.decode("utf-8", "replace"))


TWO_INSERTS = (
    "INSERT INTO users (name, age) VALUES ('민수', 25);\n"
    "INSERT INTO users (age, name) VALUES (30, 'O''Brien');\n"
)
TWO_ROWS = u("1\t민수\t25\n2\tO'Brien\t30\n")


# ---------- A1: 추가 후 전체 조회 ----------

@test
def a1_insert_then_select(env):
    expect_ok(env.run(TWO_INSERTS + "SELECT * FROM users;\n"),
              b"INSERT 1\nINSERT 1\n" + HEADER + TWO_ROWS)
    eq(env.data(), TWO_ROWS, "저장 파일")


# ---------- A3: 재실행 후 데이터 유지와 다음 ID ----------

@test
def a3_restart_keeps_data_and_next_id(env):
    expect_ok(env.run(TWO_INSERTS), b"INSERT 1\nINSERT 1\n")
    expect_ok(env.run("SELECT * FROM users;"), HEADER + TWO_ROWS)
    expect_ok(env.run("INSERT INTO users (name, age) VALUES ('지영', 41);\nSELECT * FROM users;"),
              b"INSERT 1\n" + HEADER + TWO_ROWS + u("3\t지영\t41\n"))
    eq(env.data(), TWO_ROWS + u("3\t지영\t41\n"), "저장 파일")


# ---------- A4: 한글·작은따옴표·문자열 안 세미콜론·여러 줄 ----------

@test
def a4_text_handling(env):
    sql = (
        "insert into USERS (Name, AGE)\n"
        "    values ('a;b', 1);\n"
        "INSERT\n\tINTO users\n(\n  age,\n  name\n)\nVALUES\n(\n  2,\n  '김''s 노트; 메모'\n)\n;\n"
        "INSERT INTO users (name, age) VALUES ('''', 0);"
        "select * from users;"
    )
    expect_ok(env.run(sql),
              b"INSERT 1\nINSERT 1\nINSERT 1\n" + HEADER
              + u("1\ta;b\t1\n2\t김's 노트; 메모\t2\n3\t'\t0\n"))


@test
def a4_utf8_bom_is_skipped(env):
    expect_ok(env.run(b"\xef\xbb\xbf" + u("SELECT * FROM users;")), HEADER)


# ---------- A5: 잘못된 SQL·컬럼·타입·범위 ----------

A5_CASES = [
    ("INSERT INTO users (name, email) VALUES ('a', 'b');", "컬럼 'email'"),
    ("INSERT INTO users (name) VALUES ('a');", "age 컬럼"),
    ("INSERT INTO users (id, name, age) VALUES (1, 'a', 1);", "자동"),
    ("INSERT INTO users (name, age) VALUES (1, 1);", "문자열"),
    ("INSERT INTO users (name, age) VALUES ('a', 'b');", "정수"),
    ("INSERT INTO users (name, age) VALUES ('a', 151);", "범위"),
    ("INSERT INTO users (name, age) VALUES ('a', -1);", "범위"),
    ("INSERT INTO users (name, age) VALUES ('a', 99999999999999999999);", "범위"),
    ("INSERT INTO users (name, age) VALUES ('', 1);", "빈 문자열"),
    ("INSERT INTO users (name, age) VALUES ('" + "a" * 256 + "', 1);", "255바이트"),
    ("INSERT INTO users (name, age) VALUES ('a\tb', 1);", "탭"),
    ("INSERT INTO users (name, age) VALUES ('a\nb', 1);", "줄바꿈"),
    ("INSERT INTO users (name, age) VALUES ('a', 1)", "세미콜론"),
    ("INSERT INTO users (name, age) VALUES ('a, 1);", "닫히지"),
    ("INSERT INTO orders (name, age) VALUES ('a', 1);", "테이블 'orders'"),
    ("SELECT * FROM users WHERE id = 1;", "WHERE"),
    ("SELECT name FROM users;", "SELECT *"),
    ("DELETE FROM users;", "INSERT 또는 SELECT"),
]


@test
def a5_invalid_statements_fail_without_saving(env):
    for sql, needle in A5_CASES:
        expect_fail(env.run(sql), "문장 1", needle)
        eq(env.data(), b"", "실패 후 저장 파일 (%s)" % sql[:40])


@test
def a5_name_255_bytes_boundary_ok(env):
    name = "가" * 85  # 255바이트 (UTF-8 한 글자 3바이트)
    expect_ok(env.run("INSERT INTO users (name, age) VALUES ('%s', 150);" % name), b"INSERT 1\n")
    eq(env.data(), u("1\t%s\t150\n" % name), "저장 파일")


# ---------- A6: 중간 문장 실패 ----------

@test
def a6_second_statement_fails(env):
    sql = (
        "INSERT INTO users (name, age) VALUES ('first', 1);\n"
        "INSERT INTO users (name, nickname) VALUES ('second', 'x');\n"
        "INSERT INTO users (name, age) VALUES ('third', 3);\n"
        "SELECT * FROM users;\n"
    )
    expect_fail(env.run(sql), "문장 2", "nickname", stdout=b"INSERT 1\n")
    eq(env.data(), b"1\tfirst\t1\n", "저장 파일: 첫 문장만 유지")
    expect_ok(env.run("SELECT * FROM users;"), HEADER + b"1\tfirst\t1\n")


@test
def a6_select_output_kept_before_failure(env):
    expect_ok(env.run("INSERT INTO users (name, age) VALUES ('a', 1);"), b"INSERT 1\n")
    expect_fail(env.run("SELECT * FROM users; SELECT * FROM users WHERE age = 1;"),
                "문장 2", "WHERE", stdout=HEADER + b"1\ta\t1\n")


# ---------- A7: 빈 입력·빈 테이블·파일 오류 ----------

@test
def a7_empty_and_blank_sql(env):
    expect_ok(env.run(""), b"")
    expect_ok(env.run("  \n\t\r\n"), b"")


@test
def a7_select_empty_table_prints_header(env):
    expect_ok(env.run("SELECT * FROM users;"), HEADER)


@test
def a7_missing_sql_file(env):
    expect_fail(env.run_args(["--data-dir", env.data_dir, os.path.join(env.root, "nope.sql")]),
                "SQL 파일을 열 수 없습니다")


@test
def a7_corrupted_data_file(env):
    os.makedirs(env.data_dir)
    with open(env.data_file, "wb") as f:
        f.write(b"1\tkim\t25\n2\tlee\n")
    expect_fail(env.run("SELECT * FROM users;"), "손상", "2번째 줄")
    expect_fail(env.run("INSERT INTO users (name, age) VALUES ('a', 1);"), "손상")
    eq(env.data(), b"1\tkim\t25\n2\tlee\n", "손상 파일은 그대로")


@test
def a7_data_dir_unusable(env):
    blocker = os.path.join(env.root, "blocker")
    with open(blocker, "wb") as f:
        f.write(b"x")
    expect_fail(env.run_args(["--data-dir", blocker, env.sql_file("SELECT * FROM users;")]),
                "데이터 파일을 열 수 없습니다")


@test
def a7_nul_byte_in_sql(env):
    expect_fail(env.run(b"SELECT * FROM users;\x00"), "NUL")


# ---------- 사용법 ----------

@test
def usage_errors(env):
    code, out, err = env.run_args([])
    eq(code, 2, "인자 없음 종료 코드")
    assert u("사용법") in err
    code, _, err = env.run_args(["--bogus", "x.sql"])
    eq(code, 2, "알 수 없는 옵션 종료 코드")
    code, _, err = env.run_args(["a.sql", "b.sql"])
    eq(code, 2, "SQL 파일 두 개 종료 코드")
    code, _, err = env.run_args(["x.sql", "--data-dir"])
    eq(code, 2, "--data-dir 값 없음 종료 코드")
    code, out, err = env.run_args(["--help"])
    eq(code, 0, "--help 종료 코드")
    assert u("사용법") in out


@test
def default_data_dir_is_cwd_data(env):
    path = env.sql_file("INSERT INTO users (name, age) VALUES ('a', 1);")
    expect_ok(env.run_args([path]), b"INSERT 1\n")
    eq(env.data(), b"1\ta\t1\n", "기본 data 디렉터리에 저장")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    if BIN is None or not os.path.exists(BIN):
        print("사용법: cli_test.py <minidb 실행 파일>", file=sys.stderr)
        return 2
    failures = 0
    for fn in TESTS:
        with tempfile.TemporaryDirectory() as root:
            try:
                fn(Env(root))
                print("PASS", fn.__name__)
            except Exception:
                failures += 1
                print("FAIL", fn.__name__)
                traceback.print_exc()
    print("CLI 테스트: %d개 중 %d개 실패" % (len(TESTS), failures))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
