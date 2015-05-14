var fs = require('fs');
var path = require('path');
var util = require('util');
var argv = require('minimist')(process.argv.slice(2));
var markov = require('./markov');

/**
 * Chat with someone. 
 * Commands:
 *    load $username
 * Then your inputs are used to feed the markov response.
 */

var stdin = process.openStdin(),
    markovChain = null,
    workDir = argv.workDir || process.env.WORK_DIR || './work',
    usersById = JSON.parse(fs.readFileSync(path.join(workDir, 'users.json'))),
    usersByName = invert(usersById),
    parts,
    db,
    res;

function invert(obj) {
  var newObj = {};
  Object.keys(obj).forEach(function(oldKey) {
    newObj[obj[oldKey]] = oldKey;
  });
  return newObj;
}

util.print('>');
stdin.on('data', function(line) {
  parts = line.toString().split(' ');
  if (parts[0] === 'load') {
    db = JSON.parse(fs.readFileSync(path.join(workDir, 'markov_' + usersByName[parts[1].trim()] + '_' + parts[1].trim() + '.json')));
    markovChain = markov(2, db);
  } else if (markovChain !== null) {
    res = markovChain.respond(line.toString()).join(' ');
    console.log(res);
  } else {
    console.log('you must load someone: load $user');
  }
  util.print('>');
});