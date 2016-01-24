'use strict';

var StateMachine = require('javascript-state-machine');
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var debug = {
  debug: require('debug')('biomio:debug'),
  info: require('debug')('biomio:info'),
  log: require('debug')('biomio:log'),
  error: require('debug')('biomio:error')
};

var WsWrapper = require('./wsWrapper');
var Schema = require('./schema');

util.inherits(Interface, EventEmitter);

StateMachine.create({
  initial: '_disconnected',
  target: Interface.prototype,
  error: function(eventName, from, to, args, errorCode, errorMessage) {
    debug.error('FSM error:', eventName, from, to, args, errorCode, errorMessage);
    return 'event ' + eventName + ' was naughty :- ' + errorMessage;
  },
  events: [
    {name: 'connect', from: '_disconnected', to: '_connected'},
    {name: 'register', from: '_connected', to: '_handshake'},
    {name: 'handshake', from: '_connected', to: '_handshake'},
    {name: 'ready', from: ['_registration', '_handshake'], to: '_ready'},
    {name: 'disconnect', from: '*', to: '_disconnected'}
  ]
});

function Interface(options) {
  EventEmitter.call(this);

  var self = this;
  //self.clientId = clientId;
  self.options = options;
  self.rpcCallbacks = {};
  self.rpcPendingRequests = {};

  self.reconnectTimeout = options.reconnectTimeout || 10000; // 10 sec

  if (!options.appId || !options.appType) {
    throw Error('appId & appType are required!');
  }

  self.schema = new Schema({
    appId: options.appId,
    appType: options.appType,
    oid: options.oid || 'clientHeader',
    osId: options.osId || 'linux',
    devId: options.devId || 'node_js_lib'
  });

  self.ws = new WsWrapper({schema: self.schema});

  self.connect('Initial connect');
}


/**
 *  Establish connection
 */
Interface.prototype.onconnect = function (event, from, to, msg) {
  debug.info('state:', event, from, to, msg);
  var self = this;

  self.ws.removeAllListeners();
  self.ws.connect({url: self.options.gateURL});

  self.ws.on('connect', function() {
    self.ws.sendHandshakeRequest();
  });

  self.ws.on('message', function(message) {
    self.handleSocketMessage(message);
  });

  self.ws.on('error', function(error) {});

  self.ws.on('close', function() {
    self.disconnect();
  });

  self.ws.on('connectFailed', function(error) {
    if (!self.ws.connection.connected) {
      self.disconnect();
    }
  });

};

Interface.prototype.onregister = function (event, from, to, msg) {
  debug.info('state:', event, from, to, msg);
};

Interface.prototype.onhandshake = function (event, from, to, msg) {
  debug.info('state:', event, from, to, msg);
  var self = this;

  self.ws.sendDigestRequest();
  self.ready('Handshake successful, going to READY.');
};

Interface.prototype.onready = function (event, from, to, msg) {
  debug.info('state:', event, from, to, msg);
  var self = this;
  self.ws.startConnectionLoops();
  self.emit('ready');
};

Interface.prototype.ondisconnect = function (event, from, to, msg) {
  debug.info('state:', event, from, to, msg);
  var self = this;
  self.emit('disconnect');

  /* reconnect */
  setTimeout(function() {
    self.connect('Reconnect');
  }, self.reconnectTimeout);

};

Interface.prototype.handleSocketMessage = function(message) {
  var self = this;
  switch (message.msg.oid) {
    case 'bye':
      debug.info("WS: <<< \n", JSON.stringify(message, null, 2));

      var reason = message.status || 'Unknown reason.';
      self.disconnect('Server sent bye, reason: ' + reason);

      break;
    case 'nop':
      self.ws.setTokens(message);
      self.ws.nop--;
      break;
    case 'getResources':
      debug.info("WS: <<< \n", JSON.stringify(message, null, 2));

      self.emit('getResources', function(resources) {
        self.ws.sendResourcesRequest(resources);
      });

      break;
    case 'serverHello':
      if (self.is('_connected')) {
        message.app_id = self.options.appId;
        message.rsa_key = self.options.appKey;

        self.ws.setConnectionData(message);

        if ('key' in message.msg) {
          self.register('App was registered, sending ack.');
        } else {
          self.handshake('Sending digest.');
        }

      } else {
        debug.error('State is not connected!');
      }

      break;
    case 'try':
      debug.info("WS: <<< \n", JSON.stringify(message, null, 2));

      /** emit 'try' events with data for different tries  */
      var policy = message.msg.policy.condition;
      var resource = message.msg.resource;
      var tryId = message.msg.try_id;
      var sessionId = tryId.split('##')[1];

      /** parse policy and requested resources */
      switch (policy) {
        case 'all':
        case 'any':

          for(var i = 0; i < resource.length; i++) {
            var item = resource[i];
            item.tryId = tryId;
            item.sessionId = sessionId;
            item.policy = policy;

            (function(item) {
              self.emit('try:' + item.tType, item, function (err, answer) {
                debug.info("Try result: \n", err, item, answer);

                /* we must return answer as an array */
                if (!Array.isArray(answer)) {
                  answer = [answer];
                }

                var probeOid = "";
                switch(item.tType) {
                  case 'text_input': probeOid = "textInputSamples"; break;
                  case 'ldap_check': probeOid = "ldapCheckSamples"; break;
                  case 'face': probeOid = "imageSamples"; break;
                  default:
                    throw Error('Unhandled try type (tType) ', item.tType);
                }

                item.probeData = {};
                item.probeData.oid = probeOid;
                item.probeData.samples = answer;

                if (!err) {
                  self.ws.sendTryRequest(item);
                }
              });
            })(item);
          }

          break;
        default:
          throw Error('Policy: ' + policy + ' is not recognized!');
      }

      break;
    case 'probe':
      debug.info("WS: <<< \n", JSON.stringify(message, null, 2));
      break;
    case 'rpcResp':

      /* flatten key/value dictionary from response */
      if (message.msg && message.msg.data) {
        var inData = message.msg.data;
        message.msg.data = {};

        for (var i = 0; i < inData['keys'].length; i++) {
          message.msg.data[inData['keys'][i]] = inData['values'][i];
        }
      }

      debug.info("WS: <<< \n", JSON.stringify(message, null, 2));

      if (self.is('_ready')) {
        if (!message.msg || !message.msg.session_id) {
          debug.error('RPC must return session_id!');
          break;
        }

        if (typeof self.rpcCallbacks[message.msg.session_id] == 'function') {
          self.rpcCallbacks[message.msg.session_id](message);
          delete self.rpcCallbacks[message.msg.session_id];
        } else {
          debug.error('RPC callback for session: '+ message.msg.session_id +' not found!');
        }
      }

      break;
    default:
      debug.error("Unhandled request: <<< \n", JSON.stringify(message, null, 2));

  }
};

/**
 * Call RPC command
 * @param command
 */
Interface.prototype.rpc = function() {
  var self = this;

  // retrieve arguments as array
  var args = [];
  for (var i = 0; i < arguments.length; i++) {
    args.push(arguments[i]);
  }
  var command = args.shift();
  var callback = args.pop();
  var params = args[0];
  var sessionId = params.sessionId;
  var clientId = params.clientId;
  var resources = params.resources;

  /* save command into pending requests */
  //self.rpcPendingRequests[]

  /* save callback */
  self.rpcCallbacks[sessionId] = callback;

  switch(command) {
    case 'auth':
      self.ws.sendAuthRequest(sessionId, clientId, resources);
      break;
    default:
      throw Error('RPC command ' + command + ' not found!');
  }

};

module.exports = Interface;