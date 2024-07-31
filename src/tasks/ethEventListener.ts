import fs from 'fs';
import { createLogger } from '../log';
import { alchemyClient, lowerCaseAddress } from '../eth';
import { Log } from 'alchemy-sdk';
import { DbActivity, DbNotification, DbOrder, db } from '../db';
import { decodeEventLog, erc721Abi } from 'viem';
import seaportAbi from './ethEventListener/seaport.abi.json';
import moment from 'moment';
import { WithId } from 'mongodb';
import { config } from '../config';

const FULFILLED_ORDER = '0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31';
const CANCELED_ORDER = '0x6bacc01dbe442496068f7d234edd811f1a5f833243e0aec824f86ab861f3c90d';
const INCREMENTED_COUNTER = '0x721c20121297512b72821b97f5326877ea8ecf4bb9948fea5bfcb6453074d37f';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_FOR_ALL = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31';

const logger = createLogger();
logger.info('task started');
const stateFile = '.currentBlock';
const blocksRange = 25;
const taskInterval = 12_000;
let isRunning = false;

async function run() {
  isRunning = true;

  const ethCurrentBlock = await alchemyClient.core.getBlockNumber();

  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, ethCurrentBlock.toString());
  }

  const lastProcessedBlock = Number(fs.readFileSync(stateFile, 'utf8'));
  const blockToProcess = Math.min(ethCurrentBlock, lastProcessedBlock + blocksRange);

  if (blockToProcess == lastProcessedBlock) {
    isRunning = false;
    return;
  }

  let logs: Log[] = [];

  try {
    logs = await alchemyClient.core.getLogs({
      fromBlock: lastProcessedBlock + 1,
      toBlock: blockToProcess,
    });
  } catch (e) {
    logger.error(e);
    isRunning = false;
    return;
  }

  logger.info(`${logs.length} events on block ${blockToProcess}`);

  const orders = await db.order.find().toArray();

  for (const log of logs) {
    const topic0 = log.topics[0];
    const address = lowerCaseAddress(log.address);

    if (log.removed) continue;

    switch (topic0) {
      case FULFILLED_ORDER:
        if (address !== config.web3.seaportContract) break;
        await processFulfilledOrder(log, orders);
        break;
      case CANCELED_ORDER:
        if (address !== config.web3.seaportContract) break;
        await processCanceledOrder(log, orders);
        break;
      case INCREMENTED_COUNTER:
        if (address !== config.web3.seaportContract) break;
        await processIncrementedCounter(log, orders);
        break;
      case TRANSFER:
        await processTransfer(log, orders);
        break;
      case APPROVAL_FOR_ALL:
        await processSetApprovalForAll(log, orders);
        break;
      default:
        break;
    }
  }

  fs.writeFileSync(stateFile, blockToProcess.toString());
  isRunning = false;
}

setInterval(async () => {
  if (isRunning) return;

  try {
    await run();
  } catch (e) {
    logger.error('task failed. retrying', { context: e });
    isRunning = false;
  }
}, taskInterval);

async function processFulfilledOrder(fulfilledOrder: Log, orders: WithId<DbOrder>[]) {
  const decodedLog = decodeEventLog({
    abi: seaportAbi,
    data: fulfilledOrder.data as `0x${string}`,
    topics: fulfilledOrder.topics as [],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = decodedLog.args as any as {
    orderHash: string;
    recipient: string;
    consideration: { token: string; identifier: bigint }[];
  };
  const orderHash = args.orderHash;
  const activeOrder = orders.find((order) => order.orderHash === orderHash);

  if (!activeOrder) return;

  const txHash = fulfilledOrder.transactionHash;
  const fulfiller = lowerCaseAddress(args.recipient);
  const identifier = args.consideration
    .filter((c) => lowerCaseAddress(c.token) == activeOrder.contract)
    .map((c) => Number(c.identifier));

  const activity: DbActivity = {
    etype: 'trade',
    tokenId: activeOrder.tokenId,
    contract: activeOrder.contract,
    offerer: activeOrder.offerer,
    fulfiller,
    fulfillment: {
      token: {
        amount: activeOrder.fulfillmentCriteria.token.amount,
        identifier,
      },
    },
    txHash,
    createdAt: moment().unix(),
  };

  if (activeOrder.fulfillmentCriteria.coin) {
    activity.fulfillment.coin = activeOrder.fulfillmentCriteria.coin;
  }

  const activityInsertResult = await db.activity.insertOne(activity);

  const notification: DbNotification = {
    activityId: activityInsertResult.insertedId,
    address: activeOrder.offerer,
    contract: activeOrder.contract,
  };

  await db.notification.insertOne(notification);
  await db.order.deleteOne({ _id: activeOrder._id });

  logger.info(`fulfilled ${txHash} ✅`);
}

async function processCanceledOrder(canceledOrder: Log, orders: WithId<DbOrder>[]) {
  const decodedLog = decodeEventLog({
    abi: seaportAbi,
    data: canceledOrder.data as `0x${string}`,
    topics: canceledOrder.topics as [],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = decodedLog.args as any as { orderHash: string };
  const orderHash = args.orderHash;
  const activeOrder = orders.find((order) => order.orderHash === orderHash);

  if (!activeOrder) return;

  await db.order.deleteOne({ _id: activeOrder._id });

  logger.info(`cancelled ${activeOrder.contract}:${activeOrder.tokenId}🔥`);
}

async function processIncrementedCounter(incrementedCounter: Log, orders: WithId<DbOrder>[]) {
  const decodedLog = decodeEventLog({
    abi: seaportAbi,
    data: incrementedCounter.data as `0x${string}`,
    topics: incrementedCounter.topics as [],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = decodedLog.args as any as { offerer: string };
  const offerer = lowerCaseAddress(args.offerer);
  const offererActiveOrders = orders.filter((order) => order.offerer === offerer);

  if (offererActiveOrders.length == 0) return;

  await db.order.deleteMany({ offerer });

  for (const offererActiveOrder of offererActiveOrders) {
    logger.info(`cancelled ${offererActiveOrder.contract}:${offererActiveOrder.tokenId}🔥`);
  }
}

async function processTransfer(transfer: Log, orders: WithId<DbOrder>[]) {
  if (transfer.topics.length != 4) return;

  const decodedLog = decodeEventLog({
    abi: erc721Abi,
    data: transfer.data as `0x${string}`,
    topics: transfer.topics as [],
  });

  const token = lowerCaseAddress(transfer.address);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = decodedLog.args as any as {
    from: string;
    to: string;
    tokenId: bigint;
  };
  const from = lowerCaseAddress(args.from);
  const to = lowerCaseAddress(args.to);
  const tokenId = Number(args.tokenId);

  const transferedActiveOrders = orders.filter(
    (order) => order.contract === token && order.tokenId === tokenId,
  );
  if (transferedActiveOrders.length == 0) return;
  for (const transferedActiveOrder of transferedActiveOrders) {
    const offerer = transferedActiveOrder.offerer;

    // 1. Offerer is transfering out the token with active order: Deactivate order
    if (from == offerer) {
      await db.order.updateOne({ _id: transferedActiveOrder._id }, { $set: { transferred: true } });
      logger.info(
        `transferred = true ${transferedActiveOrder.contract}:${transferedActiveOrder.tokenId} ⏸`,
      );
      continue;
    }

    // 2. Someone is transfering back the token to offerer with inactive order: Activate order
    if (to == offerer) {
      await db.order.updateOne(
        { _id: transferedActiveOrder._id },
        { $set: { transferred: false } },
      );
      logger.info(
        `transferred = false ${transferedActiveOrder.contract}:${transferedActiveOrder.tokenId} ▶️`,
      );
      continue;
    }
  }
}

async function processSetApprovalForAll(approvalForAll: Log, orders: WithId<DbOrder>[]) {
  if (approvalForAll.topics.length != 3) return;

  const decodedLog = decodeEventLog({
    abi: erc721Abi,
    data: approvalForAll.data as `0x${string}`,
    topics: approvalForAll.topics as [],
  });

  const token = lowerCaseAddress(approvalForAll.address);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const args = decodedLog.args as any as {
    owner: string;
    operator: string;
    approved: boolean;
  };
  const owner = lowerCaseAddress(args.owner);
  const operator = lowerCaseAddress(args.operator);
  const approved = args.approved;

  const setApprovalActiveOrders = orders.filter(
    (order) => order.contract === token && order.offerer === owner,
  );
  if (setApprovalActiveOrders.length === 0) return;
  if (operator !== config.web3.seaportConduitContract) return;

  // 1. User is revoking allowance: Deactivate orders
  if (!approved) {
    await db.order.updateMany(
      { _id: { $in: setApprovalActiveOrders.map((order) => order._id) } },
      { $set: { allowed: false } },
    );

    for (const transferedActiveOrder of setApprovalActiveOrders) {
      logger.info(
        `allowed = false ${transferedActiveOrder.contract}:${transferedActiveOrder.tokenId} ⏸`,
      );
    }
  }

  // 2. User is giving approval: Activate order
  if (approved) {
    await db.order.updateMany(
      { _id: { $in: setApprovalActiveOrders.map((order) => order._id) } },
      { $set: { allowed: true } },
    );
    for (const transferedActiveOrder of setApprovalActiveOrders) {
      logger.info(
        `allowed = true ${transferedActiveOrder.contract}:${transferedActiveOrder.tokenId} ▶️`,
      );
    }
  }
}
