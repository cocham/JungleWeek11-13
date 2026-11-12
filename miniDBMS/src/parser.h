#ifndef MINIDB_PARSER_H
#define MINIDB_PARSER_H

#include <stddef.h>

#include "common.h"

/* Parser: SQL 텍스트 → Statement. 파일 저장은 하지 않는다. */

typedef enum { STMT_INSERT, STMT_SELECT } StmtKind;

typedef struct {
    StmtKind kind;
    char *name; /* INSERT: 따옴표를 풀어낸 문자열. Statement가 소유(malloc) */
    int age;    /* INSERT */
} Statement;

/*
 * sql[*pos]부터 문장 하나를 파싱한다.
 *  1: out에 문장 하나를 채움. *pos는 세미콜론 바로 다음으로 이동
 *  0: 남은 입력이 공백뿐 (입력 끝)
 * -1: 오류. err에 원인. out은 해제된 상태라 statement_free가 필요 없다
 * 성공 시 호출자는 사용 후 statement_free(out)를 호출한다.
 */
int parser_next(const char *sql, size_t *pos, Statement *out, DbError *err);

/* 여러 번 호출해도 안전하다. */
void statement_free(Statement *st);

#endif
