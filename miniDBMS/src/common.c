#include "common.h"

#include <stdarg.h>
#include <stdio.h>

void db_error_set(DbError *err, const char *fmt, ...) {
    va_list ap;

    if (err == NULL) {
        return;
    }
    va_start(ap, fmt);
    vsnprintf(err->msg, sizeof err->msg, fmt, ap);
    va_end(ap);
}
