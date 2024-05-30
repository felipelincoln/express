import { DbCollection } from './db';

export interface TrendingCollection {
  collection: DbCollection;
  floor_price?: { coin_amount?: bigint; token_amount: number };
  listings: number;
  trades: number;
}
