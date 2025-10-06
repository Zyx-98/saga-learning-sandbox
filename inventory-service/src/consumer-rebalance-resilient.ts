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
  logLevel: logLevel.INFO,
  retry: {
    initialRetryTime: 100,
    retries: 8,
  },
});

const producer = kafka.producer({
  idempotent: true,
});

// FIX: Configure consumer to minimize rebalancing
const consumer = kafka.consumer({ 
  groupId: "inventory-service-group",
  
  // FIX: Increase session timeout to prevent unnecessary rebalances during slow processing
  sessionTimeout: 60000, // 60 seconds (default: 10s)
  
  // FIX: Send heartbeats more frequently
  heartbeatInterval: 3000, // 3 seconds (should be 1/3 of session timeout)
  
  // FIX: Enable static membership to avoid rebalancing on short restarts
  // Uncomment if you want static membership (requires unique groupInstanceId per consumer)
  // groupInstanceId: `inventory-service-${process.env.HOSTNAME || 'default'}`,
  
  // FIX: Reduce rebalance timeout
  rebalanceTimeout: 60000,
});

const orderDataCache = new Map<string, OrderCreatedEvent>();

// MONITORING: Track rebalancing events
let rebalanceMetrics = {
  totalRebalances: 0,
  lastRebalanceTime: null as Date | null,
  currentAssignment: [] as any[],
  rebalanceDurations: [] as number[],
  messagesProcessedBeforeRebalance: 0,
  messagesProcessedSinceStart: 0,
};

// FIX: Track rebalancing lifecycle
consumer.on(consumer.events.GROUP_JOIN, ({ payload }) => {
  rebalanceMetrics.totalRebalances++;
  rebalanceMetrics.lastRebalanceTime = new Date();
  
  console.log('🔄 Consumer group rebalancing started', {
    groupId: payload.groupId,
    memberId: payload.memberId,
    leaderId: payload.leaderId,
    isLeader: payload.isLeader,
    rebalanceCount: rebalanceMetrics.totalRebalances,
  });
  
  // Record messages processed before this rebalance
  rebalanceMetrics.messagesProcessedBeforeRebalance = 
    rebalanceMetrics.messagesProcessedSinceStart;
});

consumer.on(consumer.events.CONNECT, () => {
  console.log('Consumer connected to Kafka');
});

consumer.on(consumer.events.DISCONNECT, () => {
  console.log('Consumer disconnected from Kafka');
});

consumer.on(consumer.events.CRASH, ({ payload }) => {
  console.error('Consumer crashed:', payload.error);
  rebalanceMetrics.totalRebalances++;
});

// FIX: Monitor partition assignment changes
consumer.on(consumer.events.REBALANCING, () => {
  console.log('Consumer rebalancing in progress - processing paused');
});

consumer.on(consumer.events.COMMIT_OFFSETS, ({ payload }) => {
  // Optionally log offset commits
  // console.log('Offsets committed:', payload);
});

// Track when partitions are assigned
let rebalanceStartTime: number | null = null;
consumer.on(consumer.events.REBALANCING, () => {
  rebalanceStartTime = Date.now();
});

consumer.on(consumer.events.GROUP_JOIN, ({ payload }) => {
  if (rebalanceStartTime) {
    const duration = Date.now() - rebalanceStartTime;
    rebalanceMetrics.rebalanceDurations.push(duration);
    
    // Keep only last 10 rebalances
    if (rebalanceMetrics.rebalanceDurations.length > 10) {
      rebalanceMetrics.rebalanceDurations.shift();
    }
    
    const avgDuration = rebalanceMetrics.rebalanceDurations.reduce((a, b) => a + b, 0) 
      / rebalanceMetrics.rebalanceDurations.length;
    
    console.log(`Rebalance completed in ${duration}ms (avg: ${avgDuration.toFixed(0)}ms)`, {
      memberAssignment: payload.memberAssignment,
    });
    
    rebalanceMetrics.currentAssignment = Object.entries(payload.memberAssignment).map(
      ([topic, partitions]) => ({ topic, partitions })
    );
    
    rebalanceStartTime = null;
  }
});

// Periodic metrics reporting
setInterval(() => {
  const timeSinceLastRebalance = rebalanceMetrics.lastRebalanceTime 
    ? Math.floor((Date.now() - rebalanceMetrics.lastRebalanceTime.getTime()) / 1000)
    : null;
  
  const messagesProcessedSinceRebalance = 
    rebalanceMetrics.messagesProcessedSinceStart - 
    rebalanceMetrics.messagesProcessedBeforeRebalance;
  
  console.log(`Rebalance Metrics:
    Total Rebalances: ${rebalanceMetrics.totalRebalances}
    Since Last Rebalance: ${timeSinceLastRebalance ? timeSinceLastRebalance + 's' : 'N/A'}
    Messages Processed: ${rebalanceMetrics.messagesProcessedSinceStart} (${messagesProcessedSinceRebalance} since last rebalance)
    Current Partitions: ${JSON.stringify(rebalanceMetrics.currentAssignment)}
  `);
}, 20000);

const run = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "payments", fromBeginning: true });

  console.log("Inventory service running with rebalance resilience...");

  await consumer.run({
    // FIX: Use eachBatch for better control over heartbeats
    eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
      
      for (const message of batch.messages) {
        // FIX: Check if we're still the owner of this partition (cooperative rebalancing)
        if (!isRunning() || isStale()) {
          console.log('⏸️ Batch is stale, stopping processing (rebalance occurred)');
          break;
        }
        
        try {
          if (!message.value || !message.headers) {
            resolveOffset(message.offset);
            continue;
          }
          
          const correlationId = message.headers.correlationId?.toString();
          const eventType = message.headers?.["event-type"]?.toString();

          // DEMO ISSUE: Simulate slow processing that might trigger rebalance
          if (message.key?.toString().includes('slow_rebalance_test')) {
            console.warn(`⚠️ DEMO: Simulating slow processing (35s) that might cause rebalance`);
            
            // FIX: Send heartbeats during long processing
            for (let i = 0; i < 7; i++) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              await heartbeat(); // Critical: prevent session timeout during slow processing
              console.log(`  Heartbeat sent during slow processing (${(i+1)*5}s)`);
            }
          }

          if (batch.topic === "orders") {
            const orderEvent = JSON.parse(
              message.value.toString()
            ) as OrderCreatedEvent;

            if (orderEvent.items[0].productId === "prod_ignore") {
              resolveOffset(message.offset);
              continue;
            }

            console.log(
              `Received OrderCreatedEvent for order ${orderEvent.orderId}`
            );
            orderDataCache.set(orderEvent.orderId, orderEvent);
            resolveOffset(message.offset);
            rebalanceMetrics.messagesProcessedSinceStart++;
            
            // FIX: Send heartbeat periodically in batch processing
            await heartbeat();
            continue;
          }

          if (batch.topic === "payments" && eventType === "PaymentSucceeded") {
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
              rebalanceMetrics.messagesProcessedSinceStart++;
              continue;
            }

            await db.query(
              "UPDATE products SET quantity = quantity - $1 WHERE id = $2",
              [quantity, productId]
            );
            console.log(`Inventory successfully reserved for order ${orderId}.`);
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
            console.log(`Published InventoryReservedEvent for order ${orderId}`);
          }

          resolveOffset(message.offset);
          rebalanceMetrics.messagesProcessedSinceStart++;
          
          // FIX: Send heartbeat after processing each message
          await heartbeat();
          
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

// FIX: Graceful shutdown to prevent rebalancing
let isShuttingDown = false;
const gracefulShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('Graceful shutdown initiated...');
  console.log(`Final rebalance count: ${rebalanceMetrics.totalRebalances}`);
  console.log(`Total messages processed: ${rebalanceMetrics.messagesProcessedSinceStart}`);
  
  try {
    // FIX: Disconnect consumer gracefully (commits offsets and leaves group cleanly)
    await consumer.disconnect();
    console.log('Consumer disconnected gracefully');
    
    await producer.disconnect();
    console.log('Producer disconnected');
    
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// FIX: Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

run().catch((e) => {
  console.error("[inventory-service] Error:", e.message);
  process.exit(1);
});