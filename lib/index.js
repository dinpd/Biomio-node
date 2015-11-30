'use strict';

var StateMachine = require('javascript-state-machine');
var EventEmitter = require("events").EventEmitter;
var util = require("util");
var WsWrapper = require('./wsWrapper');
var Schema = require('./schema');

util.inherits(Interface, EventEmitter);

StateMachine.create({
  initial: '_disconnected',
  target: Interface.prototype,
  error: function(eventName, from, to, args, errorCode, errorMessage) {
    console.info('FSM error:', eventName, from, to, args, errorCode, errorMessage);
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

function Interface(clientId, options) {
  EventEmitter.call(this);

  var self = this;
  self.clientId = clientId;
  self.options = options;
  self.rpcCallbacks = {};
  self.rpcPendingRequests = {};

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
  console.info('state:', event, from, to, msg);
  var self = this;

  self.ws.connect({url: self.options.gateURL});

  self.ws.on('connect', function() {
    self.ws.sendHandshakeRequest();
  });

  self.ws.on('message', function(message) {
    self.handleSocketMessage(message);
  });

  self.ws.on('error', function(error) {
    /* reconnect? */
    self.ws.reconnect();
  });

  self.ws.on('close', function() {
    console.info('WS: socket closed');
  });

  self.ws.on('connectFailed', function(error) {
    console.info('WS: socket connection failed ', error);
  });

};

Interface.prototype.onregister = function (event, from, to, msg) {
  console.info('state:', event, from, to, msg);
};

Interface.prototype.onhandshake = function (event, from, to, msg) {
  console.info('state:', event, from, to, msg);
  var self = this;

  self.ws.sendDigestRequest();
  self.ready('Handshake successful, going to READY.');
};

Interface.prototype.onready = function (event, from, to, msg) {
  console.info('state:', event, from, to, msg);
  var self = this;
  self.ws.startConnectionLoops();
  self.emit('ready');
};

Interface.prototype.ondisconnect = function (event, from, to) {
  console.info('state:', event, from, to);
  var self = this;
  self.ws.resetConnectionData();
  self.emit('disconnect');

  /* @todo: call pending requests */
  /* reconnect */
  self.connect('Reconnect');
};

Interface.prototype.handleSocketMessage = function(message) {
  var self = this;
  switch (message.msg.oid) {
    case 'bye':
      console.info("WS: <<< \n", JSON.stringify(data, null, 2));

      var reason = message.status || 'Unknown reason.';
      self.disconnect('Server sent bye, reason: ' + reason);

      if (reason.indexOf('Invalid token') != -1) {
        self.connect('Re-initializing socket connection due to invalid token error.');
      }

      break;
    case 'nop':
      self.ws.setTokens(message);
      break;
    case 'getResources':
      console.info("WS: <<< \n", JSON.stringify(message, null, 2));

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
        throw Error('State is not connected!');
      }

      break;
    case 'try':
      console.info("WS: <<< \n", JSON.stringify(message, null, 2));

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
            self.emit('try:'+ item.tType, item, function(err, data) {
              console.info('Try callback result: ', err, data);
              if (!err) {
                self.ws.sendTryRequest(data);
              }
            });
          }

          break;
        default:
          throw Error('Policy: ' + policy + ' is not recognized!');
      }

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

      console.info("WS: <<< \n", JSON.stringify(message, null, 2));

      if (self.is('_ready')) {
        if (!message.msg || !message.msg.session_id) {
          console.warn('RPC must return session_id!');
          break;
        }

        if (typeof self.rpcCallbacks[message.msg.session_id] == 'function') {
          self.rpcCallbacks[message.msg.session_id](message);
          delete self.rpcCallbacks[message.msg.session_id];
        } else {
          console.warn('RPC callback for session: '+ message.msg.session_id +' not found!');
        }
      }

      break;
    default:
      console.info("Unhandled request: <<< \n", JSON.stringify(message, null, 2));

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
  var sessionId = args[0];

  /* save command into pending requests */
  //self.rpcPendingRequests[]

  /* save callback */
  self.rpcCallbacks[sessionId] = callback;

  switch(command) {
    case 'auth':
      self.ws.sendAuthRequest(sessionId, args[1]);
      break;
    default:
      throw Error('RPC command ' + command + ' not found!');
  }

};


module.exports = Interface;