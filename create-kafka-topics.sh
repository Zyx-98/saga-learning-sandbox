#!/bin/bash

echo "Waiting for Kafka to be ready..."
sleep 5

echo "Creating Kafka topic: orders"
docker exec kafka kafka-topics \
  --bootstrap-server kafka:29092 \
  --create \
  --topic orders \
  --partitions 3 \
  --replication-factor 1

echo "Creating Kafka topic: payments"
docker exec kafka kafka-topics \
  --bootstrap-server kafka:29092 \
  --create \
  --topic payments \
  --partitions 3 \
  --replication-factor 1

echo "Creating Kafka topic: inventory"
docker exec kafka kafka-topics \
  --bootstrap-server kafka:29092 \
  --create \
  --topic inventory \
  --partitions 3 \
  --replication-factor 1

echo "Kafka topics created successfully."

# List all topics to verify creation
echo "Verifying created topics..."
docker exec kafka kafka-topics \
  --bootstrap-server kafka:29092 \
  --list