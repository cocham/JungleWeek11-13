#include "parser.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * 구조: Lexer(next_token)가 SQL 텍스트를 토큰으로 자르고,
 * 재귀 하강 파서(parse_insert / parse_select)가 토큰 순서를 문법과 맞춰 본다.
 *
 * INSERT INTO users ( 컬럼 [, 컬럼] ) VALUES ( 값 [, 값] ) ;
 * SELECT * FROM users [ WHERE id|age = 정수 ] ;
 */

typedef enum {
    TOK_EOF,
    TOK_IDENT, /* 키워드도 IDENT로 받고 비교할 때 대소문자를 무시한다 */
    TOK_INT,
    TOK_STRING,
    TOK_LPAREN,
    TOK_RPAREN,
    TOK_COMMA,
    TOK_SEMI,
    TOK_STAR,
    TOK_EQ,
    TOK_CMP /* < > <= >= <> != : WHERE에서 거부하기 위해서만 쓴다 */
} TokKind;

typedef struct {
    TokKind kind;
    const char *text; /* 원문 위치. STRING은 여는 따옴표 다음 */
    size_t len;       /* 원문 길이. STRING은 '' 이스케이프를 포함한 안쪽 길이 */
} Token;

typedef struct {
    const char *sql;
    size_t pos; /* 다음에 읽을 위치. 항상 cur 토큰 바로 뒤 */
    Token cur;
    DbError *err;
} Parser;

enum { COL_NAME = 0, COL_AGE = 1, COL_COUNT = 2 };

/* ---------- 문자 분류 (로캘에 영향받지 않도록 ASCII만 직접 판단) ---------- */

static int is_digit(char c) { return c >= '0' && c <= '9'; }

static int is_ident_start(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
}

static int is_ident_char(char c) { return is_ident_start(c) || is_digit(c); }

static int is_space(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}

static char to_lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c; }

/* ---------- Lexer ---------- */

/*
 * 공백과 주석을 건너뛴 위치를 *pos에 담는다. 주석은 공백과 똑같이 취급한다.
 *   -- 부터 줄 끝(LF)까지, 또는 입력 끝까지
 *   / * 부터 * / 까지. 중첩은 지원하지 않는다(안쪽 / * 는 그냥 주석 내용)
 * 문자열 안의 주석 기호는 여기까지 오지 않는다: 토큰 사이에서만 호출되기 때문이다.
 */
static int skip_space_and_comments(Parser *p, size_t *pos) {
    const char *s = p->sql;
    size_t i = *pos;

    for (;;) {
        if (is_space(s[i])) {
            i++;
        } else if (s[i] == '-' && s[i + 1] == '-') {
            i += 2;
            while (s[i] != '\0' && s[i] != '\n') {
                i++;
            }
        } else if (s[i] == '/' && s[i + 1] == '*') {
            i += 2;
            while (!(s[i] == '*' && s[i + 1] == '/')) {
                if (s[i] == '\0') {
                    db_error_set(p->err, "블록 주석이 닫히지 않았습니다 ('*/' 누락)");
                    return -1;
                }
                i++;
            }
            i += 2;
        } else {
            break;
        }
    }
    *pos = i;
    return 0;
}

static int next_token(Parser *p) {
    const char *s = p->sql;
    size_t i = p->pos;
    Token *t = &p->cur;
    char c;

    if (skip_space_and_comments(p, &i) != 0) {
        return -1;
    }
    c = s[i];
    t->text = s + i;
    t->len = 1;

    switch (c) {
    case '\0':
        t->kind = TOK_EOF;
        t->len = 0;
        p->pos = i;
        return 0;
    case '(': t->kind = TOK_LPAREN; p->pos = i + 1; return 0;
    case ')': t->kind = TOK_RPAREN; p->pos = i + 1; return 0;
    case ',': t->kind = TOK_COMMA; p->pos = i + 1; return 0;
    case ';': t->kind = TOK_SEMI; p->pos = i + 1; return 0;
    case '*': t->kind = TOK_STAR; p->pos = i + 1; return 0;
    case '=': t->kind = TOK_EQ; p->pos = i + 1; return 0;
    case '<':
    case '>':
    case '!':
        /* 지원하지 않는 비교 연산자도 토큰으로 받아 "'='만 지원" 오류를 낼 수 있게 한다. */
        t->kind = TOK_CMP;
        t->len = (s[i + 1] == '=' || (c == '<' && s[i + 1] == '>')) ? 2 : 1;
        p->pos = i + t->len;
        return 0;
    default: break;
    }

    if (c == '\'') {
        /* 문자열 안의 ';'나 줄바꿈은 일반 문자다. '' 는 작은따옴표 하나. */
        size_t j = i + 1;
        for (;;) {
            if (s[j] == '\0') {
                db_error_set(p->err, "문자열이 닫히지 않았습니다 (작은따옴표 누락)");
                return -1;
            }
            if (s[j] == '\'') {
                if (s[j + 1] == '\'') {
                    j += 2;
                    continue;
                }
                break;
            }
            j++;
        }
        t->kind = TOK_STRING;
        t->text = s + i + 1;
        t->len = j - (i + 1);
        p->pos = j + 1;
        return 0;
    }

    if (is_digit(c) || (c == '-' && is_digit(s[i + 1]))) {
        /* 음수도 정수 토큰으로 받아, 문법 오류가 아닌 범위 오류로 보고한다. */
        size_t j = i + 1;
        while (is_digit(s[j])) {
            j++;
        }
        t->kind = TOK_INT;
        t->len = j - i;
        p->pos = j;
        return 0;
    }

    if (is_ident_start(c)) {
        size_t j = i + 1;
        while (is_ident_char(s[j])) {
            j++;
        }
        t->kind = TOK_IDENT;
        t->len = j - i;
        p->pos = j;
        return 0;
    }

    if ((unsigned char)c >= 0x20 && (unsigned char)c < 0x7f) {
        db_error_set(p->err, "알 수 없는 문자 '%c'", c);
    } else {
        db_error_set(p->err, "알 수 없는 문자 (바이트 0x%02X)", (unsigned)(unsigned char)c);
    }
    return -1;
}

/* ---------- 파서 도우미 ---------- */

static int advance(Parser *p) { return next_token(p); }

/* 토큰이 word와 대소문자 무시로 같은 식별자인지. word는 소문자로 준다. */
static int tok_is(const Token *t, const char *word) {
    size_t n = strlen(word);
    size_t i;

    if (t->kind != TOK_IDENT || t->len != n) {
        return 0;
    }
    for (i = 0; i < n; i++) {
        if (to_lower(t->text[i]) != word[i]) {
            return 0;
        }
    }
    return 1;
}

/* 오류 메시지에 넣을 현재 토큰 표현 */
static void describe(const Token *t, char *buf, size_t cap) {
    int shown = t->len > 32 ? 32 : (int)t->len;

    if (t->kind == TOK_EOF) {
        snprintf(buf, cap, "입력 끝");
    } else if (t->kind == TOK_STRING) {
        snprintf(buf, cap, "'%.*s%s'", shown, t->text, t->len > 32 ? "..." : "");
    } else {
        snprintf(buf, cap, "\"%.*s%s\"", shown, t->text, t->len > 32 ? "..." : "");
    }
}

static int syntax_error(Parser *p, const char *expected) {
    char near[64];

    describe(&p->cur, near, sizeof near);
    db_error_set(p->err, "구문 오류: %s이(가) 필요합니다 (현재: %s)", expected, near);
    return -1;
}

static int expect(Parser *p, TokKind kind, const char *desc) {
    if (p->cur.kind != kind) {
        return syntax_error(p, desc);
    }
    return advance(p);
}

static int expect_word(Parser *p, const char *word, const char *desc) {
    if (!tok_is(&p->cur, word)) {
        return syntax_error(p, desc);
    }
    return advance(p);
}

/* 문장 끝 세미콜론. 다음 문장의 토큰은 읽지 않는다(다음 문장 오류가 이 문장에 섞이지 않게). */
static int expect_end(Parser *p) {
    if (p->cur.kind != TOK_SEMI) {
        return syntax_error(p, "세미콜론(;)");
    }
    return 0;
}

static int parse_table(Parser *p) {
    if (p->cur.kind != TOK_IDENT) {
        return syntax_error(p, "테이블 이름");
    }
    if (!tok_is(&p->cur, "users")) {
        int shown = p->cur.len > 64 ? 64 : (int)p->cur.len;
        db_error_set(p->err, "테이블 '%.*s'이(가) 존재하지 않습니다", shown, p->cur.text);
        return -1;
    }
    return advance(p);
}

/* '' 이스케이프를 풀어 새 문자열을 만든다. */
static char *decode_string(const Token *t, DbError *err) {
    char *out = malloc(t->len + 1);
    size_t i;
    size_t n = 0;

    if (out == NULL) {
        db_error_set(err, "메모리가 부족합니다");
        return NULL;
    }
    for (i = 0; i < t->len; i++) {
        out[n++] = t->text[i];
        if (t->text[i] == '\'') {
            i++; /* Lexer가 보장: 문자열 안의 '는 항상 '' 쌍 */
        }
    }
    out[n] = '\0';
    return out;
}

static int parse_int_value(Parser *p, int *out) {
    char buf[32];
    char *end;
    long long v;
    int shown = p->cur.len > 24 ? 24 : (int)p->cur.len;

    if (p->cur.len >= sizeof buf) {
        db_error_set(p->err, "age 값 %.*s...이(가) 허용 범위(%d~%d)를 벗어났습니다",
                     shown, p->cur.text, AGE_MIN, AGE_MAX);
        return -1;
    }
    memcpy(buf, p->cur.text, p->cur.len);
    buf[p->cur.len] = '\0';
    errno = 0;
    v = strtoll(buf, &end, 10);
    if (errno == ERANGE || *end != '\0' || v < INT_MIN || v > INT_MAX) {
        db_error_set(p->err, "age 값 %s이(가) 허용 범위(%d~%d)를 벗어났습니다",
                     buf, AGE_MIN, AGE_MAX);
        return -1;
    }
    *out = (int)v; /* 0~150 범위 검사는 Executor가 한다 */
    return 0;
}

/* WHERE 비교값: 64비트 정수 범위면 받는다. 0~150 밖의 age, 0 이하의 id는 일치 없음일 뿐 오류가 아니다. */
static int parse_where_value(Parser *p, const char *col, int64_t *out) {
    char buf[32];
    char *end;
    long long v;
    int shown = p->cur.len > 24 ? 24 : (int)p->cur.len;

    if (p->cur.len >= sizeof buf) {
        db_error_set(p->err, "%s 조건 값 %.*s...이(가) 64비트 정수 범위를 벗어났습니다", col,
                     shown, p->cur.text);
        return -1;
    }
    memcpy(buf, p->cur.text, p->cur.len);
    buf[p->cur.len] = '\0';
    errno = 0;
    v = strtoll(buf, &end, 10);
    if (errno == ERANGE || *end != '\0') { /* long long은 64비트 이상이 보장된다 */
        db_error_set(p->err, "%s 조건 값 %s이(가) 64비트 정수 범위를 벗어났습니다", col, buf);
        return -1;
    }
    *out = (int64_t)v;
    return 0;
}

/* ---------- 문장별 파서 ---------- */

static int parse_columns(Parser *p, int cols[COL_COUNT], size_t *ncols) {
    int seen[COL_COUNT] = {0, 0};

    *ncols = 0;
    if (expect(p, TOK_LPAREN, "여는 괄호 '('") != 0) {
        return -1;
    }
    for (;;) {
        int col;
        int shown = p->cur.len > 64 ? 64 : (int)p->cur.len;

        if (p->cur.kind != TOK_IDENT) {
            return syntax_error(p, "컬럼 이름");
        }
        if (tok_is(&p->cur, "name")) {
            col = COL_NAME;
        } else if (tok_is(&p->cur, "age")) {
            col = COL_AGE;
        } else if (tok_is(&p->cur, "id")) {
            db_error_set(p->err, "id는 자동으로 부여되므로 INSERT에 지정할 수 없습니다");
            return -1;
        } else {
            db_error_set(p->err, "컬럼 '%.*s'이(가) 존재하지 않습니다", shown, p->cur.text);
            return -1;
        }
        if (seen[col]) {
            db_error_set(p->err, "컬럼 '%.*s'이(가) 중복되었습니다", shown, p->cur.text);
            return -1;
        }
        seen[col] = 1;
        cols[(*ncols)++] = col;
        /*
            cols[(*ncols)++] = col;를 했을 때 생성 방식
            (name, age) → cols = [COL_NAME, COL_AGE]
            (age, name) → cols = [COL_AGE, COL_NAME]
        */
        if (advance(p) != 0) {
            return -1;
        }
        if (p->cur.kind == TOK_COMMA) {
            if (advance(p) != 0) {
                return -1;
            }
            continue;
        }
        if (p->cur.kind == TOK_RPAREN) {
            break;
        }
        return syntax_error(p, "',' 또는 ')'");
    }
    if (!seen[COL_NAME]) {
        db_error_set(p->err, "name 컬럼이 필요합니다");
        return -1;
    }
    if (!seen[COL_AGE]) {
        db_error_set(p->err, "age 컬럼이 필요합니다");
        return -1;
    }
    return advance(p); /* ')' 소비 */
}

static int parse_values(Parser *p, const int cols[COL_COUNT], size_t ncols, Statement *out) {
    size_t nvals = 0;

    if (expect(p, TOK_LPAREN, "여는 괄호 '('") != 0) {
        return -1;
    }
    for (;;) {
        if (nvals >= ncols) {
            db_error_set(p->err, "값이 컬럼보다 많습니다 (컬럼 %u개)", (unsigned)ncols);
            return -1;
        }
        if (cols[nvals] == COL_NAME) { /* 문자열을 읽어서 out->name에 저장 */
            if (p->cur.kind != TOK_STRING) {
                db_error_set(p->err, "name에는 작은따옴표로 감싼 문자열 값이 필요합니다");
                return -1;
            }
            out->name = decode_string(&p->cur, p->err);
            if (out->name == NULL) {
                return -1;
            }
        } else { /* 정수를 읽어서 out->age에 저장 */
            if (p->cur.kind != TOK_INT) {
                db_error_set(p->err, "age에는 정수 값이 필요합니다");
                return -1;
            }
            if (parse_int_value(p, &out->age) != 0) {
                return -1;
            }
        }
        nvals++;
        if (advance(p) != 0) {
            return -1;
        }
        if (p->cur.kind == TOK_COMMA) {
            if (advance(p) != 0) {
                return -1;
            }
            continue;
        }
        if (p->cur.kind == TOK_RPAREN) {
            break;
        }
        return syntax_error(p, "',' 또는 ')'");
    }
    if (nvals < ncols) {
        db_error_set(p->err, "값이 컬럼보다 적습니다 (컬럼 %u개, 값 %u개)",
                    (unsigned)ncols, (unsigned)nvals);
        return -1;
    }
    return advance(p); /* ')' 소비 */
}

static int parse_insert(Parser *p, Statement *out) {
    int cols[COL_COUNT];
    size_t ncols;

    out->kind = STMT_INSERT;
    if (advance(p) != 0 ||                       /* INSERT */
        expect_word(p, "into", "INTO") != 0 ||
        parse_table(p) != 0 ||
        parse_columns(p, cols, &ncols) != 0 ||
        expect_word(p, "values", "VALUES") != 0 ||
        parse_values(p, cols, ncols, out) != 0) {
        return -1;
    }
    return expect_end(p);
}

/* WHERE id|age = 정수. 현재 토큰이 WHERE인 상태에서 호출한다. */
static int parse_where(Parser *p, Statement *out) {
    const char *col;
    int shown;

    if (advance(p) != 0) { /* WHERE */
        return -1;
    }
    if (p->cur.kind != TOK_IDENT) {
        return syntax_error(p, "조건 컬럼 이름");
    }
    if (tok_is(&p->cur, "id")) {
        out->where = WHERE_ID;
        col = "id";
    } else if (tok_is(&p->cur, "age")) {
        out->where = WHERE_AGE;
        col = "age";
    } else {
        shown = p->cur.len > 64 ? 64 : (int)p->cur.len;
        if (tok_is(&p->cur, "name")) {
            db_error_set(p->err, "WHERE 조건은 id 또는 age만 지원합니다 (name 조건은 지원하지 않음)");
        } else {
            db_error_set(p->err, "컬럼 '%.*s'이(가) 존재하지 않습니다", shown, p->cur.text);
        }
        return -1;
    }
    if (advance(p) != 0) {
        return -1;
    }
    if (p->cur.kind == TOK_CMP) {
        db_error_set(p->err, "WHERE 조건은 '=' 비교만 지원합니다 (현재: %.*s)",
                     (int)p->cur.len, p->cur.text);
        return -1;
    }
    if (expect(p, TOK_EQ, "'='") != 0) {
        return -1;
    }
    if (p->cur.kind != TOK_INT) {
        if (p->cur.kind == TOK_STRING || p->cur.kind == TOK_IDENT) {
            db_error_set(p->err, "%s 조건에는 정수 값이 필요합니다", col);
            return -1;
        }
        return syntax_error(p, "정수 값");
    }
    if (parse_where_value(p, col, &out->where_value) != 0 || advance(p) != 0) {
        return -1;
    }
    if (tok_is(&p->cur, "and") || tok_is(&p->cur, "or")) {
        db_error_set(p->err, "WHERE 조건은 하나만 지원합니다 (AND/OR 복합 조건은 지원하지 않음)");
        return -1;
    }
    return 0;
}

static int parse_select(Parser *p, Statement *out) {
    out->kind = STMT_SELECT;
    if (advance(p) != 0) { /* SELECT */
        return -1;
    }
    if (p->cur.kind != TOK_STAR) {
        if (p->cur.kind == TOK_IDENT) {
            db_error_set(p->err, "SELECT *만 지원합니다 (컬럼 선택 조회는 지원하지 않음)");
            return -1;
        }
        return syntax_error(p, "'*'");
    }
    if (advance(p) != 0 ||
        expect_word(p, "from", "FROM") != 0 ||
        parse_table(p) != 0) {
        return -1;
    }
    if (tok_is(&p->cur, "where") && parse_where(p, out) != 0) {
        return -1;
    }
    return expect_end(p);
}

/* ---------- 공개 함수 ---------- */

int parser_next(const char *sql, size_t *pos, Statement *out, DbError *err) {
    Parser p;
    int rc;

    out->kind = STMT_SELECT;
    out->name = NULL;
    out->age = 0;
    out->where = WHERE_NONE;
    out->where_value = 0;

    p.sql = sql;
    p.pos = *pos;
    p.err = err;
    if (next_token(&p) != 0) {
        return -1;
    }
    if (p.cur.kind == TOK_EOF) {
        *pos = p.pos;
        return 0;
    }

    if (tok_is(&p.cur, "insert")) {
        rc = parse_insert(&p, out);
    } else if (tok_is(&p.cur, "select")) {
        rc = parse_select(&p, out);
    } else {
        rc = syntax_error(&p, "INSERT 또는 SELECT");
    }
    if (rc != 0) {
        statement_free(out);
        return -1;
    }
    *pos = p.pos;
    return 1;
}

void statement_free(Statement *st) {
    if (st == NULL) {
        return;
    }
    free(st->name);
    st->name = NULL;
}
