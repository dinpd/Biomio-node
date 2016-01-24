# biomio-node
Library that establish connection to Biomio Gate, performs RPC calls, handling tries

## How to install

`npm install "git+ssh://git@bitbucket.org:biomio/biomio-node.git" --save`

## How to use
Look at example folder.

Create environment variable DEBUG=biomio:*, if you want to see logs

## Example

```
#!javascript

var BiomioNode = require('biomio-node');

var options = {
  gateURL: 'wss://gate.biom.io:8090/websocket',
  appId: 'd33e41bdbc3cd534ceb2e87eec5e9852',
  appKey: 'here content of private key',
  appType: 'probe', // probe | extension | hybrid

  // optional parameters
  osId: 'linux',
  headerOid: 'clientHeader',
  devId: 'node_js_lib'
};

// unique client id, here we use email
var clientId = 'test.open.id.provider@gmail.com';

var conn = new BiomioNode(options);

conn.on('ready', function() {
  console.info('Connection to Gate is ready!');
});

conn.on('getResources', function(done) {
  done({
     rProperties: "",
     rType: "user_input"
  });
});

conn.on('try:text_credentials', function(data, done) {

  // perform try: validate LDAP credentials...

  done(null, {here result});
});
```