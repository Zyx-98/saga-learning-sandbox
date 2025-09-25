import express from "express";
import { Kafka, logLevel } from "kafkajs";
import { randomUUID } from 'crypto';
import { OrderCreatedEvent } from "@common/events/order.events";
import { InventoryReservedEvent } from "@common/events/inventory.events";
import db from "./db";

const app = express();
app.use(express.json());

const kafka = new Kafka({
  clientId: "order-service",
  brokers: ["localhost:9092"],
  logLevel: logLevel.WARN,
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "order-service-group" });

app.post("/orders", async (req, res) => {
  await producer.connect();

  const orderId = randomUUID();
  const { customerId, productId, quantity, amount } = req.body;
  const correlationId = `order-${orderId}`;

  console.log(`Received new order request. Order ID: ${orderId}`);

  await db.query(
    "INSERT INTO orders (order_id, customer_id, product_id, quantity, amount, status) VALUES ($1, $2, $3, $4, $5, $6)",
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

  console.log(
    "Order service consumer is running and listening for inventory events..."
  );

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;

      const inventoryEvent = JSON.parse(
        message.value.toString()
      ) as InventoryReservedEvent;
      const { orderId } = inventoryEvent;

      console.log(`Received InventoryReservedEvent for order ${orderId}`);

      await db.query("UPDATE orders SET status = $1 WHERE order_id = $2", [
        "CONFIRMED",
        orderId,
      ]);
      console.log(
        `Updated order ${orderId} status to CONFIRMED in the database.`
      );
      console.log(`🎉 Saga finished successfully for order ${orderId}!`);
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
