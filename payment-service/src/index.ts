import { Kafka, logLevel } from 'kafkajs';
import { OrderCreatedEvent } from '@common/events/order.events';
import { PaymentSucceededEvent } from '@common/events/payment.events';

const kafka = new Kafka({
    clientId: 'payment-service',
    brokers: ['localhost:9092'],
    logLevel: logLevel.WARN,
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'payment-service-group' });

const run = async () => {
    await producer.connect();
    await consumer.connect();
    await consumer.subscribe({ topic: 'orders', fromBeginning: true });

    console.log('Payment service is running and listening for orders...');

    await consumer.run({
        eachMessage: async ({ message }) => {
            if (!message.value || !message.headers) return;

            const orderEvent = JSON.parse(message.value.toString()) as OrderCreatedEvent;
            const { orderId, totalAmount } = orderEvent;
            const correlationId = message.headers.correlationId?.toString();

            console.log(`Received OrderCreatedEvent for order ${orderId} with amount ${totalAmount}`);

            const paymentId = `payment-${Date.now()}`;
            console.log(`Payment processed successfully for order ${orderId}. Payment ID: ${paymentId}`);

            const paymentEvent: PaymentSucceededEvent = {
                orderId,
                paymentId,
            };

            await producer.send({
                topic: 'payments',
                messages: [
                    {
                        key: orderId,
                        value: JSON.stringify(paymentEvent),
                        headers: {
                            correlationId: correlationId || `payment-${Date.now()}`
                        }
                    }
                ],
            });
            console.log(`Published PaymentSucceededEvent for order ${orderId}`);
        },
    });
};

run().catch(e => {
    console.error('[payment-service] Error:', e.message);
    process.exit(1);
});