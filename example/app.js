var fs = require('fs');
var BiomioNode = require('../');

var env = process.env.NODE_ENV || 'production';

var config = require('./config');
console.info(config);

try {
  var privateKey = fs.readFileSync(__dirname + '/' + config.appSecretFile).toString();
} catch (e) {
  console.error('Can\'t find/read file "private.key"!');
  process.exit(1);
}

var options = {
  gateURL: config.gateURL,
  appId: config.appId,
  appKey: privateKey,
  appType: 'probe', // probe | extension

  /* optional parameters */
  osId: 'linux',
  headerOid: 'clientHeader',
  devId: 'node_js_lib'
}


/** establish connection to Gate */
var conn = new BiomioNode(options);

conn.on('ready', function() {
  console.info('Connection to Gate is ready!');
});

conn.on('getResources', function(done) {
  done(config.resources);
});

conn.on('try:text_credentials', function(data, done) {
  console.info("TRY: \n", data);

  /** 1. get credentials from request */

  /** 2. check credentials with LDAP server */

  /** 3. return result */
  done(null, {});
});



