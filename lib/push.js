'use strict';
const Q = require('q'),
  _ = require('lodash'),
  config = require('./config'),
  assertQueue = require('./assertQueue'),
  BSON = require('bson');

/**
 * @routeName
 * @connection
 */
/**
 *
 * @param routeName
 * @param connection
 * @returns {*}
 * @constructor
 */
function Push(routeName, connection) {
  var vm = this;

  this.routeName = routeName;
  this.connection = connection;
  vm.timeToLive = _.get(config[routeName], 'timeToLive');

  return Q.resolve(vm);
}


/**
 * @data: json object
 */
Push.prototype.sendPush = function (data) {
  var vm = this;

  var channelWrapper = vm.connection.createChannel({
    setup: function (channel) {
      return assertQueue.workerQueue(channel, vm.routeName);
    }
  });

  return Q.fcall(() => {
    const bson = new BSON();
    return channelWrapper.sendToQueue(vm.routeName, bson.serialize(data));
  }).catch((err) => {
    console.error('error send messaging', err);
  }).then(() => {
    channelWrapper.close();
    return Q.resolve(vm);
  });
};

function generateUuid() {
  return Math.random().toString() +
    Math.random().toString() +
    Math.random().toString();
}

/**
 * @reterns promise of {
 *   success:true/false if worker truly called
 *   result: anything returned from worker
 * }
 */
Push.prototype.rpcCall = function (data) {
  const deferred = Q.defer(),
    vm = this,
    correlationId = generateUuid();
  let timeout;
  let isClosed = false;
  let isSent = false;
  // eslint-disable-next-line prefer-const
  let channelWrapper;

  const resolve = function (data) {
    if (!isClosed) {
      channelWrapper.close();
      isClosed = true;
    }
    deferred.resolve(data);
  };

  const reject = function (err) {
    if (!isClosed) {
      channelWrapper.close();
      isClosed = true;
    }
    deferred.reject(err);
  };

  channelWrapper = vm.connection.createChannel({
    setup: function (channel) {
      return Q.fcall(() => {
        return assertQueue.workerQueue(channel, vm.routeName);
      }).then(() => {
        return assertQueue.replyQueue(channel, vm.routeName);
      }).then((q) => {
        const replyName = q.queue;

        channel.consume(replyName, (msg) => {
          var corrId = _.get(msg, 'properties.correlationId', false);
          if (corrId === correlationId) {
            if (timeout) {
              clearTimeout(timeout);
            }
            channel.ack(msg);
            var parsed;

            try {
              const bson = new BSON();

              parsed = bson.deserialize(msg.content, {
                promoteBuffers: true
              });
            } catch (e) {
              console.log('messaging:error parsing rpc call response', {
                routeName: replyName,
                error: e,
                incomingmsg: msg
              });
            }
            if (_.get(parsed, 'success')) {
              resolve(_.get(parsed, 'result'));
            } else {
              reject(_.get(parsed, 'result'));
            }
          } else {
            channel.nack(msg);
          }
        });
        // Send to Queue:
        // no need to catch the result:
        if (!isSent) {
          Q.fcall(() => {
            isSent = true; // it ensures that messages is sent only once if amqp connection restarted

            const bson = new BSON();
            const deferIsSent = Q.defer();

            Q.fcall(() => {
              return channel.sendToQueue(
                vm.routeName,
                bson.serialize(data), {
                  correlationId: correlationId,
                  replyTo: replyName
                }
              );
            }).catch(() => {
              console.error('amqp: error in connection sendToQueue rpc call');
              deferIsSent.reject();
            }); // no need to return promise, due to error in stability of if not connect
            if (vm.timeToLive > 0) {
              timeout = setTimeout(() => {
                console.log('error', `Timeout had happened and replied queue "${replyName}" has been closed`);
                Q.fcall(() => {
                  return channel.deleteQueue(replyName);
                }).finally(() => {
                  deferred.reject('timeout');
                  deferIsSent.resolve();
                });
              }, vm.timeToLive);
            } else {
              deferIsSent.resolve();
            }
            return deferIsSent.promise;
          }).catch((err) => {
            console.error('rpccall send queue fail', err);
            reject(err);
          });
        }
      });
    }
  });

  return deferred.promise;
};



module.exports = Push;