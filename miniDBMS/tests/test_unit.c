/*
 * 단위 테스트: Parser, Storage, Executor를 함수 단위로 검증한다.
 * 사용법: test_unit <임시 디렉터리>
 */
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "executor.h"
#include "parser.h"
#include "storage.h"

#ifdef _WIN32
#include <direct.h>
#define make_dir(path) _mkdir(path)
#else
#include <sys/stat.h>
#include <sys/types.h>
#define make_dir(path) mkdir((path), 0755)
#endif

static int g_checks;
static int g_failures;
static const char *g_base;

#define CHECK(cond)                                                              \
    do {                                                                         \
        g_checks++;                                                              \
        if (!(cond)) {                                                           \
            g_failures++;                                                        \
            fprintf(stderr, "%s:%d: 실패: %s\n", __FILE__, __LINE__, #cond);     \
        }                                                                        \
    } while (0)

/* ---------- 도우미 ---------- */

/* base/name 디렉터리를 비운 상태로 준비하고 경로를 돌려준다. */
static const char *fresh_dir(const char *name) {
    static char dir[512];
    char file[600];

    snprintf(dir, sizeof dir, "%s/%s", g_base, name);
    snprintf(file, sizeof file, "%s/users.tsv", dir);
    remove(file);
    make_dir(dir);
    return dir;
}

static void write_file(const char *dir, const char *data, size_t len) {
    char file[600];
    FILE *fp;

    snprintf(file, sizeof file, "%s/users.tsv", dir);
    fp = fopen(file, "wb");
    if (fp == NULL) {
        fprintf(stderr, "테스트 파일 생성 실패: %s\n", file);
        exit(2);
    }
    fwrite(data, 1, len, fp);
    fclose(fp);
}

/* 파일 전체를 buf에 읽는다. 없으면 길이 0. */
static size_t read_file(const char *dir, char *buf, size_t cap) {
    char file[600];
    FILE *fp;
    size_t n;

    snprintf(file, sizeof file, "%s/users.tsv", dir);
    fp = fopen(file, "rb");
    if (fp == NULL) {
        buf[0] = '\0';
        return 0;
    }
    n = fread(buf, 1, cap - 1, fp);
    buf[n] = '\0';
    fclose(fp);
    return n;
}

typedef struct {
    int count;
    int64_t ids[8];
    char names[8][300];
    int ages[8];
    int stop_after; /* 0이면 멈추지 않음 */
} Collected;

static int collect_row(const Row *row, void *ctx) {
    Collected *c = ctx;

    if (c->count < 8) {
        c->ids[c->count] = row->id;
        snprintf(c->names[c->count], sizeof c->names[0], "%s", row->name);
        c->ages[c->count] = row->age;
    }
    c->count++;
    return (c->stop_after != 0 && c->count >= c->stop_after) ? 1 : 0;
}

/* ---------- Parser ---------- */

static int parse_one(const char *sql, Statement *st, DbError *err) {
    size_t pos = 0;
    return parser_next(sql, &pos, st, err);
}

#define EXPECT_PARSE_ERROR(sql, needle)                                                   \
    do {                                                                                  \
        Statement st_;                                                                    \
        DbError e_ = {{0}};                                                               \
        int r_ = parse_one((sql), &st_, &e_);                                             \
        CHECK(r_ == -1);                                                                  \
        CHECK(strstr(e_.msg, (needle)) != NULL);                                          \
        if (r_ != -1 || strstr(e_.msg, (needle)) == NULL) {                               \
            fprintf(stderr, "    SQL: %s\n    메시지: %s\n    기대: %s\n", (sql), e_.msg, \
                    (needle));                                                            \
        }                                                                                 \
        CHECK(st_.name == NULL);                                                          \
        if (r_ == 1) {                                                                    \
            statement_free(&st_);                                                         \
        }                                                                                 \
    } while (0)

static void test_parse_insert_basic(void) {
    const char *sql = "INSERT INTO users (name, age) VALUES ('민수', 25);";
    Statement st;
    DbError err = {{0}};
    size_t pos = 0;

    CHECK(parser_next(sql, &pos, &st, &err) == 1);
    CHECK(st.kind == STMT_INSERT);
    CHECK(st.name != NULL && strcmp(st.name, "민수") == 0);
    CHECK(st.age == 25);
    CHECK(pos == strlen(sql));
    statement_free(&st);
    CHECK(st.name == NULL);
    statement_free(&st); /* 두 번 호출해도 안전 */
}

static void test_parse_column_order_and_case(void) {
    Statement st;
    DbError err = {{0}};

    CHECK(parse_one("insert into USERS (Age, NAME) values (30, 'O''Brien');", &st, &err) == 1);
    CHECK(st.kind == STMT_INSERT);
    CHECK(st.name != NULL && strcmp(st.name, "O'Brien") == 0);
    CHECK(st.age == 30);
    statement_free(&st);
}

static void test_parse_string_special_and_multiline(void) {
    Statement st;
    DbError err = {{0}};

    CHECK(parse_one("INSERT\n  INTO users\n(name,\tage)\r\nVALUES\n('a;b ''c''',\n 0)\n;", &st,
                    &err) == 1);
    CHECK(st.name != NULL && strcmp(st.name, "a;b 'c'") == 0);
    CHECK(st.age == 0);
    statement_free(&st);

    CHECK(parse_one("INSERT INTO users (name, age) VALUES ('''', 150);", &st, &err) == 1);
    CHECK(st.name != NULL && strcmp(st.name, "'") == 0);
    CHECK(st.age == 150);
    statement_free(&st);
}

static void test_parse_select_and_sequence(void) {
    const char *sql = "SELECT * FROM users; insert into users (name, age) values ('x', 1);\n  \n";
    Statement st;
    DbError err = {{0}};
    size_t pos = 0;

    CHECK(parser_next(sql, &pos, &st, &err) == 1);
    CHECK(st.kind == STMT_SELECT);
    CHECK(st.name == NULL);
    statement_free(&st);

    CHECK(parser_next(sql, &pos, &st, &err) == 1);
    CHECK(st.kind == STMT_INSERT);
    statement_free(&st);

    CHECK(parser_next(sql, &pos, &st, &err) == 0);
    CHECK(parser_next(sql, &pos, &st, &err) == 0); /* 끝에서 반복 호출해도 0 */
}

static void test_parse_empty_input(void) {
    Statement st;
    DbError err = {{0}};

    CHECK(parse_one("", &st, &err) == 0);
    CHECK(parse_one(" \n\t\r\n ", &st, &err) == 0);
}

static void test_parse_next_statement_error_isolated(void) {
    /* 첫 문장은 성공해야 하고, 두 번째 문장의 잘못된 문자는 두 번째에서만 보고된다. */
    const char *sql = "SELECT * FROM users; SELECT # FROM users;";
    Statement st;
    DbError err = {{0}};
    size_t pos = 0;

    CHECK(parser_next(sql, &pos, &st, &err) == 1);
    statement_free(&st);
    CHECK(parser_next(sql, &pos, &st, &err) == -1);
    CHECK(strstr(err.msg, "알 수 없는 문자") != NULL);
}

static void test_parse_errors(void) {
    EXPECT_PARSE_ERROR("SELECT * FROM users", "세미콜론");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', 1)", "세미콜론");
    EXPECT_PARSE_ERROR("SELECT * FROM users SELECT * FROM users;", "세미콜론");
    EXPECT_PARSE_ERROR(";", "INSERT 또는 SELECT");
    EXPECT_PARSE_ERROR("UPDATE users SET age = 1;", "INSERT 또는 SELECT");
    EXPECT_PARSE_ERROR("SELECT * FROM orders;", "테이블 'orders'");
    EXPECT_PARSE_ERROR("SELECT * FROM users WHERE id = 1;", "WHERE");
    EXPECT_PARSE_ERROR("SELECT name FROM users;", "SELECT *");
    EXPECT_PARSE_ERROR("SELECT * users;", "FROM");
    EXPECT_PARSE_ERROR("INSERT users (name, age) VALUES ('a', 1);", "INTO");
    EXPECT_PARSE_ERROR("INSERT INTO users name, age VALUES ('a', 1);", "'('");
    EXPECT_PARSE_ERROR("INSERT INTO users () VALUES ();", "컬럼 이름");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, email) VALUES ('a', 'b');", "컬럼 'email'");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, NAME) VALUES ('a', 'b');", "중복");
    EXPECT_PARSE_ERROR("INSERT INTO users (name) VALUES ('a');", "age 컬럼");
    EXPECT_PARSE_ERROR("INSERT INTO users (age) VALUES (1);", "name 컬럼");
    EXPECT_PARSE_ERROR("INSERT INTO users (id, name, age) VALUES (1, 'a', 1);", "자동");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) ('a', 1);", "VALUES");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES (1, 1);", "문자열");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', 'b');", "정수");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', NULL);", "정수");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a');", "적습니다");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', 1, 2);", "많습니다");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a' 1);", "',' 또는 ')'");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('abc, 1);", "닫히지");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', 99999999999999999999);",
                       "범위");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', 2147483648);", "범위");
    EXPECT_PARSE_ERROR("INSERT INTO users (name, age) VALUES ('a', 1.5);", "알 수 없는 문자");
}

/* ---------- Storage ---------- */

static void test_storage_empty_then_append(void) {
    const char *dir = fresh_dir("empty");
    Table *t = NULL;
    DbError err = {{0}};
    Collected c;
    int64_t id = 0;

    memset(&c, 0, sizeof c);
    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(table_scan(t, collect_row, &c, &err) == 0);
    CHECK(c.count == 0);
    CHECK(table_append(t, "kim", 1, &id, &err) == 0);
    CHECK(id == 1);
    CHECK(table_close(t, &err) == 0);
    CHECK(table_close(NULL, &err) == 0);
}

static void test_storage_persist_and_restore_id(void) {
    const char *dir = fresh_dir("persist");
    Table *t = NULL;
    DbError err = {{0}};
    Collected c;
    int64_t id = 0;
    char buf[256];

    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(table_append(t, "민수", 25, &id, &err) == 0 && id == 1);
    CHECK(table_append(t, "O'Brien", 30, &id, &err) == 0 && id == 2);
    CHECK(table_close(t, &err) == 0);

    /* 다시 열면 같은 레코드가 같은 순서로 보이고, 다음 ID는 3이다. */
    memset(&c, 0, sizeof c);
    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(table_scan(t, collect_row, &c, &err) == 0);
    CHECK(c.count == 2);
    CHECK(c.ids[0] == 1 && strcmp(c.names[0], "민수") == 0 && c.ages[0] == 25);
    CHECK(c.ids[1] == 2 && strcmp(c.names[1], "O'Brien") == 0 && c.ages[1] == 30);
    CHECK(table_append(t, "a;b", 0, &id, &err) == 0 && id == 3);

    /* 같은 핸들로 추가 직후 다시 조회해도 새 레코드가 보인다. */
    memset(&c, 0, sizeof c);
    CHECK(table_scan(t, collect_row, &c, &err) == 0);
    CHECK(c.count == 3 && c.ids[2] == 3 && strcmp(c.names[2], "a;b") == 0);
    CHECK(table_close(t, &err) == 0);

    read_file(dir, buf, sizeof buf);
    CHECK(strcmp(buf, "1\t민수\t25\n2\tO'Brien\t30\n3\ta;b\t0\n") == 0);
}

static void expect_corrupt(const char *data, size_t len, const char *needle) {
    const char *dir = fresh_dir("corrupt");
    Table *t = NULL;
    DbError err = {{0}};

    write_file(dir, data, len);
    CHECK(table_open(dir, &t, &err) == -1);
    CHECK(t == NULL);
    CHECK(strstr(err.msg, needle) != NULL);
    if (strstr(err.msg, needle) == NULL) {
        fprintf(stderr, "    메시지: %s\n    기대: %s\n", err.msg, needle);
    }
    table_close(t, &err);
}

#define CORRUPT(lit, needle) expect_corrupt((lit), sizeof(lit) - 1, (needle))

static void test_storage_corrupt_files(void) {
    char long_line[400];

    CORRUPT("1\tkim\t25", "개행");
    CORRUPT("1\tkim\n", "필드");
    CORRUPT("1\tkim\t25\textra\n", "필드");
    CORRUPT("2\ta\t1\n1\tb\t2\n", "증가");
    CORRUPT("1\ta\t1\n1\tb\t2\n", "증가");
    CORRUPT("0\ta\t1\n", "양의 정수");
    CORRUPT("01\ta\t1\n", "양의 정수");
    CORRUPT("x\ta\t1\n", "양의 정수");
    CORRUPT("-1\ta\t1\n", "양의 정수");
    CORRUPT("99999999999999999999\ta\t1\n", "양의 정수");
    CORRUPT("9223372036854775808\ta\t1\n", "양의 정수");
    CORRUPT("1\t\t1\n", "name");
    CORRUPT("1\ta\r\t1\n", "name");
    CORRUPT("1\ta\t151\n", "age");
    CORRUPT("1\ta\t-1\n", "age");
    CORRUPT("1\ta\t1\r\n", "age");
    CORRUPT("1\ta\t\n", "age");
    CORRUPT("1\ta\t1\n\n", "필드");
    CORRUPT("1\ta\0b\t1\n", "NUL");
    CORRUPT("1\tok\t1\n2\tbad\t200\n", "2번째 줄");

    memset(long_line, 'a', sizeof long_line);
    memcpy(long_line, "1\t", 2);
    expect_corrupt(long_line, sizeof long_line, "너무 깁니다");
}

static void test_storage_max_id(void) {
    const char *dir = fresh_dir("maxid");
    const char data[] = "9223372036854775807\ta\t1\n";
    Table *t = NULL;
    DbError err = {{0}};
    int64_t id = 0;

    write_file(dir, data, sizeof data - 1);
    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(table_append(t, "b", 1, &id, &err) == -1);
    CHECK(strstr(err.msg, "ID") != NULL);
    CHECK(table_close(t, &err) == 0);
}

static void test_storage_rejects_bad_record(void) {
    const char *dir = fresh_dir("badrec");
    Table *t = NULL;
    DbError err = {{0}};
    char buf[64];
    int64_t id = 0;

    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(table_append(t, "a\tb", 1, &id, &err) == -1);
    CHECK(table_append(t, "", 1, &id, &err) == -1);
    CHECK(table_append(t, "a", 151, &id, &err) == -1);
    CHECK(table_close(t, &err) == 0);
    CHECK(read_file(dir, buf, sizeof buf) == 0);
}

static void test_storage_callback_stop(void) {
    const char *dir = fresh_dir("stop");
    const char data[] = "1\ta\t1\n2\tb\t2\n3\tc\t3\n";
    Table *t = NULL;
    DbError err = {{0}};
    Collected c;

    write_file(dir, data, sizeof data - 1);
    memset(&c, 0, sizeof c);
    c.stop_after = 2;
    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(table_scan(t, collect_row, &c, &err) == -1);
    CHECK(c.count == 2);
    CHECK(table_close(t, &err) == 0);
}

static void test_storage_open_failure(void) {
    char path[512];
    FILE *fp;
    Table *t = NULL;
    DbError err = {{0}};

    /* 데이터 디렉터리 자리에 일반 파일이 있으면 열 수 없다. */
    snprintf(path, sizeof path, "%s/not_a_dir", g_base);
    fp = fopen(path, "wb");
    CHECK(fp != NULL);
    if (fp != NULL) {
        fclose(fp);
    }
    CHECK(table_open(path, &t, &err) == -1);
    CHECK(t == NULL);
    CHECK(strstr(err.msg, "열 수 없습니다") != NULL);
}

/* ---------- Executor ---------- */

static int count_insert(int64_t id, void *ctx) {
    int64_t *last = ctx;
    *last = id;
    return 0;
}

static void expect_exec_error(Table *t, const char *name, int age, const char *needle) {
    char buf[300];
    Statement st;
    DbError err = {{0}};

    snprintf(buf, sizeof buf, "%s", name);
    st.kind = STMT_INSERT;
    st.name = buf;
    st.age = age;
    CHECK(executor_run(t, &st, NULL, &err) == -1);
    CHECK(strstr(err.msg, needle) != NULL);
    if (strstr(err.msg, needle) == NULL) {
        fprintf(stderr, "    메시지: %s\n    기대: %s\n", err.msg, needle);
    }
}

static void test_executor_validation(void) {
    const char *dir = fresh_dir("exec_valid");
    Table *t = NULL;
    DbError err = {{0}};
    char name255[256];
    char name256[257];
    char buf[64];

    memset(name255, 'a', 255);
    name255[255] = '\0';
    memset(name256, 'a', 256);
    name256[256] = '\0';

    CHECK(table_open(dir, &t, &err) == 0);
    expect_exec_error(t, "", 1, "빈 문자열");
    expect_exec_error(t, name256, 1, "255바이트");
    expect_exec_error(t, "a\tb", 1, "탭");
    expect_exec_error(t, "a\nb", 1, "줄바꿈");
    expect_exec_error(t, "a\rb", 1, "줄바꿈");
    expect_exec_error(t, "a", -1, "범위");
    expect_exec_error(t, "a", 151, "범위");
    CHECK(table_close(t, &err) == 0);
    /* 실패한 INSERT는 하나도 기록되지 않는다. */
    CHECK(read_file(dir, buf, sizeof buf) == 0);

    /* 경계값은 성공한다. */
    {
        Statement st;
        int64_t last = 0;
        ResultSink sink = {count_insert, NULL, &last};

        CHECK(table_open(dir, &t, &err) == 0);
        st.kind = STMT_INSERT;
        st.name = name255;
        st.age = 0;
        CHECK(executor_run(t, &st, &sink, &err) == 0 && last == 1);
        st.age = 150;
        CHECK(executor_run(t, &st, &sink, &err) == 0 && last == 2);
        CHECK(table_close(t, &err) == 0);
    }
}

static void test_executor_insert_select(void) {
    const char *dir = fresh_dir("exec_flow");
    Table *t = NULL;
    DbError err = {{0}};
    Collected c;
    int64_t last = 0;
    char kim[] = "kim";
    char lee[] = "lee";
    Statement ins = {STMT_INSERT, kim, 20};
    Statement sel = {STMT_SELECT, NULL, 0};
    ResultSink sink;

    memset(&c, 0, sizeof c);
    sink.on_insert = count_insert;
    sink.on_row = collect_row;
    sink.ctx = &last;

    CHECK(table_open(dir, &t, &err) == 0);
    CHECK(executor_run(t, &ins, &sink, &err) == 0 && last == 1);
    ins.name = lee;
    ins.age = 21;
    CHECK(executor_run(t, &ins, &sink, &err) == 0 && last == 2);

    sink.ctx = &c;
    CHECK(executor_run(t, &sel, &sink, &err) == 0);
    CHECK(c.count == 2);
    CHECK(c.ids[0] == 1 && strcmp(c.names[0], "kim") == 0 && c.ages[0] == 20);
    CHECK(c.ids[1] == 2 && strcmp(c.names[1], "lee") == 0 && c.ages[1] == 21);
    CHECK(executor_run(t, &sel, NULL, &err) == 0); /* sink 없이도 동작 */
    CHECK(table_close(t, &err) == 0);
}

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "사용법: test_unit <임시 디렉터리>\n");
        return 2;
    }
    g_base = argv[1];
    make_dir(g_base);

    test_parse_insert_basic();
    test_parse_column_order_and_case();
    test_parse_string_special_and_multiline();
    test_parse_select_and_sequence();
    test_parse_empty_input();
    test_parse_next_statement_error_isolated();
    test_parse_errors();

    test_storage_empty_then_append();
    test_storage_persist_and_restore_id();
    test_storage_corrupt_files();
    test_storage_max_id();
    test_storage_rejects_bad_record();
    test_storage_callback_stop();
    test_storage_open_failure();

    test_executor_validation();
    test_executor_insert_select();

    printf("단위 테스트: %d개 검사 중 %d개 실패\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
