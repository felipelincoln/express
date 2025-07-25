import express, { NextFunction, Request, Response } from 'express';
import { createLogger } from './log';
import cors from 'cors';
import { alchemyClient, lowerCaseAddress, nftScanClient } from './eth';
import { isAddress } from 'viem';
import { DbCollection, DbOrder, db, isOrderValid } from './db';
import moment from 'moment';
import { ObjectId } from 'mongodb';
import { config } from './config';
import { TrendingCollection } from './virtualTypes';
import io from '@pm2/io';

const logger = createLogger();
const app = express();

const homeReqs = io.counter({ name: 'Home requests count' });

app.use(express.json());
app.use(cors({ origin: '*' }));
app.use((_, res, next) => {
  const json = res.json;

  res.json = function (body?: any) {
    res.locals.error = body.error;
    return json.call(this, body);
  };

  res.locals.startTime = moment.now();
  res.status(404);

  next();
});

// alchemy - jsonrpc
app.post('/jsonrpc', async (req, res, next) => {
  try {
    const { method, params, id, jsonrpc } = req.body;
    const result = await alchemyClient.core.send(method, params);

    res.status(200).json({ jsonrpc, id, result });
    next();
  } catch (err) {
    next(err);
  }
});

// deprecated
app.get('/collections/list/', async (req, res, next) => {
  const {
    limit,
    skip,
  }: {
    limit?: number;
    skip?: number;
  } = req.query;

  if (limit && !isValidNumber(limit)) {
    res.status(400).json({ error: 'invalid `limit` field' });
    next();
    return;
  }

  if (skip && !isValidNumber(skip)) {
    res.status(400).json({ error: 'invalid `skip` field' });
    next();
    return;
  }

  const collections = await db.collection
    .find({}, { limit, skip, projection: { _id: 0 } })
    .toArray();

  res.status(200).json({ data: { collections } });
  next();
});

app.get('/collections/trending/', async (req, res, next) => {
  const collections = await db.collection
    .find({}, { limit: 100, projection: { _id: 0 } })
    .toArray();

  const trending: TrendingCollection[] = [];

  for (const dbCollection of collections) {
    const listingsQuery: any = {
      contract: lowerCaseAddress(dbCollection.contract),
      allowed: { $ne: false },
      transferred: { $ne: true },
      endTime: { $gt: moment().unix() },
    };
    const listingRows = await db.order.find(listingsQuery).toArray();
    const floorPrice = listingRows.reduce(
      (floor, listing) => {
        const tokenPrice = Number(listing.fulfillmentCriteria.token.amount);
        const ethPrice =
          BigInt(listing.fulfillmentCriteria.coin?.amount || '0') +
          BigInt(listing.fee?.amount || '0');

        if (floor.tokenPrice === 0 && floor.ethPrice === BigInt(0)) {
          return { ethPrice, tokenPrice };
        }

        if (tokenPrice < floor.tokenPrice) {
          return { ethPrice, tokenPrice };
        }

        if (ethPrice < floor.ethPrice && tokenPrice <= floor.tokenPrice) {
          return { ethPrice, tokenPrice };
        }

        return floor;
      },
      { ethPrice: BigInt(0), tokenPrice: 0 },
    );
    const listings = listingRows.length;
    const trades = await db.activity.countDocuments({ contract: dbCollection.contract });

    const collection: TrendingCollection = {
      collection: dbCollection,
      listings,
      trades,
      floorPrice: {
        ethPrice: floorPrice.ethPrice.toString(),
        tokenPrice: floorPrice.tokenPrice,
      },
    };

    if (listings === 0 && trades === 0) continue;

    trending.push(collection);
  }

  trending.sort((a, b) => {
    if (a.trades !== b.trades) {
      return b.trades - a.trades;
    }

    if (a.listings !== b.listings) {
      return b.listings - a.listings;
    }

    return 1;
  });

  homeReqs.inc();
  res.status(200).json({ data: { trending } });
  next();
});

// nftscan - get contract metadata
app.get('/collections/get/:contract', async (req, res, next) => {
  const { contract } = req.params;

  if (!isAddress(contract)) {
    res.status(400).json({ error: 'invalid `contract`' });
    next();
    return;
  }

  const lowerCaseContract = lowerCaseAddress(contract);

  try {
    const collection = await db.collection.findOne(
      { contract: lowerCaseContract },
      { projection: { _id: 0 } },
    );

    if (collection) {
      const tokensCount = await db.token(lowerCaseContract).countDocuments();

      const isReady = tokensCount == collection.totalSupply;

      if (isReady) {
        const tokens = await db
          .token(lowerCaseContract)
          .find({}, { projection: { attributes: 0 } })
          .toArray();

        const tokenImages = Object.fromEntries(tokens.map((t) => [t.tokenId, t.image]));

        res.status(200).json({ data: { collection, isReady: isReady, tokenImages } });
        next();
        return;
      }

      res.status(200).json({ data: { collection, isReady: isReady } });
      next();
      return;
    }

    if (config.web3.blockedCollectionContracts.includes(lowerCaseContract)) {
      logger.warn(`[${lowerCaseContract}] is a blocked contract`);
      res.status(400).json({ error: 'this contract is not supported yet' });
      next();
      return;
    }

    const metadata = await nftScanClient.collection.getCollectionsByContract(contract, true);

    if (!metadata) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    if (metadata.erc_type != 'erc721') {
      res.status(400).json({ error: 'only ERC721 tokens are supported' });
      next();
      return;
    }

    if (Number(metadata.items_total) > 31000) {
      logger.warn(`[${lowerCaseContract}] has supply of ${metadata.items_total}`);
      res.status(400).json({ error: 'this contract is not supported yet' });
      next();
      return;
    }

    if (Object.entries(metadata.attributes).length === 0) {
      logger.warn(`[${lowerCaseContract}] has no attributes`);
      res.status(400).json({ error: 'this contract is not supported yet' });
      next();
      return;
    }

    const attributes = metadata.attributes;
    const attributeSummaryList = [];

    for (const [k, attribute] of Object.entries(attributes)) {
      const options = attribute.attributes_values.map((val) => val.attributes_value);
      options.sort();
      attributeSummaryList.push({
        attribute: attribute.attributes_name,
        options: Object.fromEntries(Object.entries(options)),
      });
    }

    attributeSummaryList.sort((a, b) => a.attribute.localeCompare(b.attribute));

    const newCollection: DbCollection = {
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.logo_url,
      contract: lowerCaseContract,
      totalSupply: metadata.items_total,
      attributeSummary: Object.fromEntries(Object.entries(attributeSummaryList)),
    };

    await db.collection.insertOne(newCollection);

    res.status(200).json({ data: { collection: newCollection, isReady: false } });
    next();
  } catch (err) {
    next(err);
  }
});

// alchemy - get nfts for owner
app.get('/eth/tokens/list/:contract/:userAddress', async (req, res, next) => {
  try {
    const { contract, userAddress } = req.params;

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    if (!isAddress(userAddress)) {
      res.status(400).json({ error: 'invalid `userAddress`' });
      next();
      return;
    }

    const lowerCaseContract = lowerCaseAddress(contract);

    const collection = await db.collection.findOne({ contract: lowerCaseContract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    const nfts = alchemyClient.nft.getNftsForOwnerIterator(userAddress, {
      contractAddresses: [contract],
      omitMetadata: true,
    });

    let tokenIds: number[] = [];
    for await (const { tokenId } of nfts) {
      tokenIds.push(Number(tokenId));
    }

    res.status(200).json({ data: { tokenIds } });
    next();
  } catch (err) {
    next(err);
  }
});

// alchemy - get nfts for owner
app.get('/eth/collections/list/:userAddress', async (req, res, next) => {
  try {
    const { userAddress } = req.params;

    if (!isAddress(userAddress)) {
      res.status(400).json({ error: 'invalid `userAddress`' });
      next();
      return;
    }

    const nfts = alchemyClient.nft.getNftsForOwnerIterator(userAddress);

    let collections: { name: string; image: string; contract: string; count: number }[] = [];
    for await (const nft of nfts) {
      if (nft.contract.tokenType != 'ERC721') continue;
      if (!nft.contract.name) continue;
      if (!nft.image.thumbnailUrl) continue;
      if (config.web3.blockedCollectionContracts.includes(lowerCaseAddress(nft.contract.address)))
        continue;

      const collection = {
        name: nft.contract.name,
        image: nft.image.thumbnailUrl,
        contract: nft.contract.address,
        count: 1,
      };

      const existingCollection = collections.findIndex((c) => c.contract === collection.contract);
      if (existingCollection >= 0) {
        collections[existingCollection].count++;
        continue;
      }

      collections.push(collection);
    }

    res.status(200).json({ data: { collections } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/tokens/list/:contract', async (req, res, next) => {
  try {
    const { contract } = req.params;
    const {
      tokenIds,
      filter,
      limit,
      skip,
    }: {
      tokenIds?: string[];
      filter?: Record<string, string>;
      limit?: number;
      skip?: number;
    } = req.body;

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    if (tokenIds && !isValidNumberArray(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (limit && !isValidNumber(limit)) {
      res.status(400).json({ error: 'invalid `limit` field' });
      next();
      return;
    }

    if (skip && !isValidNumber(skip)) {
      res.status(400).json({ error: 'invalid `skip` field' });
      next();
      return;
    }

    if (filter && !isValidObject(filter)) {
      res.status(400).json({ error: 'invalid `filter` field' });
      next();
      return;
    }

    const lowerCaseContract = lowerCaseAddress(contract);

    const collection = await db.collection.findOne({ contract: lowerCaseContract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    if (filter) {
      Object.keys(filter).forEach((key) => {
        filter['attributes.' + key] = filter[key];
        delete filter[key];
      });
    }

    const query: Record<string, any> = { ...filter };

    if (tokenIds) {
      query.tokenId = { $in: tokenIds };
    }

    const projection = { attributes: 0, image: 0 };
    const filteredTokens = await db
      .token(lowerCaseContract)
      .find(query, { sort: { tokenId: 1 }, limit, skip, projection })
      .toArray();

    const filteredTokenIds = filteredTokens.map((token) => token.tokenId);
    const count = await db.token(lowerCaseContract).countDocuments(query);

    res.status(200).json({ data: { tokens: filteredTokenIds, limit, skip, count } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/orders/create/', async (req, res, next) => {
  try {
    const { order }: { order: DbOrder } = req.body;

    if (!order) {
      res.status(400).json({ error: 'missing `order` field in request body' });
      next();
      return;
    }

    if (!isValidObject(order)) {
      res.status(400).json({ error: 'invalid `order` field' });
      next();
      return;
    }

    if (!isOrderValid(order)) {
      res.status(400).json({ error: 'invalid order' });
      next();
      return;
    }

    const query = { contract: order.contract, tokenId: order.tokenId };
    const existingOrder = await db.order.findOne(query);
    if (existingOrder) {
      const hasExpired = moment.unix(Number(existingOrder.endTime)).isBefore(moment());
      if (hasExpired) {
        await db.order.deleteOne({ _id: existingOrder._id });
      }
    }

    const { contract, offerer, fee } = order;
    await db.order.insertOne({
      ...order,
      contract: lowerCaseAddress(contract),
      offerer: lowerCaseAddress(offerer),
      fee: fee ? { recipient: lowerCaseAddress(fee.recipient), amount: fee.amount } : undefined,
    });

    res.status(200).json({ data: 'order created' });
    next();
  } catch (err) {
    const dbErrorCode = (err as any).code;

    switch (dbErrorCode) {
      case 11000:
        res.status(400).json({ error: `${req.body.order.tokenId} is listed` });
        next();
        return;
      default:
        next(err);
    }
  }
});

app.post('/orders/list/:contract', async (req, res, next) => {
  try {
    const { tokenIds, offerer }: { tokenIds?: number[]; offerer?: string } = req.body;
    const { contract } = req.params;

    if (offerer && !isAddress(offerer)) {
      res.status(400).json({ error: 'invalid `offerer` field' });
      next();
      return;
    }

    if (tokenIds && !isValidNumberArray(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    let query: any = {
      contract: lowerCaseAddress(contract),
      allowed: { $ne: false },
      transferred: { $ne: true },
      endTime: { $gt: moment().unix() },
    };

    if (!!offerer) {
      query.offerer = lowerCaseAddress(offerer);
    }

    if (!!tokenIds) {
      query.tokenId = { $in: tokenIds };
    }

    const orders = await db.order.find(query, { projection: { _id: 0 } }).toArray();

    res.status(200).json({ data: { orders } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/activities/list/:contract', async (req, res, next) => {
  try {
    const { address, tokenIds }: { address?: string; tokenIds?: number[] } = req.body;
    const { contract } = req.params;

    if (address && !isAddress(address)) {
      res.status(400).json({ error: 'invalid `address` field' });
      next();
      return;
    }

    if (tokenIds && !isValidNumberArray(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    let query: any = { contract: lowerCaseAddress(contract) };

    if (!!address) {
      query.$or = [
        { fulfiller: lowerCaseAddress(address) },
        { offerer: lowerCaseAddress(address) },
      ];
    }

    if (!!tokenIds) {
      query.tokenId = { $in: tokenIds };
    }

    const activities = await db.activity.find(query, { sort: { createdAt: -1 } }).toArray();

    res.status(200).json({ data: { activities } });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/notifications/list/:contract/:address', async (req, res, next) => {
  try {
    const { address, contract } = req.params;

    if (!isAddress(address)) {
      res.status(400).json({ error: 'invalid `address`' });
      next();
      return;
    }

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    const query = { contract: lowerCaseAddress(contract), address: lowerCaseAddress(address) };
    const notifications = await db.notification.find(query).toArray();

    res.status(200).json({ data: { notifications } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/notifications/view/', async (req, res, next) => {
  try {
    const { notificationIds }: { notificationIds: string[] } = req.body;

    if (notificationIds && !isValidStringArray(notificationIds)) {
      res.status(400).json({ error: 'invalid `notificationIds` field' });
      next();
      return;
    }

    const notificationObjectIds = notificationIds.map((id) => new ObjectId(id));

    const query = { _id: { $in: notificationObjectIds } };
    const notifications = await db.notification.deleteMany(query);

    res.status(200).json({ data: { notifications } });
    next();
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({ error: 'Internal server error' });
  next();
  logger.error(err.stack);
  io.notifyError(err), { context: { req } };
});

// Logger
app.use((req, res, next) => {
  const ms = moment.now() - res.locals.startTime;
  const logMessage = `${res.statusCode} ${req.method} ${req.url} (${ms} ms)`;
  const error = res.locals.error;

  if ([200, 304].includes(res.statusCode)) {
    logger.info(logMessage);
  } else if ([500].includes(res.statusCode)) {
    logger.error(logMessage, { context: { error } });
  } else {
    logger.warn(logMessage, { context: { error } });
  }
  next();
});

app.listen(3000, async () => {
  logger.info('Server started on http://localhost:3000');
});

function isValidNumberArray(numArray: any): boolean {
  if (!Array.isArray(numArray)) {
    return false;
  }

  if (
    !numArray.every((num) => {
      return isValidNumber(num);
    })
  ) {
    return false;
  }

  return true;
}

function isValidStringArray(strArray: any): boolean {
  if (!Array.isArray(strArray)) {
    return false;
  }

  if (
    !strArray.every((str) => {
      return isValidString(str);
    })
  ) {
    return false;
  }

  return true;
}

function isValidObject(object: any): boolean {
  return typeof object === 'object' && !Array.isArray(object) && object !== null;
}

function isValidString(string: any): boolean {
  return typeof string === 'string';
}

function isValidNumber(number: any): boolean {
  return typeof number === 'number';
}
