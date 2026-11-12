/*
 * CLI: 인자와 SQL 파일을 읽고, 문장을 하나씩 Parser → Executor로 넘기며
 * 결과(stdout)·오류(stderr)·종료 코드를 책임진다.
 *
 * 종료 코드: 0 성공, 1 SQL·데이터·파일 오류, 2 잘못된 사용법
 */
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "executor.h"
#include "parser.h"
#include "storage.h"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#endif

#define EXIT_FAIL 1
#define EXIT_USAGE 2
#define DEFAULT_DATA_DIR "data"

#ifdef _WIN32
static UINT g_old_console_cp;
static void restore_console(void) { SetConsoleOutputCP(g_old_console_cp); }

/* 출력 바이트를 그대로 내보내고(\n → \r\n 변환 없음), 콘솔에서 한글이 보이게 한다. */
static void setup_windows_output(void) {
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stderr), _O_BINARY);
    g_old_console_cp = GetConsoleOutputCP();
    if (g_old_console_cp != 0 && SetConsoleOutputCP(CP_UTF8)) {
        atexit(restore_console);
    }
}
#endif

static void print_usage(FILE *out) {
    fprintf(out, "사용법: minidb [--data-dir 디렉터리] SQL파일\n"
                 "  --data-dir  데이터 파일(users.tsv) 위치. 기본값: " DEFAULT_DATA_DIR "\n");
}

/* 파일 전체를 NUL로 끝나는 버퍼로 읽는다. 호출자가 free한다. */
static char *read_sql_file(const char *path, size_t *out_len, DbError *err) {
    FILE *fp = fopen(path, "rb");
    size_t cap = 4096;
    size_t len = 0;
    char *buf;

    if (fp == NULL) {
        db_error_set(err, "SQL 파일을 열 수 없습니다: %s", path);
        return NULL;
    }
    buf = malloc(cap);
    if (buf == NULL) {
        fclose(fp);
        db_error_set(err, "메모리가 부족합니다");
        return NULL;
    }
    for (;;) {
        size_t n;
        if (len + 1 >= cap) {
            char *grown;
            if (cap > SIZE_MAX / 2) {
                break;
            }
            grown = realloc(buf, cap * 2);
            if (grown == NULL) {
                free(buf);
                fclose(fp);
                db_error_set(err, "메모리가 부족합니다");
                return NULL;
            }
            buf = grown;
            cap *= 2;
        }
        n = fread(buf + len, 1, cap - len - 1, fp);
        len += n;
        if (n == 0) {
            break;
        }
    }
    if (ferror(fp) || !feof(fp)) {
        free(buf);
        fclose(fp);
        db_error_set(err, "SQL 파일을 읽을 수 없습니다: %s", path);
        return NULL;
    }
    fclose(fp);
    buf[len] = '\0';
    if (memchr(buf, '\0', len) != NULL) {
        free(buf);
        db_error_set(err, "SQL 파일에 NUL 바이트가 있습니다: %s", path);
        return NULL;
    }
    *out_len = len;
    return buf;
}

static int print_insert(int64_t id, void *ctx) {
    (void)id;
    (void)ctx;
    return printf("INSERT 1\n") < 0 ? -1 : 0;
}

static int print_row(const Row *row, void *ctx) {
    (void)ctx;
    return printf("%" PRId64 "\t%s\t%d\n", row->id, row->name, row->age) < 0 ? -1 : 0;
}

static void report(long stmt_no, const DbError *err) {
    fflush(stdout); /* 앞선 결과가 오류 메시지보다 먼저 보이게 */
    if (stmt_no > 0) {
        fprintf(stderr, "오류: 문장 %ld: %s\n", stmt_no, err->msg);
    } else {
        fprintf(stderr, "오류: %s\n", err->msg);
    }
}

int main(int argc, char **argv) {
    const char *data_dir = DEFAULT_DATA_DIR;
    const char *sql_path = NULL;
    DbError err;
    char *sql;
    size_t sql_len = 0;
    size_t pos = 0;
    Table *table = NULL;
    ResultSink sink = {print_insert, print_row, NULL};
    long stmt_no = 0;
    int status = 0;
    int i;

#ifdef _WIN32
    setup_windows_output();
#endif
    memset(&err, 0, sizeof err);

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--data-dir") == 0) {
            if (i + 1 >= argc || argv[i + 1][0] == '\0') {
                fprintf(stderr, "오류: --data-dir 뒤에 디렉터리가 필요합니다\n");
                print_usage(stderr);
                return EXIT_USAGE;
            }
            data_dir = argv[++i];
        } else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) {
            print_usage(stdout);
            return 0;
        } else if (argv[i][0] == '-' && argv[i][1] != '\0') {
            fprintf(stderr, "오류: 알 수 없는 옵션: %s\n", argv[i]);
            print_usage(stderr);
            return EXIT_USAGE;
        } else if (sql_path != NULL) {
            fprintf(stderr, "오류: SQL 파일은 하나만 지정할 수 있습니다\n");
            print_usage(stderr);
            return EXIT_USAGE;
        } else {
            sql_path = argv[i];
        }
    }
    if (sql_path == NULL) {
        print_usage(stderr);
        return EXIT_USAGE;
    }

    sql = read_sql_file(sql_path, &sql_len, &err);
    if (sql == NULL) {
        report(0, &err);
        return EXIT_FAIL;
    }
    if (sql_len >= 3 && memcmp(sql, "\xEF\xBB\xBF", 3) == 0) {
        pos = 3; /* UTF-8 BOM 건너뛰기 */
    }

    if (table_open(data_dir, &table, &err) != 0) {
        report(0, &err);
        free(sql);
        return EXIT_FAIL;
    }

    /* 문장을 순서대로 실행하고, 하나라도 실패하면 즉시 멈춘다(fail-fast).
     * 앞서 성공한 INSERT는 이미 파일에 있으므로 유지된다. */
    for (;;) {
        Statement st;
        int r;
        int rc = 0;

        stmt_no++;
        r = parser_next(sql, &pos, &st, &err);
        if (r == 0) {
            break;
        }
        if (r < 0) {
            report(stmt_no, &err);
            status = EXIT_FAIL;
            break;
        }
        if (st.kind == STMT_SELECT && printf("id\tname\tage\n") < 0) {
            db_error_set(&err, "결과 출력에 실패했습니다");
            rc = -1;
        }
        if (rc == 0) {
            rc = executor_run(table, &st, &sink, &err);
        }
        statement_free(&st);
        if (rc != 0) {
            report(stmt_no, &err);
            status = EXIT_FAIL;
            break;
        }
    }

    if (table_close(table, &err) != 0 && status == 0) {
        report(0, &err);
        status = EXIT_FAIL;
    }
    free(sql);
    if (fflush(stdout) != 0 && status == 0) {
        fprintf(stderr, "오류: 결과 출력에 실패했습니다\n");
        status = EXIT_FAIL;
    }
    return status;
}
