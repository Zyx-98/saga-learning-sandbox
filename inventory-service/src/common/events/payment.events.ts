export interface PaymentSucceededEvent {
  orderId: string;
  paymentId: string;
}

export interface PaymentFailedEvent {
  orderId: string;
  reason: string;
}