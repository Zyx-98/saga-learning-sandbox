export interface InventoryReservedEvent {
  orderId: string;
}

export interface InventoryOutOfStockEvent {
  orderId: string;
  reason: string;
}