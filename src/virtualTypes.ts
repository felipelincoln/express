import { DbCollection } from './db';

export interface TrendingCollection {
  collection: DbCollection;
  floorPrice: { ethPrice: string; tokenPrice: number };
  listings: number;
  trades: number;
}
