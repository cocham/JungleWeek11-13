#include "executor.h"

#include <string.h>

static int validate_insert(const Statement *st, DbError *err) {
    size_t n;

    if (st->name == NULL) {
        db_error_set(err, "name 값이 없습니다");
        return -1;
    }
    n = strlen(st->name);
    if (n == 0) {
        db_error_set(err, "name은 빈 문자열일 수 없습니다");
        return -1;
    }
    if (n > NAME_MAX_BYTES) {
        db_error_set(err, "name이 %d바이트를 넘습니다 (%u바이트)", NAME_MAX_BYTES, (unsigned)n);
        return -1;
    }
    if (strpbrk(st->name, "\t\r\n") != NULL) {
        db_error_set(err, "name에 탭이나 줄바꿈을 넣을 수 없습니다");
        return -1;
    }
    if (st->age < AGE_MIN || st->age > AGE_MAX) {
        db_error_set(err, "age 값 %d이(가) 허용 범위(%d~%d)를 벗어났습니다",
                     st->age, AGE_MIN, AGE_MAX);
        return -1;
    }
    return 0;
}

int executor_run(Table *t, const Statement *st, const ResultSink *sink, DbError *err) {
    switch (st->kind) {
    case STMT_INSERT: {
        int64_t id;
        /* 검증을 모두 통과한 뒤에만 기록한다. 실패한 INSERT는 파일에 남지 않는다. */
        if (validate_insert(st, err) != 0 ||
            table_append(t, st->name, st->age, &id, err) != 0) {
            return -1;
        }
        if (sink != NULL && sink->on_insert != NULL && sink->on_insert(id, sink->ctx) != 0) {
            db_error_set(err, "결과 출력에 실패했습니다");
            return -1;
        }
        return 0;
    }
    case STMT_SELECT:
        return table_scan(t, sink != NULL ? sink->on_row : NULL,
                          sink != NULL ? sink->ctx : NULL, err);
    }
    db_error_set(err, "알 수 없는 문장 종류입니다");
    return -1;
}
