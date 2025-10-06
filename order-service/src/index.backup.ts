import express from "express";
import { Kafka, logLevel } from "kafkajs";
import { randomUUID } from "crypto";
import { OrderCreatedEvent } from "./common/events/order.events";
import { PaymentFailedEvent } from "./common/events/payment.events";
import db from "./db";

const app = express();
app.use(express.json());

const kafka = new Kafka({
  clientId: "order-service",
  brokers: ["kafka-1:29092", "kafka-2:29092", "kafka-3:29092"],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer({
  allowAutoTopicCreation: false,
  transactionTimeout: 30000,
  idempotent: true,
});
const consumer = kafka.consumer({ groupId: "order-service-group" });

app.post("/orders", async (req, res) => {
  await producer.connect();

  const orderId = randomUUID();
  const { customerId, productId, quantity, amount } = req.body;
  const correlationId = `order-${orderId}`;

  console.log(`Received new order request. Order ID: ${orderId}`);

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

  await producer.send({
    topic: "orders",
    messages: [
      {
        key: orderId,
        value: JSON.stringify(event),
        headers: { correlationId },
      },
    ],
  });

  console.log(`Published OrderCreatedEvent for order ${orderId}`);
  res.status(201).json({ orderId, status: "PENDING" });
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
          console.log(`Received PaymentFailedEvent for order ${orderId}`);
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Order service API listening on port ${PORT}`);
  runConsumer().catch((e) => {
    console.error("[order-service-consumer] Error:", e.message);
    process.exit(1);
  });
});
