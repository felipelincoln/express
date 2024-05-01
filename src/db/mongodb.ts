import { MongoClient } from 'mongodb';
import { config } from '../config';

export const dbClient = new MongoClient(config.db.uri, { forceServerObjectId: true });
export const db = dbClient.db(config.db.name);
