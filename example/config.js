module.exports = {
  gateURL: "wss://gate.biom.io:8090/websocket",
  appId: "32ec6214f5b17ecf769d9d2a6c179742",
  resources: [
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
}