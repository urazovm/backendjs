//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var http = require('http');
var url = require('url');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var corelib = bkjs.corelib;
var logger = bkjs.logger;

// Messages management
var messages = {
    name: "messages"
};
module.exports = messages;

// Initialize the module
messages.init = function(options)
{
    db.describeTables({
            // New messages
            bk_message: { id: { primary: 1 },                            // my account_id
                          mtime: { primary: 1,                           // mtime:sender
                                   join: ["mtime","sender"],
                                   ops: { select: "ge" } },
                          sender: { type: "text", index: 1 },            // Sender id
                          alias: {},                                     // Sender alias
                          acl_allow: {},                                 // Who has access: all, auth, id:id...
                          msg: {},                                       // Text of the message
                          icon: { type: "int" }},                        // 1 - icon present, 0 - no icon

            // Archived messages
            bk_archive: { id: { primary: 1, index: 1 },                  // my account_id
                          mtime: { primary: 1,                           // mtime:sender
                                   join: ["mtime","sender"],
                                   ops: { select: "ge" } },
                          sender: { type: "text", index: 1 },            // Sender id
                          alias: {},                                     // Sender alias
                          msg: {},                                       // Text of the message
                          icon: { type: "int" }},                        // 1 - icon present, 0 - no icon

            // Messages sent
            bk_sent: { id: { primary: 1, index: 1 },                      // my account
                       mtime: { primary: 1,                               // mtime:recipient
                                join: ["mtime","recipient"],
                                ops: { select: "ge" } },
                       recipient: { type: "text", index: 1 },             // Recipient id
                       alias: {},                                         // Recipient alias
                       msg: {},                                           // Text of the message
                       icon: { type: "int" }},                            // 1 - icon present, 0 - no icon

            // Metrics
            bk_collect: {
                          url_image_message_rmean: { type: "real" },
                          url_image_message_hmean: { type: "real" },
                          url_image_message_0: { type: "real" },
                          url_message_get_rmean: { type: "real" },
                          url_message_get_hmean: { type: "real" },
                          url_message_get_0: { type: "real" },
                          url_message_add_rmean: { type: "real" },
                          url_message_add_hmean: { type: "real" },
                          url_message_add_0: { type: "real" },
                      },
    });
}

// Create API endpoints and routes
messages.configureWeb = function(options, callback)
{
    this.configureMessagesAPI();
    callback()
}

// Messaging management
messages.configureMessagesAPI = function()
{
    var self = this;

    api.app.all(/^\/message\/([a-z\/]+)$/, function(req, res) {
        var options = api.getOptions(req);

        switch (req.params[0]) {
        case "image":
            if (!req.query.sender || !req.query.mtime) return api.sendReply(res, 400, "sender and mtime are required");
            api.sendIcon(req, res, req.account.id, { prefix: 'message', type: req.query.mtime + ":" + req.query.sender});
            break;

        case "get":
            options.cleanup = "";
            self.getMessage(req, options, function(err, rows, info) {
                api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
            });
            break;

        case "get/sent":
            options.cleanup = "";
            self.getSentMessage(req, options, function(err, rows, info) {
                api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
            });
            break;

        case "get/archive":
            options.cleanup = "";
            self.getArchiveMessage(req, options, function(err, rows, info) {
                api.sendJSON(req, err, api.getResultPage(req, options, rows, info));
            });
            break;

        case "archive":
            self.archiveMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "add":
            self.addMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del":
            self.delMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del/archive":
            self.delArchiveMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        case "del/sent":
            self.delSentMessage(req, options, function(err, data) {
                api.sendJSON(req, err, data);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

    function onPostMessageRow(op, row, options, cols) {
        if (row.icon) row.icon = '/message/image?sender=' + row.sender + '&mtime=' + row.mtime; else delete row.icon;
    }

    function onPostSentRow(op, row, options, cols) {
        if (row.icon) row.icon = '/message/image?sender=' + row.recipient + '&mtime=' + row.mtime; else delete row.icon;
    }

    db.setProcessRow("post", "bk_sent", options, onPostSentRow);
    db.setProcessRow("post", "bk_message", options, onPostMessageRow);
    db.setProcessRow("post", "bk_archive", options, onPostMessageRow);

}

// Return archived messages, used in /message/get API call
messages.getArchiveMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    db.select("bk_archive", req.query, options, callback);
}

// Return sent messages to the specified account, used in /message/get/sent API call
messages.getSentMessage = function(req, options, callback)
{
    req.query.id = req.account.id;
    db.select("bk_sent", req.query, options, callback);
}

// Return new/unread messages, used in /message/get API call
messages.getMessage = function(req, options, callback)
{
    req.query.id = req.account.id;

    // If asked for a total with _archive/_trash we have to retrieve all messages but return only the count
    var total = corelib.toBool(options.total);
    if (total && corelib.toBool(options.archive) || corelib.toBool(options.trash)) {
        options.total = 0;
    }
    function del(rows, next) {
        corelib.forEachLimit(rows, options.concurrency || 1, function(row, next2) {
            db.del("bk_message", row, options, function() { next2() });
        }, next);
    }

    function details(rows, info, next) {
        if (options.total) return next(null, rows, info);
        if (total) return next(null, [{ count: rows.count }], info);
        if (!corelib.toNumber(options.accounts) || !core.modules.accounts) return next(null, rows, info);
        core.modules.accounts.listAccount(rows, options.extendObj(options, "account_key", 'sender'), function(err, rows) { next(err, rows, info); });
    }

    db.select("bk_message", req.query, options, function(err, rows, info) {
        if (err) return callback(err, []);

        options.ops = null;
        // Move to archive
        if (corelib.toBool(options.archive)) {
            corelib.forEachSeries(rows, function(row, next) {
                db.put("bk_archive", row, options, next);
            }, function(err) {
                if (err) return callback(err, []);

                // Delete from the new after we archived it
                del(rows, function() {
                    details(rows, info, callback);
                });
            });
        } else

        // Delete after read, if we crash now new messages will never be delivered
        if (corelib.toBool(options.trash)) {
            del(rows, function() {
                details(rows, info, callback);
            });
        } else {
            details(rows, info, callback);
        }
    });
}

// Mark a message as archived, used in /message/archive API call
messages.archiveMessage = function(req, options, callback)
{
    if (!req.query.sender || !req.query.mtime) return callback({ status: 400, message: "sender and mtime are required" });

    req.query.id = req.account.id;
    db.get("bk_message", req.query, options, function(err, row, info) {
        if (err) return callback(err, []);
        if (!row) return callback({ status: 404, message: "not found" }, []);

        options.ops = null;
        db.put("bk_archive", row, options, function(err) {
            if (err) return callback(err, []);

            db.del("bk_message", row, options, function(err) {
                callback(err, row, info);
            });
        });
    });
}

// Add new message, used in /message/add API call
messages.addMessage = function(req, options, callback)
{
    var now = Date.now();
    var info = {};
    var op = options.op || "add";
    var sent = corelib.cloneObj(req.query);
    var obj = corelib.cloneObj(req.query);

    if (!req.query.id) return callback({ status: 400, message: "recipient id is required" });
    if (!req.query.msg && !req.query.icon) return callback({ status: 400, message: "msg or icon is required" });

    corelib.series([
        function(next) {
            obj.sender = req.account.id;
            obj.alias = req.account.alias;
            obj.mtime = now;
            api.putIcon(req, obj.id, { prefix: 'message', type: obj.mtime + ":" + obj.sender }, function(err, icon) {
                obj.icon = icon ? 1 : 0;
                next(err);
            });
        },
        function(next) {
            db[op]("bk_message", obj, options, function(err, rows, info2) {
                info = info2;
                next(err);
            });
        },
        function(next) {
            if (options.nocounter || !core.modules.counters) return next();
            core.modules.counters.incrAutoCounter(req.account.id, 'msg0', 1, options, function() { next(); });
        },
        function(next) {
            if (options.nocounter || !core.modules.counters) return next();
            core.modules.counters.incrAutoCounter(req.query.id, 'msg1', 1, options, function() { next(); });
        },
        function(next) {
            sent.id = req.account.id;
            sent.recipient = req.query.id;
            sent.mtime = now;
            if (options.nosent) return next();
            db[op]("bk_sent", sent, options, function(err, rows) {
                if (err) return db.del("bk_message", req.query, function() { next(err); });
                next();
            });
        },
        function(next) {
            if (!options.publish || req.query.id == req.account.id) return next();
            api.publish(req.query.id, { path: req.path, mtime: now, alias: req.account.alias, msg: (req.query.msg || "").substr(0, 128) }, options);
            next();
        },
        ], function(err) {
            if (err) return callback(err);
            api.metrics.Counter('msg_add_0').inc();
            if (options.nosent) {
                callback(null, obj, info);
            } else {
                callback(null, sent, info);
            }
    });
}

// Delete a message or all messages for the given account from the given sender, used in /message/del` API call
messages.delMessage = function(req, options, callback)
{
    var table = options.table || "bk_message";
    var sender = options.sender || "sender";
    req.query.id = req.account.id;

    // Single deletion
    if (req.query.mtime && req.query[sender]) {
        return db.del(table, { id: req.account.id, mtime: req.query.mtime, sender: req.query[sender] }, options, function(err) {
            if (err || !req.query.icon) return callback(err, []);
            api.delIcon(req.account.id, { prefix: "message", type: req.query.mtime + ":" + req.query[sender] }, callback);
        });
    }

    // Delete by query
    db.select(table, { id: req.account.id, mtime: req.query.mtime, sender: req.query[sender] }, options, function(err, rows) {
        if (err) return callback(err, []);

        options.ops = null;
        corelib.forEachSeries(rows, function(row, next) {
            if (req.query[sender] && row[sender] != req.query[sender]) return next();
            db.del(table, row, function(err) {
                if (err || !row.icon) return next(err);
                api.delIcon(req.account.id, { prefix: "message", type: row.mtime + ":" + row[sender] }, next);
            });
        }, callback);
    });
}

// Delete the messages in the archive, used in /message/del/archive` API call
messages.delArchiveMessage = function(req, options, callback)
{
    options.table = "bk_archive";
    options.sender = "sender";
    this.delMessage(req, options, callback);
}

// Delete the messages i sent, used in /message/del/sent` API call
messages.delSentMessage = function(req, options, callback)
{
    options.table = "bk_sent";
    options.sender = "recipient";
    this.delMessage(req, options, callback);
}

