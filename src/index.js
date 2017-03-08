'use strict';
const spawn = require('child_process').spawn;
const path = require('path');
const StringDecoder = require('string_decoder').StringDecoder;
const fs = require('fs');
const tmp = require('tmp');
const portfinder = require('portfinder');
const createEditor = require('properties-parser').createEditor;
const healthCheck = require('./healthCheck');
const zookeeperHealthCheck = healthCheck.zookeeperHealthCheck;
const kafkaHealthCheck = healthCheck.kafkaHealthCheck;
const waitForCheck = healthCheck.waitForCheck;
const waitPromise = healthCheck.waitPromise;

const isWindows = process.platform === 'win32';
const decoder = new StringDecoder('utf8');
tmp.setGracefulCleanup();

const zkPropertiesFile = path.join(__dirname, '..', 'kafka', 'config', 'zookeeper.properties');
const kafkaPropertiesFile = path.join(__dirname, '..', 'kafka', 'config', 'server.properties');

function consoleDebug(msg, args) {
  if (process.env['KAFKA_PLEASE_LOG'] === 'verbose') {
    console.log(msg, args)
  }
}

const takenPorts = [];
portfinder.basePort = 18000;
function portPromise() {
  return new Promise((resolve, reject) => {
    function getPortRecursive(callback) {
      portfinder.getPort((err, port) => {
        if (err) {
          callback(err, null);
        } else {
          if (takenPorts.indexOf(port) !== -1) {
            getPortRecursive(callback);
          } else {
            callback(null, port);
          }
        }
      });
    }
    getPortRecursive((err, port) => {
      if (err) {
        reject(err);
      } else {
        consoleDebug('available port', port);
        resolve(port);
      }
    });
  });
}

function portsPromise() {
  return new Promise((resolve, reject) => {
    portfinder.getPorts(2, {}, (err, ports) => {
      if (err) {
        return reject(err);
      }

      const zkPort = ports[0];
      const kafkaPort = ports[1];
      
      resolve({zkPort, kafkaPort});
    });
  })
}

function tmpDirPromise(prefix) {
  // return Promise.resolve('C:\\'+prefix+'tmp');

  return new Promise((resolve, reject) => {
    tmp.dir({prefix, unsafeCleanup: true}, (err, path) => {
      if (err) {
        reject(err);
      } else {
        resolve(path);
      }
    });
  });
}

function copyFile(source, target) {
  consoleDebug('copy file', source);
  consoleDebug('target', target);
  return new Promise(function(resolve, reject) {
    var rd = fs.createReadStream(source);
    rd.on('error', reject);
    var wr = fs.createWriteStream(target);
    wr.on('error', reject);
    wr.on('finish', resolve);
    rd.pipe(wr);
  });
}

function makeZookeeperConfigFile(zkData) {
  const zkDir = zkData.zkDir;
  const zkPort = zkData.zkPort;
  consoleDebug('zkport', zkPort);
  return new Promise((resolve, reject) =>
    createEditor(zkPropertiesFile, {}, (err, props) => {
      if (err) {
        return reject(err);
      }

      props.set('dataDir', zkDir.replace(/\\/g, '\\\\'));
      props.set('clientPort', zkPort.toString());
      props.set('zookeeper.log.dir', zkDir.replace(/\\/g, '\\\\'));
      const finalName = path.join(zkDir, 'zookeeper.properties');
      props.save(finalName, () => resolve(zkDir));
    })
  );
}

function makeKafkaConfigFile(configData) {
  const kafkaDir = configData.kafkaDir;
  const zkPort = configData.zkPort;
  const kafkaPort = configData.kafkaPort;
  consoleDebug('making kafka config file', kafkaDir);
  return new Promise((resolve, reject) =>
    createEditor(kafkaPropertiesFile, {}, (err, props) => {
      if (err) {
        return reject(err);
      }

      props.set('log.dirs', kafkaDir.replace(/\\/g, '\\\\'));
      props.set('port', kafkaPort.toString());
      props.set('listeners', 'PLAINTEXT://:'+kafkaPort);
      props.set('zookeeper.connect', '127.0.0.1:' + zkPort);
      const finalName = path.join(kafkaDir, 'server.properties');
      props.save(finalName, () => resolve(kafkaDir));
    })
  );
}

function startZookeeper(zkConfig) {
  const zkDir = zkConfig.zkDir;
  const zkPort = zkConfig.zkPort;
  const configFile = path.join(zkDir, 'zookeeper.properties');
  const kafkaLog4jOpts = "-Dlog4j.configuration=file:"+path.join(__dirname, 'log4j-stdout.properties') // .replace(/\\/g, '\\\\');
  // const kafkaLog4jOpts = "-Dlog4j.configuration="+path.join(zkDir, 'log4j.properties') // .replace(/\\/g, '\\\\');
  const env = Object.assign({}, process.env, {KAFKA_LOG4J_OPTS: kafkaLog4jOpts, LOG_DIR: zkDir});
  const mainClass = 'org.apache.zookeeper.server.quorum.QuorumPeerMain';
  let proc;
  if (isWindows) {
    const script = path.join(__dirname, '..', 'kafka', 'bin', 'windows', 'kafka-run-class.bat');
    consoleDebug(`launching ${script}`);
    proc = spawn(script, [mainClass, configFile], {cwd: zkDir, env});
  } else {
    const script = path.join(__dirname, '..', 'kafka', 'bin', 'kafka-run-class.sh');
    consoleDebug(`launching ${script}`);
    proc = spawn(script, [mainClass, configFile], {cwd: zkDir, env, shell: 'bash'});
  }

  proc.stdout.on('data', (data) => {
    consoleDebug('STDOUT ZOOKEEPER: ' + decoder.write(data));
  });

  proc.stderr.on('data', (data) => {
    consoleDebug('STDERR ZOOKEEPER: ' + decoder.write(data));
  });

  proc.on('exit', (code) => {
    consoleDebug(`Child exited with code ${code}`);
  });

  return waitForCheck(() => zookeeperHealthCheck(zkPort), 30000).then(() => {
    return {
      port: zkPort,
      close: () => {
        return killPromise(proc).then(stopZookeeper);
      }
    }
  });
}

function stopKafka() {
  consoleDebug('Stopping kafka...');
  return new Promise((resolve, reject) => {
    let proc;
    if (isWindows) {
      const script = path.join(__dirname, '..', 'kafka', 'bin', 'windows', 'kafka-server-stop.bat');
      proc = spawn(script);
    } else {
      const script = path.join(__dirname, '..', 'kafka', 'bin', 'kafka-server-stop.sh');
      proc = spawn(script);
    }
    proc.on('exit', resolve);
  });
}

function stopZookeeper() {
  consoleDebug('Stopping zookeeper...');
  return new Promise((resolve, reject) => {
    let proc;
    if (isWindows) {
      const script = path.join(__dirname, '..', 'kafka', 'bin', 'windows', 'zookeeper-server-stop.bat');
      proc = spawn(script);
    } else {
      const script = path.join(__dirname, '..', 'kafka', 'bin', 'zookeeper-server-stop.sh');
      proc = spawn(script);
    }
    proc.on('exit', resolve);
  });
}

function killPromise(proc) {
  return new Promise((resolve, reject) => {
    proc.on('exit', (code) => {consoleDebug(`The process exited. Code ${code}. Resolve promise.`);resolve();});
    proc.kill('SIGKILL');
  });
}

function startKafka(configData) {
  const kafkaDir = configData.kafkaDir;
  const kafkaPort = configData.kafkaPort;
  const zkServer = configData.zkServer;

  const configFile = path.join(kafkaDir, 'server.properties');
  const kafkaLog4jOpts = "-Dlog4j.configuration=file:"+path.join(__dirname, 'log4j-stdout.properties'); // .replace(/\\/g, '\\\\');
  const env = Object.assign({}, process.env, {KAFKA_LOG4J_OPTS: kafkaLog4jOpts, LOG_DIR: kafkaDir});
  const mainClass = 'kafka.Kafka';
  consoleDebug('starting kafka, config', configFile);
  let proc;
  if (isWindows) {
    const script = path.join(__dirname, '..', 'kafka', 'bin', 'windows', 'kafka-run-class.bat');
    consoleDebug(`launching ${script}`);
    consoleDebug('spawning...');
    // proc = spawn('cmd.exe', ['/c', script, mainClass, configFile], {cwd: kafkaDir, env});
    proc = spawn(script, [mainClass, configFile], {cwd: kafkaDir, env});
    consoleDebug('spawned');
  } else {
    const script = path.join(__dirname, '..', 'kafka', 'bin', 'kafka-run-class.sh');
    consoleDebug(`launching ${script}`);
    consoleDebug('spawning...');
    // proc = spawn('cmd.exe', ['/c', script, mainClass, configFile], {cwd: kafkaDir, env});
    proc = spawn(script, [mainClass, configFile], {cwd: kafkaDir, env, shell: 'bash'});
    consoleDebug('spawned');
  }

  consoleDebug('after if statement, lancuh');
  consoleDebug('after template statement stuff');

  proc.stdout.on('data', (data) => {
    consoleDebug('STDOUT KAFKA: ' + decoder.write(data));
  });

  proc.stderr.on('data', (data) => {
    consoleDebug('STDOUT KAFKA: ' + decoder.write(data));
  });

  proc.on('exit', (code) => {
    consoleDebug(`Child exited with code ${code}`);
  });

  consoleDebug('Now starting with the health check stuff...');

  return waitPromise(1000).then(() => waitForCheck(elapsed => kafkaHealthCheck(zkServer.port, elapsed), 30000)).then(() => {
    consoleDebug('OMG IN HERE!');
    return {
      kafkaPort: kafkaPort,
      zookeeperPort: zkServer.port,
      close: () => zkServer.close().then(() => {
        return killPromise(proc).then(stopKafka);
      })
    };
  });
}

module.exports = function makeKafkaServer() {
  return portsPromise().then((ports) =>
    tmpDirPromise('zookeeper-')
      .then(zkDir => makeZookeeperConfigFile({zkDir, zkPort: ports.zkPort}).then(() =>
        startZookeeper({zkDir, zkPort: ports.zkPort}).then(zkServer =>
          tmpDirPromise('kafka-')
            .then(kafkaDir => makeKafkaConfigFile({kafkaDir, zkPort: ports.zkPort, kafkaPort: ports.kafkaPort}).then(() =>
              startKafka({kafkaDir, kafkaPort: ports.kafkaPort, zkServer})
            ))
        )
      )));
};
