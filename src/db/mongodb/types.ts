import { ObjectId } from 'mongodb';
import { LowerCaseAddress } from '../../eth';

export interface DbOrder {
  contract: LowerCaseAddress;
  tokenId: number;
  offerer: LowerCaseAddress;
  endTime: number;
  signature: string;
  orderHash: string;
  salt: string;
  transferred?: boolean;
  allowed?: boolean;
  fee?: {
    recipient: LowerCaseAddress;
    amount: string;
  };
  fulfillmentCriteria: {
    coin?: {
      amount: string;
    };
    token: {
      amount: string;
      identifier: number[];
    };
  };
}

export interface DbActivity {
  etype: string;
  contract: LowerCaseAddress;
  tokenId: number;
  offerer: LowerCaseAddress;
  fulfiller: LowerCaseAddress;
  fulfillment: {
    coin?: {
      amount: string;
    };
    token: {
      amount: string;
      identifier: number[];
    };
  };
  txHash: string;
  createdAt: number;
}

export interface DbCollection {
  name: string;
  symbol: string;
  image: string;
  contract: LowerCaseAddress;
  totalSupply: number;
  attributeSummary: Record<string, { attribute: string; options: Record<string, string> }>;
}

export interface DbToken {
  contract: LowerCaseAddress;
  tokenId: number;
  image?: string;
  attributes: Record<string, string>;
}

export interface DbNotification {
  activityId: ObjectId;
  address: LowerCaseAddress;
  contract: LowerCaseAddress;
}
