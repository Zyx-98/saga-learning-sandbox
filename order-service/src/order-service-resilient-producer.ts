import express from "express";
import { Kafka, logLevel, CompressionTypes } from "kafkajs";
import { randomUUID } from "crypto";
import { OrderCreatedEvent } from "./common/events/order.events";
import { PaymentFailedEvent } from "./common/events/payment.events";
import db from "./db";

const app = express();
app.use(express.json());

const kafka = new Kafka({
  clientId: "order-service",
  // FIX: Connect to all brokers for failover
  brokers: ["kafka-1:29092", "kafka-2:29092", "kafka-3:29092"],
  logLevel: logLevel.INFO,

  // FIX: Retry configuration for broker failures
  retry: {
    initialRetryTime: 100,
    retries: 8,
    maxRetryTime: 30000,
    multiplier: 2,
    factor: 0.2,
  },

  // FIX: Connection timeout settings
  connectionTimeout: 10000,
  requestTimeout: 30000,
});

const producer = kafka.producer({
  allowAutoTopicCreation: false,
  transactionTimeout: 60000,

  // FIX: Idempotent producer prevents duplicates during retries
  idempotent: true,

  // FIX: Max in-flight requests for ordering guarantees
  maxInFlightRequests: 5,

  // FIX: Require all replicas to acknowledge (durability)
  // This will cause errors if min.insync.replicas is not met
  // acks: -1 means "all" replicas must acknowledge
  // Note: kafkajs uses acks as number, -1 = all
  retry: {
    maxRetryTime: 30000,
    initialRetryTime: 300,
    retries: 10,
  },
});

const consumer = kafka.consumer({
  groupId: "order-service-group",
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
});

// MONITORING: Track producer metrics
let producerMetrics = {
  successfulSends: 0,
  failedSends: 0,
  retriedSends: 0,
  totalLatency: 0,
};

setInterval(() => {
  const avgLatency =
    producerMetrics.successfulSends > 0
      ? (
          producerMetrics.totalLatency / producerMetrics.successfulSends
        ).toFixed(2)
      : 0;

  console.log(`📊 Producer Metrics:
    ✅ Successful: ${producerMetrics.successfulSends}
    ❌ Failed: ${producerMetrics.failedSends}
    🔄 Retried: ${producerMetrics.retriedSends}
    ⏱️  Avg Latency: ${avgLatency}ms
  `);
}, 15000);

// FIX: Handle producer events for monitoring
producer.on("producer.connect", () => {
  console.log("✅ Producer connected to Kafka cluster");
});

producer.on("producer.disconnect", () => {
  console.log("⚠️ Producer disconnected from Kafka cluster");
});

producer.on("producer.network.request_timeout", ({ payload }) => {
  console.error("⏰ Producer request timeout:", payload);
  producerMetrics.retriedSends++;
});

app.post("/orders", async (req, res) => {
  const startTime = Date.now();

  try {
    await producer.connect();

    const orderId = randomUUID();
    const { customerId, productId, quantity, amount } = req.body;
    const correlationId = `order-${orderId}`;

    console.log(`Received new order request. Order ID: ${orderId}`);

    // Save to DB first (outbox pattern consideration)
    await db.query(
      "INSERT INTO orders (id, customer_id, product_id, quantity, amount, status) VALUES ($1, $2, $3, $4, $5, $6)",
      [orderId, customerId, productId, quantity, amount, "PENDING"]
    );
    console.log(`Order ${orderId} saved to DB with PENDING status.`);

    const event: OrderCreatedEvent = {
      orderId,
      customerId,
      items: [{ productId, quantity }],
      totalAmount: amount,
    };

    // FIX: Send with explicit configuration for durability
    try {
      const result = await producer.send({
        topic: "orders",
        // FIX: Compression reduces network bandwidth
        compression: CompressionTypes.GZIP,
        // FIX: acks: -1 (all) ensures message is replicated to all in-sync replicas
        acks: -1,
        // FIX: Timeout for the send operation
        timeout: 30000,
        messages: [
          {
            key: orderId,
            value: JSON.stringify(event),
            headers: {
              correlationId,
              timestamp: Date.now().toString(),
            },
          },
        ],
      });

      const latency = Date.now() - startTime;
      producerMetrics.successfulSends++;
      producerMetrics.totalLatency += latency;

      console.log(`✅ Published OrderCreatedEvent for order ${orderId}`, {
        partition: result[0].partition,
        offset: result[0].offset,
        latency: `${latency}ms`,
      });

      res.status(201).json({
        orderId,
        status: "PENDING",
        partition: result[0].partition,
        offset: result[0].offset,
      });
    } catch (produceError) {
      producerMetrics.failedSends++;

      // FIX: Handle specific Kafka errors
      const errorMessage = (produceError as Error).message;

      if (errorMessage.includes("NOT_ENOUGH_REPLICAS")) {
        console.error(`❌ NOT_ENOUGH_REPLICAS error for order ${orderId}`);
        console.error("   Cluster does not have enough in-sync replicas");
        console.error(
          "   Check: min.insync.replicas setting and broker health"
        );

        // Update order status to failed
        await db.query("UPDATE orders SET status = $1 WHERE id = $2", [
          "FAILED",
          orderId,
        ]);

        return res.status(503).json({
          error: "Service temporarily unavailable",
          reason: "Kafka cluster does not have enough replicas",
          orderId,
          status: "FAILED",
        });
      }

      if (errorMessage.includes("REQUEST_TIMED_OUT")) {
        console.error(`⏰ Request timeout for order ${orderId}`);
        console.error("   Broker may be under heavy load or network issues");

        return res.status(504).json({
          error: "Request timeout",
          reason: "Kafka broker did not respond in time",
          orderId,
          status: "UNKNOWN", // Message may or may not have been written
        });
      }

      if (errorMessage.includes("LEADER_NOT_AVAILABLE")) {
        console.error(`👥 Leader not available for order ${orderId}`);
        console.error("   Partition leader election in progress");
        producerMetrics.retriedSends++;

        return res.status(503).json({
          error: "Service temporarily unavailable",
          reason: "Partition leader election in progress",
          orderId,
        });
      }

      // Generic error handling
      console.error(`❌ Failed to publish order ${orderId}:`, errorMessage);
      throw produceError;
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    console.error(`💥 Error processing order:`, errorMessage);

    res.status(500).json({
      error: "Internal server error",
      message: errorMessage,
    });
  }
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");

    const admin = kafka.admin();
    await admin.connect();
    const cluster = await admin.describeCluster();
    await admin.disconnect();

    res.json({
      status: "healthy",
      kafka: {
        brokers: cluster.brokers.length,
        controller: cluster.controller,
      },
      metrics: producerMetrics,
    });
  } catch (error) {
    res.status(503).json({
      status: "unhealthy",
      error: (error as Error).message,
    });
  }
});

const runConsumer = async () => {
  await consumer.connect();
  await consumer.subscribe({ topic: "inventory", fromBeginning: true });
  await consumer.subscribe({ topic: "payments", fromBeginning: true });

  console.log("Order service consumer is running...");

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value) return;

      const eventType = message.headers?.["event-type"]?.toString();
      const orderId = message.key!.toString();

      if (topic === "inventory") {
        if (eventType === "InventoryReserved") {
          console.log(`Received InventoryReservedEvent for order ${orderId}`);

          await db.query("UPDATE orders SET status = $1 WHERE id = $2", [
            "CONFIRMED",
            orderId,
          ]);

          console.log(
            `Updated order ${orderId} status to CONFIRMED in the database.`
          );
          console.log(`🎉 Saga finished successfully for order ${orderId}!`);
        } else if (eventType === "InventoryOutOfStock") {
          console.log(`Received InventoryOutOfStockEvent for order ${orderId}`);
          await db.query("UPDATE orders SET status = $1 WHERE id = $2", [
            "FAILED",
            orderId,
          ]);
          console.log(`❌ Order ${orderId} status updated to FAILED.`);
        }
      }

      if (topic === "payments") {
        if (eventType === "PaymentFailed") {
          const paymentFailedEvent = JSON.parse(
            message.value.toString()
          ) as PaymentFailedEvent;
          const { orderId } = paymentFailedEvent;

          console.log(`Received PaymentFailedEvent for order ${orderId}`);
          await db.query("UPDATE orders SET status = $1 WHERE id = $2", [
            "FAILED",
            orderId,
          ]);
          console.log(`Order ${orderId} status updated to FAILED.`);
        }
      }
    },
  });
};

// FIX: Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down gracefully...");
  console.log("Final metrics:", producerMetrics);

  await consumer.disconnect();
  await producer.disconnect();

  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, shutting down gracefully...");
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Order service API listening on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);

  runConsumer().catch((e) => {
    console.error("[order-service-consumer] Error:", e.message);
    process.exit(1);
  });
});
