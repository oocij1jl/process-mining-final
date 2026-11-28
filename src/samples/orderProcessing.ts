/**
 * Order Processing — small synthetic sample bundled with the UI so a first-time
 * visitor can start in one click. Hand-authored illustrative data (3 orders,
 * 11 events, UTC). Content matches the independently checked fixture
 * tests/fixtures/order-processing-event-log.csv (V03_FINAL §8 acceptance values).
 * It is analysed by the normal ingestion path and engine like any upload.
 */
export const ORDER_SAMPLE_NAME = 'Order Processing (synthetic sample)';
export const ORDER_SAMPLE_FILE = 'order-processing-sample.csv';

export const ORDER_SAMPLE_MAPPING = {
  case_id: 'order',
  activity: 'step',
  timestamp: 'occurred_at',
  resource: 'owner',
  lifecycle: 'state',
  activity_instance_id: 'instance',
} as const;

export const ORDER_SAMPLE_DESCRIPTION =
  'Three customer orders move from receipt through payment, packing and shipping; one order is cancelled. Owners (Customer, Billing, Warehouse, Carrier, Support) show who hands work to whom.';

export const ORDER_SAMPLE_CSV = `order,step,occurred_at,owner,state,instance
001,Order Received,2028-07-01T09:00:00Z,Customer,,
001,Payment Authorized,2028-07-01T09:01:00Z,Billing,start,P1
002,Order Received,2028-07-01T09:02:00Z,Customer,,
001,Payment Authorized,2028-07-01T09:03:00Z,Billing,complete,P1
002,Payment Authorized,2028-07-01T09:05:00Z,Billing,,
001,"Packed, boxed",2028-07-01T09:07:00Z,Warehouse,,
002,"Packed, boxed",2028-07-01T09:09:00Z,Warehouse,,
001,Order Shipped,2028-07-01T09:10:00Z,Carrier,,
003,Order Received,2028-07-01T09:16:00Z,Customer,,
002,Order Shipped,2028-07-01T09:17:00Z,Carrier,,
003,Order Cancelled,2028-07-01T09:18:00Z,Support,,
`;
