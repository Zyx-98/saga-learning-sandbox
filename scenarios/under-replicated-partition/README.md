# Troubleshooting Guide: Under-Replicated Partitions (URP)

This document provides a complete guide to understanding, diagnosing, and resolving the "Under-Replicated Partitions" issue in Apache Kafka. A high URP count is a critical alert that indicates your cluster's fault tolerance is compromised.

---

## 1. What is an Under-Replicated Partition?

A partition becomes **under-replicated** when the number of fully synced backup copies (replicas) is less than the number you configured.

Think of the `replication-factor` as the number of identical copies of your data you want for safety. If you set it to `3`, Kafka maintains one "leader" copy and two "follower" copies on different brokers. The set of all fully synced copies is called the **In-Sync Replica (ISR)** set.

**URP happens when `ISR count < Replication Factor`.**

The primary impact is **reduced fault tolerance**. If you're in a URP state, you have fewer backup copies than you intended, and losing another broker could lead to permanent data loss.

---

## 2. How to Detect URP (Diagnosis 🔬)

Diagnosing URP involves a few key steps to check the health of your cluster.

### A. The Primary Tool: `kafka-topics.sh`

The most direct way to check for URP is with the topic description tool.

1. **Get a shell inside a Kafka broker:**

    ```sh
    docker exec -it kafka-1 /bin/bash
    ```

2. **Run the describe command:**

    ```sh
    kafka-topics --bootstrap-server localhost:9092 --describe
    ```

3. **Analyze the Output:**
    * **✅ Healthy State:** The `Replicas` and `Isr` lists are identical.

    ```sh
        Topic: orders    Partition: 0    Leader: 1    Replicas: 1,2,3    Isr: 1,2,3
    ```

    * **❌ Unhealthy (URP) State:** The `Isr` list is smaller than the `Replicas` list.

    ```sh
        Topic: orders    Partition: 0    Leader: 1    Replicas: 1,2,3    Isr: 1,3

    ```

    You can also grep specifically for the warning:

    ```sh
    kafka-topics.sh --describe --bootstrap-server localhost:9092 | grep "Under-replicated"
    ```

### B. Key Metrics to Monitor

In a production environment with monitoring (like Prometheus & Grafana), you should have alerts on these JMX metrics:

* **`kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions`**: The total count of URPs across the cluster. **This should always be 0.**
* **`kafka.server:type=ReplicaManager,name=IsrShrinksPerSec` / `IsrExpandsPerSec`**: A high rate of shrinks and expands (known as "ISR flapping") indicates network instability or overloaded brokers that are frequently falling out of and rejoining the ISR set.
* **`kafka.server:type=KafkaRequestHandlerPool,name=RequestHandlerAvgIdlePercent`**: A low value (close to 0) indicates that the broker's request handler threads are saturated and cannot keep up, which can cause followers to lag.

### C. Check Broker Logs

Always inspect the `server.log` files on the affected brokers. Look for:

* Disk I/O errors or warnings about disk space.
* Long Garbage Collection (GC) pauses that could cause the broker to be unresponsive.
* Network timeout exceptions or ZooKeeper session expirations.

---

## 3. How to Fix URP

Fixes for URP range from immediate recovery actions to long-term preventative tuning.

### A. Immediate Recovery

* **Restart the Failed Broker:** This is the most common solution. If a broker went down due to a temporary issue, simply restarting it (`docker-compose start <broker-name>`) will allow it to rejoin the cluster and catch up on its replicas.
* **Reassign Partitions (for Permanent Failure):** If a broker is permanently lost (e.g., hardware failure), you must reassign its partitions to the remaining healthy brokers.
    1. Create a `reassignment.json` file defining the new replica assignments.
    2. Execute the reassignment plan using the `kafka-reassign-partitions.sh` tool.

### B. Preventative Tuning & Best Practices

* **Prevent ISR Flapping:** If brokers are dropping out of the ISR due to temporary spikes in load or network latency, you can increase the time a replica can be out of sync before being removed.
  * **Tune:** `replica.lag.time.max.ms` (Default is 30s). Increasing this makes the cluster more tolerant of temporary slowness.

* **Improve Replication Performance:** If followers are consistently lagging, you can help them fetch data faster from the leader.
  * **Tune:** `num.replica.fetchers` (increases parallelism of fetching).
  * **Tune:** `replica.fetch.max.bytes` (allows fetching larger batches of data at once).

* **Ensure Proper Configuration:**
  * **Replication Factor:** Always use a replication factor of **3 or more** in production environments.
  * **`min.insync.replicas`:** For topics that require high durability, set this to `2`. This ensures a write is only acknowledged after it's been written to at least two brokers.

* **Infrastructure Health:**
  * **Disk Space:** Monitor disk usage (`df -h`). A full disk will take a broker offline.
  * **Use SSDs:** For high-throughput workloads, SSDs are essential for keeping up with writes.
  * **Network:** Ensure low latency and high bandwidth between brokers.
