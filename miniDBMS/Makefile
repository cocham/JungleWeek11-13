# 미니 DBMS 빌드 (DB-D04)
#   Windows: mingw32-make (TDM-GCC)  — 빌드·단위·CLI 테스트
#   Linux/Docker: make               — 위 + sanitize(ASan/UBSan·누수 검사)

CC = gcc
CFLAGS = -std=c17 -Wall -Wextra -Wpedantic -Wshadow -Wstrict-prototypes -O2 -g
SAN_FLAGS = -fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=all -O1 -g

SRC = src/common.c src/parser.c src/storage.c src/executor.c
HDR = src/common.h src/parser.h src/storage.h src/executor.h

ifeq ($(OS),Windows_NT)
  SHELL := cmd.exe
  EXE := .exe
  PYTHON ?= python
  CPPFLAGS += -D__USE_MINGW_ANSI_STDIO=1
  fix = $(subst /,\,$1)
  RMDIR = if exist build rmdir /s /q build
else
  EXE :=
  PYTHON ?= python3
  fix = $1
  RMDIR = rm -rf build
endif

BIN = build/minidb$(EXE)
TEST_BIN = build/test_unit$(EXE)

.PHONY: all test unit cli sanitize clean

all: $(BIN)

build:
	mkdir build

$(BIN): $(SRC) src/main.c $(HDR) | build
	$(CC) $(CFLAGS) $(CPPFLAGS) -o $@ $(SRC) src/main.c

$(TEST_BIN): $(SRC) tests/test_unit.c $(HDR) | build
	$(CC) $(CFLAGS) $(CPPFLAGS) -Isrc -o $@ $(SRC) tests/test_unit.c

test: unit cli

unit: $(TEST_BIN)
	$(call fix,$(TEST_BIN)) build/tmp_unit

cli: $(BIN)
	$(PYTHON) tests/cli_test.py $(BIN)

# Linux 전용: ASan/UBSan과 LeakSanitizer로 단위·CLI 테스트를 다시 실행한다.
sanitize:
	mkdir -p build/san
	$(CC) $(CFLAGS) $(SAN_FLAGS) -o build/san/minidb $(SRC) src/main.c
	$(CC) $(CFLAGS) $(SAN_FLAGS) -Isrc -o build/san/test_unit $(SRC) tests/test_unit.c
	ASAN_OPTIONS=detect_leaks=1 build/san/test_unit build/san/tmp_unit
	ASAN_OPTIONS=detect_leaks=1 $(PYTHON) tests/cli_test.py build/san/minidb

clean:
	$(RMDIR)
