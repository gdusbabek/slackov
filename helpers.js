function expand(dict) {
  var str = '', first = true;
  Object.keys(dict).forEach(function(key) {
    str += first ? '?' : '&';
    str += key + '=' + dict[key];
    first = false;
  });
  return str;
}

function filenameSanitize(s) {
  return s.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

exports.expand = expand;
exports.filenameSanitize = filenameSanitize;