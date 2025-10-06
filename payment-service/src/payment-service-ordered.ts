import { Kafka, logLevel } from "kafkajs";
import { OrderCreatedEvent } from "./common/events/order.events";
import {
  PaymentFailedEvent,
  PaymentSucceededEvent,
} from "./common/events/payment.events";
import { InventoryOutOfStockEvent } from "./common/events/inventory.events";

const kafka = new Kafka({
  clientId: "payment-service",
  brokers: ["kafka-1:29092", "kafka-2:29092", "kafka-3:29092"],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({
  idempotent: true,
});

const consumer = kafka.consumer({ 
  groupId: "payment-service-group",
  sessionTimeout: 30000,
  heartbeatInterval: 3000,
});

// MONITORING: Track ordering issues
let orderingMetrics = {
  totalMessages: 0,
  outOfOrderDetected: 0,
  bufferedMessages: 0,
  processedInOrder: 0,
};

// FIX: Message buffer for out-of-order handling
interface BufferedMessage {
  orderId: string;
  eventType: string;
  sequenceNumber: number;
  timestamp: number;
  payload: any;
  receivedAt: number;
}

const messageBuffer = new Map<string, BufferedMessage[]>();

// FIX: Track expected sequence numbers per order
const expectedSequence = new Map<string, number>();

// FIX: Track order creation timestamps to detect ordering issues
const orderTimestamps = new Map<string, number>();

// Cleanup old buffered messages periodically
setInterval(() => {
  const now = Date.now();
  const BUFFER_TTL = 60000; // 1 minute
  
  for (const [orderId, messages] of messageBuffer.entries()) {
    const filtered = messages.filter(msg => now - msg.receivedAt < BUFFER_TTL);
    
    if (filtered.length === 0) {
      messageBuffer.delete(orderId);
      console.warn(`⚠️ Cleaned up stale messages for order ${orderId}`);
    } else if (filtered.length < messages.length) {
      messageBuffer.set(orderId, filtered);
    }
  }
}, 30000);

setInterval(() => {
  console.log(`📊 Message Ordering Metrics:
    Total Messages: ${orderingMetrics.totalMessages}
    Processed In Order: ${orderingMetrics.processedInOrder}
    Out of Order Detected: ${orderingMetrics.outOfOrderDetected}
    Currently Buffered: ${orderingMetrics.bufferedMessages}
    Orders in Buffer: ${messageBuffer.size}
  `);
}, 15000);

// FIX: Add sequence number to events
function addSequenceNumber(orderId: string, event: any): any {
  const seq = (expectedSequence.get(orderId) || 0) + 1;
  expectedSequence.set(orderId, seq);
  
  return {
    ...event,
    sequenceNumber: seq,
    timestamp: Date.now(),
  };
}

// FIX: Check if message is in correct order
function isInOrder(orderId: string, sequenceNumber: number): boolean {
  const expected = expectedSequence.get(orderId) || 0;
  return sequenceNumber === expected + 1;
}

// FIX: Buffer out-of-order message
function bufferMessage(
  orderId: string,
  eventType: string,
  sequenceNumber: number,
  payload: any
) {
  if (!messageBuffer.has(orderId)) {
    messageBuffer.set(orderId, []);
  }
  
  const messages = messageBuffer.get(orderId)!;
  messages.push({
    orderId,
    eventType,
    sequenceNumber,
    timestamp: payload.timestamp || Date.now(),
    payload,
    receivedAt: Date.now(),
  });
  
  // Sort by sequence number
  messages.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  
  orderingMetrics.bufferedMessages = Array.from(messageBuffer.values())
    .reduce((sum, msgs) => sum + msgs.length, 0);
  
  console.log(`Buffered out-of-order message for order ${orderId}`, {
    eventType,
    sequenceNumber,
    expected: (expectedSequence.get(orderId) || 0) + 1,
    bufferSize: messages.length,
  });
}

// FIX: Process buffered messages that are now in order
async function processBufferedMessages(orderId: string): Promise<void> {
  const messages = messageBuffer.get(orderId);
  if (!messages || messages.length === 0) return;
  
  const expected = (expectedSequence.get(orderId) || 0) + 1;
  
  // Process all sequential messages from buffer
  while (messages.length > 0 && messages[0].sequenceNumber === expected) {
    const msg = messages.shift()!;
    
    console.log(`Processing buffered message for order ${msg.orderId}`, {
      eventType: msg.eventType,
      sequenceNumber: msg.sequenceNumber,
      waitTime: Date.now() - msg.receivedAt,
    });
    
    // Process the buffered message
    await processOrderEvent(msg.payload);
    expectedSequence.set(orderId, msg.sequenceNumber);
    
    orderingMetrics.bufferedMessages--;
  }
  
  if (messages.length === 0) {
    messageBuffer.delete(orderId);
  }
}

// FIX: Main order processing function
async function processOrderEvent(orderEvent: OrderCreatedEvent & { sequenceNumber?: number }) {
  const { orderId, totalAmount, sequenceNumber } = orderEvent;
  
  // DEMO ISSUE: Detect out-of-order scenario
  if (orderEvent.customerId === "cust_out_of_order_test") {
    console.warn(`DEMO: Testing out-of-order detection for order ${orderId}`);
  }

  console.log(`Processing OrderCreatedEvent for order ${orderId}`, {
    sequenceNumber,
    totalAmount,
  });

  if (totalAmount > 1000) {
    console.log(
      `Payment failed for order ${orderId} due to insufficient funds (total amount > 1000).`
    );
    const paymentFailedEvent: PaymentFailedEvent = {
      orderId,
      reason: "Payment declined: amount exceeds limit",
    };

    await producer.send({
      topic: "payments",
      messages: [
        {
          key: orderId, // FIX: Always use orderId as key for ordering
          value: JSON.stringify(addSequenceNumber(orderId, paymentFailedEvent)),
          headers: {
            correlationId: `payment-${orderId}`,
            "event-type": "PaymentFailed",
          },
        },
      ],
    });

    orderingMetrics.processedInOrder++;
    return;
  }

  const paymentId = `payment-${Date.now()}`;
  console.log(
    `Payment processed successfully for order ${orderId}. Payment ID: ${paymentId}`
  );

  const paymentEvent: PaymentSucceededEvent = {
    orderId,
    paymentId,
  };

  await producer.send({
    topic: "payments",
    messages: [
      {
        key: orderId, // FIX: Critical - same key ensures ordering
        value: JSON.stringify(addSequenceNumber(orderId, paymentEvent)),
        headers: {
          correlationId: `payment-${orderId}`,
          "event-type": "PaymentSucceeded",
        },
      },
    ],
  });
  
  console.log(`Published PaymentSucceededEvent for order ${orderId}`);
  orderingMetrics.processedInOrder++;
}

const run = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "inventory", fromBeginning: true });

  console.log("Payment service running with message ordering...");

  await consumer.run({
    // FIX: Process messages per partition to maintain order
    eachMessage: async ({ topic, partition, message }) => {
      orderingMetrics.totalMessages++;
      
      if (!message.value || !message.headers) return;
      
      const correlationId = message.headers.correlationId?.toString();
      const eventType = message.headers?.["event-type"]?.toString();

      if (topic === "orders") {
        const orderEvent = JSON.parse(
          message.value.toString()
        ) as OrderCreatedEvent & { sequenceNumber?: number, timestamp?: number };
        
        const { orderId, sequenceNumber, timestamp } = orderEvent;
        
        // FIX: Validate message ordering
        if (sequenceNumber) {
          if (!isInOrder(orderId, sequenceNumber)) {
            orderingMetrics.outOfOrderDetected++;
            
            console.warn(`⚠️ Out-of-order message detected for order ${orderId}`, {
              received: sequenceNumber,
              expected: (expectedSequence.get(orderId) || 0) + 1,
              partition,
            });
            
            // Buffer the message and wait for missing messages
            bufferMessage(orderId, 'OrderCreated', sequenceNumber, orderEvent);
            return;
          }
          
          // Update expected sequence
          expectedSequence.set(orderId, sequenceNumber);
        }
        
        // Track order creation time
        if (timestamp) {
          orderTimestamps.set(orderId, timestamp);
        }
        
        // DEMO ISSUE: Simulate processing payment before order creation
        if (orderEvent.customerId === "cust_wrong_order_demo") {
          // Artificially delay this message to cause ordering issue
          console.warn(`⚠️ DEMO: Delaying OrderCreated to simulate out-of-order`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
        await processOrderEvent(orderEvent);
        
        // FIX: Check if any buffered messages can now be processed
        await processBufferedMessages(orderId);
      }

      if (topic === "inventory") {
        if (eventType === "InventoryOutOfStock") {
          const inventoryEvent = JSON.parse(
            message.value.toString()
          ) as InventoryOutOfStockEvent & { sequenceNumber?: number };
          
          const { orderId, sequenceNumber } = inventoryEvent;

          // FIX: Validate ordering
          if (sequenceNumber && !isInOrder(orderId, sequenceNumber)) {
            orderingMetrics.outOfOrderDetected++;
            bufferMessage(orderId, 'InventoryOutOfStock', sequenceNumber, inventoryEvent);
            return;
          }
          
          if (sequenceNumber) {
            expectedSequence.set(orderId, sequenceNumber);
          }

          console.log(
            `Received InventoryOutOfStockEvent for order ${orderId}.`
          );
          console.log(`Initiating refund for order ${orderId}...`);
          console.log(`Refund for order ${orderId} processed.`);
          
          orderingMetrics.processedInOrder++;
          await processBufferedMessages(orderId);
        }
      }
    },
  });
};

process.on('SIGTERM', async () => {
  console.log('Shutting down payment service...');
  console.log('Final ordering metrics:', orderingMetrics);
  console.log('Buffered orders:', Array.from(messageBuffer.keys()));
  
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
});

run().catch((e) => {
  console.error("[payment-service] Error:", e.message);
  process.exit(1);
});