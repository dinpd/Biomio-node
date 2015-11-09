var fs = require('fs');
var BiomioNode = require('../');
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
  appType: 'probe', // probe | extension
  onGetResources: function() {
    return [
      {
        rProperties: "1280x960,1280x720,640x480,480x360,192x144",
        rType: "front-cam"
      },
      {
        rProperties: "",
        rType: "fp-scanner"
      },
/*      {
        rProperties: "",
        rType: "ldap"
      }*/
    ]
  },
  onTry: function(data) {
    console.info('onTry ', data);
  },
  /* optional parameters */
  osId: 'linux',
  headerOid: 'clientHeader',
  devId: 'node_js_lib'
}

console.log(options);

var userToken = 'biomio.vk.test@gmail.com'; // for now we use email

/** Test probe type */
var conn = new BiomioNode(userToken, options, function() {});





/** Test extension type */
//var conn = new BiomioNode(userToken, options, function() {
//
//  conn.user_exists(function(exists) {
//    console.info('user exists ', exists);
//
//    /* callback will be called few times: in_progress, completed */
//    conn.run_auth(function (result) {
//      console.log('RUN AUTH STATUS: ' + JSON.stringify(result, null, 2));
//
//    });
//
//  });
//
//});