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

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "payment-service-group" });

// MONITORING: Track retry attempts per message
const retryAttempts = new Map<string, number>();
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// MONITORING: Track poison message statistics
let poisonMessageCount = 0;
let validationFailures = 0;
let successfulProcessing = 0;

setInterval(() => {
  console.log(`📊 Payment Service Metrics:
    - Successful: ${successfulProcessing}
    - Validation Failures: ${validationFailures}
    - Poison Messages (sent to DLQ): ${poisonMessageCount}
    - Messages in retry: ${retryAttempts.size}
  `);
}, 15000);

// FIX: Message validation schema
interface ValidatedOrderEvent extends OrderCreatedEvent {
  orderId: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number }>;
  totalAmount: number;
}

function validateOrderEvent(data: any): ValidatedOrderEvent {
  const errors: string[] = [];

  if (!data.orderId || typeof data.orderId !== "string") {
    errors.push("Missing or invalid orderId");
  }
  if (!data.customerId || typeof data.customerId !== "string") {
    errors.push("Missing or invalid customerId");
  }
  if (!Array.isArray(data.items) || data.items.length === 0) {
    errors.push("Missing or invalid items array");
  }
  if (typeof data.totalAmount !== "number" || data.totalAmount < 0) {
    errors.push("Invalid totalAmount");
  }

  if (data.items) {
    data.items.forEach((item: any, index: number) => {
      if (!item.productId) {
        errors.push(`Item ${index}: missing productId`);
      }
      if (typeof item.quantity !== "number" || item.quantity <= 0) {
        errors.push(`Item ${index}: invalid quantity`);
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(", ")}`);
  }

  return data as ValidatedOrderEvent;
}

async function sendToDLQ(
  topic: string,
  message: any,
  error: Error,
  attempts: number
) {
  poisonMessageCount++;

  await producer.send({
    topic: `${topic}.dlq`,
    messages: [
      {
        key: message.key,
        value: message.value,
        headers: {
          ...message.headers,
          "x-original-topic": topic,
          "x-error-message": error.message,
          "x-error-timestamp": new Date().toISOString(),
          "x-retry-count": attempts.toString(),
          "x-service": "payment-service",
        },
      },
    ],
  });

  console.log(`☠️ Poison message sent to DLQ after ${attempts} attempts:`, {
    topic: `${topic}.dlq`,
    error: error.message,
    messageKey: message.key?.toString(),
  });
}

const run = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "inventory", fromBeginning: true });

  console.log("Payment service is running with poison message handling...");

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const messageKey = message.key?.toString() || "unknown";
      const correlationId = message.headers?.correlationId?.toString();
      const eventType = message.headers?.["event-type"]?.toString();

      // Track retry attempts
      const currentAttempts = retryAttempts.get(messageKey) || 0;

      try {
        if (!message.value || !message.headers) {
          throw new Error("Message missing value or headers");
        }

        if (topic === "orders") {
          let orderEvent: ValidatedOrderEvent;

          try {
            const rawData = JSON.parse(message.value.toString());

            // DEMO ISSUE: Simulate malformed JSON (already parsed, so simulate missing fields)
            if (rawData.customerId === "cust_poison_missing_fields") {
              console.warn(`⚠️ DEMO: Simulating missing required fields`);
              delete rawData.totalAmount; // Remove required field
            }

            // DEMO ISSUE: Simulate invalid data types
            if (rawData.customerId === "cust_poison_invalid_type") {
              console.warn(`⚠️ DEMO: Simulating invalid data type`);
              rawData.totalAmount = "not_a_number"; // Invalid type
            }

            // DEMO ISSUE: Simulate unparseable JSON
            if (rawData.customerId === "cust_poison_json_error") {
              console.warn(`⚠️ DEMO: Simulating JSON parse error`);
              throw new SyntaxError("Unexpected token in JSON");
            }

            // FIX: Validate message structure
            orderEvent = validateOrderEvent(rawData);
          } catch (validationError) {
            validationFailures++;
            console.error(
              `Validation failed for message ${messageKey}:`,
              (validationError as Error).message
            );

            // FIX: Immediate DLQ for validation errors (no retry)
            if (
              validationError instanceof SyntaxError ||
              (validationError as Error).message.includes("Validation failed")
            ) {
              await sendToDLQ(topic, message, validationError as Error, 0);
              retryAttempts.delete(messageKey);
              return; // Don't retry validation errors
            }
            throw validationError;
          }

          const { orderId, totalAmount } = orderEvent;
          console.log(`Received OrderCreatedEvent for order ${orderId}`);

          // DEMO ISSUE: Simulate transient error (should retry)
          if (orderEvent.customerId === "cust_transient_error") {
            if (currentAttempts < 2) {
              console.warn(
                `⚠️ DEMO: Simulating transient error (attempt ${
                  currentAttempts + 1
                }/${MAX_RETRIES})`
              );
              throw new Error("Temporary payment gateway timeout");
            }
            console.log(
              `✅ Transient error resolved on attempt ${currentAttempts + 1}`
            );
          }

          // Business logic validation
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
                  key: orderId,
                  value: JSON.stringify(paymentFailedEvent),
                  headers: {
                    correlationId: correlationId || `payment-${Date.now()}`,
                    "event-type": "PaymentFailed",
                  },
                },
              ],
            });

            successfulProcessing++;
            retryAttempts.delete(messageKey);
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
                key: orderId,
                value: JSON.stringify(paymentEvent),
                headers: {
                  correlationId: correlationId || `payment-${Date.now()}`,
                  "event-type": "PaymentSucceeded",
                },
              },
            ],
          });
          console.log(`Published PaymentSucceededEvent for order ${orderId}`);
          successfulProcessing++;
          retryAttempts.delete(messageKey);
        }

        if (topic === "inventory") {
          if (eventType === "InventoryOutOfStock") {
            const inventoryEvent = JSON.parse(
              message.value.toString()
            ) as InventoryOutOfStockEvent;
            const { orderId } = inventoryEvent;

            console.log(
              `Received InventoryOutOfStockEvent for order ${orderId}.`
            );
            console.log(`Initiating refund for order ${orderId}...`);
            console.log(`Refund for order ${orderId} processed.`);
            successfulProcessing++;
            retryAttempts.delete(messageKey);
          }
        }
      } catch (error) {
        const errorMessage = (error as Error).message;
        console.error(
          `Error processing message ${messageKey}:`,
          errorMessage
        );

        // FIX: Implement retry with exponential backoff
        if (currentAttempts < MAX_RETRIES) {
          retryAttempts.set(messageKey, currentAttempts + 1);

          const delay = RETRY_DELAY_MS * Math.pow(2, currentAttempts);
          console.log(
            `Retrying in ${delay}ms (attempt ${
              currentAttempts + 1
            }/${MAX_RETRIES})`
          );

          await new Promise((resolve) => setTimeout(resolve, delay));

          // Throw error to trigger consumer retry
          throw error;
        } else {
          // FIX: Max retries reached, send to DLQ
          console.error(
            `Max retries (${MAX_RETRIES}) exceeded for message ${messageKey}`
          );
          await sendToDLQ(topic, message, error as Error, currentAttempts);
          retryAttempts.delete(messageKey);
          // Don't throw - message is handled by DLQ
        }
      }
    },
  });
};

process.on("SIGTERM", async () => {
  console.log("Shutting down payment service...");
  console.log(
    `Final Stats - Poison Messages: ${poisonMessageCount}, Validation Failures: ${validationFailures}`
  );
  await consumer.disconnect();
  await producer.disconnect();
  process.exit(0);
});

run().catch((e) => {
  console.error("[payment-service] Error:", e.message);
  process.exit(1);
});
