var path = require('path');
var url = require('url');
var fs = require('fs');
var util = require('util');
var mkdirp = require('mkdirp');
var Promise = require('bluebird');
var request = require('request');
var htmlparser = require('htmlparser2');
var unique = require('array-unique');
var rimraf = require('rimraf');

var writeFileAsync = Promise.promisify(fs.writeFile);
var mkdirpAsync = Promise.promisify(mkdirp);
var requestAsync = Promise.promisify(request);

module.exports  = {
    run: function(opts) {
        var self = this;

        var log = opts.log;
        var dir = opts.dir;

        var start = Date.now();

        if(!opts.host) {
            log.error('You must supply a host option (-h, --host)');
            return;
        }

        log.info('Generating static site from %s...', opts.host);

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
            log.debug('Fetching content for page %s (%s)', page.url, page.name);
            return self._getPage(opts.host, page.url, log);
        }).map(function(page) {
            log.info('Processing page %s', page.url);
            return self._processPage(page, outputDir, log);
        }).then(function(allResources) {
            var foundResources = unique(Array.prototype.concat.apply([], allResources));
            log.info('Fetching %s local static resources', foundResources.length);
            return self._fetchResources(outputDir, opts.host, foundResources, log);
        }).then(function() {
            log.info('All resources fetched');
            var time = Date.now() - start;
            log.info('Resources written to %s', outputDir);
            log.info('Static site generation complete in %sms', time);
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

        function convert(pageUrl, resource) {
            if(/^\//.test(resource)) {
                resource = resource.substr(1);
                var depth = pageUrl.split('/').length - 1;
                resource = Array(depth).join('../') + resource;
            } else {
                resource = url.resolve(pageUrl, resource);
            }

            return resource;
        }

        function convertStyles(pageUrl, styleText) {
            return styleText.replace(/url\("?(.+)"?\)/g, function(match, p1) {
                foundResources.push(p1);
                var converted =  convert(pageUrl, p1);
                log.debug('Converting stylesheet resource from %s to %s', p1, converted);
                return 'url(' + converted + ')';
            });
        }

        function mapNode(node, pageUrl) {
            var tag = node.name;

            if(tag === 'style') {
                node.children[0].data = convertStyles(pageUrl, node.children[0].data);
                return;
            }

            if(node.attribs && node.attribs.style) {
                node.attribs.style = convertStyles(pageUrl, node.attribs.style);
            }

            var attr = node.attribs && node.attribs[tags[tag]];
            if(!attr) {
                return;
            }

            if(isLocal(attr)) {
                var newAttr;
                if (tag === 'a') {
                    newAttr = convert(pageUrl, attr);
                    if (!/\.html$/.test(attr)) {
                        newAttr += '.html';
                    }
                } else if (tags[node.name]) {
                    newAttr = convert(pageUrl, attr);
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
        var headNode = htmlparser.DomUtils.findOne(function(node) {
            return node.name === 'head';
        }, dom);

        function prependChild(elem, child){
            child.parent = elem;

            if(elem.children.unshift(child) !== 1){
            var sibling = elem.children[1];
                sibling.prev = child;
                child.next = sibling;
                child.prev = null;
            }
        }
        prependChild(headNode, {
            type: 'tag',
            name: 'meta',
            attribs: {
                name: 'generator',
                content: 'Pagespace'
            }
        });
        prependChild(headNode, {
            data: '\n        ',
            type: 'text'
        });
        var html = htmlparser.DomUtils.getOuterHTML(dom);

        var promise;
        if(outputDir) {
            if(page.url === '/') {
                page.url = 'index';
            }
            var htmlFilePath = path.join(outputDir, page.url) + '.html';
            var htmlDirPath = htmlFilePath.replace(/[^\/]*$/, '');
            log.debug('Creating directory (if not exists) %s', htmlDirPath);
            promise = mkdirpAsync(htmlDirPath).then(function() {
                return writeFileAsync(htmlFilePath, html);
            });
            log.debug('Writing HTML file to %s', htmlFilePath);

        } else {
            promise = Promise.resolve();
            console.info('No files written on dry run');
        }
        return promise.then(function() {
            return foundResources;
        });
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
                    log.debug('Fetching resource %s', url.resolve(host, resource));

                    request
                        .get(url.resolve(host, resource))
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