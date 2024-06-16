import { Alchemy, Network as AlchemyNetwork } from 'alchemy-sdk';
import { Network, config } from '../config';

const alchemyNetwork = (() => {
  switch (config.network) {
    case Network.EthMainnet:
      return AlchemyNetwork.ETH_MAINNET;
    case Network.EthSepolia:
      return AlchemyNetwork.ETH_SEPOLIA;
    case Network.Base:
      return AlchemyNetwork.BASE_MAINNET;
    default:
      throw new Error(`Invalid Ethereum Network: ${config.network}`);
  }
})();

export const alchemyClient = new Alchemy({
  apiKey: config.web3.alchemyApiKey,
  network: alchemyNetwork,
});
