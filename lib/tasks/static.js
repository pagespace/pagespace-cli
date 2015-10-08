var path = require('path');
var fs = require('fs');
var util = require('util');
var mkdirp = require('mkdirp');
var Promise = require('bluebird');
var request = require('request');
var htmlparser = require('htmlparser2');
var unique = require('array-unique');
var rimraf = require('rimraf');

var mkdirpAsync = Promise.promisify(mkdirp);
var requestAsync = Promise.promisify(request);

module.exports  = {
    run: function(opts) {
        var self = this;

        var log = opts.log;
        var dir = opts.dir;

        log.info('Generating static site...');

        if(!opts.host) {
            log.error('You must supply a host option (-h, --host)');
            return;
        }

        if(!opts.auth) {
            log.error('Please provide authorization credentials to contact the pages api (-a, --auth');
            return;
        }

        var outputDir = null;
        if(!opts.output) {
            log.warn('No output directory given. Performing a dry run...');
        } else {
            outputDir = path.resolve(dir, opts.output);

            if(opts.clean && outputDir !== dir) {
                log.info('Cleaning output dir: %s', outputDir);
                rimraf.sync(outputDir);
            }
        }

        var username = opts.auth.split(':')[0];
        var password = opts.auth.split(':')[1];
        requestAsync({
            url: opts.host + '/_api/pages?status=200',
            headers: {
                'Accept': 'application/json'
            },
            auth: {
                user: username,
                pass: password
            }
        }).spread(function(res, body) {
            var pages = JSON.parse(body);
            log.info('Found %s pages', pages.length);
            return pages;
        }).map(function(page) {
            log.info('Fetching content for page %s (%s)', page.url, page.name);
            return self._getPage(opts.host, page.url, log);
        }).map(function(page) {
            log.info('Processing page %s', page.url);
            return self._processPage(page, outputDir, log);
        }).then(function(allResources) {
            log.info('Fetching local static resources');
            var foundResources = unique(Array.prototype.concat.apply([], allResources));
            return self._fetchResources(outputDir, opts.host, foundResources, log);
        }).all(function() {
            log.info('All resources fetched');
            log.info('Static site generation complete.');
        }).catch(function(err) {
            console.error(err);
        });
    },

    _getPage: function (host, url, log) {
        log.debug('Requesting %s/%s', host, url);
        return requestAsync(host + url).spread(function(res, body) {
            log.debug('Received response for %s/%s', host, url);
            return {
                url: url,
                html: body
            };
        });
    },

    _processPage: function(page, outputDir, log) {

        var foundResources = [];

        var tags = {
            a: 'href',
            link: 'href',
            audio: 'src',
            video: 'src',
            img: 'src',
            script: 'src'
        };

        function isLocal(href) {
            return !/^(https?|\/\/)/.test(href) && /^\//.test(href);
        }

        function convert(url, attr) {
            attr = attr.substr(1);
            var depth = url.split('/').length - 1;
            attr = Array(depth).join('../') + attr;
            return attr;
        }

        function mapNode(node, url) {
            var tag = node.name;
            var attr = node.attribs && node.attribs[tags[tag]];

            if(!attr) {
                return;
            }

            var newAttr;
            if(isLocal(attr)) {
                if (tag === 'a') {
                    newAttr = convert(url, attr);
                    if (!/\.html$/.test(attr)) {
                        newAttr += '.html';
                    }
                } else if (tags[node.name]) {
                    newAttr = convert(url, attr);
                    foundResources.push(attr);
                }
                node.attribs[tags[tag]] = newAttr;
                log.debug('Converting %s[%s] from %s to %s', tag, tags[tag], attr, newAttr);
            } else {
                log.debug('Ignoring %s[%s=%s]', tag, tags[tag], attr);
            }
        }

        function walk(nodes, fn) {
            for(var i = 0; i < nodes.length; i++) {
                fn(nodes[i]);
                if(nodes[i].children) {
                    walk(nodes[i].children, fn);
                }
            }

        }
        var dom = new htmlparser.parseDOM(page.html);
        walk(dom, function(node) {
            log.trace('Found node:\n%s', util.inspect(node));
            mapNode(node, page.url);
        });
        var html = htmlparser.DomUtils.getOuterHTML(dom);

        if(outputDir) {
            if(page.url === '/') {
                page.url = 'index';
            }
            var htmlFilePath = path.join(outputDir, page.url) + '.html';
            var htmlDirPath = htmlFilePath.replace(/[^\/]*$/, '');
            log.debug('Creating directory (if not exists) %s', htmlDirPath);
            mkdirp.sync(htmlDirPath);
            log.debug('Writing HTML file to %s', htmlFilePath);
            fs.writeFileSync(htmlFilePath, html);
        } else {
            console.info('No files written on dry run');
        }
        return foundResources;
    },

    _fetchResources: function(outputDir, host, resources, log) {

        log.debug('Found resources:\n%s', resources.join('\n'));

        if(!outputDir) {
            console.info('No resources fetched on dry run');
            return [];
        }

        return Promise.map(resources, function(resource) {
            return new Promise(function(resolve, reject) {
                var resourceFilePath = path.join(outputDir, resource);
                var resourceDirPath = resourceFilePath.replace(/[^\/]*$/, '');
                mkdirpAsync(resourceDirPath).then(function() {
                    log.debug('Fetching resource %s$s', host, resource);
                    request
                        .get(host + resource)
                        .on('error', function(err) {
                            log.warn(err, 'Could not fetch %s%s', host, resource);
                            reject(err);
                        })
                        .on('end', function() {
                            log.debug('Fetched %s%s', host, resource);
                            resolve();
                        })
                        .pipe(fs.createWriteStream(resourceFilePath));
                });
            });
        });
    }
};