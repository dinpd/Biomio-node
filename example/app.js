var fs = require('fs');
var Agent = require('../');
var config = require('./config');

try {
  var privateKey = fs.readFileSync(__dirname + "/private.key").toString();
} catch (e) {
  console.error('Can\'t find/read file "private.key"!');
  process.exit(1);
}

var options = {
  gateURL: config.gateURL,
  appId: config.appId,
  appKey: privateKey,
  appType: 'extension', // or probe
  /* optional parameters */
  osId: 'linux',
  headerOid: 'clientHeader',
  devId: 'node_js_lib'
}

console.log(options);

var userToken = 'biomio.vk.test@gmail.com'; // for now we use email

var conn = new Agent(userToken, options, function() {

  conn.user_exists(function(exists) {
    console.info('user exists ', exists);

    /* callback will be called few times: in_progress, completed */
    conn.run_auth(function (result) {
      console.log('RUN AUTH STATUS: ' + JSON.stringify(result, null, 2));

    });

  });

});