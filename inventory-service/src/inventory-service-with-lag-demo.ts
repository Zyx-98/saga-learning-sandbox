import { Kafka, logLevel } from "kafkajs";
import { PaymentSucceededEvent } from "./common/events/payment.events";
import {
  InventoryOutOfStockEvent,
  InventoryReservedEvent,
} from "./common/events/inventory.events";
import { OrderCreatedEvent } from "./common/events/order.events";
import db from "./db";

const kafka = new Kafka({
  clientId: "inventory-service",
  brokers: ["kafka-1:29092", "kafka-2:29092", "kafka-3:29092"],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer();
const consumer = kafka.consumer({
  groupId: "inventory-service-group",
  // FIX: Add session timeout to prevent rebalancing during slow processing
  sessionTimeout: 60000,
  heartbeatInterval: 3000,
});

const orderDataCache = new Map<string, OrderCreatedEvent>();

// MONITORING: Track processing metrics
let processedCount = 0;
let lagMetrics = {
  currentLag: 0,
  avgProcessingTime: 0,
  slowMessages: 0,
};

setInterval(() => {
  console.log(
    `📊 Metrics - Processed: ${processedCount}, Avg Time: ${lagMetrics.avgProcessingTime}ms, Slow: ${lagMetrics.slowMessages}`
  );
}, 10000);

const run = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "payments", fromBeginning: true });

  console.log("Inventory service is running...");

  await consumer.run({
    // FIX: Add batch processing to improve throughput
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
      console.log(`📦 Processing batch of ${batch.messages.length} messages`);

      for (let message of batch.messages) {
        const startTime = Date.now();

        try {
          if (!message.value || !message.headers) continue;

          const correlationId = message.headers.correlationId?.toString();
          const eventType = message.headers?.["event-type"]?.toString();
          const topic = batch.topic;

          if (topic === "orders") {
            const orderEvent = JSON.parse(
              message.value.toString()
            ) as OrderCreatedEvent;

            // DEMO ISSUE: Simulate slow consumer causing lag
            if (orderEvent.customerId === "cust_slow_consumer") {
              console.warn(
                `⚠️ DEMO: Simulating slow processing for order ${orderEvent.orderId}`
              );
              await new Promise((resolve) => setTimeout(resolve, 5000)); // 5s delay
              lagMetrics.slowMessages++;
            }

            // DEMO ISSUE: Simulate CPU-intensive operation
            if (orderEvent.customerId === "cust_cpu_intensive") {
              console.warn(
                `⚠️ DEMO: Simulating CPU-intensive task for order ${orderEvent.orderId}`
              );
              // Simulate heavy computation
              let result = 0;
              for (let i = 0; i < 10000000; i++) {
                result += Math.sqrt(i);
              }
            }

            if (orderEvent.items[0].productId === "prod_ignore") {
              console.warn(
                `[DLQ] Ignoring OrderCreatedEvent for order ${orderEvent.orderId} containing 'prod_ignore'`
              );
              resolveOffset(message.offset);
              continue;
            }

            console.log(
              `Received OrderCreatedEvent for order ${orderEvent.orderId}`
            );
            orderDataCache.set(orderEvent.orderId, orderEvent);
            resolveOffset(message.offset);
            continue;
          }

          if (topic === "payments" && eventType === "PaymentSucceeded") {
            const paymentEvent = JSON.parse(
              message.value.toString()
            ) as PaymentSucceededEvent;
            const { orderId } = paymentEvent;

            const orderDetails = orderDataCache.get(orderId);

            if (!orderDetails) {
              throw new Error(
                `No order details found for order ${orderId}. Cannot reserve inventory.`
              );
            }

            // DEMO ISSUE: Simulate burst traffic causing lag
            if (orderDetails?.customerId === "cust_burst_test") {
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }

            const { productId, quantity } = orderDetails.items[0];

            console.log(
              `Received PaymentSucceededEvent for order ${orderId}. Attempting to reserve ${quantity} of product ${productId}.`
            );

            // FIX: Use connection pooling for DB queries
            const stockResult = await db.query(
              "SELECT quantity FROM products WHERE id = $1",
              [productId]
            );

            if (
              stockResult.rows.length === 0 ||
              stockResult.rows[0].quantity < quantity
            ) {
              console.error(`Not enough stock for product ${productId}.`);
              const outOfStockEvent: InventoryOutOfStockEvent = {
                orderId,
                reason: "Insufficient stock",
              };

              await producer.send({
                topic: "inventory",
                messages: [
                  {
                    key: orderId,
                    value: JSON.stringify(outOfStockEvent),
                    headers: {
                      correlationId,
                      "event-type": "InventoryOutOfStock",
                    },
                  },
                ],
              });

              resolveOffset(message.offset);
              continue;
            }

            await db.query(
              "UPDATE products SET quantity = quantity - $1 WHERE id = $2",
              [quantity, productId]
            );
            console.log(
              `Inventory successfully reserved for order ${orderId}.`
            );
            orderDataCache.delete(orderId);

            const inventoryEvent: InventoryReservedEvent = { orderId };

            await producer.send({
              topic: "inventory",
              messages: [
                {
                  key: orderId,
                  value: JSON.stringify(inventoryEvent),
                  headers: { correlationId, "event-type": "InventoryReserved" },
                },
              ],
            });
            console.log(
              `Published InventoryReservedEvent for order ${orderId}`
            );
          }

          resolveOffset(message.offset);
          await heartbeat();

          // Track metrics
          const processingTime = Date.now() - startTime;
          lagMetrics.avgProcessingTime =
            (lagMetrics.avgProcessingTime * processedCount + processingTime) /
            (processedCount + 1);
          processedCount++;
        } catch (error) {
          console.error(`[DLQ] Unhandled error processing message.`, {
            error: (error as Error).message,
            originalMessage: message.value?.toString(),
          });

          await producer.send({
            topic: "inventory.dlq",
            messages: [
              {
                key: message.key,
                value: message.value,
                headers: {
                  ...message.headers,
                  "error-service": "inventory-service",
                  "error-timestamp": new Date().toISOString(),
                  "error-message": (error as Error).message,
                },
              },
            ],
          });

          resolveOffset(message.offset);
        }
      }
    },
  });
};

// FIX: Graceful shutdown to prevent message loss during deployment
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, shutting down gracefully...");
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
});

run().catch((e) => {
  console.error("[inventory-service] Error:", e.message);
  process.exit(1);
});
