var path = require('path'),
    DeepRepo = exports.DeepRepo = (function() {
        var PROTOTYPE = function(globalpath, pattern) {

            function objectfromPath(repopath) {
                var dir = repopath.replace(globalpath + '/', '');
                var name = pattern.exec(dir)[1];
                return {
                    location: repopath,
                    dir: dir,
                    name: name,
                    id: name.replace(/\//g, '+'),
                    archive: name.replace(/\//g, '-')
                };
            }

            function objectfromID(id) {
                var name = id.replace(/\+/g, '/');
                var dir = name + '.git';
                return {
                    location: path.join(globalpath, dir),
                    dir: dir,
                    name: name,
                    id: id,
                    archive: name.replace(/\//g, '-')
                };
            }

            this.object = function(pathOrID) {
                if (pathOrID.indexOf(globalpath) > -1) {
                    return objectfromPath(pathOrID);
                }
                return objectfromID(pathOrID);
            }
        }

        //
        return {
            'create': function(globalpath, pattern) {
                return new PROTOTYPE(globalpath, pattern);
            }
        }
    }
)();

module.exports = DeepRepo;
