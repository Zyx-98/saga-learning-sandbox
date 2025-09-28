# Load Generator for Kafka Consumer Lag Scenario

This directory contains a simple script designed to generate a high volume of `OrderCreated` events. Its primary purpose is to simulate a burst of traffic to demonstrate and troubleshoot **consumer lag** in the Kafka learning sandbox.

---

## Overview

**Consumer Lag** is a critical metric in Kafka that measures how far behind a consumer is from the latest message in a topic. A consistently high or growing lag indicates that your consumers cannot keep up with the rate of incoming messages.

This script acts as a high-speed producer. By running it against the deliberately slowed-down `inventory-service`, we can create a significant consumer lag, monitor it with Kafka's built-in tools, and then resolve it by scaling up our consumers.

---

## 1. The Script: `send-burst.sh`

```sh
scenarios/consumer-lag/send-burst.sh
```

---

## 2. How to Run the Consumer Lag Scenario

Follow these steps to create, monitor, and resolve consumer lag.

### Step A: Prepare the Environment

1. **Start the Full System:** From the project's root directory, ensure all services are running.

    ```sh
    docker-compose up --build
    ```

2. **Add a Delay:** To make the lag obvious, open `inventory-service/src/index.ts` and add an artificial delay inside the `eachMessage` handler. This simulates a slow operation.

    ```typescript
    // Inside the eachMessage function in inventory-service
    console.log(`Processing order ${orderId}...`);
    await new Promise(resolve => setTimeout(resolve, 2000)); // <-- ADD THIS 2-SECOND DELAY
    console.log(`Finished processing ${orderId}.`);
    ```

3. **Rebuild and Restart:** After adding the delay, stop (`Ctrl+C`) and restart your services.

    ```sh
    docker-compose up --build
    ```

### Step B: Generate Load and Observe Lag

1. **Compile the Generator:** From the root directory, compile all TypeScript code.

    ```sh
    tsc --build
    ```

2. **Run the Generator:** Execute the script to send a burst of messages.

    ```sh
    node dist/load-generator/load-generator.js
    ```

3. **Check the Lag:** While the `inventory-service` is slowly processing, check its consumer group's lag. You'll need to run this command from inside the Kafka container.

    ```sh
    # Open a new terminal and run:
    docker exec -it kafka /bin/bash

    # Then, inside the container, run:
    kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group inventory-service-group
    ```

    Look at the output. You will see a high number in the **`LAG`** column, indicating the consumer is falling behind.

### Step C: Resolve the Lag by Scaling

1. **Scale Up Consumers:** The solution to lag is to add more consumers to the group to process messages in parallel. In your Docker terminal, run:

    ```sh
    # This scales ONLY the inventory-service to 3 instances
    docker-compose up --scale inventory-service=3
    ```

    Docker Compose will start two new `inventory-service` containers. They will automatically join the same consumer group and Kafka will assign them free partitions.

2. **Verify the Fix:** Run the consumer group check command again inside the Kafka container.

    ```sh
    kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group inventory-service-group
    ```

You will now see the **`LAG`** rapidly decreasing as the three consumers work together to clear the backlog. This demonstrates Kafka's powerful horizontal scaling capabilities.
