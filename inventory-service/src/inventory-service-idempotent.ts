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

// FIX: Enable idempotent producer to prevent duplicate messages
const producer = kafka.producer({
  idempotent: true,
  maxInFlightRequests: 5,
  transactionalId: "inventory-service-txn",
});

const consumer = kafka.consumer({
  groupId: "inventory-service-group",
  sessionTimeout: 60000,
  heartbeatInterval: 3000,
});

const orderDataCache = new Map<string, OrderCreatedEvent>();

// MONITORING: Track deduplication metrics
let metrics = {
  totalProcessed: 0,
  duplicatesDetected: 0,
  uniqueProcessed: 0,
  transactionRollbacks: 0,
};

setInterval(() => {
  console.log(`📊 Idempotency Metrics:
    📝 Total Messages: ${metrics.totalProcessed}
    ✅ Unique Processed: ${metrics.uniqueProcessed}
    🔄 Duplicates Blocked: ${metrics.duplicatesDetected}
    ↩️  Transaction Rollbacks: ${metrics.transactionRollbacks}
    📈 Dedup Rate: ${(
      (metrics.duplicatesDetected / Math.max(metrics.totalProcessed, 1)) *
      100
    ).toFixed(2)}%
  `);
}, 15000);

// FIX: Initialize processed messages table
async function initializeIdempotencyTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id VARCHAR(255) PRIMARY KEY,
        order_id VARCHAR(255),
        topic VARCHAR(100),
        event_type VARCHAR(100),
        processed_at TIMESTAMP DEFAULT NOW(),
        partition_id INTEGER,
        offset_id BIGINT
      )
    `);

    // Index for cleanup queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_processed_at 
      ON processed_messages(processed_at)
    `);

    console.log("✅ Idempotency table initialized");
  } catch (error) {
    console.error("Failed to initialize idempotency table:", error);
    throw error;
  }
}

// FIX: Check if message was already processed
async function isMessageProcessed(messageId: string): Promise<boolean> {
  const result = await db.query(
    "SELECT 1 FROM processed_messages WHERE message_id = $1",
    [messageId]
  );
  return result.rows.length > 0;
}

// FIX: Mark message as processed within transaction
async function markMessageProcessed(
  messageId: string,
  orderId: string,
  topic: string,
  eventType: string,
  partition: number,
  offset: string
) {
  await db.query(
    `INSERT INTO processed_messages 
     (message_id, order_id, topic, event_type, partition_id, offset_id) 
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (message_id) DO NOTHING`,
    [messageId, orderId, topic, eventType, partition, offset]
  );
}

// FIX: Cleanup old processed messages (run periodically)
async function cleanupOldProcessedMessages(daysToKeep: number = 7) {
  const result = await db.query(
    `DELETE FROM processed_messages 
     WHERE processed_at < NOW() - INTERVAL '${daysToKeep} days'`
  );
  console.log(`🧹 Cleaned up ${result.rowCount} old processed message records`);
}

// Run cleanup every hour
setInterval(() => {
  cleanupOldProcessedMessages(7).catch((err) =>
    console.error("Cleanup failed:", err)
  );
}, 3600000);

const run = async () => {
  await initializeIdempotencyTable();
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "payments", fromBeginning: true });

  console.log("Inventory service is running with idempotency...");

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      metrics.totalProcessed++;

      try {
        if (!message.value || !message.headers) return;

        const correlationId = message.headers.correlationId?.toString();
        const eventType = message.headers?.["event-type"]?.toString();
        const offset = message.offset;

        // FIX: Create unique message ID (correlationId + topic + partition + offset)
        const messageId = `${correlationId}-${topic}-${partition}-${offset}`;

        // FIX: Check for duplicate before processing
        const alreadyProcessed = await isMessageProcessed(messageId);

        if (alreadyProcessed) {
          metrics.duplicatesDetected++;
          console.log(
            `🔄 Duplicate message detected (already processed): ${messageId}`
          );
          return; // Skip processing
        }

        // FIX: Use database transaction for atomic processing
        await db.query("BEGIN");

        try {
          if (topic === "orders") {
            const orderEvent = JSON.parse(
              message.value.toString()
            ) as OrderCreatedEvent;

            // DEMO ISSUE: Simulate duplicate message scenario
            if (orderEvent.customerId === "cust_duplicate_test") {
              console.warn(
                `⚠️ DEMO: Simulating duplicate processing attempt for order ${orderEvent.orderId}`
              );
              // Intentionally try to process twice - idempotency should prevent it
            }

            if (orderEvent.items[0].productId === "prod_ignore") {
              console.warn(
                `[DLQ] Ignoring OrderCreatedEvent for order ${orderEvent.orderId} containing 'prod_ignore'`
              );
              await db.query("COMMIT");
              return;
            }

            console.log(
              `Received OrderCreatedEvent for order ${orderEvent.orderId}`
            );
            orderDataCache.set(orderEvent.orderId, orderEvent);

            // Mark as processed
            await markMessageProcessed(
              messageId,
              orderEvent.orderId,
              topic,
              "OrderCreated",
              partition,
              offset
            );

            await db.query("COMMIT");
            metrics.uniqueProcessed++;
            return;
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

            const { productId, quantity } = orderDetails.items[0];

            console.log(
              `Received PaymentSucceededEvent for order ${orderId}. Attempting to reserve ${quantity} of product ${productId}.`
            );

            // FIX: Check stock and update within same transaction
            const stockResult = await db.query(
              "SELECT quantity FROM products WHERE id = $1 FOR UPDATE",
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

              // Mark as processed even though it failed business logic
              await markMessageProcessed(
                messageId,
                orderId,
                topic,
                eventType || "PaymentSucceeded",
                partition,
                offset
              );

              await db.query("COMMIT");
              metrics.uniqueProcessed++;
              return;
            }

            // FIX: Update inventory atomically
            const updateResult = await db.query(
              "UPDATE products SET quantity = quantity - $1 WHERE id = $2 AND quantity >= $1 RETURNING quantity",
              [quantity, productId]
            );

            if (updateResult.rows.length === 0) {
              // Race condition: another process reserved the last items
              console.error(
                `Race condition: stock depleted during processing for ${productId}`
              );
              throw new Error("Stock depleted during processing");
            }

            console.log(
              `Inventory successfully reserved for order ${orderId}. Remaining: ${updateResult.rows[0].quantity}`
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

            // Mark as processed
            await markMessageProcessed(
              messageId,
              orderId,
              topic,
              eventType || "PaymentSucceeded",
              partition,
              offset
            );

            await db.query("COMMIT");
            metrics.uniqueProcessed++;
            console.log(
              `Published InventoryReservedEvent for order ${orderId}`
            );
          }
        } catch (txError) {
          // FIX: Rollback transaction on error
          await db.query("ROLLBACK");
          metrics.transactionRollbacks++;
          console.error("Transaction rolled back:", (txError as Error).message);
          throw txError;
        }
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
      }
    },
  });
};

process.on("SIGTERM", async () => {
  console.log("Shutting down inventory service...");
  console.log("Final idempotency metrics:", metrics);
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
});

run().catch((e) => {
  console.error("[inventory-service] Error:", e.message);
  process.exit(1);
});
