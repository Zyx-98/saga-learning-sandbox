# Kafka Learning Sandbox: Microservices & Troubleshooting

A hands-on learning environment for mastering Apache Kafka through practical microservices examples and real-world troubleshooting scenarios.

---

## 📚 Table of Contents

- [Kafka Learning Sandbox: Microservices \& Troubleshooting](#kafka-learning-sandbox-microservices--troubleshooting)
  - [📚 Table of Contents](#-table-of-contents)
  - [1. About The Project](#1-about-the-project)
    - [Business Flow (Saga Pattern)](#business-flow-saga-pattern)
    - [Built With](#built-with)
  - [2. Learning Concepts](#2-learning-concepts)
    - [Core Kafka Concepts](#core-kafka-concepts)
    - [Production Issues \& Solutions](#production-issues--solutions)
  - [3. Getting Started](#3-getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Test the Happy Path](#test-the-happy-path)
  - [4. Running Tests](#4-running-tests)
    - [Quick Start - Run All Tests](#quick-start---run-all-tests)
    - [Run Individual Tests](#run-individual-tests)
    - [Manual Testing](#manual-testing)
    - [Available Make Commands](#available-make-commands)
  - [5. Troubleshooting Scenarios](#5-troubleshooting-scenarios)
    - [Issue 1: Consumer Lag \& Backpressure](#issue-1-consumer-lag--backpressure)
    - [Issue 2: Poison Messages \& DLQ](#issue-2-poison-messages--dlq)
    - [Issue 3: Broker Failure \& Replication](#issue-3-broker-failure--replication)
    - [Issue 4: Message Duplication](#issue-4-message-duplication)
    - [Issue 5: Consumer Rebalancing Storm](#issue-5-consumer-rebalancing-storm)
    - [Issue 6: Out of Order Messages](#issue-6-out-of-order-messages)
  - [6. Monitoring](#6-monitoring)
    - [Dashboards](#dashboards)
    - [Checking Metrics via CLI](#checking-metrics-via-cli)
  - [7. Roadmap](#7-roadmap)
    - [✅ Completed](#-completed)
    - [🚧 In Progress](#-in-progress)
    - [📋 Planned](#-planned)
  - [8. License](#8-license)

---

## 1. About The Project

This project simulates a real-world e-commerce order system using **event-driven microservices** with Apache Kafka. It's designed as a learning laboratory where you can:

- ✅ See Kafka concepts in action
- ⚠️ Trigger production-like problems
- 🔧 Practice troubleshooting and fixes
- 📊 Monitor with Grafana dashboards

### Business Flow (Saga Pattern)

```
Order Created → Payment Processed → Inventory Reserved → Order Confirmed
     ↓               ↓                      ↓
   orders         payments              inventory
   topic           topic                 topic
```

**Services:**

- **Order Service** - API entry point, manages order lifecycle
- **Payment Service** - Processes payments, handles refunds
- **Inventory Service** - Manages stock, reserves products

### Built With

- **Backend:** Node.js, TypeScript, KafkaJS
- **Message Broker:** Apache Kafka (3 brokers + Zookeeper)
- **Database:** PostgreSQL
- **Monitoring:** Grafana, Prometheus, AKHQ
- **Container:** Docker, Docker Compose

---

## 2. Learning Concepts

### Core Kafka Concepts

- Producers & Consumers
- Topics & Partitions
- Consumer Groups & Rebalancing
- Message Headers & Correlation IDs
- Event-Driven Architecture
- Saga Pattern (Choreography)

### Production Issues & Solutions

| Issue | What You'll Learn | Tools Used |
|-------|------------------|------------|
| **Consumer Lag** | Batch processing, heartbeat management | Grafana metrics |
| **Poison Messages** | DLQ pattern, retry logic, validation | Logs, AKHQ |
| **Broker Failure** | Replication, failover, durability | Grafana, cluster health |
| **Duplicates** | Idempotency, database transactions | PostgreSQL, dedup table |
| **Rebalancing** | Session timeout, graceful shutdown | Consumer group state |
| **Out of Order** | Message keys, sequence numbers, buffering | Partition assignment |

---

## 3. Getting Started

### Prerequisites

- Docker Desktop installed and running
- 8GB RAM minimum (16GB recommended)
- Ports available: 3000, 5432, 8080, 9090, 3001, 9092-9094

### Installation

```bash
# 1. Clone repository
git clone https://github.com/Zyx-98/saga-learning-sandbox.git
cd saga-learning-sandbox

# 2. Start all services
docker-compose up --build -d

# 3. Wait for services to be ready (30-60 seconds)
docker-compose ps

# 4. Verify Kafka cluster
docker exec kafka-1 kafka-topics --list --bootstrap-server localhost:9092
```

**Expected output:**

```
orders
payments
inventory
inventory.dlq
orders.dlq
```

### Test the Happy Path

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust_001",
    "productId": "prod_123",
    "quantity": 2,
    "amount": 250.50
  }'
```

**Check logs:**

```bash
docker logs order_service --tail 10
docker logs payment_service --tail 10
docker logs inventory-service --tail 10
```

---

## 4. Running Tests

### Quick Start - Run All Tests

```bash
# First time: Create backup files
make setup

# Run all 6 troubleshooting tests
make test-all
```

### Run Individual Tests

```bash
# Check current status
make status

# Test specific issue
make test-lag          # Issue 1: Consumer Lag
make test-poison       # Issue 2: Poison Messages
make test-broker       # Issue 3: Broker Failure
make test-idempotency  # Issue 4: Message Duplication
make test-rebalance    # Issue 5: Rebalancing Storm
make test-ordering     # Issue 6: Out of Order Messages

# Restore original code
make restore-all
```

### Manual Testing

```bash
# 1. Switch to specific implementation
make switch-lag

# 2. Open monitoring
make dashboard

# 3. Run test script
bash tests/test-consumer-lag.sh

# 4. Restore original
make restore-inventory
```

### Available Make Commands

```bash
make help              # Show all available commands
make status            # Check which implementation is active
make dashboard         # Open Grafana/AKHQ dashboards
make logs              # View service logs
make up                # Start all services
make down              # Stop all services
```

---

## 5. Troubleshooting Scenarios

### Issue 1: Consumer Lag & Backpressure

**Problem:** Consumer can't keep up with message production rate.

**Symptoms:**

- ✓ Grafana: "Consumer lag by group" increasing
- ✓ Processing slows down
- ✓ Messages pile up in topic

**Test:**

```bash
make test-lag
```

**What happens:**

1. Sends orders with `customerId: "cust_slow_consumer"`
2. Simulates 5-second processing delay
3. Watch lag spike in Grafana
4. Fix uses batch processing + heartbeats

**Fix highlights:**

- Batch processing with `eachBatch`
- Regular `heartbeat()` calls
- Graceful shutdown handling

---

### Issue 2: Poison Messages & DLQ

**Problem:** Malformed message crashes consumer repeatedly.

**Symptoms:**

- ✓ Consumer crash-restart loop
- ✓ Same error repeating in logs
- ✓ Messages stuck, not processed

**Test:**

```bash
make test-poison
```

**What happens:**

1. Sends orders with missing fields
2. Validation fails
3. Message goes to DLQ (orders.dlq)
4. Consumer continues processing other messages

**Fix highlights:**

- Message validation before processing
- Retry logic with max attempts
- Immediate DLQ for validation errors

---

### Issue 3: Broker Failure & Replication

**Problem:** Kafka broker crashes, partitions under-replicated.

**Symptoms:**

- ✓ Grafana: "Brokers Online" drops
- ✓ "Under Replicated Partitions" > 0
- ✓ Producer errors: NOT_ENOUGH_REPLICAS

**Test:**

```bash
make test-broker
```

**What happens:**

1. Stops kafka-2 broker
2. Watch under-replicated partitions increase
3. Cluster continues operating (2/3 brokers)
4. Restart broker, partitions re-replicate

**Fix highlights:**

- Producer with `acks: -1` (all replicas)
- Proper error handling
- Connection to all brokers

---

### Issue 4: Message Duplication

**Problem:** Same message processed multiple times.

**Symptoms:**

- ✓ Database: Duplicate key violations
- ✓ Business impact: Double charges
- ✓ Same orderId processed twice

**Test:**
```bash
make test-idempotency
```

**What happens:**

1. Sends duplicate PaymentSucceeded events
2. Idempotency check prevents reprocessing
3. Database tracks processed messages
4. Only first message is processed

**Fix highlights:**

- `processed_messages` table
- Database transactions
- Idempotent producer enabled

---

### Issue 5: Consumer Rebalancing Storm

**Problem:** Frequent rebalancing stops processing.

**Symptoms:**

- ✓ Logs: "rebalancing started" repeatedly
- ✓ Grafana: Lag shows sawtooth pattern
- ✓ Processing pauses intermittently

**Test:**

```bash
make test-rebalance
```

**What happens:**

1. Simulates slow processing (35 seconds)
2. Heartbeats prevent session timeout
3. Service restarts trigger rebalancing
4. Graceful shutdown minimizes impact

**Fix highlights:**

- Increased session timeout (60s)
- Heartbeat during processing
- Cooperative sticky assignor
- Graceful shutdown handler

---

### Issue 6: Out of Order Messages

**Problem:** Events arrive in wrong sequence.

**Symptoms:**

- ✓ Logs: "Order not found" errors
- ✓ Payment processed before order created
- ✓ Data inconsistencies

**Test:**

```bash
make test-ordering
```

**What happens:**

1. Sends messages with sequence numbers
2. Out-of-order messages are buffered
3. Processing waits for correct sequence
4. Buffered messages released in order

**Fix highlights:**

- Consistent message keys (orderId)
- Sequence numbers in events
- Message buffering logic
- Same key → same partition → ordering

---

## 6. Monitoring

### Dashboards

- **Grafana:** http://localhost:3001 (admin/admin)
  - Consumer lag by group
  - Brokers online
  - Under-replicated partitions
  - Messages in/out per topic
  - Bytes in/out per broker

- **AKHQ (Kafka UI):** http://localhost:8080
  - Topic browser
  - Consumer groups
  - Message inspection
  - DLQ monitoring

- **Prometheus:** http://localhost:9090
  - Raw metrics
  - Custom queries

### Checking Metrics via CLI

```bash
# Consumer group lag
docker exec kafka-1 kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe \
  --group inventory-service-group

# Topic details
docker exec kafka-1 kafka-topics \
  --bootstrap-server localhost:9092 \
  --describe \
  --topic orders

# Under-replicated partitions
docker exec kafka-1 kafka-topics \
  --bootstrap-server localhost:9092 \
  --describe \
  --under-replicated-partitions
```

---

## 7. Roadmap

### ✅ Completed

- [x] Core Kafka setup (3 brokers + Zookeeper)
- [x] Event-driven microservices
- [x] Saga pattern implementation
- [x] 6 production troubleshooting scenarios
- [x] Grafana + Prometheus monitoring
- [x] Automated test suite with Makefile
- [x] Complete documentation

### 🚧 In Progress

- [ ] Schema Registry integration
- [ ] Avro message format
- [ ] Exactly-once semantics (EOS)
- [ ] Kafka Streams example
- [ ] KSQL queries

### 📋 Planned

- [ ] Multi-region setup
- [ ] Performance benchmarking
- [ ] Security (SSL/SASL)
- [ ] Kubernetes deployment
- [ ] CI/CD pipeline

---

## 8. License

Distributed under the MIT License. See `LICENSE` for more information.

---
