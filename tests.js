//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//
// Unit tests
// To run a test execute for example: node tests.js -cmd account ....
//

var fs = require("fs");
var cluster = require('cluster');
var util = require('util');
var path = require('path');
var child_process = require('child_process');
var bkjs = require('backendjs')
core = bkjs.core;
corelib = bkjs.corelib;
ipc = bkjs.ipc;
api = bkjs.api;
db = bkjs.db;
aws = bkjs.aws;
server = bkjs.server;
logger = bkjs.logger;
bk = bkjs.backend;

var females = [ "mary", "patricia", "linda", "barbara", "elizabeth", "jennifer", "maria", "susan",
                "carol", "ruth", "sharon", "michelle", "laura", "sarah", "kimberly", "deborah", "jessica",
                "heather", "teresa", "doris", "gloria", "evelyn", "jean", "cheryl", "mildred",
                "katherine", "joan", "ashley", "judith"];

var males = [ "james", "john", "robert", "michael", "william", "david", "richard", "charles", "joseph",
              "thomas", "christopher", "daniel", "paul", "mark", "donald", "george", "kenneth", "steven",
              "justin", "terry", "gerald", "keith", "samuel", "willie", "ralph", "lawrence", "nicholas",
              "roy", "benjamin"];

var locations = { LA: { name: "Los Angeles",  bbox: [ 33.60503975233155, -117.72825045393661, 34.50336024766845, -118.75374954606342 ], },
                  DC: { name: "Washington", bbox: [ 30.10, -77.5, 38.60, -76.5 ], },
                  SD: { name: "San Diego", bbox: [ 32.26553975233155, -118.8279466261797, 33.163860247668445, -115.4840533738203 ], },
                  SF: { name: "San Francisco", bbox: [ 37.32833975233156, -122.86154379633437, 38.22666024766845, -121.96045620366564 ] }, };

// Test object with functions for different areas to be tested
var tests = {
    city: "",
    bbox: [0, 0, 0, 0],
};

// To be used in the tests, this function takes the following arguments
// checkTest(next, err, failure, ....)
//  - next is a callback to be called after printing error condition if any, it takes err as its argument
//  - err - is the error object passed by the most recent operation
//  - failure - must be true for failed test, the condition is evaluated by the caller and this is the result of it
//  - all other arguments are printed in case of error or result being false
//
//  NOTE: In forever mode (-test-forever) any error is ignored and not reported
//
// Example
//
//          function(next) {
//              db.get("bk_account", { id: "123" }, function(err, row) {
//                  core.checkTest(next, err, row && row.id == "123", "Record not found", row)
//              });
//          }
core.checkTest = function()
{
    var next = arguments[0], err = null;
    if (this.test.forever) return next();

    if (arguments[1] || arguments[2]) {
        var args = [ arguments[1] || new Error("failed condition") ];
        for (var i = 3; i < arguments.length; i++) args.push(arguments[i]);
        logger.error(args);
        err = args[0];
    }
    if (this.test.timeout) return setTimeout(function() { next(err) }, this.test.timeout);
    next(err);
}

// Run the test function which is defined in the object, all arguments will be taken from the command line.
// The common command line arguments that supported:
// - -test-cmd - name of the function to run
// - -test-workers - number of workers to run the test at the same time
// - -test-delay - number of milliseconds before starting worker processes, default is 500ms
// - -test-timeout - number of milliseconds between test steps, i.e. between invokations of the checkTest
// - -test-iterations - how many times to run this test function, default is 1
// - -test-forever - run forever without reporting any errors, for performance testing
//
// All common command line arguments can be used, like -db-pool to specify which db to use.
//
// After finish or in case of error the process exits, so this is not supposded tobe run inside the
// production backend, only as standalone utility for running unit tests
//
// Example:
//
//          var bk = require("backendjs"), core = bk.core, db = bk.db;
//          var tests = {
//              test1: function(next) {
//                  db.get("bk_account", { id: "123" }, function(err, row) {
//                      core.checkTest(next, err, row && row.id == "123", "Record not found", row)
//                  });
//              },
//              ...
//          }
//          bk.run(function() { core.runTest(tests); });
//
//          # node tests.js -test-cmd test1
//
core.runTest = function(obj, options, callback)
{
    var self = this;
    if (!options) options = {};

    this.test = { role: cluster.isMaster ? "master" : "worker", iterations: 0, stime: Date.now() };
    this.test.delay = options.delay || this.getArgInt("-test-delay", 500);
    this.test.countdown = options.iterations || this.getArgInt("-test-iterations", 1);
    this.test.forever = options.forever || this.getArgInt("-test-forever", 0);
    this.test.timeout = options.forever || this.getArgInt("-test-timeout", 0);
    this.test.keepmaster = options.keepmaster || this.getArgInt("-test-keepmaster", 0);
    self.test.workers = options.workers || self.getArgInt("-test-workers", 0);
    this.test.cmd = options.cmd || this.getArg("-test-cmd");
    if (this.test.cmd[0] == "_" || !obj || !obj[this.test.cmd]) {
        console.log("usage: ", process.argv[0], process.argv[1], "-test-cmd", "command");
        console.log("      where command is one of: ", Object.keys(obj).filter(function(x) { return x[0] != "_" && typeof obj[x] == "function" }).join(", "));
        if (cluster.isMaster && callback) return callback("invalid arguments");
        process.exit(0);
    }

    if (cluster.isMaster) {
        setTimeout(function() { for (var i = 0; i < self.test.workers; i++) cluster.fork(); }, self.test.delay);
        cluster.on("exit", function(worker) {
            if (!Object.keys(cluster.workers).length && !self.test.forever && !self.test.keepmaster) process.exit(0);
        });
    }

    logger.log("test started:", cluster.isMaster ? "master" : "worker", 'name:', this.test.cmd, 'db-pool:', this.modules.db.pool);

    corelib.whilst(
        function () { return self.test.countdown > 0 || self.test.forever || options.running; },
        function (next) {
            self.test.countdown--;
            obj[self.test.cmd](function(err) {
                self.test.iterations++;
                if (self.test.forever) err = null;
                setImmediate(function() { next(err) });
            });
        },
        function(err) {
            self.test.etime = Date.now();
            if (err) {
                logger.error("test failed:", self.test.role, 'name:', self.test.cmd, err);
                if (cluster.isMaster && callback) return callback(err);
                process.exit(1);
            }
            logger.log("test stopped:", self.test.role, 'name:', self.test.cmd, 'db-pool:', self.modules.db.pool, 'time:', self.test.etime - self.test.stime, "ms");
            if (cluster.isMaster && callback) return callback();
            process.exit(0);
        });
};

server.startTestServer = function(options)
{
    var self = this;
    if (!options) options = {};

    if (!options.master) {
        options.running = options.stime = options.etime = options.id = 0;
        aws.getInstanceInfo(function() {
            setInterval(function() {
                core.sendRequest({ url: options.host + '/ping/' + core.instance.id + '/' + options.id }, function(err, params) {
                    if (err) return;
                    logger.debug(params.obj);

                    switch (params.obj.cmd) {
                    case "exit":
                    case "error":
                        process.exit(0);
                        break;

                    case "register":
                        options.id = params.obj.id;
                        break;

                    case "start":
                        if (options.running) break;
                        options.running = true;
                        options.stime = Date.now();
                        if (options.callback) {
                            options.callback(options);
                        } else
                        if (options.test) {
                            var name = options.test.split(".");
                            core.runTest(core.modules[name[0]], name[1], options);
                        }
                        break;

                    case "stop":
                        if (!options.running) break;
                        options.running = false;
                        options.etime = Date.now();
                        break;

                    case "shutdown":
                        self.shutdown();
                        break;
                    }
                });

                // Check shutdown interval
                if (!options.running) {
                    var now = Date.now();
                    if (!options.etime) options.etime = now;
                    if (now - options.etime > (options.idlelimit || 3600000)) core.shutdown();
                }
            }, options.interval || 5000);
        });
        return;
    }

    var nodes = {};
    var app = express();
    app.on('error', function (e) { logger.error(e); });
    app.use(function(req, res, next) { return api.checkQuery(req, res, next); });
    app.use(app.routes);
    app.use(function(err, req, res, next) {
        logger.error('startTestMaster:', req.path, err, err.stack);
        res.json(err);
    });
    try { app.listen(options.port || 8080); } catch(e) { logger.error('startTestMaster:', e); }

    // Return list of all nodes
    app.get('/nodes', function(req, res) {
        res.json(nodes)
    });

    // Registration: instance, id
    app.get(/^\/ping\/([a-z0-9-]+)\/([a-z0-9]+)/, function(req, res) {
        var now = Date.now();
        var obj = { cmd: 'error', mtime: now }
        var node = nodes[req.params[1]];
        if (node) {
            node.instance = req.params[0];
            node.mtime = now;
            obj.cmd = node.state;
        } else {
            obj.cmd = 'register';
            obj.id = corelib.uuid();
            nodes[obj.id] = { state: 'stop', ip: req.connection.remoteAddress, mtime: now, stime: now };
        }
        logger.debug(obj);
        res.json(obj)
    });

    // Change state of the node(es)
    app.get(/^\/(start|stop|launch|shutdown)\/([0-9]+)/, function(req, res, next) {
        var obj = {}
        var now = Date.now();
        var state = req.params[0];
        var num = req.params[1];
        switch (state) {
        case "launch":
            break;

        case "shutdown":
            var instances = {};
            for (var n in nodes) {
                if (num <= 0) break;
                if (!instances[nodes[n].instance]) {
                    instances[nodes[n].instance] = 1;
                    num--;
                }
            }
            for (var n in nodes) {
                var node = nodes[n];
                if (node && node.state != state && instances[node.instance]) {
                    node.state = state;
                    node.stime = now;
                }
            }
            logger.log('shutdown:', instances);
            break;

        default:
            for (var n in nodes) {
                if (num <= 0) break;
                var node = nodes[n];
                if (node && node.state != state) {
                    node.state = state;
                    node.stime = now;
                    num--;
                }
            }
        }
        res.json(obj);
    });

    var interval = options.interval || 30000;
    var runlimit = options.runlimit || 3600000;

    setInterval(function() {
        var now = Date.now();
        for (var n in nodes) {
            var node = nodes[n]
            // Last time we saw this node
            if (now - node.mtime > interval) {
                logger.debug('cleanup: node expired', n, node);
                delete nodes[n];
            } else
            // How long this node was in this state
            if (now - node.stime > runlimit) {
                switch (node.state) {
                case 'start':
                    // Stop long running nodes
                    node.state = 'stop';
                    logger.log('cleanup: node running too long', n, node)
                    break;
                }
            }
        }
    }, interval);

    logger.log('startTestMaster: started', options || "");
}

tests.account = function(callback)
{
    var myid, otherid;
    var login = corelib.random();
    var secret = login;
    var gender = ['m','f'][corelib.randomInt(0,1)];
    var bday = new Date(corelib.randomInt(Date.now() - 50*365*86400000, Date.now() - 20*365*86400000));
    var latitude = corelib.randomNum(this.bbox[0], this.bbox[2]);
    var longitude = corelib.randomNum(this.bbox[1], this.bbox[3]);
    var name = corelib.toTitle(gender == 'm' ? males[corelib.randomInt(0, males.length - 1)] : females[corelib.randomInt(0, females.length - 1)]);
    var email = "test@test.com"
    var icon = "iVBORw0KGgoAAAANSUhEUgAAAAcAAAAJCAYAAAD+WDajAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAAABp0RVh0U29mdHdhcmUAUGFpbnQuTkVUIHYzLjUuMTAw9HKhAAAAPElEQVQoU2NggIL6+npjIN4NxIIwMTANFFAC4rtA/B+kAC6JJgGSRCgAcs5ABWASMHoVw////3HigZAEACKmlTwMfriZAAAAAElFTkSuQmCC";
    var msgs = null, icons = [];

    corelib.series([
        function(next) {
            var query = { login: login, secret: secret, name: name, gender: gender, birthday: corelib.strftime(bday, "%Y-%m-%d") }
            core.sendRequest({ url: "/account/add", sign: false, query: query }, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/del", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.name != name, "err1:", params.obj);
            });
        },
        function(next) {
            var query = { login: login + 'other', secret: secret, name: name + ' Other', gender: gender, birthday: corelib.strftime(bday, "%Y-%m-%d") }
            core.sendRequest({ url: "/account/add", sign: false, query: query }, function(err, params) {
                otherid = params.obj.id;
                next(err);
            });
        },
        function(next) {
            var query = { login: login, secret: secret, name: name, gender: gender, email: email, birthday: corelib.strftime(bday, "%Y-%m-%d") }
            for (var i = 1; i < process.argv.length - 1; i++) {
                var d = process.argv[i].match(/^\-account\-(.+)$/);
                if (!d) continue;
                if (d[1] == "icon") {
                    icons.push(process.argv[++i]);
                } else {
                    query[d[1]] = process.argv[++i];
                }
            }
            core.sendRequest({ url: "/account/add", sign: false, query: query }, function(err, params) {
                myid = params.obj.id;
                next(err);
            });
        },
        function(next) {
            if (!icons.length) return next();
            // Add all icons from the files
            var type = 0;
            corelib.forEachSeries(icons, function(icon, next2) {
                icon = corelib.readFileSync(icon, { encoding : "base64" });
                var options = { url: "/account/put/icon", login: login, secret: secret, method: "POST", postdata: { icon: icon, type: type++, acl_allow: "allow" }  }
                core.sendRequest(options, function(err, params) {
                    next2(err);
                });
            }, next);
        },
        function(next) {
            var options = { url: "/location/put", login: login, secret: secret, query: { latitude: latitude, longitude: longitude } };
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/update",login: login, secret: secret, query: { alias: "test" + name }, type: "testadmin", latitude: 1, ltime: 1, type: "admin" };
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/put/secret", login: login, secret: secret, query: { secret: "test" } };
            core.sendRequest(options, function(err, params) {
                secret = "test";
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next,err, !params.obj || params.obj.name != name || params.obj.alias != "test" + name || params.obj.latitude != latitude || params.obj.type, "err2:",params.obj);
            });
        },
        function(next) {
            var options = { url: "/account/put/icon", login: login, secret: secret, query: { icon: icon, type: 98, acl_allow: "all" }  }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/put/icon", login: login, secret: secret, method: "POST", postdata: { icon: icon, type: 99, _width: 128, _height: 128, acl_allow: "auth" }  }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/account/select/icon", login: login, secret: secret, query: { _consistent: 1 } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.length!=2+icons.length || !params.obj[0].acl_allow || !params.obj[0].prefix, "err2-1:", params.obj);
            });
        },
        function(next) {
            var options = { url: "/account/get", login: login, secret: secret, query: { id: otherid } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next,err, !params.obj || params.obj.length!=1 || params.obj[0].name, "err3:", params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/add", login: login, secret: secret, query: { peer: otherid, type: "like" }  }
            core.sendRequest(options, function(err, params) {
                options = { url: "/connection/add", login: login, secret: secret, query: { peer: otherid, type: "follow" }  }
                core.sendRequest(options, function(err, params) {
                    next(err);
                });
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { type: "like" } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err4:", params.obj.count, params.obj.data);
            });
        },
        function(next) {
            var options = { url: "/counter/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.like0!=1 || params.obj.follow0!=1, "err5:", params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/del", login: login, secret: secret, query: { peer: otherid, type: "like" }  }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { type: "follow" } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err6:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { type: "follow", _accounts: 1 } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err7:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/counter/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.follow0!=1 || params.obj.ping!=0, "err8:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/del", login: login, secret: secret, query: {} }
            core.sendRequest(options, function(err, params) {
                next(err, "err5-3:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/connection/select", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err9:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/counter/incr", login: login, secret: secret, query: { ping: "1" } }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/counter/get", login: login, secret: secret }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || params.obj.like0!=0 || params.obj.ping!=1, "err10:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/add", login: login, secret: secret, query: { id: otherid, msg: "test123" }  }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err7:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/add", login: login, secret: secret, query: { id: myid, icon: icon }  }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err8:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/add", login: login, secret: secret, method: "POST", postdata: { id: myid, msg: "test000" }  }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err11:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                msgs = params.obj;
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2, "err12:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { sender: myid } }
            core.sendRequest(options, function(err, params) {
                msgs = params.obj;
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2 || msgs.data[0].sender!=myid, "err13:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/archive", login: login, secret: secret, query: { sender: msgs.data[0].sender, mtime: msgs.data[0].mtime } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj, "err14:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/image", login: login, secret: secret, query: { sender: msgs.data[0].sender, mtime: msgs.data[0].mtime } }
            core.sendRequest(options, function(err, params) {
                next(err);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { _archive: 1 } }
            core.sendRequest(options, function(err, params) {
                msgs = params.obj;
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1, "err15:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err16:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get/sent", login: login, secret: secret, query: { recipient: otherid } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=1 || params.obj.data[0].recipient!=otherid || params.obj.data[0].msg!="test123", "err15:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get/archive", login: login, secret: secret, query: { } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=2, "err17:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/del/archive", login: login, secret: secret, query: { sender: myid } }
            core.sendRequest(options, function(err, params) {
                next(err, "err18:" , params.obj);
            });
        },
        function(next) {
            var options = { url: "/message/get/archive", login: login, secret: secret, query: { sender: myid } }
            core.sendRequest(options, function(err, params) {
                core.checkTest(next, err, !params.obj || !params.obj.data || params.obj.data.length!=0, "err20:" , params.obj);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.resetTables = function(tables, callback)
{
    db.dropPoolTables(db.pool, tables, function() {
        db.initPoolTables(db.pool, tables, callback);
    });
}

tests.location = function(callback)
{
    var self = this;
    var tables = {
            geo: { geohash: { primary: 1, index: 1, semipub: 1 },
                   id: { type: "int", primary: 1, pub: 1 },
                   latitude: { type: "real", semipub: 1, projection: 1 },
                   longitude: { type: "real", semipub: 1, projection: 1 },
                   distance: { type: "real" },
                   rank: { type: 'int', index: 1 },
                   status: { value: 'good', projection: 1 },
                   mtime: { type: "bigint", now: 1 }
            },
    };
    var bbox = this.bbox;
    var rows = core.getArgInt("-rows", 10);
    var distance = core.getArgInt("-distance", 25);
    var round = core.getArgInt("-round", 0);
    var reset = core.getArgInt("-reset", 1);
    var latitude = core.getArgInt("-lat", corelib.randomNum(bbox[0], bbox[2]))
    var longitude = core.getArgInt("-lon", corelib.randomNum(bbox[1], bbox[3]))

    var rc = [], top = {}, bad = 0, good = 0, error = 0, count = rows/2;
    var ghash, gcount = Math.floor(count/2);
    // New bounding box for the tests
    bbox = bkjs.utils.geoBoundingBox(latitude, longitude, distance);
    // To get all neighbors, we can only guarantee searches in the neighboring areas, even if the distance is within it
    // still can be in the box outside of the immediate neighbors, minDistance is an approximation
    var geo = corelib.geoHash(latitude, longitude, { distance: distance });

    corelib.series([
        function(next) {
            if (!cluster.isMaster && !reset) return next();
            self.resetTables(tables, next);
        },
        function(next) {
            if (!reset) return next();
            corelib.whilst(
                function () { return good < rows + count; },
                function (next2) {
                    var lat = corelib.randomNum(bbox[0], bbox[2]);
                    var lon = corelib.randomNum(bbox[1], bbox[3]);
                    var obj = corelib.geoHash(lat, lon);
                    obj.distance = corelib.geoDistance(latitude, longitude, lat, lon, { round: round });
                    if (obj.distance == null || obj.distance > distance) return next2();
                    // Make sure its in the neighbors
                    if (geo.neighbors.indexOf(obj.geohash) == -1) return next2();
                    // Create several records in the same geohash box
                    if (good > rows && ghash != obj.geohash) return next2();
                    good++;
                    obj.id = String(good);
                    obj.rank = good;
                    ghash = obj.geohash;
                    db.add("geo", obj, { silence_error: 1 }, function(err) {
                        if (!err) {
                            // Keep track of all records by area for top search by rank
                            if (!top[obj.geohash]) top[obj.geohash] = [];
                            top[obj.geohash].push(obj.rank);
                        } else {
                            good--;
                            if (error++ < 10) err = null;
                        }
                        next2(err);
                    });
                },
                function(err) {
                    next(err);
                });
        },
        function(next) {
            if (!reset) return next();
            // Records beyond our distance
            bad = good;
            corelib.whilst(
                function () { return bad < good + count; },
                function (next2) {
                    var lat = corelib.randomNum(bbox[0], bbox[2]);
                    var lon = corelib.randomNum(bbox[1], bbox[3]);
                    var obj = corelib.geoHash(lat, lon);
                    obj.distance = corelib.geoDistance(latitude, longitude, lat, lon, { round: round });
                    if (obj.distance == null || obj.distance <= distance || obj.distance > distance*2) return next2();
                    bad++;
                    obj.id = String(bad);
                    obj.rank = bad;
                    obj.status = "bad";
                    db.add("geo", obj, { silence_error: 1 }, function(err) {
                        if (err) {
                            bad--;
                            if (error++ < 10) err = null;
                        }
                        next2(err);
                    });
                },
                function(err) {
                    next(err);
                });
        },
        function(next) {
            // Scan all locations, do it in small chunks to verify we can continue within the same geohash area
            var query = { latitude: latitude, longitude: longitude, distance: distance };
            var options = { count: gcount, round: round };
            corelib.doWhilst(
                function(next2) {
                    db.getLocations("geo", query, options, function(err, rows, info) {
                        options = info.next_token;
                        rows.forEach(function(x) { rc.push({ id: x.geohash + ":" + x.id, status: x.status }) })
                        next2();
                    });
                },
                function() { return options },
                function(err) {
                    var ids = {};
                    var isok = rc.every(function(x) { ids[x.id] = 1; return x.status == 'good' })
                    core.checkTest(next, err, rc.length!=good || Object.keys(ids).length!=good, "err1: ", rc.length, good, 'RC:', rc, ids);
                });
        },
        function(next) {
            // Scan all good locations with the top 3 rank values
            var query = { latitude: latitude, longitude: longitude, distance: distance, status: "good", rank: good-3 };
            var options = { round: round, ops: { rank: 'gt' } };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'good' && x.rank > good-3 });
                core.checkTest(next, err, rows.length!=3 || !isok, "err2:", rows.length, isok, good, rows);
            });
        },
        function(next) {
            // Scan all locations beyond our good distance, get all bad with top 2 rank values
            var query = { latitude: latitude, longitude: longitude, distance: distance*2, status: "bad", rank: bad-2 };
            var options = { round: round, ops: { rank: 'gt' }, sort: "rank", desc: true };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'bad' && x.rank > bad-2 });
                core.checkTest(next, err, rows.length!=2 || !isok, "err3:", rows.length, isok, bad, rows);
            });
        },
        function(next) {
            // Scan all neighbors within the distance and take top 2 ranks only, in desc order
            var query = { latitude: latitude, longitude: longitude, distance: distance, status: "good" };
            var options = { round: round, sort: "rank", desc: true, count: 50, top: 2, select: "latitude,longitude,id,status,rank" };
            db.getLocations("geo", query, options, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.status == 'good' })
                var iscount = Object.keys(top).reduce(function(x,y) { return x + Math.min(2, top[y].length) }, 0);
                core.checkTest(next, err, rows.length!=iscount || !isok, "err4:", rows.length, iscount, isok, rows, 'TOP:', top);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.db = function(callback)
{
    var self = this;
    var tables = {
            test1: { id: { primary: 1, pub: 1 },
                     num: { type: "int" },
                     num2: {},
                     num3: { join: ["id","num"] },
                     email: {} },
            test2: { id: { primary: 1, pub: 1, index: 1 },
                     id2: { primary: 1, projection: 1 },
                     email: { projection: 1 },
                     alias: { pub: 1 },
                     birthday: { semipub: 1 },
                     json: { type: "json" },
                     num: { type: "bigint", index: 1, projection: 1 },
                     num2: { type: "real" },
                     mtime: { type: "bigint" } },
            test3: { id : { primary: 1, pub: 1 },
                     num: { type: "counter", value: 0, pub: 1 } },
            test4: { id: { primary: 1, pub: 1 },
                     type: { pub: 1 } },
            test5: { id: { primary: 1, pub: 1 },
                     hkey: { primary: 1, join: ["type","peer"], ops: { select: "begins_with" }  },
                     type: { pub: 1 },
                     peer: { pub: 1 } },
    };
    var now = Date.now();
    var id = corelib.random(64);
    var id2 = corelib.random(128);
    var num2 = corelib.randomNum(this.bbox[0], this.bbox[2]);
    var next_token = null;

    db.setProcessRow("post", "test4", function(op, row, options, cols) {
        logger.log(row, options, cols)
        var type = (row.type || "").split(":");
        row.type = type[0];
        row.mtime = type[1];
        return row;
    });

    corelib.series([
        function(next) {
             self.resetTables(tables, next);
        },
        function(next) {
            db.add("test1", { id: id, email: id, num: '1', num2: null, num3: 1, num4: 1 }, function(err) {
                if (err) return next(err);
                db.put("test1", { id: id2, email: id2, num: '2', num2: null, num3: 1 }, function(err) {
                    if (err) return next(err);
                    db.put("test3", { id: id, num: 0, email: id }, next);
                });
            });
        },
        function(next) {
            db.get("test1", { id: id }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id || row.num != 1 || row.num3 != row.id+"|"+row.num, "err1:", row);
            });
        },
        function(next) {
            db.get("test3", { id: id }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id, "err1-1:", row);
            });
        },
        function(next) {
            // Type conversion for strictTypes
            db.get("test1", { id: id, num: '1' }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id || row.num!=1, "err2:", row);
            });
        },
        function(next) {
            db.list("test1", String([id,id2]),  {}, function(err, rows) {
                var isok = rows.every(function(x) { return x.id==id || x.id==id2});
                var row1 = rows.filter(function(x) { return x.id==id}).pop();
                var row2 = rows.filter(function(x) { return x.id==id2}).pop();
                core.checkTest(next, err, rows.length!=2 || !isok, "err3:", rows.length, isok, rows);
            });
        },
        function(next) {
            db.add("test2", { id: id, id2: '1', email: id, alias: id, birthday: id, num: 0, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.add("test2", { id: id2, id2: '2', email: id, alias: id, birthday: id, num: 2, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.put("test2", { id: id2, id2: '1', email: id2, alias: id2, birthday: id2, num: 1, num2: num2, mtime: now }, next);
        },
        function(next) {
            db.put("test3", { id: id2, num: 2, emai: id2 }, next);
        },
        function(next) {
            db.put("test4", { id: id, type: "like:" + Date.now() }, next);
        },
        function(next) {
            db.select("test4", { id: id }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].id != id || rows[0].type!="like", "err4:", rows);
            });
        },
        function(next) {
            db.delAll("test1", { id: id }, next);
        },
        function(next) {
            db.select("test2", { id: id2 }, { filter: function(row, o) { return row.id2 == '1' } }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].id2 != '1' || rows[0].num2 != num2 , "err5:", num2, rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: ["2"] },  { ops: { id2: "in" } }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].id2!='2', "err5-1:", rows.length, rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2 }, { async_filter: function(rows, opts, cb) {
                    cb(null, rows.filter(function(r) { return r.id2 == '1' }));
                }
            }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].id2 != '1' || rows[0].num2 != num2, "err5-2:", num2, rows);
            });
        },
        function(next) {
            db.list("test3", String([id,id2]), function(err, rows) {
                core.checkTest(next, err, rows.length!=2, "err6:", rows);
            });
        },
        function(next) {
            db.incr("test3", { id: id, num: 1 }, { mtime: 1 }, function(err) {
                if (err) return next(err);
                db.incr("test3", { id: id, num: 2 }, function(err) {
                    if (err) return next(err);
                    db.incr("test3", { id: id, num: -1 }, next);
                });
            });
        },
        function(next) {
            db.get("test3", { id: id }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id && row.num != 2, "err7:", row);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'gt' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].email || rows[0].id2 != '2' || rows[0].num2 != num2, "err8:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: '1' }, { ops: { id2: 'begins_with' }, select: 'id,id2,num2,mtime' }, function(err, rows) {
                core.checkTest(next, err, rows.length!=1 || rows[0].email || rows[0].id2 != '1' || rows[0].num2 != num2, "err8-1:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, id2: "1,2" }, { ops: { id2: 'between' } }, function(err, rows) {
                core.checkTest(next, err, rows.length!=2, "err8-2:", rows);
            });
        },
        function(next) {
            db.select("test2", { id: id2, num: "1,2" }, { ops: { num: 'between' } }, function(err, rows) {
                core.checkTest(next, err, rows.length!=2, "err8-3:", rows);
            });
        },
        function(next) {
            db.update("test2", { id: id, id2: '1', email: id + "@test", json: [1, 9], mtime: now }, function(err) {
                if (err) return next(err);
                db.replace("test2", { id: id, id2: '1', email: id + "@test", num: 9, mtime: now }, { check_mtime: 'mtime' }, next);
            });
        },
        function(next) {
            db.get("test2", { id: id, id2: '1' }, { consistent: true }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id  || row.email != id+"@test" || row.num == 9 || !Array.isArray(row.json), "err9:", row);
            });
        },
        function(next) {
            now = Date.now();
            db.replace("test2", { id: id, id2: '1', email: id + "@test", num: 9, num2: 9, json: { a: 1, b: 2 }, mtime: now }, { check_data: 1 }, next);
        },
        function(next) {
            db.get("test2", { id: id, id2: '1' }, { skip_columns: ['alias'], consistent: true }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id || row.alias || row.email != id+"@test" || row.num!=9 || corelib.typeName(row.json)!="object" || row.json.a!=1, "err9-1:", row);
            });
        },
        function(next) {
            db.update("test2", { id: id, id2: '1', mtime: now+1 }, next);
        },
        function(next) {
            db.get("test2", { id: id, id2: '1' }, { consistent: true }, function(err, row) {
                core.checkTest(next, err, !row || row.id != id  || row.email != id+"@test" || row.num != 9, "err9-2:", row);
            });
        },
        function(next) {
            db.del("test2", { id: id2, id2: '1' }, next);
        },
        function(next) {
            db.get("test2", { id: id2, id2: '1' }, { consistent: true }, function(err, row) {
                core.checkTest(next, err, row, "del:", row);
            });
        },
        function(next) {
            corelib.forEachSeries([1,2,3,4,5,6,7,8,9], function(i, next2) {
                db.put("test2", { id: id2, id2: String(i), email: id, alias: id, birthday: id, num: i, num2: i, mtime: now }, next2);
            }, function(err) {
                next(err);
            });
        },
        function(next) {
            corelib.forEachSeries([1,2,3], function(i, next2) {
                db.put("test5", { id: id, type: "like", peer: i }, next2);
            }, function(err) {
                next(err);
            });
        },
        function(next) {
            // Check pagination
            next_token = null;
            var rc = [];
            corelib.forEachSeries([2, 3], function(n, next2) {
                db.select("test2", { id: id2 }, { sort: "id2", start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    rc.push.apply(rc, rows);
                    next2(err);
                });
            }, function(err) {
                // Redis cannot sort due to hash implementation, known bug
                var isok = db.pool == "redis" ? rc.length>=5 : rc.length==5 && (rc[0].id2 == 1 && rc[rc.length-1].id2 == 5);
                core.checkTest(next, err, !isok, "err10:", rc.length, isok, rc, next_token);
            })
        },
        function(next) {
            // Check pagination with small page size with condition on the range key
            next_token = null;
            corelib.forEachSeries([2, 3], function(n, next2) {
                db.select("test2", { id: id2, id2: '0' }, { sort: "id2", ops: { id2: 'gt' }, start: next_token, count: n, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    var isok = db.pool == "redis" ? rows.length>=n : rows.length==n;
                    core.checkTest(next2, err, !isok || !info.next_token, "err11:", rows.length, n, info, rows);
                });
            },
            function(err) {
                if (err) return next(err);
                db.select("test2", { id: id2, id2: '0' }, { ops: { id2: 'gt' }, start: next_token, count: 5, select: 'id,id2' }, function(err, rows, info) {
                    next_token = info.next_token;
                    var isnum = db.pool == "redis" ? rows.length>=3 : rows.length==4;
                    var isok = rows.every(function(x) { return x.id2 > '0' });
                    core.checkTest(next, err, !isnum || !isok, "err12:", isok, rows.length, rows, info);
                });
            });
        },
        function(next) {
            core.checkTest(next, null, next_token, "err13: next_token must be null", next_token);
        },
        function(next) {
            db.add("test2", { id: id, id2: '2', email: id, alias: id, birthday: id, num: 2, num2: 1, mtime: now }, next);
        },
        function(next) {
            // Select by primary key and other filter
            db.select("test2", { id: id, num: 9, num2: 9 }, {  ops: { num: 'ge', num2: 'ge' } }, function(err, rows, info) {
                core.checkTest(next, err, rows.length==0 || rows[0].num!=9 || rows[0].num2!=9, "err13:", rows, info);
            });
        },
        function(next) {
            // Wrong query property
            db.select("test2", { id: id, num: 9, num2: 9, email: 'fake' }, {  ops: { num: 'ge' } }, function(err, rows, info) {
                core.checkTest(next, err, rows.length!=0, "err14:", rows, info);
            });
        },
        function(next) {
            // Scan the whole table with custom filter
            db.select("test2", { num: 9 }, { ops: { num: 'ge' } }, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.num >= 9 });
                core.checkTest(next, err, rows.length==0 || !isok, "err15:", isok, rows, info);
            });
        },
        function(next) {
            // Scan the whole table with custom filter and sorting
            db.select("test2", { id: id2, num: 1 }, { ops: { num: 'gt' }, sort: "num" }, function(err, rows, info) {
                var isok = rows.every(function(x) { return x.num > 1 });
                core.checkTest(next, err, rows.length==0 || !isok , "err16:", isok, rows, info);
            });
        },
        function(next) {
            // Query with sorting with composite key
            db.select("test2", { id: id2 }, { desc: true, sort: "id2" }, function(err, rows, info) {
                core.checkTest(next, err, rows.length==0 || rows[0].id2!='9' , "err17:", rows, info);
            });
        },
        function(next) {
            // Query with sorting by another column/index
            db.select("test2", { id: id2 }, { desc: true, sort: "num" }, function(err, rows, info) {
                core.checkTest(next, err, rows.length==0 || rows[0].num!=9 , "err18:", rows, info);
            });
        },
        function(next) {
            // Scan all records
            var rows = [];
            db.scan("test2", {}, { count: 2 }, function(row, next2) {
                rows.push(row);
                next2();
            }, function(err) {
                core.checkTest(next, err, rows.length!=11, "err19:", rows.length);
            });
        },
        function(next) {
            db.select("test5", { id: id }, {}, function(err, rows) {
                core.checkTest(next, err, rows.length!=3 , "err20:", rows);
            });
        },
        function(next) {
            db.select("test5", { id: id, type: "like" }, {}, function(err, rows) {
                core.checkTest(next, err, rows.length!=3 , "err21:", rows);
            });
        },
        function(next) {
            db.get("test5", { id: id, type: "like", peer: 2 }, {}, function(err, row) {
                core.checkTest(next, err, !row, "err22:", row);
            });
        },
    ],
    function(err) {
        callback(err);
    });
}

tests.s3icon = function(callback)
{
    var id = core.getArg("-id", "1");
    api.storeIconS3("../web/img/loading.gif", id, { prefix: "account" }, function(err) {
        var icon = api.iconPath(id, { prefix: "account" });
        aws.queryS3(api.imagesS3, icon, { file: "tmp/" + path.basename(icon) }, function(err, params) {
            console.log('icon:', corelib.statSync(params.file));
            callback(err);
        });
    });
}

tests.icon = function(callback)
{
    api.putIcon({ body: {}, files: { 1: { path: __dirname + "/web/img/loading.gif" } } }, 1, { prefix: "account", width: 100, height: 100 }, function(err) {
        callback(err);
    });
}

tests.cookie = function(callback)
{
    core.httpGet('http://www.google.com', { cookies: true }, function(err, params) {
        console.log('COOKIES:', params.cookies);
        callback(err);
    });
}

tests.busy = function(callback)
{
    var work = 524288;
    function worky() {
      var howBusy = bk.isBusy();
      if (howBusy) {
        work /= 4;
        console.log("I can't work! I'm too busy:", howBusy + "ms behind");
      }
      work *= 2;
      for (var i = 0; i < work;) i++;
      console.log("worked:",  work);
    };
    bk.initBusy(core.getArgInt("-busy", 100));
    var interval = setInterval(worky, 100);
}

tests.msg = function(callback)
{
    if (!self.getArgInt("-test-workers")) logger.error("need -test-worker 1 argument");

    if (cluster.isMaster) {
        var count = 0;
        var addr = "tcp://127.0.0.1:1234 tcp://127.0.0.1:1235";
        var sock = new bk.NNSocket(bk.AF_SP, bk.NN_SUB);
        sock.connect(addr);
        sock.subscribe("");
        sock.setCallback(function(err, data) {
            logger.log('subscribe:', err, this.socket, data, 'count:', count++);
            if (data == "exit") process.exit(0);
        });
    } else {
        var count = core.getArgInt("-count", 10);
        var addr = "tcp://127.0.0.1:" + (cluster.worker.id % 2 == 0 ? 1234 : 1235);
        var sock = new bk.NNSocket(bk.AF_SP, bk.NN_PUB);
        sock.bind(addr);

        corelib.whilst(
           function () { return count > 0; },
           function (next) {
               count--;
               sock.send(addr + ':' + corelib.random());
               logger.log('publish:', sock, addr, count);
               setTimeout(next, corelib.randomInt(1000));
           },
           function(err) {
               sock.send("exit");
               sock = null;
               callback(err);
           });
    }
}

tests.cache = function(callback)
{
    core.msgType = "none";
    core.cacheBind = "127.0.0.1";
    core.cacheHost = "127.0.0.1";
    var nworkers = core.getArgInt("-test-workers");
    if (!nworkers) logger.error("need -test-workers 1 argument");

    function run1(cb) {
        corelib.series([
           function(next) {
               ipc.put("a", "1");
               ipc.put("b", "1");
               ipc.put("c", "1");
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("a", function(val) {
                   core.checkTest(next, null, val!="1", "value must be 1, got", val)
               });
           },
           function(next) {
               ipc.get(["a","b","c"], function(val) {
                   core.checkTest(next, null, !val||val.a!="1"||val.b!="1"||val.c!="1", "value must be {a:1,b:1,c:1} got", val)
               });
           },
           function(next) {
               ipc.incr("a", 1);
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("a", function(val) {
                   core.checkTest(next, null, val!="2", "value must be 2, got", val)
               });
           },
           function(next) {
               ipc.put("a", "3");
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("a", function(val) {
                   core.checkTest(next, null, val!="3", "value must be 3, got", val)
               });
           },
           function(next) {
               ipc.incr("a", 1);
               setTimeout(next, 10);
           },
           function(next) {
               ipc.del("b");
               setTimeout(next, 10);
           },
           function(next) {
               ipc.get("b", function(val) {
                   core.checkTest(next, null, val!="", "value must be '', got", val)
               });
           },
           ],
           function(err) {
                if (!err) return cb();
                ipc.keys(function(keys) {
                    var vals = {};
                    corelib.forEachSeries(keys || [], function(key, next) {
                        ipc.get(key, function(val) { vals[key] = val; next(); })
                    }, function() {
                        logger.log("keys:", vals);
                        cb(err);
                    });
                });
        });
    }

    function run2(cb) {
        corelib.series([
           function(next) {
               ipc.get("a", function(val) {
                   core.checkTest(next, null, val!="4", "value must be 4, got", val)
               });
           },
           ],
           function(err) {
            cb(err);
        });
    }

    if (cluster.isMaster) {
        ipc.onMessage = function(msg) {
            switch(msg.op) {
            case "ready":
                if (nworkers == 1) return this.send({ op: "run1" });
                if (this.id == 1) return this.send({ op: "init" });
                if (this.id > 1) return this.send({ op: "run1" });
                break;
            case "done":
                if (nworkers == 1) break;
                if (this.id > 1) cluster.workers[1].send({ op: "run2" });
                break;
            }
        }
        if (!core.test.iterations) {
            ipc.initServer();
            setInterval(function() { logger.log('keys:', bkjs.utils.lruKeys()); }, 1000);
        }
    } else {
        ipc.onMessage = function(msg) {
            switch (msg.op) {
            case "init":
                if (core.test.iterations) break;
                core.cacheBind = core.ipaddrs[0];
                core.cachePort = 20000;
                ipc.initServer();
                ipc.initClient();
                break;

            case "run2":
                run2(function(err) {
                    if (!err) ipc.send("done");
                    callback(err);
                });
                break;

            case "run1":
                run1(function(err) {
                    if (!err) ipc.send("done");
                    callback(err);
                });
                break;
            }
        }
        if (!core.test.iterations) {
            ipc.initClient();
        }
        ipc.send("ready");
    }
}

tests.nndb = function(callback)
{
    var bind = core.getArg("-bind", "ipc://var/nndb.sock");
    var socket = core.getArg("-socket", "NN_PULL");
    var type = core.getArg("-type", "lmdb"), pool;

    if (cluster.isMaster) {
        pool = db.lmdbInitPool({ db: "stats", type: type });
        db.query({ op: "server" }, { pool: type, bind: bind, socket: socket }, function(err) {
            if (err) logger.error(err);
        });

    } else {
        pool = db.nndbInitPool({ db: bind, socket: socket == "NN_REP" ? "NN_REQ" : "NN_PUSH" });
        corelib.series([
           function(next) {
               db.put("", { name: "1", value: 1 }, { pool: pool.name }, next);
           },
           function(next) {
               db.get("", "1", { pool: pool.name }, function(err, row) {
                   logger.log("get ", row);
                   next(err);
               });
           },
           function(next) {
               db.incr("", { name: "1", value: 2 }, { pool: pool.name }, next);
           },
           function(next) {
               db.get("", { name: "1" }, { pool: pool.name }, function(err, row) {
                   logger.log("get ", row);
                   next(err);
               });
           }],callback);
    }
}

tests.pool = function(callback)
{
    var options = { min: core.getArgInt("-min", 1),
                    max: core.getArgInt("-max", 5),
                    idle: core.getArgInt("-idle", 0),
                    create: function(cb) { cb(null,{ id:Date.now()}) }
    }
    var list = [];
    var pool = corelib.createPool(options)
    corelib.series([
       function(next) {
           console.log('pool0:', pool.stats(), 'list:', list.length);
           for (var i = 0; i < 5; i++) {
               pool.acquire(function(err, obj) { list.push(obj); console.log('added:', list.length); });
           }
           console.log('pool1:', pool.stats(), 'list:', list.length);
           next();
       },
       function(next) {
           while (list.length) {
               pool.release(list.shift());
           }
           next();
       },
       function(next) {
           console.log('pool2:', pool.stats(), 'list:', list.length);
           pool.acquire(function(err, obj) { list.push(obj); console.log('added:', list.length); });
           next();
       },
       function(next) {
           console.log('pool3:', pool.stats(), 'list:', list.length);
           pool.release(list.shift());
           next();
       },
       function(next) {
           setTimeout(function() {
               console.log('pool4:', pool.stats(), 'list:', list.length);
               next();
           }, options.idle*2);
       }], callback);
}

tests.config = function(callback)
{
    var argv = ["-uid", "1",
                "-proxy-port", "3000",
                "-db-sqlite-pool-no-init-tables",
                "-api-allow-path", "^/a",
                "-api-allow-admin", "^/a",
                "-api-allow-account-dev=^/a",
                "-api-allow-anonymous=^/a",
                "-api-redirect-url", '{ "^a/$": "a", "^b": "b" }',
                "-logwatcher-email-error", "a",
                "-logwatcher-file-error", "a",
                "-logwatcher-file", "b",
                "-logwatcher-match-error", "a",
                "-db-sqlite-pool-max", "10",
                "-db-sqlite-pool-1", "a",
                "-db-sqlite-pool-max-1", "10"
            ];
    core.parseArgs(argv);
    if (core.uid != 1) return callback("invalid uid");
    if (core.proxy.port != 3000) return callback("invalid proxy-port");
    if (!db.poolParams.sqliteNoInitTables) return callback("invalid sqlite no init tables");
    if (db.poolParams.sqliteMax != 10) return callback("invalid sqlite max");
    if (db.poolNames.sqlite1 != "a") return callback("invalid sqlite1");
    if (db.poolParams.sqliteMax1 != 10) return callback("invalid sqlite1 max");
    if (core.logwatcherEmail.error != "a") return callback("invalid logwatcher email:" + JSON.stringify(core.logwatcherEmail));
    if (core.logwatcherMatch.error.indexOf("a") == -1) return callback("invalid logwatcher match: " + JSON.stringify(core.logwatcherMatch));
    if (!core.logwatcherFile.some(function(x) { return x.file == "a" && x.type == "error"})) return callback("invalid logwatcher file: " + JSON.stringify(core.logwatcherFile));
    if (!core.logwatcherFile.some(function(x) { return x.file == "b"})) return callback("invalid logwatcher file: " + JSON.stringify(core.logwatcherFile));
    if (!api.allow.list.some(function(x) { return x == "^/a"})) return callback("invalid allow path");
    if (!api.allowAdmin.list.some(function(x) { return x == "^/a"})) return callback("invalid allow admin");
    callback();
}

tests.logwatcher = function(callback)
{
    var email = core.getArg("-email");
    if (!email) return callback("-email is required")

    var argv = ["-logwatcher-email-error", email,
                "-logwatcher-email-test", email,
                "-logwatcher-email-warning", email,
                "-logwatcher-email-any", email,
                "-logwatcher-match-test", "TEST: ",
                "-logwatcher-match-any", "line:[0-9]+"
            ];
    var lines = [
                " ERROR: error1",
                " continue error1",
                "[] WARN: warning1",
                " backtrace test line:123",
                "[] TEST: test1",
                "[] ERROR: error2",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                "no error string",
                " backtrace test line:456",
            ];
    core.parseArgs(argv);
    fs.appendFile(core.logFile, lines.join("\n"));
    core.watchLogs(function(err, errors) {
        console.log(errors);
        callback();
    });
}


bkjs.run(function() {
    var l = locations[core.getArg("-city", "LA")] || locations.LA;
    tests.city = l.name;
    tests.bbox = l.bbox;
    core.runTest(tests);
});


