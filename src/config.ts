function fail(varName: string) {
  throw new Error(`${varName} is required.`);
}

const getEnv = (varName: string) => (process.env[varName] || fail(varName)) as string;

export enum EthereumNetwork {
  Mainnet = '1',
  Sepolia = '11155111',
}

export const config = {
  ethereumNetwork: EthereumNetwork.Sepolia,
  db: {
    uri: 'mongodb://localhost:27017',
    name: 'collectoor',
  },
  eth: {
    alchemyApiKey: getEnv('ALCHEMY_API_KEY'),
    seaportContract: '0x0000000000000068F116a894984e2DB1123eB395',
  },
};
