'use strict';
var WebSocketClient = require('websocket').client;
var util = require("util");
var EventEmitter = require("events").EventEmitter;
var rsaSign = require('jsrsasign');
var debug = {
  debug: require('debug')('biomio:debug'),
  info: require('debug')('biomio:info'),
  log: require('debug')('biomio:log'),
  error: require('debug')('biomio:error')
};
var keep_alive_interval;
var refresh_token_interval;

function Ws(options) {
  EventEmitter.call(this);

  var self = this;
  self.keepAliveInterval = options.keepAliveInterval || 4000;
  self.closeConnectionAfterFailedNops = 2;
  self.nop = 0;

  self.schema = options.schema;
  self.url = null;
  self.connection = {connected: false};
  self.client = new WebSocketClient();

  self.connectionData = {
    token: '',
    refresh_token: '',
    session_ttl: '',
    connection_ttl: '',
    rsa_key: '',
    app_id: ''
  };

  self.client.on('connectFailed', function (error) {
    debug.error('WS: Failed to connect to server:', error.toString());

    self.emit('connectFailed', error);
  });

  self.client.on('connect', function (connection) {
    self.connection = connection;
    self.nop = 0;

    self.emit('connect');

    self.connection.on('error', function (error) {
      debug.error('WS: Connection Error:', error.toString());
      self.emit('error', error);
    });

    self.connection.on('close', function () {
      debug.info('WS: Connection closed.', self.connection.connected);

      self.resetConnectionData();
      self.emit('close');
    });

    self.connection.on('message', function (message) {
      try {
        var data = message.utf8Data;
        data = JSON.parse(data);
      } catch (ex) {
        debug.error(ex);
      }

      self.emit('message', data);
    });

  });

}

util.inherits(Ws, EventEmitter);

Ws.prototype.send = function (request) {
  var self = this;

  if (self.connection.connected) {

    /* do not log nop */
    if (request.msg.oid !== 'nop') {
      debug.info("WS: >>> \n", request);
    }

    self.connection.sendUTF(JSON.stringify(request));

    self.schema.increaseRequestCounter();

    clearInterval(keep_alive_interval);
    self.keepAlive();
  } else {
    debug.error('WS: Socket is not connected!');
  }
};

Ws.prototype.setConnectionData = function(data) {
  this.connectionData.app_id = data.app_id;
  this.connectionData.rsa_key = data.rsa_key;
  this.connectionData.token = data.header.token;
  this.connectionData.refresh_token = data.msg.refreshToken;
  this.connectionData.session_ttl = data.msg.sessionttl * 1000;
  this.connectionData.connection_ttl = data.msg.connectionttl * 1000;
};

Ws.prototype.resetConnectionData = function() {
  var self = this;
  self.nop = 0;
  self.connection.connected = false;

  self.connectionData = {
    token: '',
    refresh_token: '',
    session_ttl: '',
    connection_ttl: ''
  };
};

Ws.prototype.sendHandshakeRequest = function() {
  var self = this;
  self.send(self.schema.getHandshakeRequest());
};

Ws.prototype.sendDigestRequest = function() {
  var self = this;
  var rsaKey = new rsaSign.RSAKey();
  rsaKey.readPrivateKeyFromPEMString(self.connectionData.rsa_key);

  var signature = rsaKey.signString(JSON.stringify(self.schema.getHeader(self.connectionData.token)), 'sha1');

  var request = self.schema.getDigestRequest(signature, self.connectionData.token);
  self.send(request);
};

Ws.prototype.sendNopRequest = function(token) {
  var self = this;
  self.nop ++;
  self.send(self.schema.getNopRequest(token));
};

Ws.prototype.sendResourcesRequest = function(resources) {
  var self = this;
  self.send(self.schema.getResourcesRequest(self.connectionData.token, resources));
};

Ws.prototype.sendAuthRequest = function(sessionId, clientId, userId, resources) {
  var self = this;
  var request = self.schema.getAuthRequest(self.connectionData.token, userId, sessionId, resources, {email: clientId, auth_code: 'NO_REST'});
  self.send(request);
};

Ws.prototype.sendCancelAuthRequest = function(sessionId, clientId, userId, resources) {
  var self = this;
  var request = self.schema.getCancelAuthRequest(self.connectionData.token, userId, sessionId, resources, {email: clientId, auth_code: 'NO_REST'});
  self.send(request);
};

Ws.prototype.sendGetWebResourceSecretRequest = function(sessionId, clientId, userId, resources) {
  var self = this;
  var request = self.schema.getGetWebResourceSecretRequest(self.connectionData.token, userId, sessionId, resources, {web_resource_id: clientId});
  self.send(request);
};

Ws.prototype.sendGetUserRequest = function(sessionId, userId, resources) {
  var self = this;
  var request = self.schema.getGetUserRequest(self.connectionData.token, userId, sessionId, resources, {})
  self.send(request);
};

Ws.prototype.sendCheckUserRequest = function(sessionId, clientId, userId, resources) {
  var self = this;
  var request = self.schema.getCheckUserRequest(self.connectionData.token, clientId, sessionId, resources, {email: userId, auth_code: 'NO_REST'});
  self.send(request);
};

Ws.prototype.sendTryRequest = function(result) {
  var self = this;
  var request = self.schema.getTryRequest(self.connectionData.token, result);
  self.send(request);
};

Ws.prototype.connect = function (options) {
  var self = this;
  self.url = options.url;

  if (self.connection.connected) {
    self.connection.drop();
  }

  self.resetConnectionData();

  self.client.connect(options.url);
};

/**
 * Keep connection alive
 */
Ws.prototype.keepAlive = function () {
  var self = this;
  /* check the count of failed NOPs */
  if (self.nop >= self.closeConnectionAfterFailedNops) {
    debug.info('limit of failed nops');
    self.resetConnectionData();
    self.connection.drop();
  }

  if (self.connectionData.connection_ttl > 0) {
    keep_alive_interval = setInterval(function () {
      debug.debug('WS: Keep Alive nop');
      if (self.connection.connected) {
        self.sendNopRequest(self.connectionData.token);
      } else {
        clearInterval(keep_alive_interval);
      }
    }, (self.connectionData.connection_ttl - self.keepAliveInterval));
  }
};

/**
 * Refresh session token
 */
Ws.prototype.refreshToken = function () {
  var self = this;

  if (self.connectionData.session_ttl > 0) {
    refresh_token_interval = setInterval(function () {
      debug.debug('WS: Refresh Token nop');
      if (self.connection.connected) {
        self.sendNopRequest(self.connectionData.refresh_token);
      } else {
        clearInterval(refresh_token_interval);
      }
    }, (self.connectionData.session_ttl - self.keepAliveInterval));
  }
};

Ws.prototype.startConnectionLoops = function () {
  var self = this;
  debug.debug('start_connection_loops');
  clearInterval(refresh_token_interval);
  clearInterval(keep_alive_interval);
  self.keepAlive();
  self.refreshToken();
};

Ws.prototype.setTokens = function (data) {
  var self = this;
  if (self.connectionData.token != data.header.token) {
    self.connectionData.token = data.header.token;
    clearInterval(refresh_token_interval);
    self.refreshToken();
  }
};

module.exports = Ws;
