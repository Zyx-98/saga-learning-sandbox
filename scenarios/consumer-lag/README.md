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

   - **Open Grafana:** In your web browser, navigate to your Grafana dashboard, which is likely at `http://localhost:3001`.

   - **Observe the Lag:** Find your **"Consumer Lag by Group"** panel. You will see a line on the graph representing the `inventory-service-group`. Watch as this line steadily climbs, providing a clear visual confirmation that the consumer is falling behind and its lag is increasing.

### Step C: Resolve the Lag by Scaling

1. **Scale Up Consumers:** The solution to processing a backlog is to add more consumers to the group. In your terminal where Docker is running, execute:

    ```sh
    # This scales ONLY the inventory-service to 3 instances
    docker-compose up --scale inventory-service=3 -d
    ```

    Docker Compose will start two new `inventory-service` containers. They will automatically join the `inventory-service-group`, and Kafka will rebalance the topic partitions among the three available consumers.

2. **Verify the Fix in Grafana:** Return to your Grafana dashboard. You will now see the lag for the **`inventory-service-group`** rapidly decreasing towards zero. This visually demonstrates that the three consumers are working in parallel to clear the backlog, showcasing Kafka's powerful horizontal scaling.

### Step D: Other fixes

Scaling is not the only solution. Here are other fixes you can experiment with in this project:

- **Optimize Consumer Code (Batching):** Instead of processing one message at a time with `eachMessage`, you can process a batch with `eachBatch`. This is far more efficient for database writes.

  - **Try This:** Modify your consumer to use `eachBatch` and write a more efficient `UPDATE` query.
        ```typescript
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
            console.log(`Processing a batch of ${batch.messages.length} messages.`);
            for (const message of batch.messages) {
                await resolveOffset(message.offset);
                await heartbeat();
            }
        }
        ```

- **Tune Consumer Configurations:** In the consumer creation logic, experiment with these settings:
  - `max.poll.records`: Increase to fetch more messages in a single request.
  - `fetch.min.bytes`: Increase to make the broker wait for more data before responding, reducing network round-trips.
