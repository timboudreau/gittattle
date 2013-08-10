var http = require('http'),
        fs = require('fs'),
        util = require('util'),
        url = require('url'),
        path = require('path'),
        child_process = require('child_process'),
        error = require('./serverUtils').error,
        respond = require('./serverUtils').respond,
        DEFAULT_HEADERS = require('./serverUtils').DEFAULT_HEADERS,
        Router = require('./router');

// GITTATTLE
// ---------
// Implements a very straing

var file = 'gitattle.json';
var gitpattern = /(.*?)\.git/;
var DEFAULT_COUNT = 30;

var config = {
//    gitdir: '/var/lib/gitolite/repositories',
    gitdir: '/tmp/git',
    urlpath: '/git',
    appendDotGitToRepoNames: true,
    port: 9902,
    tar: 'tar',
    fastTimeout: 1400,
    logEntriesPerPage: DEFAULT_COUNT,
    serveIndexPage: true,
    html: {
        title: 'Git Server',
        headingText: 'Git Server'
    }
};

if (fs.existsSync(file)) {
    var loaded = JSON.parse(fs.readFileSync(file, {encoding: 'utf8'}));
    for (var key in loaded) {
        config[key] = loaded[key]
    }
}

var listFileRex = /\/git\/[^\/`'"'&|<>]*\/get\/([^&`'"|<>]*)/;
var downloadRex = /\/git\/([^\/`'"'&|<>]*)\.([tarzipgb2x\.]*)$/;

var router = new Router();
if (config.serveIndexPage) {
    router.getAndHead(/\/git\/index.html/, getFile('index.html'), 'Index page');
}
router.getAndHead('/git', list, 'List repositories');
router.getAndHead(downloadRex, archive, 'Fetch an archive of a repository');
router.getAndHead(/\/git\/[^\/`'"'&|<>]*$/, log, 'Fetch log for one repository');
router.getAndHead(/\/git\/[^\/`'"'&|<>]*\/[abcdef1234567890]*$/, diff, 'Fetch a change set')
router.getAndHead(/\/git\/[^\/`'"'&|<>]*\/list$/, listFiles, 'List files');
router.getAndHead(listFileRex, getOneFile, 'List files');

function getFile(file) {
    var dir = path.dirname(module.filename);
    var pth = path.join(dir, file);
    if (!fs.existsSync(pth)) {
        throw new Error(pth + " does not exist");
    }
    return function serveFile(req, res) {
        var stream = fs.createReadStream(pth);
        res.writeHead(200, {'Content-Type': guessContentType(pth)});
        stream.pipe(res);
    }
}

// tags and branches

function copy(arr) {
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        result.push(arr[i])
    }
    return result;
}

function gitCommits(pth, n, cb, skip) {
    // The terrifying ^@^ delimiter is so that we can escape quotes safely,
    // after which we can replace them with quotes.  If anybody actually uses
    // this sequence in a commit message, well, it will be a weird hack.

    var skipArg = '';
    if (skip) {
        skipArg = ' --skip=' + skip + ' ';
    }

    var cmd = 'git log -n' + n + ' --branches=* ' + skipArg + ' --pretty=format:\'{%n^@^hash^@^:^@^%h^@^,%n^@^author^@^:^@^%an^@^,%n^@^date^@^:^@^%ad^@^,%n^@^email^@^:^@^%aE^@^,%n^@^message^@^:^@^%s^@^,%n^@^commitDate^@^:^@^%ai^@^,%n^@^age^@^:^@^%cr^@^},\'';
    var opts = {
        cwd: pth,
        timeout: config.fastTimeout
    };
    if (config.appendDotGitToRepoNames && !gitpattern.test(pth)) {
        opts.cwd += '.git';
    }
    child_process.exec(cmd, opts, function(err, stdout) {
        if (err)
            return cb(err)
        var out = ("" + stdout).replace(/\\/g, '\\\\').replace(/"/gm, '\\"').replace(/\^@\^/gm, '"').replace(/[\f\r\n]/g, "");
        if (out[out.length - 1] === ',') {
            out = out.substring(0, out.length - 1);
        }
        out = '[' + out + ']';
        try {
            var parsed = JSON.parse(out);
            for (var i = 0; i < parsed.length; i++) {
                if (parsed[i].date) {
                    parsed[i].date = new Date(Date.parse(parsed[i].date))
                }
            }
            cb(null, parsed);
        } catch (err) {
            cb(err, out)
        }
    });
}

function diff(req, res) {
    var u = url.parse(req.url, true);
    var portions = u.pathname.split(/\//g);
    var repo = portions[portions.length - 2] + '.git';
    var commit = portions[portions.length - 1];
    var dir = path.join(config.gitdir, repo);
    fs.exists(dir, function(exists) {
        if (!exists)
            return error(req, res, 'No such repository ' + repo + '\n', 404);
        var opts = {
            cwd: dir,
            timeout: config.fastTimeout
        }
        var cmdline = 'git diff-tree --patch-with-stat "' + commit + '"';
        res.writeHead(200, {'Content-Type': 'text/plain; charset=UTF-8'});
        var proc = child_process.exec(cmdline, opts);
        proc.stdout.pipe(res);
    });
}

function archive(req, res) {
    var u = url.parse(req.url, true);
    var x = downloadRex.exec(u.pathname);
    var repo = x[1];
    if (/(.*)\.tar/.test(repo)) {
        repo = /(.*?)\.tar/.exec(repo)[1];
    }
    var dir = path.join(config.gitdir, repo + '.git');
    var branch = u.query.branch || 'HEAD';
    var fmt = x[2];
    var format = 'tar';
    console.log('FORMAT: "' + fmt + '"');
    var cmdline = 'git archive --format='
    var postProcess = '';
    var contentType = 'application/x-tar';
    switch (fmt) {
        case 'tar' :
            break;
        case 'zip' :
            format = 'zip';
            contentType = 'application/zip'
            break;
        case 'gz' :
            format = 'tar.gz'
            contentType = 'application/x-gtar';
            break;
        case 'bz2' :
            postProcess = ' | bzip2 -9c'
            contentType = 'application/x-gtar';
            break;
        case 'xz' :
            postProcess = ' | xz -9c'
            contentType = 'application/x-xz';
            break;
        default :
            return error(req, res, 'Unknown format ' + fmt, 400);
    }
    cmdline += format + ' ' + branch + postProcess;
    var opts = {
        cwd: dir,
        timeout: 24000,
        encoding: 'binary'
    }
    // XXX for some reason, when piping the process output directly to the
    // http response, the result ends up truncated
    var tempfile = '/tmp/' + new Date().getTime() + '_' + repo + '-' + Math.random() + '.' + format;
    cmdline += ' > ' + tempfile;
    console.log('RUN ' + cmdline);
    res.writeHead(200, {'Content-Type': contentType});
    var proc = child_process.exec(cmdline, opts, function(err, stdout) {
        if (err)
            console.log(err);
        var str = fs.createReadStream(tempfile);
        str.on('close', function() {
            fs.unlink(tempfile);
        })
        str.pipe(res);
    });
//    proc.stdout.pipe(res);
}

function guessContentType(pth) {
    var contentType = "application/octet-stream";
    var rex = /.*\.(.*)/;
    if (rex.test(pth)) {
        switch (rex.exec(pth.toLowerCase())[1]) {
            case 'js' :
                contentType = 'application/javascript; charset=utf8';
                break;
            case 'java' :
                contentType = 'text/x-java; charset=utf8';
                break;
            case 'woff' :
                contentType = 'font/woff';
                break;
            case 'ttf' :
                contentType = 'font/ttf';
                break;
            case 'gif' :
                contentType = 'image/gif';
                break;
            case 'png' :
                contentType = 'image/png';
                break;
            case 'jpg' :
            case 'jpeg' :
                contentType = 'image/jpeg';
                break;
            case 'txt' :
                break;
            case 'html' :
                contentType = 'text/html; charset=utf8';
                break;
            case 'md' :
            case 'markdown' :
                contentType = 'text/x-markdown; charset=utf8';
                break;
            case 'xml' :
                contentType = 'text/xml; charset=utf8';
                break;
            case 'css' :
                contentType = 'text/css; charset=utf8';
                break;
            case 'nf' :
                contentType = 'text/x-manifest; charset=utf8';
                break;
            case 'json' :
                contentType = 'application/json; charset=utf8';
                break;
            case 'rb' :
                contentType = 'text/ruby; charset=utf8';
                break;
            case 'zip' :
                contentType = 'application/zip';
                break;
            case 'xz' :
                contentType = 'application/x-xz';
                break;
            case 'jar' :
                contentType = 'application/jar';
                break;
            case 'bz2' :
                contentType = 'application/x-bzip2';
                break;
            case 'gz' :
                contentType = 'application/x-gzip';
                break;
            case 'rb' :
                contentType = 'text/ruby; charset=utf8';
                break;
        }
    }
    return contentType;
}

function getOneFile(req, res) {
    var self = this;
    var u = url.parse(self.req.url, true);
    var portions = u.pathname.split(/\//g);
    var repo = portions[2] + '.git';
    var dir = path.join(config.gitdir, repo);
    var pth = "";
    var raw = u.query.raw;
    var branch = u.query.branch || 'HEAD';
    for (var i = 4; i < portions.length; i++) {
        if (pth.length > 0) {
            pth += '/'
        }
        pth += portions[i];
    }
    fs.exists(dir, function(exists) {
        if (!exists)
            return error(req, res, 'No such repository ' + repo + '\n', 404);
        var opts = {
            cwd: dir,
            timeout: config.fastTimeout
        }
        var contentType = 'text/plain; charset=UTF-8';
        if (raw || /.*\.gif/.test(pth) || /.*\.png/.test(pth) || /.*\.jpg/.test(pth)) {
            var rex = /.*\.(.*)/;
            if (rex.test(pth)) {
                contentType = guessContentType(pth);
            }
        }
        var cmdline = 'git show "' + branch + ':' + pth + '"';
        var proc = child_process.exec(cmdline, opts);
        self.res.writeHead(200, {'Content-Type': contentType});
        proc.stdout.pipe(res);
    });
}

function listFiles(req, res) {
    var self = this;
    var u = url.parse(self.req.url, true);
    var portions = u.pathname.split(/\//g);
    var repo = portions[portions.length - 2] + '.git';
    var dir = path.join(config.gitdir, repo);
    var branch = u.query.branch || 'master'
    var rex = /([dwrxs-]{10})\s+(\S+)\s+(\d+)\s+([\d-]+)\s+([\d:-]+)\s+(.*)$/gm
    fs.exists(dir, function(exists) {
        if (!exists)
            return error(req, res, 'No such repository ' + repo + '\n', 404);
        var opts = {
            cwd: dir,
            timeout: config.fastTimeout
        }
        var cmdline = 'git archive "' + branch + '"| ' + config.tar + ' -tv';
        child_process.exec(cmdline, opts, function(err, stdout, stderr) {
            if (err)
                return error(req, res, err);
            var split = (stdout + '').split('\n');
            var result = [];
            for (var i = 0; i < split.length; i++) {
                if (rex.test(split[i])) {
                    var dta = split[i].split(rex);
                    var isFile = dta[1][0] != 'd';
                    var name = dta[6].split(/\//gm);
                    if (name && name.length > 0) {
                        name = name[name.length - 1];
                    } else {
                        name = dta[6];
                    }
                    if (isFile) {
                        var item = {
                            type: dta[1],
                            name : name,
                            
//                        owner: dta[2],
                            size: parseInt(dta[3]),
                            date: new Date(Date.parse(dta[4] + ' ' + dta[5])), // XXX timezone
//                        date: dta[4],
//                        time: dta[5],
                            path: dta[6]
                        };
                        result.push(item)
                    }
                }
            }
            respond(req, res, result)
        });

    });

}

function log(req, res) {
    var self = this;
    var u = url.parse(self.req.url, true);
    var portions = u.pathname.split(/\//g);
    var repo = portions[portions.length - 1] + '.git';
    var dir = path.join(config.gitdir, repo);
    fs.exists(dir, function(exists) {
        var skip = null;
        var count = config.logEntriesPerPage;
        if (typeof u.query.skip !== 'undefined') {
            skip = parseInt(u.query.skip);
            if (skip + '' === 'NaN') {
                return respond(req, res, 'Not a number: ' + u.query.skip + '\n');
            }
        }
        if (typeof u.query.count !== 'undefined') {
            count = parseInt(u.query.count);
            if (count + '' === 'NaN') {
                return respond(req, res, 'Not a number: ' + u.query.count + '\n');
            }
        }
        if (!exists)
            return error(req, res, 'No such repository ' + repo + '\n', 404);
        gitCommits(dir, count, function(err, commits) {
            if (err)
                return error(req, res, err);
            respond(req, res, commits);
        }, skip)
    });
}

function list(req, res) {
    if (req.method.toUpperCase() === 'HEAD') {
        res.writeHead(200, DEFAULT_HEADERS);
        return res.end();
    }
    fs.readdir(config.gitdir, function(err, files) {
        if (err)
            return error(req, res);

        var data = [];
        for (var i = 0; i < files.length; i++) {
            if (gitpattern.test(files[i])) {
                data.push({
                    location: path.join(config.gitdir, files[i]),
                    dir: files[i],
                    name: gitpattern.exec(files[i])[1]
                });
            }
        }

        var moreData = copy(data);

        var handled = 0;
        function loadDescription() {
            var item = moreData.pop();
            var descriptionFile = item ? path.join(item.location, 'description') : '';
            function done() {
                if (++handled >= data.length) {
                    respond(req, res, data);
                } else {
                    process.nextTick(loadDescription);
                }
            }

            function almostDone() {
                gitCommits(item.location, 1, function(err, commit) {
                    if (commit) {
                        item.lastCommit = commit[0];
                    } else if (err) {
                        console.log(err);
                    }
                    done();
                });
            }

            fs.exists(descriptionFile, function(exists) {
                if (!exists) {
                    almostDone();
                } else {
                    fs.readFile(descriptionFile, {encoding: 'utf8'}, function(err, desc) {
                        if (desc) {
                            for (var i = 0; i < data.length; i++) {
                                if (data[i].name === item.name) {
                                    data[i].description = desc;
                                    break;
                                }
                            }
                        }
                        almostDone();
                    });
                }
            });
        }

        loadDescription();
    });
}

router.createSimpleServer(config.port, function onStart(err) {
    if (err)
        throw err;
    console.log('Started git server on ' + config.port + " over " + config.gitdir);
});
