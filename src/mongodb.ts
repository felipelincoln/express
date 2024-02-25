import { MongoClient } from 'mongodb';

const mongoDbUri =
  'mongodb+srv://express:unz3JN7zeo5rLK3J@free.ej7kjrx.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';

export const mongoClient = new MongoClient(mongoDbUri);
