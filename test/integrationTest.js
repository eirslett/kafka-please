'use strict';
const expect = require('chai').expect;
const makeKafkaServer = require('../src/index');

describe('Kafka please', () => {
  it('should start Kafka', function() {
    this.timeout(30000);
    return makeKafkaServer().then(kafkaServer => {
      console.log('made kafka server', kafkaServer);
      return kafkaServer.close().then(() => {
        console.log('stopped kafka server');
        return Promise.resolve();
      });
    });
  });
});

//
//function setupEverything() {
//  console.log('start');
//  makeKafkaServer().then(kafkaServer => {
//    console.log('BIG PROFIT', kafkaServer);
//    kafkaServer.close().then(() => {
//      console.log('Closed the shop.');
//    });
//  });
//}
//
//setupEverything();
//
