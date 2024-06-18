const ALCHEMY_API_KEY = '';
const OPENSEA_API_KEY = '';
const NFTSCAN_API_KEY = '';
const MONGO_URI = '';
const MONGO_DBNAME = '';
const CHAIN = '';

module.exports = {
  apps: [
    {
      name: 'api',
      script: 'build/server.js',
      exec_mode: 'cluster',
      instances: 'max',
      env: {
        ALCHEMY_API_KEY,
        OPENSEA_API_KEY,
        NFTSCAN_API_KEY,
        MONGO_URI,
        MONGO_DBNAME,
        CHAIN,
      },
    },
    {
      name: 'collection-listener',
      script: 'build/tasks/dbCollectionListener.js',
      env: {
        ALCHEMY_API_KEY,
        OPENSEA_API_KEY,
        NFTSCAN_API_KEY,
        MONGO_URI,
        MONGO_DBNAME,
        CHAIN,
      },
    },
    {
      name: 'event-listener',
      script: 'build/tasks/ethEventListener.js',
      env: {
        ALCHEMY_API_KEY,
        OPENSEA_API_KEY,
        NFTSCAN_API_KEY,
        MONGO_URI,
        MONGO_DBNAME,
        CHAIN,
      },
    },
  ],
};
