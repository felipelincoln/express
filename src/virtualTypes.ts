import { DbCollection } from './db';

export interface TrendingCollection {
  collection: DbCollection;
  floorPrice: { ethPrice: bigint; tokenPrice: number };
  listings: number;
  trades: number;
}
