'use strict';
var WebSocketClient = require('websocket').client;
var util = require("util");
var EventEmitter = require("events").EventEmitter;
var rsaSign = require('jsrsasign');
var keep_alive_interval;
var refresh_token_interval;

function Ws(options) {
  EventEmitter.call(this);

  var self = this;
  self.keepAliveInterval = 4000;

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
    console.warn('WS: Failed to connect to server:', error.toString());
    self.emit('connectFailed', error);
  });

  self.client.on('connect', function (connection) {
    self.connection = connection;

    self.emit('connect');

    self.connection.on('error', function (error) {
      console.warn('WS: Connection Error:', error.toString());
      self.emit('error', error);
    });

    self.connection.on('close', function () {
      console.info('WS: Connection closed.');
      self.emit('close');
    });

    self.connection.on('message', function (message) {
      try {
        var data = message.utf8Data;
        data = JSON.parse(data);
        //console.info("WS: <<< \n", data);
      } catch (ex) {
        console.error(ex);
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
      console.info("WS: >>> \n", request);
    }

    self.connection.sendUTF(JSON.stringify(request));
    self.schema.increaseRequestCounter();

    clearInterval(keep_alive_interval);
    self.keepAlive();
  } else {
    console.warn('WS: Socket is not connected!');
  }
};

Ws.prototype.setConnectionData = function(data) {
  this.connectionData.app_id = data.app_id;
  this.connectionData.rsa_key = data.rsa_key;
  this.connectionData.token = data.header.token;
  this.connectionData.refresh_token = data.msg.refreshToken;
  this.connectionData.session_ttl = data.msg.sessionttl * 1000;
  this.connectionData.connection_ttl = data.msg.connectionttl * 1000;
  //console.info("connection data: \n", this.connectionData);
};

Ws.prototype.resetConnectionData = function() {
  var self = this;

  if(self.connection.connected){
    self.client.close();
  }

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
  self.send(self.schema.getNopRequest(token));
};

Ws.prototype.sendResourcesRequest = function(resources) {
  var self = this;
  self.send(self.schema.getResourcesRequest(self.connectionData.token, resources));
};

Ws.prototype.sendAuthRequest = function(sessionId, clientId) {
  var self = this;
  var request = self.schema.getAuthRequest(self.connectionData.token, clientId, sessionId, {email: clientId, auth_code: 'NO_REST'})
  self.send(request);
};

Ws.prototype.sendTryRequest = function(result) {
  var self = this;
  var request = self.schema.getTryRequest(self.connectionData.token, result);
  //console.info('AA', request);
  self.send(request);
};

Ws.prototype.connect = function (options) {
  var self = this;
  self.url = options.url;
  self.client.connect(options.url);
};

Ws.prototype.reconnect = function() {
  var self = this;
  if (!self.url) {
    throw Error('Websocket: connection URL does not set!');
  }
  self.client.connect(self.url);
};

/**
 * Keep connection alive
 */
Ws.prototype.keepAlive = function () {
  var self = this;

  if (self.connectionData.connection_ttl > 0) {
    keep_alive_interval = setInterval(function () {
      console.info('WS: Keep Alive nop');
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
      console.info('WS: Refresh Token nop');
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
  //console.info('start_connection_loops');
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