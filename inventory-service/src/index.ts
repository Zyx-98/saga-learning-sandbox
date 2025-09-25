import { Kafka, logLevel } from "kafkajs";
import { PaymentSucceededEvent } from "@common/events/payment.events";
import {
  InventoryOutOfStockEvent,
  InventoryReservedEvent,
} from "@common/events/inventory.events";
import { OrderCreatedEvent } from "@common/events/order.events";
import db from "./db";

const kafka = new Kafka({
  clientId: "inventory-service",
  brokers: ["localhost:9092"],
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
      if (!message.value || !message.headers) return;
      const correlationId = message.headers.correlationId?.toString();
      const eventType = message.headers?.["event-type"]?.toString();

      if (topic === "orders") {
        const orderEvent = JSON.parse(
          message.value.toString()
        ) as OrderCreatedEvent;
        orderDataCache.set(orderEvent.orderId, orderEvent);
        return;
      }

      if (topic === "payments" && eventType === "PaymentSucceeded") {
        const paymentEvent = JSON.parse(
          message.value.toString()
        ) as PaymentSucceededEvent;
        const { orderId } = paymentEvent;

        // Retrieve the cached order data
        const orderDetails = orderDataCache.get(orderId);
        if (!orderDetails) {
          console.error(
            `No order details found for order ${orderId}. Cannot reserve inventory.`
          );
          return; // In a real app, publish a failure event
        }
        const { productId, quantity } = orderDetails.items[0];

        console.log(
          `Received PaymentSucceededEvent for order ${orderId}. Attempting to reserve ${quantity} of product ${productId}.`
        );

        const stockResult = await db.query(
          "SELECT quantity FROM products WHERE product_id = $1",
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
                headers: { correlationId, "event-type": "InventoryOutOfStock" },
              },
            ],
          });

          return;
        }

        await db.query(
          "UPDATE products SET quantity = quantity - $1 WHERE product_id = $2",
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
    },
  });
};

run().catch((e) => {
  console.error("[inventory-service] Error:", e.message);
  process.exit(1);
});
