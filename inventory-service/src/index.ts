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
  brokers: ["kafka-1:29092"],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "inventory-service-group" });

const orderDataCache = new Map<string, OrderCreatedEvent>();

const run = async () => {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: "orders", fromBeginning: true });
  await consumer.subscribe({ topic: "payments", fromBeginning: true });

  console.log("Inventory service is running...");

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        if (!message.value || !message.headers) return;
        const correlationId = message.headers.correlationId?.toString();
        const eventType = message.headers?.["event-type"]?.toString();

        if (topic === "orders") {
          const orderEvent = JSON.parse(
            message.value.toString()
          ) as OrderCreatedEvent;

          if (orderEvent.items[0].productId === "prod_ignore") {
            console.warn(
              `[DLQ] Ignoring OrderCreatedEvent for order ${orderEvent.orderId} containing 'prod_ignore'`
            );
            return; // Skip processing this event
          }

          console.log(
            `Received OrderCreatedEvent for order ${orderEvent.orderId}`
          );
          orderDataCache.set(orderEvent.orderId, orderEvent);
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

          if (orderDetails?.customerId === "cust_burst_test") {
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Simulate slow processing
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

            return;
          }

          await db.query(
            "UPDATE products SET quantity = quantity - $1 WHERE id = $2",
            [quantity, productId]
          );
          console.log(`Inventory successfully reserved for order ${orderId}.`);
          orderDataCache.delete(orderId); // Clean up cache

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

run().catch((e) => {
  console.error("[inventory-service] Error:", e.message);
  process.exit(1);
});
