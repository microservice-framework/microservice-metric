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
  metric: debugF('microservice-metrics:metric'),
  init: debugF('microservice-metrics:init'),
  handler: debugF('microservice-metrics:handler'),
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
    shutdown: hookShutdown,
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
var metricStorageReport = {}

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
    if (process.env.PUBLIC) {
      return callback(null)
    }
    if (requestDetails.headers['authorization']) {
      let auth = requestDetails.headers['authorization'].split(" " , 2)
      debug.validate('get request %O %s ', auth, process.env.SECURE_KEY)
      if (auth[1] && auth[1] == process.env.SECURE_KEY) {
        return callback(null)
      } else {
        debug.validate('not equal %s %s ', auth[1], process.env.SECURE_KEY)
      }
    }
    
  }

  return mservice.validate(method, jsonData, requestDetails, callback);
}

/**
 * Shutdown Handler. Executed in each worker
 */
function hookShutdown(timers){
  if (timers.intervalReset) {
    clearInterval(timers.intervalReset)
  }
  if (timers.startTimer) {
    clearTimeout(timers.startTimer)
  }
}
/**
 * Init Handler. Executed in each worker
 */
function hookInit(callback) {
  let timers = {}
  timers.intervalReset = setInterval(function(){
    let metricStorageCopy = metricStorage
    metricStorage = {}
    metricStorageReport = metricStorageCopy

  }, 60000) // drop report once in a minute ad reset storage
  
  // register handler
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
      cluster: mControlCluster
    });
  }
  timers.startTimer = setTimeout(function(){
    starHandler();
  }, 60000) // set timeout for one minute due to limitations of router
  
  callback(timers)
}


/**
 * SEARCH handler.
 */
function getMetrics(jsonData, requestDetails, callback) {
  debug.handler('metricStorage', metricStorageReport)
  let headers = {}
  if (requestDetails.headers['user-agent']) {
    headers['user-agent'] = requestDetails.headers['user-agent']
  }

  if (!Object.keys(metricStorageReport).length) {
    callback(null, {code: 404, answer: { message: "no data collected yet"}, headers: headers})
  }
  
  callback(null, {code: 200, answer: metricStorageReport, headers: headers})
}

/**
 * Process Metrics.
 */
function processMetrics(type, message) {
  if (type !== 'metric') {
    return
  }
  let metricName = 'unknown';
  if (message.jsonData.route) {
    metricName = message.jsonData.route
  }
  for (let name in message.jsonData.headers) {
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
    metricStorage[metricName].methods[metricMethod][message.jsonData.code] = {
      counter: 0,
      time: {
        min: 0,
        max: 0,
        total: 0
      }
    }
  }

  metricStorage[metricName].methods[metricMethod][message.jsonData.code].counter++
  let time = message.jsonData.endTime - message.jsonData.startTime
  if (time < metricStorage[metricName].methods[metricMethod][message.jsonData.code].time.min) {
    metricStorage[metricName].methods[metricMethod][message.jsonData.code].time.min = time
  }
  if (time > metricStorage[metricName].methods[metricMethod][message.jsonData.code].time.max) {
    metricStorage[metricName].methods[metricMethod][message.jsonData.code].time.max = time
  }
  metricStorage[metricName].methods[metricMethod][message.jsonData.code].time.total = +time


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
  debug.metric('data %O %O', jsonData, requestDetails)
  let message = {
    headers: requestDetails.headers,
    jsonData: jsonData 
  }
  mControlCluster.message('metric', message)
  callback(null, {code: 200, answer: {message: 'received'}})
}
