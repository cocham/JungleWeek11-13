#ifndef MINIDB_COMMON_H
#define MINIDB_COMMON_H

/* 모든 모듈이 공유하는 오류 정보와 스키마 상수. */

typedef struct {
    char msg[256];
} DbError;

/* err가 NULL이면 아무것도 하지 않는다. 메시지가 길면 잘린다. */
void db_error_set(DbError *err, const char *fmt, ...)
#if defined(__GNUC__)
    __attribute__((format(printf, 2, 3)))
#endif
    ;

/* users 테이블 스키마 (spec.md 입출력 계약) */
#define NAME_MAX_BYTES 255
#define AGE_MIN 0
#define AGE_MAX 150

#endif
