# Kafka Learning Sandbox: Microservices & Troubleshooting

## Table of Contents

1. [About The Project](#1-about-the-project)
   - [Built With](#built-with)
2. [Kafka Concepts Demonstrated](#2-kafka-concepts-demonstrated)
3. [Troubleshooting Scenarios](#3-troubleshooting-scenarios)
4. [Getting Started](#4-getting-started)
   - [Prerequisites](#prerequisites)
   - [Installation](#installation)
5. [Running the Scenarios](#5-running-the-scenarios)
6. [Roadmap](#6-roadmap)
7. [License](#7-license)

---

## 1. About The Project

This project is a hands-on learning sandbox designed to explore all aspects of **Apache Kafka**. It uses a practical, event-driven e-commerce microservices application as a backdrop to demonstrate core Kafka functionalities, design patterns, and solutions to common real-world issues.

The primary goal is not just to build a working system, but to create a laboratory where you can intentionally trigger and solve problems like **consumer lag**, **poison pill messages**, **connectivity errors**, and **startup race conditions**.

The business case involves placing an order, which is managed as a distributed transaction using the **Saga Pattern** across three services:

- **Order Service:** The API entry point for creating and tracking orders.
- **Payment Service:** A stateless service that processes payments.
- **Inventory Service:** A stateful service that manages product stock.

### Built With

- **Backend:** [Node.js](https://nodejs.org/), [TypeScript](https://www.typescriptlang.org/)
- **Messaging:** [Apache Kafka](https://kafka.apache.org/) (managed via KafkaJS)
- **Database:** [PostgreSQL](https://www.postgresql.org/)
- **Containerization:** [Docker](https://www.docker.com/), Docker Compose

---

## 2. Kafka Concepts Demonstrated

This repository provides a practical implementation of the following Kafka concepts:

- **Producers & Consumers:** Each service acts as both a producer and a consumer, forming a chain of events.
- **Topics:** Dedicated topics (`orders`, `payments`, `inventory`) for decoupling services.
- **Consumer Groups:** Each service instance belongs to a consumer group, allowing for parallel processing and scalability.
- **Event-Driven Architecture:** Services are loosely coupled and communicate asynchronously through events.
- **Saga Pattern:** A choreography-based saga manages a distributed transaction, with compensating events for rollbacks.
- **Message Headers:** Used to pass metadata like `Correlation ID` and `event-type` for tracing and routing.
- **Containerized Kafka:** A full Kafka and Zookeeper environment is provided in Docker for a reproducible setup.
- **Dead-Letter Queues (DLQ):** A strategy for handling un-processable "poison pill" messages without halting the consumer.

---

## 3. Troubleshooting Scenarios

This project is pre-configured to let you simulate and solve common Kafka issues.

- **Connectivity Errors (`ENOTFOUND`):** The initial setup guides you through fixing the common error of a service running on the host machine trying to connect to a broker inside the Docker network, teaching the difference between `kafka:29092` (internal) and `localhost:9092` (external).
- **Startup Race Conditions (`Group coordinator not available`):** Demonstrates what happens when a consumer starts faster than the broker can initialize. The solution shows the importance of waiting or implementing a health check.
- **Poison Pill Messages:** The DLQ scenario shows how to send a malformed message that would normally crash a consumer and how the DLQ pattern gracefully handles it, preventing a service outage.
- **Consumer Lag:** A dedicated load-generation script and a deliberately slowed-down consumer allow you to create, monitor, and resolve consumer lag by scaling up consumer instances, demonstrating Kafka's core scalability feature.

---

## 4. Getting Started

Follow these steps to get the entire environment up and running.

### Prerequisites

- **Docker and Docker Compose** must be installed and running.
  - [Install Docker Desktop](https://www.docker.com/products/docker-desktop/)

### Installation

1. **Clone the repository:**

   ```sh
   git clone <your-repo-url>
   cd <repo-name>
   ```

2. **Build and Run the Full Stack:**
   This single command builds the Docker images for each service, starts all infrastructure (Kafka, PostgreSQL), creates the necessary topics, and runs the entire application.

   ```sh
   docker-compose up --build
   ```

The system is now running. The Order Service API is available at `http://localhost:3000`.

---

## 5. Running the Scenarios

Use `curl` to interact with the system and trigger the different learning scenarios.

### Success Scenario (Happy Path)

```sh
curl -X POST http://localhost:3000/orders -H "Content-Type: application/json" -d '{"customerId": "cust_happy_path", "productId": "prod_123", "quantity": 2, "amount": 250.50}'
```

### Inventory Failure Scenario (Saga Rollback)

This triggers a successful payment followed by a rollback (refund) because stock is insufficient.

```sh
curl -X POST http://localhost:3000/orders -H "Content-Type: application/json" -d '{"customerId": "cust_large_quantity", "productId": "prod_123", "quantity": 10, "amount": 250.00}'
```

### DLQ Scenario (Poison Pill)

This sends an order with a special product ID (`prod_ignore`) that causes a logic error in the inventory service, triggering the DLQ.

```sh
curl -X POST http://localhost:3000/orders -H "Content-Type: application/json" -d '{"customerId": "cust_dlq_test", "productId": "prod_ignore", "quantity": 1, "amount": 99.00}'
```

### Consumer Lag Scenario

See the file [scenarios/consumer-lag/README.md](./scenarios/consumer-lag/README.md) for instructions on how to simulate high traffic, monitor, and resolve consumer lag.

---

## 6. Roadmap

This project serves as a hands-on laboratory for learning Kafka. This checklist outlines the concepts covered, from fundamentals to advanced troubleshooting. Use it to guide your exploration of the codebase and to see what future learning modules are planned.

### ✅ **Part 1: Core Concepts & Patterns (Implemented)**

*These concepts are already built into the project and ready to be explored.*

- [x] **Kafka Fundamentals:**
  - **[x] Producers & Consumers:** See how services produce events (`producer.send()`) and consume them (`consumer.run()`).
  - **[x] Topics & Partitions:** The system is built around dedicated topics (`orders`, `payments`, `inventory`).
  - **[x] Consumer Groups:** Each service runs as a distinct `groupId`, enabling work to be distributed.
  - **[x] Containerized Kafka:** The `docker-compose.yml` provides a complete, single-node Kafka & Zookeeper environment.

- [x] **Event-Driven Design Patterns:**
  - **[x] Asynchronous Microservices:** Services are fully decoupled and communicate only through Kafka events.
  - **[x] Saga Pattern (Choreography):** The core business logic for an order is a distributed transaction managed by a chain of events.
  - **[x] Compensating Transactions:** The "refund" logic in the `payment-service` demonstrates how to roll back a step when a subsequent step fails.
  - **[x] Correlation IDs:** Message headers are used to pass a unique `correlationId` for tracing a request's entire journey across all services.

### ✅ **Part 2: Common Problems & Solutions (Implemented)**

*These are hands-on labs you can run right now to learn how to troubleshoot common Kafka issues.*

- [x] **Handling "Poison Pill" Messages:**
  - **The Problem:** A malformed message (e.g., bad JSON) can cause a consumer to crash repeatedly, blocking all further processing.
  - **The Solution:** The **Dead-Letter Queue (DLQ)** pattern is implemented in the `inventory-service`. The `Usage` section shows how to trigger this to see the poison pill get caught and routed to a `.dlq` topic.

- [x] **Simulating and Resolving Consumer Lag:**
  - **The Problem:** What happens when producers generate messages much faster than a consumer can process them?
  - **The Solution:** The project includes a `load-generator` script and a deliberately slowed-down consumer. You can run this scenario to watch the lag build up using command-line tools and then resolve it by scaling up the consumer service (`docker-compose up --scale inventory-service=3`), demonstrating Kafka's horizontal scalability.

- [x] **Solving Connectivity & Startup Issues:**
  - **The Problem:** Why do services sometimes fail to connect with `ENOTFOUND` or `Group coordinator not available` errors?
  - **The Solution:** The setup process implicitly teaches these lessons. You will encounter and fix the Docker host vs. container networking issue, and you'll learn that consumers need to be resilient to temporary broker unavailability during startup.

### 🔲 **Part 3: Advanced Concepts & Performance (Future Implementation)**

*This is the roadmap for future enhancements to this learning repository.*

- [ ] **Data Integrity & Exactly-Once Semantics (EOS):**
  - **The Challenge:** How to prevent message duplication or loss during network failures or producer/consumer restarts.
  - **The Learning:** Implement **Idempotent Producers** and **Kafka Transactions** to guarantee that each message is processed exactly once.

- [ ] **Schema Management & Data Quality:**
  - **The Challenge:** How to prevent services from breaking when the structure of an event changes.
  - **The Learning:** Integrate a **Schema Registry** and convert events from JSON to a binary format like **Avro**. This enforces data contracts and allows for safe schema evolution.

- [ ] **Performance Tuning & Optimization:**
  - **The Challenge:** How to optimize Kafka for different workloads (high throughput vs. low latency).
  - **The Learning:** Conduct experiments by tuning producer `batch.size` and `linger.ms` settings. Implement **message compression** (`snappy`, `zstd`) and measure the impact on network bandwidth and CPU usage.

- [ ] **Advanced Data Storage Patterns:**
  - **The Challenge:** Can Kafka be used for more than just a temporary message queue?
  - **The Learning:** Implement a service that uses a **Log Compacted** topic to store the latest state for each key (e.g., a customer's current profile), using Kafka as a durable, key-value data store.

- [ ] **Operational Stability & Resilience:**
  - **The Challenge:** How to minimize downtime during deployments or when a consumer crashes.
  - **The Learning:** Simulate a **Consumer Rebalance Storm**. Implement **Static Group Membership** to reduce the "stop-the-world" pauses that occur when consumers join or leave a group.

---

## 7. License

Distributed under the MIT License.
