'use strict';
const net = require('net');
const zookeeper = require('node-zookeeper-client');

function consoleDebug(msg, args) {
  // console.log(msg, args)
}

// Performs the "ruok" - "imok" health check
function zookeeperHealthCheck(port) {
  return new Promise((resolve, reject) => {
    const connection = net.connect({port});
    connection.setEncoding('utf8');
    connection.setTimeout(1000);
    connection.on('error', err => {
      connection.unref();
      reject(new Error('Connection error', err));
    });
    connection.on('data', data => {
      connection.unref();
      if (data === 'imok') {
        resolve();
      } else {
        reject(new Error(`Expected "imok" from health check, but got ${data}`));
      }
    });

    connection.on('timeout', () => {
      connection.unref();
      reject(new Error('Zookeeper connection timed out.'));
    });

    connection.write('ruok');
    connection.end();
  });
}


function kafkaHealthCheck(zkPort, elapsed) {
  consoleDebug('Run Kafka health check against ZK on port '+zkPort);
  consoleDebug('Elapsed', elapsed);
  return new Promise((resolve, reject) => {
    let timeout;
    try {
      const client = zookeeper.createClient('localhost:'+zkPort, {
        sessionTimeout: 1000,
        spinDelay : 1000,
        retries : 0
      });

      timeout = setTimeout(() => {
        client.close();
        consoleDebug('kafka health check failed after timeout', elapsed);
        reject(new Error('Connection timeout'));
      }, 1000);

      client.once('connected', function () {
        consoleDebug('Connected to the server.');
        client.exists('/brokers', () => {}, (error, stat) => {
          if (error) {
            consoleDebug('kafka health check failed', elapsed);
            clearTimeout(timeout);
            client.close();
            reject(error);
          } else if (!stat) {
            consoleDebug('kafka health check failed', elapsed);
            clearTimeout(timeout);
            client.close();
            reject(new Error('The /brokers path doesnt exist in ZooKeeper yet'));
          } else {
            client.exists('/brokers/ids', () => {}, (error, stat) => {
              if (error) {
                consoleDebug('kafka health check failed', elapsed);
                clearTimeout(timeout);
                client.close();
                reject(error);
              } else if (!stat) {
                consoleDebug('kafka health check failed', elapsed);
                clearTimeout(timeout);
                client.close();
                reject(new Error('The /brokers/ids path doesnt exist in ZooKeeper yet'));
              } else {
                client.getChildren('/brokers/ids', event => consoleDebug('got event', event), (error, children) => {
                  client.close();
                  if (error) {
                    consoleDebug('kafka health check failed', elapsed);
                    clearTimeout(timeout);
                    reject(error);
                  } else {
                    if (children.length > 0) {
                      consoleDebug('kafka test passed', elapsed);
                      clearTimeout(timeout);
                      resolve();
                    } else {
                      consoleDebug('kafka health check failed', elapsed);
                      clearTimeout(timeout);
                      reject(new Error('There are no kafka brokers registered in ZooKeeper.'));
                    }
                  }
                });
              }
            });
          }
        });
      });
      client.connect();


    } catch(error) {
      consoleDebug('kafka health check failed catch ex', elapsed);
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    }
  });
}

function waitPromise(length) {
  return new Promise((resolve) => {
    consoleDebug(`Now waiting for ${length} ms.`);
    setTimeout(() => {
      resolve();
    }, length);
  });
}

function waitForCheck(check, timeout=60000, waitBetweenRetries = 1000, elapsed=0) {
  if (elapsed > timeout) {
    return Promise.reject({});
  } else {
    return check(elapsed).then(() => consoleDebug('ok'))
      .catch(() => {
        return waitPromise(waitBetweenRetries)
          .then(() => waitForCheck(check, timeout, waitBetweenRetries, elapsed + waitBetweenRetries));
      });
  }
}

module.exports = {
  zookeeperHealthCheck,
  kafkaHealthCheck,
  waitPromise,
  waitForCheck
};
