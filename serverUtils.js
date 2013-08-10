var url = require ( 'url' ), util = require ( 'util' );

function copyObject ( a, b ) {
    var result = {};
    for (var key in a) {
        result[key] = a[key];
    }
    for (var key in b) {
        result[key] = b[key];
    }
    return result;
}

function sendHeaders ( req, res, code, headers ) {
    code = code || 200;
    var hdrs = DEFAULT_HEADERS;
    if (headers) {
        hdrs = copyObject ( hdrs, headers );
    }
    res.writeHead ( 200, hdrs );
}

function respond ( req, res, msg, code, headers ) {
    if (util.isError ( msg )) {
        msg = ( msg + "" ) + '\n' + msg.stack;
        if (!headers) {
            headers = {};
        } else {
            headers['Content-Type'] = 'text/plain; charset=UTF-8'
        }
    }
    if (!headers) {
        headers = DEFAULT_HEADERS;
    }
    if (typeof msg === 'object') {
        msg = JSON.stringify ( msg );
    }
    if (!code) {
        code = 200;
    }
    sendHeaders ( req, res, code, headers );
    res.end ( msg );
}

function error ( req, res, err, code ) {
    respond ( req, res, err, code || 500 );
}

var DEFAULT_HEADERS = {
    'Content-Type': 'application/json; charset=UTF-8'
};

exports.DEFAULT_HEADERS = DEFAULT_HEADERS;
exports.copyObject = copyObject;
exports.respond = respond;
exports.error = error;
exports.sendHeaders = sendHeaders;
