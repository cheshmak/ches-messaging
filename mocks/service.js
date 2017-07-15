'use strict';
var push = require('./push'),
  Q = require('q'),
  _ = require('lodash');

/**
 * @param dataToReturn : {routeName:{}}
 * @returns {service}
 */
module.exports = (dataToReturn) => {
  var service = function () {
    return Q.resolve(this);
  };
  service.prototype.connect = function () {
    return Q.resolve();
  };
  service.prototype.isConnectionAvailable = function () {
    return true;
  };
  service.prototype.addWorker = function () {
    return Q.resolve();
  };
  service.prototype.getPushProvider = function (name) {
    return new push(_.isObject(dataToReturn) ? dataToReturn[name] : {});
  };
  return service;
};