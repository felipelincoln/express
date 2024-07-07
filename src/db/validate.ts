import { DbOrder } from './types';

export function isOrderValid(order: DbOrder): boolean {
  //if (!order.fee) return false;

  if (!order.fulfillmentCriteria.coin && order.fulfillmentCriteria.token.amount == '0')
    return false;

  if (
    Number(order.fulfillmentCriteria.token.amount) >
    order.fulfillmentCriteria.token.identifier.length
  )
    return false;

  return true;
}
