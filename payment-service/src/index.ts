import { Kafka, logLevel } from "kafkajs";
import { OrderCreatedEvent } from "./common/events/order.events";
import {
  PaymentFailedEvent,
  PaymentSucceededEvent,
} from "./common/events/payment.events";
import { InventoryOutOfStockEvent } from "./common/events/inventory.events";

const kafka = new Kafka({
  clientId: "payment-service",
  brokers: ["kafka-1:29092"],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "payment-service-group" });

const run = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "inventory", fromBeginning: true });

  console.log("Payment service is running...");

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      if (!message.value || !message.headers) return;
      const correlationId = message.headers.correlationId?.toString();
      const eventType = message.headers?.["event-type"]?.toString();

      if (topic === "orders") {
        const orderEvent = JSON.parse(
          message.value.toString()
        ) as OrderCreatedEvent;
        const { orderId, totalAmount } = orderEvent;

        console.log(`Received OrderCreatedEvent for order ${orderId}`);

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
        }
      }
    },
  });
};

run().catch((e) => {
  console.error("[payment-service] Error:", e.message);
  process.exit(1);
});
