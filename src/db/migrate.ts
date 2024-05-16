import { databaseMain, databaseTokens, db } from './db';

const order = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: [
        '_id',
        'tokenId',
        'contract',
        'offerer',
        'endTime',
        'signature',
        'orderHash',
        'salt',
        'fulfillmentCriteria',
      ],
      properties: {
        _id: { bsonType: 'objectId' },
        contract: { bsonType: 'string' },
        tokenId: { bsonType: 'int' },
        offerer: { bsonType: 'string' },
        endTime: { bsonType: 'int' },
        signature: { bsonType: 'string' },
        orderHash: { bsonType: 'string' },
        salt: { bsonType: 'string' },
        transferred: { bsonType: 'bool' },
        allowed: { bsonType: 'bool' },
        fee: {
          bsonType: 'object',
          additionalProperties: false,
          required: ['recipient', 'amount'],
          properties: {
            recipient: { bsonType: 'string' },
            amount: { bsonType: 'string' },
          },
        },
        fulfillmentCriteria: {
          bsonType: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: {
            coin: {
              bsonType: 'object',
              additionalProperties: false,
              required: ['amount'],
              properties: {
                amount: { bsonType: 'string' },
              },
            },
            token: {
              bsonType: 'object',
              additionalProperties: false,
              required: ['amount', 'identifier'],
              properties: {
                amount: { bsonType: 'string' },
                identifier: { bsonType: 'array', items: { bsonType: 'int' } },
              },
            },
          },
        },
      },
    },
  },
};

const activity = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: [
        '_id',
        'etype',
        'tokenId',
        'contract',
        'offerer',
        'fulfiller',
        'fulfillment',
        'txHash',
        'createdAt',
      ],
      properties: {
        _id: { bsonType: 'objectId' },
        etype: { bsonType: 'string' },
        tokenId: { bsonType: 'int' },
        contract: { bsonType: 'string' },
        offerer: { bsonType: 'string' },
        fulfiller: { bsonType: 'string' },
        txHash: { bsonType: 'string' },
        createdAt: { bsonType: 'int' },
        fulfillment: {
          bsonType: 'object',
          additionalProperties: false,
          required: ['token'],
          properties: {
            coin: {
              bsonType: 'object',
              additionalProperties: false,
              required: ['amount'],
              properties: { amount: { bsonType: 'string' } },
            },
            token: {
              bsonType: 'object',
              additionalProperties: false,
              required: ['amount', 'identifier'],
              properties: {
                amount: { bsonType: 'string' },
                identifier: { bsonType: 'array', items: { bsonType: 'int' } },
              },
            },
          },
        },
      },
    },
  },
};

const notification = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: ['_id', 'activityId', 'contract', 'address'],
      properties: {
        _id: { bsonType: 'objectId' },
        activityId: { bsonType: 'objectId' },
        contract: { bsonType: 'string' },
        address: { bsonType: 'string' },
      },
    },
  },
};

const collection = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: ['_id', 'contract', 'totalSupply', 'name', 'symbol', 'image', 'attributeSummary'],
      properties: {
        _id: { bsonType: 'objectId' },
        contract: { bsonType: 'string' },
        totalSupply: { bsonType: 'int' },
        name: { bsonType: 'string' },
        symbol: { bsonType: 'string' },
        image: { bsonType: 'string' },
        attributeSummary: { bsonType: 'object' },
      },
    },
  },
};

const token = {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      additionalProperties: false,
      required: ['_id', 'tokenId', 'attributes'],
      properties: {
        _id: { bsonType: 'objectId' },
        tokenId: { bsonType: 'int' },
        image: { bsonType: 'string' },
        attributes: { bsonType: 'object' },
      },
    },
  },
};

export async function dbMigrate() {
  await databaseMain.createCollection('order', order);
  await databaseMain.createCollection('activity', activity);
  await databaseMain.createCollection('notification', notification);
  await databaseMain.createCollection('collection', collection);

  await db.order.createIndex({ contract: 1, tokenId: 1 }, { unique: true });
  await db.activity.createIndex({ txHash: 1 }, { unique: true });
  await db.collection.createIndex({ contract: 1 }, { unique: true });
}

export async function createTokenCollection(contract: string) {
  await databaseTokens.createCollection(contract, token);
  db.token(contract).createIndex({ tokenId: 1 }, { unique: true });
}
