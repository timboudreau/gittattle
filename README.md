GitTattle
=========

Implements a simple, read-only REST API on top of a directory of Git repositories,
allowing for basic browsing.

Why?  Gitweb is awful, and cgit is painful to set up on Linux, excruciating
on Solaris derivatives.  And in many cases, you just want to make a git
repository visible, not necessarily have full pull/push access via HTTP.

This will not solve the world's problems, but it's quick and dirty and does the job.

It's written in node.js and can be run from the command-line.  It's not intended
to be a full featured Git server - I'm using ``gitolite`` and am perfectly
happy with that for pulls and pushes.  This is just to get a decent UI on the
web with minimum pain.


Configuration
-------------

It looks for a file named ``gittattle.json`` in the process` working directory.
The following properties are relevant and shown with their defaults:

 * ``gitdir : /var/lib/gitolite/repositories`` - Path to the parent directory of git repos to serve
 * ``appendDotGitToRepoNames : true`` - Look for ``.git`` as the suffix
 * ``port : 9902`` - The port to run the HTTP server on
 * ``tar : tar`` - The name of the tar command, for platforms that call GNU tar ``gtar``
 * ``logEntriesPerPage : 30`` - The number of log entries to return if log is called with no ``count`` URL parameter
 * ``serveIndexPage : true`` - Should the built-in HTML client be used


Web UI
------

The application includes a simple web user interface which uses CDN-hosted
JQuery, Twitter Bootstrap and AngularJS to create a single-page web application
which uses the web API to browse Git repositories.

Run it and navigate in a browser to ``/git/index.html`` for that.


Web API
-------

The API aims to be simple and intuitive.  Since this is read-only, only GET and HEAD
requests are supported.

### ``/git``

Lists the respositories being served as a JSON array, with some info about the
most recent commit if available

    [ { location: '/tmp/git/blog.git',
        dir: 'blog.git',
        name: 'blog',
        description: 'Yet another nodejs blog engine\n',
        lastCommit: 
         { hash: '92cb9cb',
           author: 'Joe Shmoe',
           date: '2013-03-24T16:12:23.000Z',
           email: 'joe@foo.example',
           message: 'Fix utf8, more attempts to get working in IE8, filter obvious spam comments',
           commitDate: '2013-03-24 12:12:23 -0400',
           age: '5 months ago' }
    } ]


### ``/git/$REPO_NAME``

Get a commit log for one repository.  Example data:

        [{ hash: '56cbf59',
          author: 'Tim Boudreau',
          date: '2012-11-27T01:20:05.000Z',
          email: 'tboudreau@chiliad.com',
          message: 'Fix gzip length bug',
          commitDate: '2012-11-26 20:20:05 -0500',
          age: '9 months ago' }]

Optional parameters:

 * skip - integer number of log records to skip
 * count - the maximum number of log records to return


### ``/git/$REPO_NAME/list``

List the files in one repository, as they would be presented by ``tar tv``, JSON-ized.
Example data:

  [{ type: '-rw-rw-r--',
    size: 646,
    date: '2013-03-24T16:12:00.000Z',
    path: 'ui/package.json' }]

Add the parameter ``?branch=$BRANCH_NAME`` to download the version from a particular branch.

Directories are omitted from the file list.


### ``/git/$REPO_NAME.tar.gz``

Download an archive of this repository, specifying the compression type with
the file name.  The following are supported:  .tar, .tar.gz, .tar.bz2, .tar.xz, zip

Add the parameter ``?branch=$BRANCH_NAME`` to download the version from a particular branch.


### ``/git/$REPO_NAME/get/path/to/some.file``

Download the file ``path/to/some.file``.  Add ``?raw=true`` to have the server
attempt to set the content-type to the MIME type suggested by the extension.

Add the parameter ``?branch=$BRANCH_NAME`` to download the version from a particular branch.


### ``/git/$REPO_NAME/$COMMIT_HEX_ID``

Fetch the output of ``git diff-tree --patch-with-stat $COMMIT_HEX_ID`` - a basic
diff and stats output for that repository.
