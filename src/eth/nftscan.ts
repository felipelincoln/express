import { EvmChain, NftscanEvm } from 'nftscan-api';
import { Network, config } from '../config';

const NftScanNetwork = (() => {
  switch (config.network) {
    case Network.EthMainnet:
      return EvmChain.ETH;
    case Network.EthSepolia:
      return undefined;
    case Network.Base:
      return EvmChain.BASE;
    default:
      throw new Error(`Invalid Ethereum Network: ${config.network}`);
  }
})();

export const nftScanClient = new NftscanEvm({
  apiKey: config.web3.nftscanApiKey,
  chain: NftScanNetwork,
});
