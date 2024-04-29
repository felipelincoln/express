import { Alchemy, Network } from 'alchemy-sdk';
import { EthereumNetwork, config } from '../config';

const alchemyNetwork = (() => {
  switch (config.ethereumNetwork) {
    case EthereumNetwork.Mainnet:
      return Network.ETH_MAINNET;
    case EthereumNetwork.Sepolia:
      return Network.ETH_SEPOLIA;
    default:
      throw new Error(`Invalid Ethereum Network: ${config.ethereumNetwork}`);
  }
})();

export const alchemyClient = new Alchemy({
  apiKey: config.eth.alchemyApiKey,
  network: alchemyNetwork,
});
