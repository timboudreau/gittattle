#!/usr/bin/env node
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
        DeepRepo = require('./DeepRepo');

// GITTATTLE
// ---------
// Implements a very straightforward minimal web api

var file = 'gittattle.json';
var filepath = path.resolve(__dirname, file);
var gitpattern = /(.*?)\.git/;
var DEFAULT_COUNT = 30;

var config = {
    gitdir: '/var/lib/gitolite/repositories',
    port: 9902,
    tar: 'tar',
    fastTimeout: 1400,
    logEntriesPerPage: DEFAULT_COUNT,
    serveIndexPage: true,
    failOnNoDir: true,
    blacklist: []
};

// Look for a file named gittattle.json in the process working dir, and
// if present, override config defaults with its contents
if (fs.existsSync(filepath)) {
    var loaded = JSON.parse(fs.readFileSync(filepath, {encoding: 'utf8'}));
    for (var key in loaded) {
        config[key] = loaded[key]
    }
}
config.blacklist.unshift('gitolite-admin.git');

// Bail out early if gitdir is not set, or if failOnNoDir is true and the
// dir does not exist
if (!config.gitdir || (config.failOnNoDir && !fs.existsSync(config.gitdir))) {
    throw new Error("Git dir does not exist: '" + config.gitdir + "'")
}

var deepRepoInst = DeepRepo.create(config.gitdir, gitpattern);

var listFileRex = /\/git\/[^\/`'"'&|<>]*\/get\/([^&`'"|<>]*)/;
var downloadRex = /\/git\/([^\/`'"'&|<>]*)\.([tarzipgb2x\.]*)$/;

var router = new Router();

// Redirects to the UI home page
router.getAndHead("", redir);
router.getAndHead("/", redir);
router.getAndHead(/\/git$/, redir);

// Static content
if (config.serveIndexPage) {
    router.getAndHead(/\/git\/index.html/, getFile('index.html'), 'Index page');
    router.getAndHead(/\/git\/?$/, getFile('index.html'), 'Index page');
    router.getAndHead(/\/git\/ajax-loader.gif/, getFile('ajax-loader.gif'), 'Progress animation');
}
// Web API
router.getAndHead('/git/list', list, 'List repositories');
router.getAndHead(downloadRex, archive, 'Fetch an archive of a repository');
router.getAndHead(/\/git\/[^\/`'"'&|<>]*$/, log, 'Fetch log for one repository');
router.getAndHead(/\/git\/[^\/`'"'&|<>]*\/[abcdef1234567890]*$/, diff, 'Fetch a change set')
router.getAndHead(/\/git\/[^\/`'"'&|<>]*\/list$/, listFiles, 'List files');
router.getAndHead(listFileRex, getOneFile, 'List files');

// Start the server
router.createSimpleServer(config.port, function onStart(err) {
    if (err)
        throw err;
    console.log('Started git server on ' + config.port + " over " + config.gitdir);
});

// Redirect requests to the site root
function redir(req, res) {
    res.writeHead(302, {
        Location: '/git/'
    });
    res.end("Redirecting to git server root");
}

// Web API calls:
function getFile(file) {
    var dir = path.dirname(module.filename);
    var pth = path.join(dir, file);
    if (!fs.existsSync(pth)) {
        throw new Error(pth + " does not exist");
    }
    var contentType = guessContentType(pth);
    return function serveFile(req, res) {
        fs.stat(pth, function(err, stat) {
            if (err) {
                return error(req, res, err);
            }
            if (req.headers['if-modified-since']) {
                var date = new Date(req.headers['if-modified-since']);
                if (date <= mtime) {
                    res.writeHead(304)
                    return res.end()
                }
            }
            var mtime = stat.mtime;
            var stream = fs.createReadStream(pth);
            var hdrs = {
                'Content-Type': contentType,
                'Last-Modified': mtime
            };
            if (/image/.test(contentType) || /javascript/.test(contentType)) {
                var expires = new Date();
                expires.setFullYear(expires.getFullYear() + 10)
                hdrs['Expires'] = expires
                hdrs['Cache-Control'] = 'public, max-age=600000'
            } else {
                hdrs['Cache-Control'] = 'public, must-revalidate'
            }
            res.writeHead(200, hdrs);
            stream.pipe(res);

        });
    }
}

// PENDING: include tags and branches in basic repo info

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

    // Basically we're getting `git log` to return pseudo-JSON
    var cmd = 'git log -n' + n + ' --branches=* ' + skipArg
            + ' --pretty=format:\'{%n^@^hash^@^:^@^%h^@^,%n^@^author^@^:^@^%an^@^,%n^@^date^@^:^@^%ad^@^,%n^@^email^@^:^@^%aE^@^,%n^@^message^@^:^@^%s^@^,%n^@^commitDate^@^:^@^%ai^@^,%n^@^age^@^:^@^%cr^@^},\'';
    var opts = {
        cwd: pth,
        timeout: config.fastTimeout
    };
    if (!gitpattern.test(pth)) {
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
    var repo = deepRepoInst.object(portions[portions.length - 2]);
    var commit = portions[portions.length - 1];
    var dir = repo.location;
    fs.exists(dir, function(exists) {
        if (!exists)
            return error(req, res, 'No such repository ' + repo.name + '\n', 404);
        var opts = {
            cwd: dir,
            timeout: config.fastTimeout
        }
        var cmdline = 'git diff-tree --patch-with-stat "' + commit + '"';
        var expires = new Date();
        // Set expiration date 10 years in the future - a commit will always
        // match its hash
        expires.setFullYear(expires.getFullYear() + 10);
        res.writeHead(200, {
            'Content-Type': 'text/plain; charset=UTF-8',
            Expires: expires,
            'Cache-Control': 'public'
        });
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
    // Do a little hack to pipe it through xz or bz2, so we can
    // support those target formats
    var orepo = deepRepoInst.object(repo);
    var dir = orepo.location;
    var branch = u.query.branch || 'HEAD';
    var fmt = x[2];
    var format = 'tar';
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
    // http response, the result ends up truncated.  For now use a temporary
    // file and serve that
    var tempfile = '/tmp/' + new Date().getTime() + '_' + repo + '-' + Math.random() + '.' + format;
    cmdline += ' > ' + tempfile;
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': 'inline;filename=' + orepo.archive + '.' + format
    });
    var proc = child_process.exec(cmdline, opts, function(err, stdout) {
        if (err)
            console.log(err);
        var str = fs.createReadStream(tempfile);
        str.on('close', function() {
            fs.unlink(tempfile);
        })
        str.pipe(res);
    });
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
            case 'mf' :
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
        }
    }
    return contentType;
}

function getOneFile(req, res) {
    // Use git show to list the file - we never actually unpack it to disk,
    // just read the index
    var self = this;
    var u = url.parse(self.req.url, true);
    var portions = u.pathname.split(/\//g);
    var repo = deepRepoInst.object(portions[2]);
    var dir = repo.location
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
            return error(req, res, 'No such repository ' + repo.name + '\n', 404);
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
        var cmdline = 'git show --format=raw "' + branch + ':' + pth + '"';
        var proc = child_process.exec(cmdline, opts);
        self.res.writeHead(200, {'Content-Type': contentType});
        proc.stdout.setEncoding('binary');
        proc.stdout.pipe(res);
    });
}

function listFiles(req, res) {
    var self = this;
    var u = url.parse(self.req.url, true);
    var portions = u.pathname.split(/\//g);
    var repo = deepRepoInst.object(portions[portions.length - 2]);
    var dir = repo.location;
    var branch = u.query.branch || 'master'
    var rex = /([dwrxs-]{10})\s+(\S+)\s+(\d+)\s+([\d-]+)\s+([\d:-]+)\s+(.*)$/gm
    fs.exists(dir, function(exists) {
        if (!exists)
            return error(req, res, 'No such repository ' + repo.name + '\n', 404);
        var opts = {
            cwd: dir,
            timeout: config.fastTimeout
        }
        // PENDING:  This is pretty horribly inefficient, since we're archiving
        // the entire repo in order to list it - find another way
        var cmdline = 'git archive "' + branch + '"| ' + config.tar + ' -tv';
        child_process.exec(cmdline, opts, function(err, stdout, stderr) {
            if (err)
                return error(req, res, err);
            var split = (stdout + '').split('\n');
            var result = [];
            for (var i = 0; i < split.length; i++) {
                var dta = split[i].split(/\s+/);                
                if (/^([dwrxs-]{10})/.test(dta[0])) {
                    var isFile = dta[0][0] != 'd';
                    var name = dta[5].split(/\//gm);
                    if (name && name.length > 0) {
                        name = name[name.length - 1];
                    } else {
                        name = dta[5];
                    }
                    if (isFile) {
                        var item = {
                            type: dta[0],
                            name: name,
//                        owner: dta[1],
                            size: parseInt(dta[2]),
                            date: new Date(Date.parse(dta[3] + ' ' + dta[4])), // XXX timezone
//                        date: dta[3],
//                        time: dta[4],
                            path: dta[5]
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
    var repo = deepRepoInst.object(portions[portions.length - 1]);
    var dir = repo.location;
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
            return error(req, res, 'No such repository ' + repo.name + '\n', 404);
        gitCommits(dir, count, function(err, commits) {
            if (err)
                return error(req, res, err);
            respond(req, res, commits);
        }, skip)
    });
}

function list(req, res) {
    // List repositories, with commit info
    if (req.method.toUpperCase() === 'HEAD') {
        res.writeHead(200, DEFAULT_HEADERS);
        return res.end();
    }
    
    function isBlacklisted(dir) {
        return config.blacklist && config.blacklist.length > 0 ?
                config.blacklist.indexOf(dir) >= 0 : false;
    }
    
    function sortrepos(a, b) {
        return a.name <= b.name ? -1 : 1;
    }
    
    function findrepos(dir, callback) {
        var repos = [];
        fs.readdir(dir, function(err, files) {
            if (err)
                return callback(err);

            var pending = files.length;

            if (!pending)
                return callback(null, repos);

            files.forEach(function(file) {
                var relativepath = dir.replace(config.gitdir + '/', '') + '/' + file;
                if (!isBlacklisted(file) && !isBlacklisted(relativepath)) {
                    var fullpath = path.join(dir, file);
                    fs.stat(fullpath, function(err, stat) {
                        if (gitpattern.test(file)) {
                            repos.push(deepRepoInst.object(fullpath));
                            if (!--pending)
                                callback(null, repos);
                        } else if (stat && stat.isDirectory()) {
                            findrepos(fullpath, function(err, res) {
                                repos = repos.concat(res);
                                if (!--pending)
                                    callback(null, repos);
                            });
                        }
                    });
                } else {
                    if (!--pending)
                        callback(null, repos);
                }
            });
        });
    }
    
    // List all subdirs of the git dir
    findrepos(config.gitdir, function(err, data) {
        if (err)
            return error(req, res);        

        if (data.length === 0) {
            return respond(req, res, []);
        }

        // sort data in alphabetically ascendant order 
        data.sort(sortrepos);
        
        // clone the data
        var moreData = copy(data);

        var handled = 0;
        function loadDescription() {
            // Called iteratively - get the current item
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
                // get the most recent commit for this repo
                gitCommits(item.location, 1, function(err, commit) {
                    if (commit) {
                        item.lastCommit = commit[0];
                    } else if (err) {
                        console.log(err);
                    }
                    done();
                });
            }

            // load the description
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
