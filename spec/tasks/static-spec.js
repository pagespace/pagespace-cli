var http = require('http');
var fs = require('fs');
var path = require('path');

var staticTask = require('../../lib/tasks/static');

var testLogger = {
    info: function() {
        console.log.apply(null, arguments);
    },
    debug: function() {
        console.log.apply(null, arguments);
    },
    trace: function() {
        //console.log.apply(null, arguments);
    },
    warn: function() {
        console.warn.apply(null, arguments);
    },
    error: function() {
        console.error.apply(null, arguments);
    }
};

describe('Generating a static site', function () {

    it('gets HTML from a url', function(done) {

        var testHtml = '<html><title>Foo</title></html>';
        var server = http.createServer(function (req, res) {
            res.writeHead(200, {'Content-Type': 'text/html'});
            console.log('sending')
            res.end(testHtml);
        }).listen(0, '127.0.0.1', function() {
            staticTask._getPage('http://127.0.0.1:' + server.address().port, '/foo', testLogger).then(function(page) {
                expect(testHtml).toEqual(page.html);
                done();
            });
        });
    });

    it('gets a map of static resources to download', function() {

        var html = fs.readFileSync(path.resolve(__dirname, '../fixtures/p1.html'), 'utf8');
        var outputDir = path.resolve(__dirname, '../tmp');
        staticTask._processPage({
            url: '/path/to/page',
            html: html
        }, outputDir, testLogger);
    })
});