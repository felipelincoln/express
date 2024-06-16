const ALCHEMY_API_KEY = 'none';
const OPENSEA_API_KEY = 'none';
const NFTSCAN_API_KEY = 'nMDstwxluFoTJKgq771WaoWa';

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
      },
    },
    {
      name: 'collection-listener',
      script: 'build/tasks/dbCollectionListener.js',
      env: {
        ALCHEMY_API_KEY,
        OPENSEA_API_KEY,
        NFTSCAN_API_KEY,
      },
    },
    {
      name: 'event-listener',
      script: 'build/tasks/ethEventListener.js',
      env: {
        ALCHEMY_API_KEY,
        OPENSEA_API_KEY,
        NFTSCAN_API_KEY,
      },
    },
  ],
};
