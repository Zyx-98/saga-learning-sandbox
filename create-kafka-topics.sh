#!/bin/bash

# Wait for the first broker to be available
echo "Waiting for Kafka to be ready..."
cub kafka-ready -b kafka-1:29092 1 20

# Create topics with a replication factor of 3
echo "Creating Kafka topic: orders"
kafka-topics --bootstrap-server kafka-1:29092 --create --topic orders --partitions 3 --replication-factor 3

echo "Creating Kafka topic: payments"
kafka-topics --bootstrap-server kafka-1:29092 --create --topic payments --partitions 3 --replication-factor 3

echo "Creating Kafka topic: inventory"
kafka-topics --bootstrap-server kafka-1:29092 --create --topic inventory --partitions 3 --replication-factor 3

echo "Creating Kafka topic: inventory.dlq"
kafka-topics --bootstrap-server kafka-1:29092 --create --topic inventory.dlq --partitions 1 --replication-factor 3

echo "Creating Kafka topic: orders.dlq"
kafka-topics --bootstrap-server kafka-1:29092 --create --topic orders.dlq --partitions 1 --replication-factor 3

echo "All topics created successfully."

# List all topics to verify creation
echo "Verifying created topics..."
kafka-topics --bootstrap-server kafka-1:29092,kafka-2:29092,kafka-3:29092 --list

# Describe topics to verify ISR
echo "Describing topics to verify in-sync replicas..."
kafka-topics --bootstrap-server kafka-1:29092,kafka-2:29092,kafka-3:29092 --describe