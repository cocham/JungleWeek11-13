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

/*
 * SELECT ... WHERE: Storage가 레코드를 하나씩 넘겨주면, 조건에 맞는 것만 원래 콜백에 전달한다.
 * Storage는 조건을 모르고, CLI는 조건이 있었는지 모른다. 여기가 조건 검사가 들어가는 유일한 곳이다.
 * Phase 1은 선형 탐색: 파일 전체를 끝까지 읽는다(뒤쪽 레코드의 손상도 함께 검출된다).
 */
typedef struct {
    const Statement *st;
    RowFn next;     /* 조건을 통과한 레코드를 받을 콜백. NULL이면 버린다 */
    void *next_ctx;
} FilterCtx;

static int row_matches(const Statement *st, const Row *row) {
    switch (st->where) {
    case WHERE_NONE: return 1;
    case WHERE_ID: return row->id == st->where_value;
    case WHERE_AGE: return (int64_t)row->age == st->where_value;
    }
    return 0;
}

static int filter_row(const Row *row, void *ctx) {
    FilterCtx *f = ctx;

    if (!row_matches(f->st, row) || f->next == NULL) {
        return 0;
    }
    return f->next(row, f->next_ctx);
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
    case STMT_SELECT: {
        FilterCtx f;
        f.st = st;
        f.next = sink != NULL ? sink->on_row : NULL;
        f.next_ctx = sink != NULL ? sink->ctx : NULL;
        return table_scan(t, filter_row, &f, err);
    }
    }
    db_error_set(err, "알 수 없는 문장 종류입니다");
    return -1;
}
