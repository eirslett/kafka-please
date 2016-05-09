#!/bin/sh
wget http://www.us.apache.org/dist/kafka/0.9.0.1/kafka_2.11-0.9.0.1.tgz -O kafka.tgz
mkdir -p kafka
tar xzf kafka.tgz -C kafka --strip-components 1
