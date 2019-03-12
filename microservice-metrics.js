'use strict';

const framework = '@microservice-framework';
const Cluster = require(framework + '/microservice-cluster');
const Microservice = require(framework + '/microservice');
const MicroserviceRouterRegister = require(framework + '/microservice-router-register').register;
const clientViaRouter = require(framework + '/microservice-router-register').clientViaRouter;

require('dotenv').config();

const debugF = require('debug');

var debug = {
  log: debugF('microservice-metrics:log'),
  validate: debugF('microservice-metrics:validate'),
  debug: debugF('microservice-metrics:debug')
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
  cluster: mControlCluster
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
    debug.validate('get request %O', requestDetails)
    if(process.env.PUBLIC) {
      return callback(null)
    }
    if (requestDetails.headers['authorization']) {
      let auth = requestDetails.headers['authorization'].split(" " , 2)
      debug.validate('get request %O %s ', auth, process.env.SECURE_KEY)
      if(auth[1] && auth[1] == process.env.SECURE_KEY) {
        return callback(null)
      } else {
        debug.validate('not equal %s %s ', auth[1], process.env.SECURE_KEY)
      }
    }
    
  }

  return mservice.validate(method, jsonData, requestDetails, callback);
}

/**
 * Init Handler. Executed in each worker
 */
function hookInit(cluster) {
  // load exists metrics if available.
  let starHandler = function(){
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
  clientViaRouter(process.env.SELF_PATH, function(err, metricServer) {
    if (err) {
      debug.debug('clientViaRouter %s err %O', process.env.SELF_PATH, err)
      return starHandler();
    }
    metricServer.search({}, function(err, answer){
      if(err) {
        debug.debug('metricServer.search err %O %O', err, answer)
        return starHandler();
      }
      if(typeof answer == "object") {
        metricStorage = answer
      }
      starHandler();
    });
  });
}

/**
 * SEARCH handler.
 */
function getMetrics(jsonData, requestDetails, callback) {
  callback(null, {code: 200, answer: metricStorage, headers: {
    'user-agent': requestDetails.headers['user-agent']
  }})
}

/**
 * Process Metrics.
 */
function processMetrics(type, message) {
  if(type !== 'metric') {
    return
  }
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
  mControlCluster.message('metric', message)
  callback(null, {code: 200, answer: {message: 'received'}})
}
