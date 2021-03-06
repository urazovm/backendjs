//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var util = require('util');
var url = require('url');
var net = require('net');
var fs = require('fs');
var path = require('path');
var domain = require('domain');
var cluster = require('cluster');
var os = require('os');
var core = require(__dirname + '/../core');
var corelib = require(__dirname + '/../corelib');
var db = require(__dirname + '/../db');
var logger = require(__dirname + '/../logger');
var utils = require(__dirname + '/../build/Release/backend');

// Create a database pool that works with ElasticSearch server
db.elasticsearchInitPool = function(options)
{
    var self = this;
    if (!options) options = {};
    if (!options.pool) options.pool = "elasticsearch";

    options.type = "elasticsearch";
    options.dboptions = { noJson: 1 };
    var u = url.parse(options.db);
    if (!u.port) u.host = u.hostname + ":" + 9200;
    options.db = url.format(u);
    var pool = this.createPool(options);

    // Native query parameters for each operation
    var _query = { index: ["op_type","version","routing","parent","timestamp","ttl","consistency","refresh","timeout","replication"],
                   del: ["version","routing","parent","consistency","refresh","timeout","replication"],
                   get: ["version","fields","routing","realtime","preference","refresh","_source","_source_include","_source_exclude"],
                   select: ["version","analyzer","analyze_wildcard","default_operator","df","explain","fields","from","ignore_unavailable",
                            "allow_no_indices","expand_wildcards","indices_boost","lenient","lowercase_expanded_terms","preference","q",
                            "routing","scroll","search_type","size","sort","_source","_source_include","_source_exclude","stats","local",
                            "terminate_after","suggest_field","suggest_mode","suggest_size","suggest_text","timeout","track_scores","query_cache"],
                   list: ["version","fields","routing","_source","_source_include","_source_exclude"] };

    function query(op, method, path, obj, opts, callback) {
        var uri = pool.db + "/" + path;
        var params = { method: method, postdata: obj, query: {} };
        if (_query[op]) _query[op].forEach(function(x) { if (opts[x]) params.query[x] = opts[x] });

        core.httpGet(uri, params, function(err, params) {
            if (err) {
                logger.error("elasticsearch:", method, path, err);
                return callback(err, {});
            }
            var err = null;
            obj = corelib.jsonParse(params.data, { obj: 1 });
            if (params.status >= 400) {
                err = corelib.newError({ message: obj.reason || (method + " Error: " + params.status), code: obj.error, status: params.status });
            }
            callback(err, obj);
        });
    }

    pool.query = function(client, req, opts, callback) {
        var keys = self.getKeys(req.table, opts);
        var key = keys.filter(function(x) { return req.obj[x] }).map(function(x) { return req.obj[x] }).join("|");

        switch (req.op) {
        case "get":
            if (opts.select) opts.fields = String(opts.select);
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("get", "GET", path, "", opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, [ res._source || res.fields || {} ], res);
            });
            break;

        case "select":
        case "search":
            if (opts.count) opts.size = opts.count;
            if (opts.select) opts.fields = String(opts.select);
            if (typeof req.obj == "string") {
                opts.q = req.obj;
                req.obj = "";
            } else
            if (req.obj.query) {

            } else {
                opts.q = Object.keys(req.obj).map(function(x) {
                    var val = req.obj[x];
                    var op = opts.ops[x];
                    switch (op) {
                    case "in": return x + ':' + (Array.isArray(val) ? '(' + val.map(function(y) { return '"' + y + '"' }).join(" OR ") + ')' : val);
                    case "ne": return x + ':-"' + val + '"';
                    case "gt": return x + ':>' + val;
                    case "lt": return x + ':<' + val;
                    case "ge": return x + ':>=' + val;
                    case "le": return x + ':<=' + val;
                    case "between": return x + ':' + (val.length == 2 ? '["' + val[0] + '" TO "' + val[1] + '"]' : val);
                    case "begins_with": return x + ':"' + val + '*"';
                    case "contains": return x + ':"*' + val + '*"';
                    case "not_contains": return x + ':>' + val;
                    default: return x + ':"' + val + '"';
                    }
                }).join(" AND ");
                req.obj = "";
            }
            var path = "/" + req.table + "/" + (opts.type || req.table) +  "/" + (opts.op || "_search");
            query("select", "POST", path, req.obj, opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, res.hits ? res.hits.hits.map(function(x) { return x._source || x.fields || {} }) : [], res);
            });
            break;

        case "list":
            if (opts.count) opts.searchSize = opts.count;
            if (opts.select) opts.fields = String(opts.select);
            var ids = req.obj.map(function(x) { return Object.keys(x).map(function(y) { return x[y]}).join("|") });
            var path = "/" + req.table + "/" + (opts.type || req.table) +  "/_mget";
            query("list", "GET", path, { ids: ids }, opts, function(err, res) {
                if (err) return callback(err, []);
                callback(null, res.docs ? res.docs.map(function(x) { return x._source || x.fields || {} }) : [], res);
            });
            break;

        case "add":
            opts.op_type = "create";
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("index", "PUT", path, req.obj, opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "put":
        case "update":
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("index", "PUT", path, req.obj, opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        case "del":
            var path = "/" + req.table + "/" + (opts.type || req.table) + "/" + (opts.id || key).replace(/[\/]/g, "%2F");
            query("del", "DELETE", path, "", opts, function(err, res) {
                callback(err, [], res);
            });
            break;

        default:
            return callback(null, []);
        }
    }

    return pool;
}

