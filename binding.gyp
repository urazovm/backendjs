{
    "target_defaults": {
        "defines": [
           "SQLITE_USE_URI",
           "SQLITE_ENABLE_STAT3=1",
           "SQLITE_ENABLE_FTS4=1",
           "SQLITE_ENABLE_FTS3_PARENTHESIS=1",
           "SQLITE_ENABLE_COLUMN_METADATA=1",
           "SQLITE_ALLOW_COVERING_INDEX_SCAN=1",
           "SQLITE_ENABLE_UNLOCK_NOTIFY",
           "SQLITE_ENABLE_LOAD_EXTENSION",
           "SQLITE_SOUNDEX",
           "HAVE_INTTYPES_H=1",
           "HAVE_STDINT_H=1",
           "HAVE_USLEEP=1",
           "HAVE_LOCALTIME_R=1",
           "HAVE_GMTIME_R=1",
           "HAVE_STRERROR_R=1",
           "HAVE_READLINE=1",
           "LEVELDB_PLATFORM_POSIX",
           "SNAPPY=1",
           "NDEBUG",
        ],
        "include_dirs": [
           ".",
           "src",
           "src/snappy",
           "src/lmdb",
           "src/sqlite",
           "src/leveldb/include",
           "src/leveldb",
           "include",
           "build/include",
           "/opt/local/include"
        ]
    },
    "targets": [
    {
        "target_name": "backend",
        "defines": [
           "<!@(if which mysql_config 2>/dev/null 1>&2; then echo USE_MYSQL; fi)",
           "<!@(if which pkg-config 2>/dev/null 1>&2 && pkg-config --exists libpq; then echo USE_PGSQL; fi)",
           "<!@(if test -f /usr/include/libpq-fe.h -o -f /usr/include/pgsql/libpq-fe.h; then echo USE_PGSQL; fi)",
           "<!@(export PKG_CONFIG_PATH=`pwd`/build/lib/pkgconfig; if which pkg-config 2>/dev/null 1>&2 && pkg-config --exists Wand; then echo USE_WAND; fi)",
           "<!@(export PKG_CONFIG_PATH=`pwd`/build/lib/pkgconfig; if which pkg-config 2>/dev/null 1>&2 && pkg-config --exists libnanomsg; then echo USE_NANOMSG; fi)",
        ],
        "libraries": [
           "-L/opt/local/lib",
           "$(shell mysql_config --libs_r 2>/dev/null)",
           "<!@(if test -f /usr/include/libpq-fe.h; then echo -lpq; fi)",
           "<!@(if test -f /usr/include/pgsql/libpq-fe.h; then echo -lpq; fi)",
           "$(shell pkg-config --silence-errors --static --libs libpq)",
           "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --silence-errors --static --libs libnanomsg)",
           "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --silence-errors --static --libs Wand)"
        ],
        "sources": [
           "src/node_backend.cpp",
           "src/node_debug.cpp",
           "src/node_image.cpp",
           "src/node_sqlite.cpp",
           "src/node_syslog.cpp",
           "src/node_nanomsg.cpp",
           "src/node_pgsql.cpp",
           "src/node_mysql.cpp",
           "src/node_leveldb.cpp",
           "src/node_lmdb.cpp",
           "src/node_cache.cpp",
           "src/bksqlite.cpp",
           "src/bklog.cpp",
           "src/bklib.cpp",
           "src/bkunzip.cpp",
           "src/regexp.cpp",
           "src/sqlite/sqlite3.cpp",
           "src/snappy/snappy.cc",
           "src/snappy/snappy-sinksource.cc",
           "src/snappy/snappy-stubs-internal.cc",
           "src/lmdb/mdb.c",
           "src/lmdb/midl.c",
           "src/leveldb/db/builder.cc",
           "src/leveldb/db/db_impl.cc",
           "src/leveldb/db/db_iter.cc",
           "src/leveldb/db/filename.cc",
           "src/leveldb/db/dbformat.cc",
           "src/leveldb/db/log_reader.cc",
           "src/leveldb/db/log_writer.cc",
           "src/leveldb/db/memtable.cc",
           "src/leveldb/db/repair.cc",
           "src/leveldb/db/table_cache.cc",
           "src/leveldb/db/version_edit.cc",
           "src/leveldb/db/version_set.cc",
           "src/leveldb/db/write_batch.cc",
           "src/leveldb/helpers/memenv/memenv.cc",
           "src/leveldb/table/block.cc",
           "src/leveldb/table/block_builder.cc",
           "src/leveldb/table/filter_block.cc",
           "src/leveldb/table/format.cc",
           "src/leveldb/table/iterator.cc",
           "src/leveldb/table/merger.cc",
           "src/leveldb/table/table.cc",
           "src/leveldb/table/table_builder.cc",
           "src/leveldb/table/two_level_iterator.cc",
           "src/leveldb/util/arena.cc",
           "src/leveldb/util/bloom.cc",
           "src/leveldb/util/cache.cc",
           "src/leveldb/util/coding.cc",
           "src/leveldb/util/comparator.cc",
           "src/leveldb/util/crc32c.cc",
           "src/leveldb/util/env.cc",
           "src/leveldb/util/env_posix.cc",
           "src/leveldb/util/filter_policy.cc",
           "src/leveldb/util/hash.cc",
           "src/leveldb/util/logging.cc",
           "src/leveldb/util/options.cc",
           "src/leveldb/util/status.cc",
           "src/leveldb/port/port_posix.cc",
        ],
        "conditions": [
           [ 'OS=="mac"', {
             "defines": [
                "OS_MACOSX",
             ],
             "xcode_settings": {
                "OTHER_CFLAGS": [
                   "-g -fPIC",
                   "$(shell mysql_config --cflags)",
                   "$(shell pkg-config --silence-errors --cflags libpq)",
                   "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --silence-errors --cflags Wand)"
                ],
             }
           }],
           [ 'OS=="linux"', {
             "defines": [
                "OS_LINUX",
             ],
             "cflags_cc+": [
                "-g -fPIC -rdynamic",
                "$(shell mysql_config --cflags)",
                "$(shell pkg-config --silence-errors --cflags libpq)",
                "$(shell if test -f /usr/include/pgsql/libpq-fe.h; then echo -I/usr/include/pgsql; fi)",
                "$(shell PKG_CONFIG_PATH=$$(pwd)/lib/pkgconfig pkg-config --silence-errors --cflags Wand)",
             ]
           }]
        ]
    }]
}
