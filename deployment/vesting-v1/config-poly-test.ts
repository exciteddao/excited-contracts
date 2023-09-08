import { zeroAddress } from "@defi.org/web3-candies";

export interface Config {
  xctdAddress: string;
  durationSeconds: number;
  daoWalletAddress: string;
  projectWalletAddress: string;
}

export const _config: Config = {
  // TODO: replace with real address
  xctdAddress: "0xb49d92F90eD85Be05b0e114cb11D2ea48607F2e8",
  durationSeconds: 60 * 60 * 24 * 4,
  // TODO: replace with real address
  daoWalletAddress: "0xC1760d11bb342EBCD4fbE30f3c673558dE1DBd2c",
  // TODO: replace with real address
  projectWalletAddress: "0xC1760d11bb342EBCD4fbE30f3c673558dE1DBd2c",
};

export type ConfigTuple = [string, number, string, string];

export const config: ConfigTuple = [_config.xctdAddress, _config.durationSeconds, _config.daoWalletAddress, _config.projectWalletAddress];
