import { MongoClient } from 'mongodb';
import { config } from '../config';
import { DbActivity, DbCollection, DbNotification, DbOrder, DbToken } from './types';

export const dbClient = new MongoClient(config.db.uri);

export const databaseMain = dbClient.db(config.db.name);
export const databaseTokens = dbClient.db(config.db.name + '-tokens');
export const db = {
  activity: databaseMain.collection<DbActivity>('activity'),
  collection: databaseMain.collection<DbCollection>('collection'),
  notification: databaseMain.collection<DbNotification>('notification'),
  order: databaseMain.collection<DbOrder>('order'),
  token(contract: string) {
    return databaseTokens.collection<DbToken>(contract);
  },
};
