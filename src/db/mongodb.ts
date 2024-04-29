import { MongoClient } from 'mongodb';
import { config } from '../config';

export const dbClient = new MongoClient(config.db.uri);
export const db = dbClient.db(config.db.name);
