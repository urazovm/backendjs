//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var fs = require('fs');
var os = require("os");
var utils = require(__dirname + '/build/Release/backend');

// Simple logger utility for debugging
var logger = {
    level: 0,
    file: null,
    stream: process.stdout,
    writable: true,
    levels: { test: 3, dev: 2, debug: 1, warn: 0, info: 0, error: -1, none: -1 },
    filters: null,

    // syslog facilities
    LOG_KERN: (0<<3),
    LOG_USER: (1<<3),
    LOG_MAIL: (2<<3),
    LOG_DAEMON: (3<<3),
    LOG_AUTH: (4<<3),
    LOG_SYSLOG: (5<<3),
    LOG_LPR: (6<<3),
    LOG_NEWS: (7<<3),
    LOG_UUCP: (8<<3),
    LOG_CRON:  (9<<3),
    LOG_AUTHPRIV: (10<<3),
    LOG_FTP: (11<<3),
    LOG_LOCAL0: (16<<3),
    LOG_LOCAL1: (17<<3),
    LOG_LOCAL2: (18<<3),
    LOG_LOCAL3: (19<<3),
    LOG_LOCAL4: (20<<3),
    LOG_LOCAL5: (21<<3),
    LOG_LOCAL6: (22<<3),
    LOG_LOCAL7: (23<<3),

    // syslog options for openlog
    LOG_PID: 0x01,
    LOG_CONS: 0x02,
    LOG_ODELAY: 0x04,
    LOG_NDELAY: 0x08,
    LOG_NOWAIT: 0x10,
    LOG_PERROR: 0x20,
    LOG_RFC3339: 0x10000,

    // syslog priorities
    LOG_EMERG: 0,
    LOG_ALERT: 1,
    LOG_CRIT: 2,
    LOG_ERROR: 3,
    LOG_WARNING: 4,
    LOG_NOTICE: 5,
    LOG_INFO: 6,
    LOG_DEBUG: 7,

    syslogMap: {},
    syslogLevels: {},
    syslogFacilities: {},
}

module.exports = logger;

// Default options, can be set directly only so thi smodule does not have any dependencies
logger.options = logger.LOG_PID | logger.LOG_CONS | (os.type() == "Linux" ? logger.LOG_RFC3339 : 0);
logger.facility = logger.LOG_LOCAL0;

logger.pad = function(n)
{
    if (n >= 0 && n < 10) return "0" + n
    return n
}

logger.prefix = function(level)
{
    var d = new Date()
    return d.getFullYear() + "-" +
           this.pad(d.getMonth()+1) + "-" +
           this.pad(d.getDate()) + " " +
           this.pad(d.getHours()) + ":" +
           this.pad(d.getMinutes()) + ":" +
           this.pad(d.getSeconds()) + "." +
           this.pad(d.getMilliseconds()) +
           " [" + process.pid + "] " +
           level + ": "
}

// Set or close syslog mode
logger.setSyslog = function (on)
{
    var self = this;
    if (on) {
        utils.syslogInit("backend", this.options, this.facility);
        self.print = this.printSyslog;
        // Initialize map for facilities
        self.syslogLevels = { test: this.LOG_DEBUG, dev: this.LOG_DEBUG, debug: this.LOG_DEBUG, warn: this.LOG_WARNING,
                              notice: this.LOG_NOTICE, info: this.LOG_INFO, error: this.LOG_ERROR,
                              emerg: this.LOG_EMERG, alert: this.LOG_ALERT, crit: this.LOG_CRIT };
        self.syslogFacilities = { kern: this.LOG_KERN, user: this.LOG_USER, mail: this.LOG_MAIL,
                                  daemon: this.LOG_DAEMON, auth: this.LOG_AUTH, syslog: this.LOG_SYSLOG,
                                  lpr: this.LOG_LPR, news: this.LOG_NEWS, uucp: this.LOG_UUCP,
                                  cron: this.LOG_CRON, authpriv: this.LOG_AUTHPRIV,
                                  ftp: this.LOG_FTP, local0: this.LOG_LOCAL0, local1: this.LOG_LOCAL1,
                                  local2: this.LOG_LOCAL2, local3: this.LOG_LOCAL3, local4: this.LOG_LOCAL4,
                                  local5: this.LOG_LOCAL5, local6: this.LOG_LOCAL6, local7: this.LOG_LOCAL7 };
        self.syslogMap = {}
        Object.keys(this.syslogLevels).forEach(function(l) {
           Object.keys(self.syslogFacilities).forEach(function(f) {
               self.syslogMap[l + ':' + f] = self.syslogLevels[l] | self.syslogFacilities[f];
           });
        });
    } else {
        utils.syslogClose();
        self.print = this.printStream;
    }
    self.syslog = on;
}

// Redirect logging into file
logger.setFile = function(file)
{
    var self = this;
    if (this.stream && this.stream != process.stdout) {
        this.stream.destroySoon();
    }
    self.file = file;
    if (self.file) {
        self.stream = fs.createWriteStream(this.file, { flags: 'a' });
        self.stream.on('error', function(err) {
            process.stderr.write(String(err));
            self.stream = process.stderr;
        });
        // Make sure the log file is owned by regular user to avoid crashes due to no permission of the log file
        if (process.getuid() == 0) {
            fs.chown(file, core.uid, core.gid, function(err) { self.error(file, e) });
        }
    } else {
        self.stream = process.stdout;
    }
    this.setSyslog(0);
}

logger.setDebug = function(level)
{
    var self = this;
    self.level = typeof this.levels[level] != "undefined" ? this.levels[level] : isNaN(parseInt(level)) ? 0 : parseInt(level);
    utils.logging(self.level + 2);
}

// Enable debugging level for this label, if used with the same debugging level it will be printed regardless of the global level
logger.setDebugFilter = function(str)
{
    var self = this;
    String(str).split(",").forEach(function(x) {
        x = x.trim();
        switch (x[0]) {
        case '-':
            if (x == "-") self.filters = null;
            if (!self.filters) break;
            delete self.filters[x.substr(1)];
            if (!Object.keys(self.filters).length) self.filters = null;
            break;
        case '+':
            if (!self.filters) self.filters = {};
            self.filters[x.substr(1)] = 1;
            break;
        }
    });
}

// Assign output channel to system logger, default is stdout
logger.setChannel = function(name)
{
    utils.loggingChannel(name);
}
// syslog allows facility to be specified after log level like info:local0 for LOG_LOCAL0
logger.printSyslog = function(level, msg)
{
    var code = this.syslogMap[level];
    utils.syslogSend(code || this.LOG_INFO, (code ? "" : level + ": ") + msg);
}

logger.printStream = function(level, msg)
{
    this.stream.write(this.prefix(level) + msg + "\n");
}

logger.printError = function()
{
    process.stderr.write(this.prefix("ERROR") + this.format(arguments) + "\n");
}

logger.log = function()
{
    if (this.level < 0) return;
    this.print('INFO', this.format(arguments));
}

// Make it one line to preserve space, syslog cannot output very long lines
logger.debug = function()
{
    if (this.level < 1 && (!this.filters || !this.filters[arguments[0]])) return;
    this.print('DEBUG', this.format(arguments));
}

logger.dev = function()
{
    if (this.level < 2) return;
    this.print('DEV', this.format(arguments));
}

logger.warn = function()
{
    if (this.level < 0) return;
    this.print('WARN', this.format(arguments));
}

logger.error = function()
{
    this.print('ERROR', this.format(arguments));
}

logger.dump = function()
{
    this.stream.write(util.format.apply(this, arguments).replace(/[ \r\n\t]+/g, " ") + "\n");
}

logger.format = function(args)
{
    var str = "";
    for (var p in args) str += util.inspect(args[p], { depth: 5 }) + " ";
    return str.replace(/\\n/g,' ').replace(/[ \\\r\n\t]+/g, " ");
}

// Print stack backtrace as error
logger.trace = function()
{
    var err = new Error('');
    err.name = 'Trace';
    Error.captureStackTrace(err, arguments.callee);
    this.error(util.format.apply(this, arguments), err.stack);
}

// A generic logger method, safe, first arg is supposed to be a logging level, if not valid the call is ignored
logger.logger = function()
{
    if (["error","log","warn","debug","test","trace"].indexOf(arguments[0] || "") == -1) return;
    this[arguments[0]].apply(this, (Array.prototype.slice.apply(arguments).slice(1)));
}

// Default write handler
logger.print = function()
{
    this.printStream.apply(this, arguments);
}

// Stream emulation
logger.write = function(str)
{
    if (str) this.log(str);
    return true;
}

logger.end = function(str)
{
    if (str) this.log(str);
}
