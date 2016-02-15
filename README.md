# biomio-node
Library that establish connection to Biomio Gate, performs RPC calls, handling tries

## How to install

// install latest production ready version

`npm install "git+ssh://git@bitbucket.org:biomio/biomio-node.git" --save`

 // install latest development version

`npm install "git+ssh://git@bitbucket.org:biomio/biomio-node.git#development" --save`

## How to use
Look at example folder.

Create environment variable DEBUG=biomio:*, if you want to see logs

## Example

### Use as a 'probe'

```
#!javascript
var BiomioNode = require('biomio-node');

var productionGateURL = 'wss://gate.biom.io:8080/websocket';
var developmentGateURL = 'wss://gate.biom.io:8090/websocket';

var options = {
  gateURL: developmentGateURL,
  appId: 'b0ced4ecb22ceb8ee0116804b2f87256',
  appKey: '-----BEGIN RSA PRIVATE KEY-----MIICX...',

  // probe - just handle "TRY" requests (auth requests)
  // hybrid - handle "TRY" requests and run auth request to other "probe"
  appType: 'probe',

  // optional parameters
  osId: 'linux',
  headerOid: 'clientHeader',
  devId: 'win_service_ldap_agent'
}

// establish connection to Gate
var conn = new BiomioNode(options);

conn.on('ready', function () {
  logger.log('Connection to Gate is ready!');
});

conn.on('getResources', function (done) {
  // here we send our resources to the Gate
  var availableResources = [
    {
      rProperties: "",
      rType: "ldap_connection"
    },
    {
      rProperties: "",
      rType: "db_connection"
    }
  ];

  done(availableResources);
});

conn.on('try:db_check', function(data, done) {
  // here we handle "TRY" requests, perform some actions and return answer
  var authenticated = true;
  done(authenticated);
});

conn.on('try:ldap_check', function (data, done) {
  // here we handle "TRY" requests, perform some actions and return answer
  var authenticated = true;
  done(authenticated);
});
```


### Use as a 'hybrid'

```
#!javascript

var BiomioNode = require('biomio-node');

var productionGateURL = 'wss://gate.biom.io:8080/websocket';
var developmentGateURL = 'wss://gate.biom.io:8090/websocket';

var options = {
  gateURL: developmentGateURL,
  appId: 'b0ced4ecb22ceb8ee0116804b2f87256',
  appKey: '-----BEGIN RSA PRIVATE KEY-----MIICX...',

  // probe - just handle "TRY" requests (auth requests)
  // hybrid - handle "TRY" requests and run auth request to other "probe"
  appType: 'hybrid',

  // optional parameters
  osId: 'linux',
  headerOid: 'clientHeader',
  devId: 'win_service_ldap_agent'
}

var conn = new BiomioNode(options);

conn.on('ready', function() {
  console.info('Connection to Gate is ready!');

  // call RPC method to start authentication
  runAuth();
});


function runAuth() {
  var rpcParams = {
    userId: 'user@gmail.com',                     // currently we use enduser's email
    sessionId: "SOME_USER_SESSION_ID",
    clientId: 'test.open.id.provider@gmail.com',  // hardcoded for now, it should goes from url request
    resources: {"front-cam": "640x480"}           // here we send to Gate our available resources
  };

  conn.rpc('auth', rpcParams, function (message) {

    switch (message.msg.rpcStatus) {
      case 'completed':
        console.log('Authentication is successful');

        break;
      case 'inprogress':
        console.log('Authentication in progress');

        break;
      case 'fail':
        console.error(message.msg.data.error);
        break;
      default:
        throw Error('Unhandled RPC status: ', message.msg.rpcStatus);
    }

  });
}
```