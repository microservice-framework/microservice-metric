'use strict';

const framework = '@microservice-framework';
const Cluster = require(framework + '/microservice-cluster');
const Microservice = require(framework + '/microservice');
const MicroserviceRouterRegister = require(framework + '/microservice-router-register').register;


require('dotenv').config();

const debugF = require('debug');

var debug = {
  log: debugF('microservice-metric:log'),
  debug: debugF('microservice-metric:debug')
};


var mservice = new Microservice({
  secureKey: process.env.SECURE_KEY,
  schema: process.env.SCHEMA
});

var mControlCluster = new Cluster({
  pid: process.env.PIDFILE,
  port: process.env.PORT,
  hostname: process.env.HOSTNAME,
  count: process.env.WORKERS,
  callbacks: {
    init: hookInit,
    validate: hookValidate,
    NOTIFY: hookNOTIFY,
    GET: getMetrics,
    SEARCH: getMetrics,
    IPM: processMetrics,
    OPTIONS: mservice.options
  }
});

var metricStorage = {}

/**
 * Validate handler.
 */
function hookValidate(method, jsonData, requestDetails, callback) {
  // Ignore access token
  
  if (method == 'NOTIFY'){
    if (requestDetails.headers.access_token) {
      delete requestDetails.headers.access_token
    }
    if (requestDetails.headers['access-token']) {
      delete requestDetails.headers['access-token']
    }
    if (requestDetails.headers['x-hook-signature']) {
      requestDetails.headers.signature = requestDetails.headers['x-hook-signature']
    }
    return mservice.validate('POST', jsonData, requestDetails, callback);
  }

  if (method == 'GET'){
    if(process.env.PUBLIC) {
      return callback(null)
    }
    if (requestDetails.headers['authorization']) {
      let auth = requestDetails.headers['authorization'].split(" " , 2)
      if(auth[1] && auth[1] == process.env.SECURE_KEY) {
        return callback(null)
      }
    }
    
  }

  return mservice.validate(method, jsonData, requestDetails, callback);
}

/**
 * Init Handler.
 */
function hookInit(cluster, worker, address) {
  if (worker.id == 1) {
    var mserviceRegister = new MicroserviceRouterRegister({
      server: {
        url: process.env.ROUTER_URL,
        secureKey: process.env.ROUTER_SECRET,
        period: process.env.ROUTER_PERIOD,
      },
      route: {
        type: 'metric',
        url: process.env.SELF_URL,
        secureKey: process.env.SECURE_KEY,
        online: true,
        meta: true,
      },
      cluster: cluster
    });
    // register this one on 1 min+ later to have one min stats for sure.
    var mserviceRegister = new MicroserviceRouterRegister({
      server: {
        url: process.env.ROUTER_URL,
        secureKey: process.env.ROUTER_SECRET,
        period: process.env.ROUTER_PERIOD,
      },
      route: {
        type: 'handler',
        path: [process.env.SELF_PATH],
        url: process.env.SELF_URL,
        secureKey: process.env.SECURE_KEY,
        online: true,
      },
      cluster: cluster
    });
  }
}

/**
 * SEARCH handler.
 */
function getMetrics(jsonData, requestDetails, callback) {
  if(requestDetails.url == 'prometheus') {
    return callback(null, {code: 200, answer: prometheus_export(), headers: {'content-type': 'text/plain'}})
  }
  callback(null, {code: 200, answer: metricStorage})
}

/**
 * SEARCH handler.
 */
function prometheus_export(){
  let metricName = 'mfwapi_requests_total'
  let apiname = process.env.NAME
  let answer = '#HELP ' + metricName + ' The total numbers of mfwapi requests' + "\n"
  answer += '#TYPE ' + metricName + ' counter' + "\n"
  for(let name in metricStorage) {
    for(let method in metricStorage[name].methods) {
      for(let code in metricStorage[name].methods[method]) {
        let count = metricStorage[name].methods[method][code]
        let statLine = metricName + '{'
          + 'name="' + apiname + '"'
          + ',path="' + name + '"'
          + ',method="' + method + '"'
          + ',code="' + code + '"'

          + '} ' + count + "\n";
        answer += statLine
      }
    }
  }
  return answer;
}

/**
 * Process Metrics.
 */
function processMetrics(message) {
  let metricName = 'unknown';
  if (message.jsonData.route) {
    metricName = message.jsonData.route
  }
  for(let name in message.jsonData.headers) {
    if (name.substr(0, 4) == 'mfw-') {
      let pathname = name.substr(4)
      let value = message.jsonData.headers[name]
      metricName = metricName.replace(value, ':' + pathname);
    }
  }
  if (message.jsonData.headers['x-hook-type']) {
    metricName += ':' + message.jsonData.headers['x-hook-type']
  }
  if (message.jsonData.headers['x-hook-phase']) {
    metricName += ':' + message.jsonData.headers['x-hook-phase']
  }
  if (message.jsonData.headers['x-hook-group']) {
    metricName += ':' + message.jsonData.headers['x-hook-group']
  }
  if (!metricStorage[metricName]) {
    metricStorage[metricName] = {
      methods: {},
    }
  }
  let metricMethod = 'unknown'
  if (message.jsonData.method) {
    metricMethod = message.jsonData.method
  }
  if (!metricStorage[metricName].methods[metricMethod]){
    metricStorage[metricName].methods[metricMethod] = {}
  }

  if (!metricStorage[metricName].methods[metricMethod][message.jsonData.code]) {
    metricStorage[metricName].methods[metricMethod][message.jsonData.code] = 0
  }

  metricStorage[metricName].methods[metricMethod][message.jsonData.code]++

}

/**
 * Proxy NOTIFY requests.
 */
function hookNOTIFY(jsonData, requestDetails, callback) {
  try {
    mservice.validateJson(jsonData);
  } catch (e) {
    return callback(e, null);
  }
  debug.debug('data %O %O', jsonData, requestDetails)
  let message = {
    headers: requestDetails.headers,
    jsonData: jsonData 
  }
  process.send(JSON.stringify(message));
  callback(null, {code: 200, answer: {message: 'received'}})
}
