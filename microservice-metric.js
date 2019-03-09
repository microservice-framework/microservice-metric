'use strict';

const framework = '@microservice-framework';
const Cluster = require(framework + '/microservice-cluster');
const Microservice = require(framework + '/microservice');
const MicroserviceRouterRegister = require(framework + '/microservice-router-register').register;
const clientViaRouter = require(framework + '/microservice-router-register').clientViaRouter;

const Octokit = require('@octokit/rest')

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
  callback(null, {code: 200, asnwer: {message: 'test'}})
}


/**
 * Process Metrics.
 */
function processMetrics(message) {
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

}
