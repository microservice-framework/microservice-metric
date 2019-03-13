const MicroserviceClient = require('@microservice-framework/microservice-client');

require('dotenv').config();

var client = new MicroserviceClient({
  URL: process.env.SELF_URL,
  secureKey: process.env.SECURE_KEY
});

let apiname = 'unknow'
if (process.env.NAME) {
  apiname = process.env.NAME 
}

let metricName = 'mfwapi_requests_total'
console.log('#HELP ' + metricName + ' The total numbers of mfwapi requests')
console.log('#TYPE ' + metricName + ' counter')

client.search({ }, function(err, handlerResponse){
  //console.log(handlerResponse)
  for (let name in handlerResponse) {
    for (let method in handlerResponse[name].methods) {
      for (let code in handlerResponse[name].methods[method]) {
        let count = handlerResponse[name].methods[method][code]
        let statLine = metricName + '{'
          + 'name="' + apiname + '"'
          + ',path="' + name + '"'
          + ',method="' + method + '"'
          + ',code="' + code + '"'

          + '} ' + count ;
          console.log(statLine)
      }
    }
  }
});
