module.exports = {
  gateURL: process.env.GATE_URL,
  appId: process.env.APP_ID,
  appSecretFile: process.env.APP_SECRET_FILE,
  resources: [
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