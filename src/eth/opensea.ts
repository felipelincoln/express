import { Network, config } from '../config';
import axios from 'axios';

const OpenseaNetwork = (() => {
  switch (config.network) {
    case Network.EthMainnet:
      return 'ethereum';
    case Network.EthSepolia:
      return 'sepolia';
    case Network.Base:
      return 'base';
    case Network.Polygon:
      return 'matic';
    default:
      throw new Error(`Invalid Ethereum Network: ${config.network}`);
  }
})();

interface NftAttribute {
  trait_type: string;
  value: string;
}

interface GetNFTResponse {
  nft?: { traits?: NftAttribute[] | null; display_image_url?: string | null };
  errors?: string[];
}

class Opensea {
  private apiUrl: string = config.web3.openseaApiUrl + '/api/v2';
  private apiKey: string = '';
  private network: string = '';

  constructor({ apiKey, network }: { apiKey: string; network: string }) {
    this.apiKey = apiKey;
    this.network = network;
  }

  async getNFT(
    contract: string,
    tokenId: string,
  ): Promise<{ attributes?: NftAttribute[]; image?: string }> {
    const endpoint = `${this.apiUrl}/chain/${this.network}/contract/${contract}/nfts/${tokenId}`;
    const response = await axios.get<GetNFTResponse>(endpoint, {
      headers: { accept: 'application/json', 'x-api-key': this.apiKey },
    });

    const image = response.data.nft?.display_image_url ?? undefined;
    const attributes = response.data.nft?.traits?.map((attribute) => {
      return { trait_type: attribute.trait_type, value: attribute.value };
    });

    return { attributes, image };
  }
}

export const openseaClient = new Opensea({
  apiKey: config.web3.openseaApiKey,
  network: OpenseaNetwork,
});
