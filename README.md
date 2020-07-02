NB! This package is no longer maintained. To spin up a local Kafka instance for testing, try using [Testcontainers](https://github.com/testcontainers/testcontainers-node) instead, and run Kafka in a Docker container!

---

# Kafka Please

This npm module lets you start up a Kafka broker (including ZooKeeper) locally.
It's meant to facilitate integration tests when you need to test against a Kafka broker.

*You need Java in order to run Kafka. This npm module assumes that you already have Java installed.*

Usage:

`npm install kafka-please --save-dev`

```javascript
const makeKafkaServer = require('kafka-please');

makeKafkaServer().then(kafkaServer => {
  // Do stuff that needs a Kafka broker here
  console.log('made kafka server', kafkaServer);
  console.log('zookeeper listens on', kafkaServer.zookeeperPort);
  console.log('kafka listens on', kafkaServer.kafkaPort);

  // Remember to shut down the server afterwards!
  return kafkaServer.close().then(() => {
    console.log('stopped kafka server');
    return Promise.resolve();
  });
});
```

## Timeouts in mocha

Typically, starting a Kafka server takes ~2-3 seconds, and can make your
mocha tests time out, if you don't override the timeout:

```javascript
describe('my integration test', () => {
  it('should use kafka', function() {
    this.timeout(60000); // Set timeout to 60 seconds, just to be sure
    // start kafka, run integration tests etc. here
  });
});
```

## Developing

- git clone this project
- run `fetch.sh` to download Kafka and unzip it
- run `npm install` to get dependencies
- `npm test` will run the integration tests.
