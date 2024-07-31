module.exports = {
  apps: [
    {
      name: 'api',
      script: 'build/server.js',
      exec_mode: 'cluster',
      instances: 'max',
    },
    {
      name: 'collection-listener',
      script: 'build/tasks/dbCollectionListener.js',
    },
    {
      name: 'event-listener',
      script: 'build/tasks/ethEventListener.js',
    },
  ],
};
