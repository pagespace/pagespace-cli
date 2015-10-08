var argOpts = {
    boolean: [ 'l', 'link']
};

var fs = require('fs');
var argv = require('minimist')(process.argv.slice(2), argOpts);
var chalk = require('chalk');
var bunyan = require('bunyan');
var PrettyStream = require('bunyan-prettystream');

var commands = {
    'static' : './tasks/static'
};

var commandMsg = {
    'static' : 'Static Site Generator'
};

var main = function() {

    var command = argv._[0];

    if(argv.V || argv.version) {
        return showVersion();
    }
    if(argv.help) {
        console.log(chalk.bold('Help') + ':');
        return showHelp();
    }

    var taskModule = commands[command];
    if(taskModule) {
        var welcome =
            chalk.bgWhite.magenta.italic('P ') +
            chalk.bgWhite.cyan.italic('A ') +
            chalk.bgWhite.red.italic('G ') +
            chalk.bgWhite.green.italic('E ') +
            chalk.bgWhite.gray.italic('S P A C E');


            console.log(welcome + ': ' + commandMsg[command]);

        var dir = process.cwd();
        var task = require(taskModule);

        //preparea a logger for tasks
        var prettyStdOut = new PrettyStream({
            mode: 'short'
        });
        prettyStdOut.pipe(process.stdout);
        var log = bunyan.createLogger({
            name: 'pagespace-cli',
            streams: [{
                level: argv.v || argv.verbose ? 'debug' : 'info',
                type: 'raw',
                stream: prettyStdOut
            }]
        });

        //prepare all options
        var opts = {
            dir: dir,
            output: argv.o || argv.output,
            host: argv.h || argv.host,
            auth: argv.a || argv.auth,
            clean: argv.c || argv.clean
        };


        log.debug('Using options:');
        if(log.level() <= bunyan.DEBUG) {
            log.debug(JSON.stringify(opts, null, '  '));
        }

        //extra stuff
        opts.args = argv._;
        opts.log = log;

        task.run(opts);
    } else {
        console.warn(command ? 'Unrecognized command: ' + command : 'Missing command');
        return showHelp();
    }
};

function showVersion() {
    var version = require('../package.json').version;
    console.log(version);
}

function showHelp() {
    var helpText = fs.readFileSync(__dirname + '/help.txt', 'utf-8');
    console.log(helpText);
}

module.exports = main;