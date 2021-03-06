//
//  Author: Vlad Seryakov vseryakov@gmail.com
//  Sep 2013
//

var path = require('path');
var util = require('util');
var fs = require('fs');
var url = require('url');
var qs = require('qs');
var http = require('http');
var bkjs = require('backendjs');
var db = bkjs.db;
var api = bkjs.api;
var app = bkjs.app;
var ipc = bkjs.ipc;
var msg = bkjs.msg;
var core = bkjs.core;
var corelib = bkjs.corelib;
var logger = bkjs.logger;

// Icons management
var icons = {
    name: "icons",
    limit: {},
};
module.exports = icons;

// Initialize the module
icons.init = function(options)
{
    core.describeArgs("icons", [
         { name: "limit", type: "intmap", descr: "Set the limit of how many icons by type can be uploaded by an account, type:N,type:N..., type * means global limit for any icon type" },
    ]);

    // Keep track of icons uploaded
    db.describeTables({
            bk_icon: { id: { primary: 1 },                         // Account id
                       type: { primary: 1, pub: 1 },               // prefix:type
                       prefix: {},                                 // icon prefix/namespace
                       acl_allow: {},                              // Who can see it: all, auth, id:id...
                       ext: {},                                    // Saved image extension
                       descr: {},
                       geohash: {},                                // Location associated with the icon
                       latitude: { type: "real" },
                       longitude: { type: "real" },
                       mtime: { type: "bigint", now: 1 }},         // Last time added/updated

            // Metrics
            bk_collect: { url_icon_get_rmean: { type: "real" },
                          url_icon_get_hmean: { type: "real" },
                          url_icon_get_0: { type: "real" },
                      }
    });
}

// Create API endpoints and routes
icons.configureWeb = function(options, callback)
{
    this.configureIconsAPI();
    callback()
}

// Generic icon management
icons.configureIconsAPI = function()
{
    var self = this;

    api.app.all(/^\/icon\/([a-z]+)$/, function(req, res) {
        var options = api.getOptions(req);

        if (!req.query.prefix) return api.sendReply(res, 400, "prefix is required");
        if (!req.query.id) req.query.id = req.account.id;
        if (!req.query.type) req.query.type = "";
        switch (req.params[0]) {
        case "get":
            self.getIcon(req, res, req.query.id, options);
            break;

        case "select":
            self.selectIcon(req, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        case "upload":
            options.force = true;
            options.type = req.query.type;
            options.prefix = req.query.prefix;
            self.putIcon(req, req.account.id, options, function(err, icon) {
                var row = api.formatIcon({ id: req.account.id, type: req.query.prefix + ":" + req.query.type }, options);
                api.sendJSON(req, err, row);
            });
            break;

        case "del":
        case "put":
            options.op = req.params[0];
            self.handleIconRequest(req, res, options, function(err, rows) {
                api.sendJSON(req, err, rows);
            });
            break;

        default:
            api.sendReply(res, 400, "Invalid command");
        }
    });

    db.setProcessRow("post", "bk_icon", options, api.checkIcon);

}

// Process icon request, put or del, update table and deal with the actual image data, always overwrite the icon file
// Verify icon limits before adding new icons
icons.handleIconRequest = function(req, res, options, callback)
{
    var self = this;
    var op = options.op || "put";

    options.force = true;
    options.type = req.query.type || "";
    options.prefix = req.query.prefix || "account";
    if (!req.query.id) req.query.id = req.account.id;

    // Max number of allowed icons per type or globally
    var limit = self.limit[options.type] || self.limit['*'];
    var icons = [];

    corelib.series([
       function(next) {
           options.ops = { type: "begins_with" };
           db.select("bk_icon", { id: req.query.id, type: options.prefix + ":" }, options, function(err, rows) {
               if (err) return next(err);
               switch (op) {
               case "put":
                   // We can override existing icon but not add a new one
                   if (limit > 0 && rows.length >= limit && !rows.some(function(x) { return x.type == options.type })) {
                       return next({ status: 400, message: "No more icons allowed" });
                   }
                   break;
               }
               icons = rows;
               next();
           });
       },

       function(next) {
           options.ops = {};
           req.query.type = options.prefix + ":" + options.type;
           if (options.ext) req.query.ext = options.ext;
           if (req.query.latitude && req.query.longitude) req.query.geohash = corelib.geoHash(req.query.latitude, req.query.longitude);

           db[op]("bk_icon", req.query, options, function(err, rows) {
               if (err) return next(err);

               switch (op) {
               case "put":
                   api.putIcon(req, req.query.id, options, function(err, icon) {
                       if (err || !icon) return db.del('bk_icon', req.query, options, function() { next(err || { status: 500, message: "Upload error" }); });
                       // Add new icons to the list which will be returned back to the client
                       if (!icons.some(function(x) { return x.type == options.type })) icons.push(api.formatIcon(req.query, options))
                       next();
                   });
                   break;

               case "del":
                   api.delIcon(req.query.id, options, function() {
                       icons = icons.filter(function(x) { return x.type != options.type });
                       next();
                   });
                   break;

               default:
                   next({ status: 500, message: "invalid op" });
               }
           });
       }], function(err) {
            if (callback) callback(err, icons);
    });
}

// Return list of icons for the account, used in /icon/get API call
icons.selectIcon = function(req, options, callback)
{
    options.ops = { type: "begins_with" };
    db.select("bk_icon", { id: req.query.id, type: req.query.prefix + ":" + (req.query.type || "") }, options, function(err, rows) {
        callback(err, rows);
    });
}

// Return icon to the client, checks the bk_icon table for existence and permissions
icons.getIcon = function(req, res, id, options)
{
    db.get("bk_icon", { id: id, type: req.query.prefix + ":" + req.query.type }, options, function(err, row) {
        if (err) return api.sendReply(res, err);
        if (!row) return api.sendReply(res, 404, "Not found or not allowed");
        if (row.ext) options.ext = row.ext;
        options.prefix = req.query.prefix;
        options.type = req.query.type;
        api.sendIcon(req, res, id, options);
    });
}
