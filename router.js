var url = require ( 'url' ),
        util = require ( 'util' ),
        path = require ( 'path' )
        ;

// Flatiron/director's router was more trouble for streaming PUTs than it
// was worth, so...

var Router = exports.Router = function ( routes ) {
    var self = this;
    var registrations = routes || {};
    this.registrations = registrations;
    
    this.__defineGetter__("info", function() {
        var result = {};
        for (var mth in registrations) {
            var items = registrations[mth];
            for (var i=0; i < items.length; i++) {
                var what = items[i];
                var callback = items[what.toString()];
                if (callback.description) {
                    result[ mth.toUpperCase() + ' ' + what] = callback.description;
                } else {
                    result[ mth.toUpperCase() + ' ' + what] = '(no description)';
                }
            }
        }
        return result;
    })

    this.route = function ( method, what, callback, description ) {
        method = method.toLowerCase ();
        if (typeof what !== 'string' && typeof what['test'] !== 'function') {
            throw new Error ( "Don't know how to test '" + util.inspect ( what ) + "'" );
        }
        var forMethod = registrations[method];
        if (!forMethod) {
            forMethod = [];
            registrations[method] = forMethod;
        }
        forMethod.push ( what );
        forMethod[what.toString ()] = callback;
        if (description) {
            callback.__defineGetter__ ( "description", function () {
                return description;
            } );
        }
    }

    this.remove = function ( what, callback, description ) {
        self.route ( 'delete', what, callback, description );
        return self;
    }

    this.post = function ( what, callback, description ) {
        self.route ( 'post', what, callback, description );
        return self;
    }

    this.put = function ( what, callback, description ) {
        self.route ( 'put', what, callback, description );
        return self;
    }

    this.get = function ( what, callback, description ) {
        self.route ( 'get', what, callback, description );
        return self;
    }

    this.getAndHead = function ( what, callback, description ) {
        self.route ( 'get', what, callback, description );
        self.route ( 'head', what, callback, description );
        return self;
    }

    this.head = function ( what, callback, description ) {
        self.route ( 'head', what, callback, description );
        return self;
    }

    this.dispatch = function ( req, res, ifNone ) {
        var method = req.method.toLowerCase ();
        var u = url.parse ( req.url, true );
        var forMethod = registrations[method];
        if (forMethod) {
            var matchFunction;
            for (var i = 0; i < forMethod.length; i++) {
                var test = forMethod[i];

                var match = false;
                if (typeof test === 'string') {
                    match = test === u.pathname || test + '/' === u.pathname;
                } else {
                    match = test.test ( u.pathname );
                }
                if (match) {
                    matchFunction = forMethod[test];
                    break;
                }
            }
            if (matchFunction) {
                var stream = matchFunction.stream === true;
                var dis = {
                    req: req,
                    res: res
                }
                if (method === 'put' && !stream) {
                    if (!matchFunction.binary) {
                        req.setEncoding ( 'utf8' );
                    }
                    req.on ( 'data', function ( chunk ) {
                        if (!req.chunks) {
                            req.chunks = [];
                        }
                        req.chunks.push ( chunk );
                    } );
                    req.on ( 'end', function () {
                        req.done = true;
                        matchFunction.apply ( dis, [req, res, req.chunks] );
                    } );
                    req.on ( 'close', function () {
                        req.done = true;
                        matchFunction.apply ( dis, [req, res, req.chunks] );
                    } );
                    req.on ( 'checkContinue', function () {
                        res.writeContinue ();
                    } );
                }
                if (method !== 'put' || ( method === 'put' && stream )) {
                    matchFunction.apply ( dis, [req, res] );
                }
            } else if (typeof ifNone === 'function') {
                ifNone ( req, res );
            }
        } else if (typeof ifNone === 'function') {
            ifNone ( req, res );
        }
    };

    var self = this;
    this.createSimpleServer = function ( port, callback, onStart ) {
        var http = require ( 'http' );
        var server = http.createServer ( function ( req, res ) {
            if ("/favicon.ico" === req.url) {
                res.writeHead ( 404 );
                res.end ();
                return;
            } else if (req.method.toUpperCase () === "OPTIONS") {
                res.writeHead (
                        "204",
                        "No Content",
                        {
                            "access-control-allow-origin": '*',
                            "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
                            "access-control-allow-headers": "content-type, accept",
                            "access-control-max-age": 600, // Seconds.
                            "content-length": 0
                        }
                );
                res.end ();
                return;
            }
            res.setHeader ( 'Access-Control-Allow-Origin', '*' );
            self.dispatch ( req, res, function ( ) {
                res.writeHead ( 404, {
                    'Content-Type': 'text/plain; charset=UTF-8'
                } );
                res.end('Not found: ' + req.url)
            } );
        } );
        server.on ( 'error', function ( err ) {
            callback ( err );
        } );
        server.listen ( port, function ( err ) {
            if (err && typeof callback === 'function') {
                callback ( err );
            }
            if (typeof callback === 'function') {
                callback ( null, server );
            }
        } );
    };
};

module.exports = Router;
